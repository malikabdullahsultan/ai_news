from __future__ import annotations

import os
import shutil
import subprocess
from datetime import date, datetime, timezone
from pathlib import Path

import pytest

from scripts.providers import ProviderError, SambaNovaProvider, make_provider
from scripts.report_pipeline import (
    FeedItem,
    build_evidence_fallback_report,
    build_system_prompt,
    calculate_importance_rating,
    cluster_items,
    ensure_report_date_heading,
    parse_feed,
    persist_report,
    redact_report_for_debug,
    report_date_from_utc,
    report_date_for,
    select_candidate_stories,
    validate_report,
    write_debug_report,
)


ROOT = Path(__file__).resolve().parents[1]


def test_hong_kong_timezone_rolls_forward_after_1930_utc() -> None:
    before = datetime(2026, 8, 11, 19, 29, tzinfo=timezone.utc)
    after = datetime(2026, 8, 11, 19, 30, tzinfo=timezone.utc)
    assert report_date_for(before) == date(2026, 8, 12)
    assert report_date_for(after) == date(2026, 8, 12)
    assert report_date_from_utc("2026-08-11T18:00:00Z") == "2026-08-12"


def test_parse_feed_filters_old_items() -> None:
    payload = b"""
    <rss><channel>
      <item><title>Fresh model release</title><link>https://example.com/fresh</link><description>Good evidence</description><pubDate>Tue, 11 Aug 2026 19:00:00 GMT</pubDate></item>
      <item><title>Old model release</title><link>https://example.com/old</link><description>Old evidence</description><pubDate>Mon, 01 Aug 2026 19:00:00 GMT</pubDate></item>
    </channel></rss>
    """
    source = {"name": "Example", "organization": "Example Lab", "region": "Global", "kind": "official", "topics": ["models"]}
    items = parse_feed(payload, source, datetime(2026, 8, 10, tzinfo=timezone.utc))
    assert [item.title for item in items] == ["Fresh model release"]


def test_duplicate_coverage_becomes_one_story() -> None:
    items = [
        FeedItem("Qwen releases a new open model", "https://example.com/one", "Official announcement", "2026-08-11T01:00:00+00:00", "Qwen", "Alibaba / Qwen", "China", "official", ["models"]),
        FeedItem("Qwen launches new open model", "https://example.com/two", "Independent reaction", "2026-08-11T02:00:00+00:00", "News", "Newsroom", "Global", "discovery", ["models"]),
    ]
    stories = cluster_items(items, {"global": ["Qwen"], "china": ["Qwen"]})
    assert len(stories) == 1
    assert len(stories[0]["primary_sources"]) == 1
    assert len(stories[0]["secondary_sources"]) == 1
    assert "china" in stories[0]["watchlist_matches"]


def sample_research() -> dict:
    official_source = {
        "name": "Official Lab",
        "organization": "Official Lab",
        "region": "Global",
        "kind": "official",
        "url": "https://example.com/official",
        "published_at": "2026-08-13T01:00:00+00:00",
    }
    research_source = {
        "name": "Research Feed",
        "organization": "Research Lab",
        "region": "Global",
        "kind": "research",
        "url": "https://example.com/paper",
        "published_at": "2026-08-13T02:00:00+00:00",
    }
    discovery_source = {
        "name": "Discovery Feed",
        "organization": "News Index",
        "region": "China",
        "kind": "discovery",
        "url": "https://example.com/discovery",
        "published_at": "2026-08-13T03:00:00+00:00",
    }

    def story(title: str, source: dict, *, watched: bool = False) -> dict:
        primary = [source] if source["kind"] in {"official", "research"} else []
        secondary = [source] if source["kind"] == "discovery" else []
        return {
            "title": title,
            "summary": f"Evidence summary for {title} with enough detail to explain why the item belongs in the daily briefing.",
            "topics": ["models", "research"],
            "primary_sources": primary,
            "secondary_sources": secondary,
            "creator_sources": [],
            "watchlist_matches": ["china"] if watched else [],
        }

    return {
        "successful_source_count": 8,
        "raw_item_count": 42,
        "candidate_story_count": 3,
        "stories": [
            story("Official model release", official_source, watched=True),
            story("New research result", research_source),
            story("China market signal", discovery_source, watched=True),
        ],
    }


def test_candidate_selection_balances_source_types() -> None:
    research = sample_research()
    selected = select_candidate_stories(list(reversed(research["stories"])), 3)
    assert any(story["primary_sources"][0]["kind"] == "official" for story in selected if story["primary_sources"])
    assert any(story["primary_sources"][0]["kind"] == "research" for story in selected if story["primary_sources"])
    assert any(story["secondary_sources"] for story in selected)


