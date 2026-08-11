"""AI provider abstraction for Daily AI Intelligence.

The default provider is GitHub Models. The optional OpenAI provider is deliberately
guarded by FREE_ONLY so a paid endpoint cannot be selected accidentally.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any


class ProviderError(RuntimeError):
    """A provider could not safely complete a request."""


@dataclass
class GenerationResult:
    text: str
    model: str
    finish_reason: str = "stop"
    usage: dict[str, Any] = field(default_factory=dict)
    raw: dict[str, Any] = field(default_factory=dict)


def env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _json_request(
    url: str,
    *,
    method: str = "GET",
    token: str | None = None,
    payload: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    timeout: int = 60,
) -> dict[str, Any] | list[Any]:
    request_headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "daily-ai-intelligence/1.0",
    }
    if headers:
        request_headers.update(headers)
    if token:
        request_headers["Authorization"] = f"Bearer {token}"
    body = None
    if payload is not None:
        request_headers["Content-Type"] = "application/json"
        body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(url, data=body, headers=request_headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")[:500]
        if error.code in {402, 429}:
            raise ProviderError("Daily report could not be generated because the free AI inference limit was reached or unavailable; no paid fallback is enabled.") from error
        if error.code == 403:
            raise ProviderError(f"GitHub Models access was denied. Check the workflow's models: read permission. Detail: {detail}") from error
        raise ProviderError(f"Provider request failed with HTTP {error.code}: {detail}") from error
    except urllib.error.URLError as error:
        raise ProviderError(f"Provider request could not reach {url}: {error.reason}") from error
    try:
        return json.loads(raw)
    except json.JSONDecodeError as error:
        raise ProviderError(f"Provider returned invalid JSON from {url}") from error


class AIProvider:
    name = "abstract"

    def generate(self, system_prompt: str, user_prompt: str, *, model: str = "auto") -> GenerationResult:
        raise NotImplementedError

    def continue_report(self, system_prompt: str, previous_report: str, *, model: str) -> GenerationResult:
        user_prompt = (
            "Continue the Daily AI Intelligence report below from exactly where it ends. "
            "Do not restart it, repeat its title, or add a second sources section. "
            "Keep the same voice and Markdown style. Return only the continuation.\n\n"
            f"CURRENT REPORT TAIL:\n{previous_report[-12000:]}"
        )
        return self.generate(system_prompt, user_prompt, model=model)


class GitHubModelsProvider(AIProvider):
    name = "github-models"
    default_base_url = "https://models.github.ai"
    api_version = "2026-03-10"

    def __init__(self, *, token: str | None = None, base_url: str | None = None, free_only: bool = True):
        self.token = token or os.getenv("GITHUB_TOKEN")
        self.base_url = (base_url or os.getenv("GITHUB_MODELS_API_URL") or self.default_base_url).rstrip("/")
        self.free_only = free_only
        if not self.token:
            raise ProviderError("GITHUB_TOKEN is required for GitHub Models; no paid fallback is enabled.")

    def catalog(self) -> list[dict[str, Any]]:
        result = _json_request(
            f"{self.base_url}/catalog/models",
            token=self.token,
            headers={"X-GitHub-Api-Version": self.api_version},
        )
        if not isinstance(result, list):
            raise ProviderError("GitHub Models catalog did not return a list.")
        return [item for item in result if isinstance(item, dict) and item.get("id")]

    @staticmethod
    def _model_score(model: dict[str, Any]) -> int:
        model_id = str(model.get("id", "")).lower()
        tags = " ".join(str(tag).lower() for tag in model.get("tags", []))
        summary = str(model.get("summary", "")).lower()
        capabilities = " ".join(str(item).lower() for item in model.get("capabilities", []))
        limits = model.get("limits") or {}
        max_output = int(limits.get("max_output_tokens") or 0)
        score = 0
        preferred_families = {
            "gpt-4o-mini": 70,
            "gpt-4.1-mini": 72,
            "phi-4": 62,
            "mistral-small": 59,
            "qwen": 55,
            "deepseek": 53,
            "llama-3.3": 50,
            "llama-3.1": 44,
        }
        for family, points in preferred_families.items():
            if family in model_id:
                score += points
        if "multipurpose" in tags:
            score += 14
        if "reasoning" in tags or "reason" in summary:
            score += 13
        if "coding" in tags or "code" in summary:
            score += 10
        if "multilingual" in tags:
            score += 5
        if "chat" in capabilities or "tool-calling" in capabilities:
            score += 3
        if "mini" in model_id or "small" in model_id or "phi" in model_id:
            score += 10
        if max_output >= 16000:
            score += 6
        elif max_output >= 8000:
            score += 3
        if any(term in model_id for term in ("vision", "embed", "audio", "whisper", "tts", "image")):
            score -= 80
        return score

    def choose_model(self, requested: str = "auto") -> tuple[str, dict[str, Any]]:
        catalog = self.catalog()
        if requested and requested != "auto":
            for item in catalog:
                if item.get("id") == requested:
                    return requested, item
            raise ProviderError(f"Requested GitHub Model '{requested}' was not present in the current catalog.")
        eligible = []
        for item in catalog:
            limits = item.get("limits") or {}
            modalities = item.get("supported_input_modalities") or ["text"]
            output_modalities = item.get("supported_output_modalities") or ["text"]
            if "text" not in modalities or "text" not in output_modalities:
                continue
            if int(limits.get("max_output_tokens") or 0) < 8000:
                continue
            eligible.append(item)
        if not eligible:
            raise ProviderError("GitHub Models catalog has no eligible text model with enough output capacity.")
        chosen = max(eligible, key=self._model_score)
        return str(chosen["id"]), chosen

    def generate(self, system_prompt: str, user_prompt: str, *, model: str = "auto") -> GenerationResult:
        selected, details = self.choose_model(model)
        max_catalog_output = int((details.get("limits") or {}).get("max_output_tokens") or 16000)
        requested_output = int(os.getenv("MAX_OUTPUT_TOKENS", "14000"))
        max_tokens = min(requested_output, max_catalog_output)
        payload = {
            "model": selected,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": 0.25,
            "max_tokens": max_tokens,
        }
        result = _json_request(
            f"{self.base_url}/inference/chat/completions",
            method="POST",
            token=self.token,
            payload=payload,
            headers={"X-GitHub-Api-Version": self.api_version},
            timeout=180,
        )
        if not isinstance(result, dict):
            raise ProviderError("GitHub Models inference returned an unexpected response.")
        try:
            choice = result["choices"][0]
            text = str(choice["message"]["content"] or "").strip()
        except (KeyError, IndexError, TypeError) as error:
            raise ProviderError("GitHub Models inference response did not contain message content.") from error
        if not text:
            raise ProviderError("GitHub Models returned an empty completion.")
        return GenerationResult(
            text=text,
            model=selected,
            finish_reason=str(choice.get("finish_reason") or "stop"),
            usage=result.get("usage") or {},
            raw=result,
        )


class OpenAIProvider(AIProvider):
    """Explicit opt-in future provider using the modern Responses API."""

    name = "openai"

    def __init__(self, *, token: str | None = None, free_only: bool = True):
        if free_only:
            raise ProviderError("OpenAI is disabled while FREE_ONLY=true.")
        self.token = token or os.getenv("OPENAI_API_KEY")
        if not self.token:
            raise ProviderError("OPENAI_API_KEY is required only for the explicitly selected paid provider.")

    def generate(self, system_prompt: str, user_prompt: str, *, model: str = "auto") -> GenerationResult:
        selected = model if model != "auto" else os.getenv("OPENAI_MODEL") or "gpt-4.1-mini"
        result = _json_request(
            "https://api.openai.com/v1/responses",
            method="POST",
            token=self.token,
            payload={
                "model": selected,
                "instructions": system_prompt,
                "input": user_prompt,
                "temperature": 0.25,
                "max_output_tokens": int(os.getenv("MAX_OUTPUT_TOKENS", "14000")),
            },
            headers={"Accept": "application/json"},
            timeout=180,
        )
        if not isinstance(result, dict):
            raise ProviderError("OpenAI Responses API returned an unexpected response.")
        text = str(result.get("output_text") or "").strip()
        if not text:
            for item in result.get("output", []):
                for content in item.get("content", []):
                    if content.get("type") in {"output_text", "text"}:
                        text += str(content.get("text") or "")
        text = text.strip()
        if not text:
            raise ProviderError("OpenAI Responses API returned an empty completion.")
        return GenerationResult(text=text, model=selected, usage=result.get("usage") or {}, raw=result)


def make_provider() -> AIProvider:
    provider_name = os.getenv("AI_PROVIDER", "github-models").strip().lower()
    free_only = env_bool("FREE_ONLY", True)
    if provider_name == "github-models":
        return GitHubModelsProvider(free_only=free_only)
    if provider_name == "openai":
        return OpenAIProvider(free_only=free_only)
    raise ProviderError(f"Unknown AI_PROVIDER '{provider_name}'. Use github-models or an explicit optional provider.")
