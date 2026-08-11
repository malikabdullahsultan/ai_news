from __future__ import annotations

import os
import shutil
import subprocess
from datetime import date, datetime, timezone
from pathlib import Path

import pytest

from scripts.providers import ProviderError, make_provider
from scripts.report_pipeline import (
    FeedItem,
    cluster_items,
    parse_feed,
    persist_report,
    report_date_from_utc,
    report_date_for,
    validate_report,
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


def test_validation_catches_missing_sections() -> None:
    errors = validate_report("# A short report", date(2026, 8, 12))
    assert "report is too short" in errors[0]
    assert "SOURCES section is missing" in errors
    assert "Hong Kong report date is missing" in errors


def test_validation_accepts_structured_report() -> None:
    report = """# The Daily AI Intelligence Report — 2026-08-12

## WHAT HAPPENED

Today\'s verified evidence explains a useful change in AI systems. """ + ("More detail. " * 100) + """

## SOURCES

- [Official evidence](https://example.com/source)
"""
    assert validate_report(report, date(2026, 8, 12)) == []


def test_default_provider_requires_no_openai_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setenv("AI_PROVIDER", "github-models")
    monkeypatch.setenv("FREE_ONLY", "true")
    with pytest.raises(ProviderError, match="GITHUB_TOKEN"):
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
    assert "DEMO MODE" in (ROOT / "dist" / "index.html").read_text(encoding="utf-8")


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
        assert index.index("2099-01-02") < index.index("2099-01-01")
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