def test_evidence_fallback_is_valid_and_rated() -> None:
    research = sample_research()
    report_date = date(2026, 8, 13)
    report = build_evidence_fallback_report(report_date, research)
    assert validate_report(report, report_date) == []
    assert "Evidence-only resilient edition" in report
    assert "https://example.com/official" in report
    assert calculate_importance_rating(research) == 5


def test_all_source_failure_creates_transparent_status_report() -> None:
    report_date = date(2026, 8, 14)
    research = {
        "successful_source_count": 0,
        "raw_item_count": 0,
        "candidate_story_count": 0,
        "stories": [],
        "source_status": [
            {
                "name": "Official Lab",
                "url": "https://example.com/feed.xml",
                "status": "error",
                "error": "temporary timeout",
            }
        ],
    }
    report = build_evidence_fallback_report(report_date, research)
    assert validate_report(report, report_date) == []
    assert "Source availability incident" in report
    assert "no AI claims are being asserted" in report
    assert calculate_importance_rating(research) == 1


def test_provider_failure_persists_resilient_report(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    import scripts.report_pipeline as pipeline

    report_date = date(2026, 8, 13)
    monkeypatch.setattr(pipeline, "ROOT", tmp_path)
    monkeypatch.setattr(pipeline, "REPORTS_PATH", tmp_path / "reports")
    monkeypatch.setattr(pipeline, "RESEARCH_PATH", tmp_path / "research")
    monkeypatch.setattr(pipeline, "META_PATH", tmp_path / "meta")
    monkeypatch.setattr(pipeline, "DEBUG_REPORT_PATH", tmp_path / "debug" / "generated-report.md")
    source_config = tmp_path / "research_sources.json"
    source_config.write_text('{"feeds": []}', encoding="utf-8")
    prompt = tmp_path / "daily-report.md"
    prompt.write_text("Write a careful report.", encoding="utf-8")
    monkeypatch.setattr(pipeline, "SOURCES_PATH", source_config)
    monkeypatch.setattr(pipeline, "PROMPT_PATH", prompt)
    monkeypatch.setattr(pipeline, "collect_research", lambda *args, **kwargs: sample_research())
    monkeypatch.setattr(pipeline, "make_provider", lambda: (_ for _ in ()).throw(ProviderError("temporary free-tier outage")))

    assert pipeline.run(report_date) == 0
    report_path = tmp_path / "reports" / "2026" / "08" / "2026-08-13.md"
    contents = report_path.read_text(encoding="utf-8")
    assert 'model: "deterministic-evidence-fallback"' in contents
    assert "importance: 5" in contents
    assert pipeline.run(report_date) == 0


def test_run_persists_status_report_when_all_sources_fail(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    import scripts.report_pipeline as pipeline

    report_date = date(2026, 8, 14)
    monkeypatch.setattr(pipeline, "ROOT", tmp_path)
    monkeypatch.setattr(pipeline, "REPORTS_PATH", tmp_path / "reports")
    monkeypatch.setattr(pipeline, "RESEARCH_PATH", tmp_path / "research")
    monkeypatch.setattr(pipeline, "META_PATH", tmp_path / "meta")
    monkeypatch.setattr(pipeline, "DEBUG_REPORT_PATH", tmp_path / "debug" / "generated-report.md")
    source_config = tmp_path / "research_sources.json"
    source_config.write_text('{"feeds": []}', encoding="utf-8")
    prompt = tmp_path / "daily-report.md"
    prompt.write_text("Write a careful report.", encoding="utf-8")
    monkeypatch.setattr(pipeline, "SOURCES_PATH", source_config)
    monkeypatch.setattr(pipeline, "PROMPT_PATH", prompt)
    monkeypatch.setattr(
        pipeline,
        "collect_research",
        lambda *args, **kwargs: {
            "successful_source_count": 0,
            "raw_item_count": 0,
            "candidate_story_count": 0,
            "stories": [],
            "source_status": [{"name": "Official Lab", "url": "https://example.com/feed.xml", "status": "error"}],
        },
    )
    monkeypatch.setattr(pipeline, "make_provider", lambda: pytest.fail("provider should not run without evidence"))

    assert pipeline.run(report_date) == 0
    contents = (tmp_path / "reports" / "2026" / "08" / "2026-08-14.md").read_text(encoding="utf-8")
    assert "Source availability incident" in contents
    assert "importance: 1" in contents


def test_validation_catches_missing_sections() -> None:
    errors = validate_report("# A short report", date(2026, 8, 12))
    assert "report is too short" in errors[0]
    assert "SOURCES section is missing" in errors
    assert "Hong Kong report date is missing" in errors


def test_validation_accepts_structured_report() -> None:
    report = """# The Daily AI Intelligence Report — 2026-08-12

## WHAT HAPPENED

Today\'s verified evidence explains a useful change in AI systems. """ + ("More detail. " * 100) + """

An API key may be required to try some developer services. Discussing that phrase is ordinary reporting, not a credential leak.

## SOURCES

- [Official evidence](https://example.com/source)
"""
    assert validate_report(report, date(2026, 8, 12)) == []


def test_validation_rejects_credential_assignment_but_redacts_value() -> None:
    fake_credential = "test-only-credential-value-123456789"
    report = f"""# The Daily AI Intelligence Report — 2026-08-12

## WHAT HAPPENED

API_KEY={fake_credential}

## SOURCES

- [Evidence](https://example.com)
"""
    errors = validate_report(report, date(2026, 8, 12), minimum_chars=0)
    assert "report contains a credential-like assignment (value redacted)" in errors
    redacted = redact_report_for_debug(report)
    assert fake_credential not in redacted
    assert "API_KEY=[REDACTED CREDENTIAL]" in redacted


def test_debug_artifact_redacts_configured_secret(tmp_path: Path) -> None:
    fake_secret = "configured-test-secret-123456789"
    report = f"# The Daily AI Intelligence Report — 2026-08-12\n\n{fake_secret}\n\n## SOURCES\n"
    errors = validate_report(report, date(2026, 8, 12), secret_values=[fake_secret], minimum_chars=0)
    destination = tmp_path / "generated-report.md"
    write_debug_report(
        date(2026, 8, 12),
        report,
        errors,
        secret_values=[fake_secret],
        destination=destination,
    )
    artifact = destination.read_text(encoding="utf-8")
    assert fake_secret not in artifact
    assert "[REDACTED CONFIGURED SECRET]" in artifact
    assert "Validation: FAILED" in artifact
    assert "report contains a configured secret" in artifact


def test_runtime_prompt_requires_exact_iso_dated_title() -> None:
    prompt = build_system_prompt("Canonical instructions stay unchanged.", date(2026, 8, 12))
    assert "# *** The Daily AI Intelligence Report — 2026-08-12***" in prompt
    assert "Do not convert it to a month-name format" in prompt


def test_date_heading_normalizes_model_month_name() -> None:
    report = """# *** The Daily AI Intelligence Report — August 12, 2026***

## SOURCES

- [Evidence](https://example.com)
"""
    normalized = ensure_report_date_heading(report, date(2026, 8, 12))
    assert normalized.splitlines()[0] == "# *** The Daily AI Intelligence Report — 2026-08-12***"
    assert "August 12, 2026" not in normalized
    assert validate_report(normalized, date(2026, 8, 12), minimum_chars=0) == []


def test_date_heading_is_added_when_model_omits_title() -> None:
    report = "# THE 60-SECOND VERSION\n\nOpening paragraph without a title.\n\n## SOURCES\n\n- Evidence"
    normalized = ensure_report_date_heading(report, date(2026, 8, 12))
    assert normalized.startswith("# *** The Daily AI Intelligence Report — 2026-08-12***\n\n")
    assert "# THE 60-SECOND VERSION" in normalized
    assert ensure_report_date_heading(normalized, date(2026, 8, 12)) == normalized


def test_default_provider_requires_no_openai_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SAMBANOVA_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("AI_PROVIDER", raising=False)
    monkeypatch.setenv("FREE_ONLY", "true")
    with pytest.raises(ProviderError, match="SAMBANOVA_API_KEY"):
        make_provider()


def test_free_only_refuses_paid_or_unknown_model(monkeypatch: pytest.MonkeyPatch) -> None:
    provider = object.__new__(SambaNovaProvider)
    provider.free_only = True
    provider.catalog = lambda: [{"id": "gpt-oss-120b"}]
    with pytest.raises(ProviderError, match="FREE_ONLY"):
        provider.choose_models("openai/gpt-4.1")


def test_auto_prefers_high_quality_verified_free_model() -> None:
    provider = object.__new__(SambaNovaProvider)
    provider.free_only = True
    provider.catalog = lambda: [
        {"id": "Meta-Llama-3.3-70B-Instruct"},
        {"id": "gpt-oss-120b"},
        {"id": "DeepSeek-V3.1"},
    ]
    assert provider.choose_models("auto")[0][0] == "gpt-oss-120b"


def test_free_only_refuses_custom_endpoint() -> None:
    with pytest.raises(ProviderError, match="non-official"):
        SambaNovaProvider(token="test-key", base_url="https://example.com/openai/v1", free_only=True)


def test_retired_github_provider_fails_with_migration_message(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AI_PROVIDER", "github-models")
    monkeypatch.setenv("FREE_ONLY", "true")
    with pytest.raises(ProviderError, match="retired"):
        make_provider()


def test_previous_groq_provider_fails_with_migration_message(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AI_PROVIDER", "groq")
    monkeypatch.setenv("FREE_ONLY", "true")
    with pytest.raises(ProviderError, match="sambanova"):
        make_provider()


def test_openai_cannot_activate_in_free_only_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AI_PROVIDER", "openai")
    monkeypatch.setenv("FREE_ONLY", "true")
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    with pytest.raises(ProviderError, match="disabled"):
        make_provider()


def test_dry_run_and_static_build() -> None:
    dry = subprocess.run(["python", "scripts/report_pipeline.py", "--dry-run", "--date", "2026-08-12"], cwd=ROOT, capture_output=True, text=True)
    assert dry.returncode == 0, dry.stdout + dry.stderr
    build = subprocess.run(["node", "scripts/build-site.mjs"], cwd=ROOT, capture_output=True, text=True)
    assert build.returncode == 0, build.stdout + build.stderr
    assert (ROOT / "dist" / "index.html").exists()
    assert (ROOT / "dist" / "latest" / "index.html").exists()
    assert (ROOT / "dist" / "archive" / "index.html").exists()
    assert (ROOT / "dist" / "search" / "index.html").exists()
    home = (ROOT / "dist" / "index.html").read_text(encoding="utf-8")
    production_reports = list((ROOT / "reports").rglob("*.md"))
    assert ("DEMO MODE" not in home) if production_reports else ("DEMO MODE" in home)
    assert 'href="/ai_news/latest/"' in home
    assert 'href="/ai_news/archive/"' in home
    assert 'href="/ai_news/search/"' in home
    assert 'data-sound-toggle' in home
    client = (ROOT / "dist" / "assets" / "client.js").read_text(encoding="utf-8")
    assert "daily-ai-sound" in client
    assert "AudioContext" in client


def test_production_archive_latest_and_search_index() -> None:
    first = ROOT / "reports" / "2099" / "01" / "2099-01-01.md"
    second = ROOT / "reports" / "2099" / "01" / "2099-01-02.md"
    first.parent.mkdir(parents=True, exist_ok=True)
    template = """---
date: {date}
title: \"The Daily AI Intelligence Report\"
subtitle: \"{subtitle}\"
timezone: \"Asia/Hong_Kong\"
---

# The Daily AI Intelligence Report — {date}

## SOURCES

- [Evidence](https://example.com/{date})
"""
    first.write_text(template.format(date="2099-01-01", subtitle="Older signal"), encoding="utf-8")
    second.write_text(template.format(date="2099-01-02", subtitle="Newer signal"), encoding="utf-8")
    try:
        build = subprocess.run(["node", "scripts/build-site.mjs"], cwd=ROOT, capture_output=True, text=True)
        assert build.returncode == 0, build.stdout + build.stderr
        home = (ROOT / "dist" / "index.html").read_text(encoding="utf-8")
        index = (ROOT / "dist" / "index.json").read_text(encoding="utf-8")
        assert "Newer signal" in home
        assert home.index("Newer signal") < home.index("Older signal")
        assert 'aria-label="Importance 3 out of 5"' in home
        assert index.index("2099-01-02") < index.index("2099-01-01")
        assert '"importance": 3' in index
        assert (ROOT / "dist" / "reports" / "2099-01-02" / "index.html").exists()
    finally:
        shutil.rmtree(ROOT / "reports" / "2099", ignore_errors=True)


def test_duplicate_report_is_rejected(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    import scripts.report_pipeline as pipeline

    monkeypatch.setattr(pipeline, "REPORTS_PATH", tmp_path / "reports")
    result = type("Result", (), {"model": "test-model"})()
    persist_report(date(2099, 1, 3), "# The Daily AI Intelligence Report — 2099-01-03\n\n## SOURCES\n", result)
    with pytest.raises(RuntimeError, match="Refusing to overwrite"):
        persist_report(date(2099, 1, 3), "# duplicate", result)
