"""AI provider abstraction for Daily AI Intelligence.

The default provider is SambaNova's no-payment-method Free Tier. The optional
OpenAI provider is deliberately guarded by FREE_ONLY so a paid endpoint cannot
be selected accidentally.
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

    def __init__(self, message: str, *, retryable: bool = False, status_code: int | None = None):
        super().__init__(message)
        self.retryable = retryable
        self.status_code = status_code


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
    provider_label: str = "Provider",
    timeout: int = 60,
) -> dict[str, Any] | list[Any]:
    request_headers = {
        "Accept": "application/json",
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
        retryable = error.code == 429 or error.code >= 500 or error.code == 408
        if error.code == 429:
            message = f"The {provider_label} free-tier rate limit or quota was reached; no paid fallback is enabled."
        elif error.code in {401, 403}:
            message = f"{provider_label} rejected the API key or account access. Check the free-tier API key and account permissions."
        elif error.code == 402:
            message = f"{provider_label} requires paid billing for this request; FREE_ONLY refused to continue."
        else:
            message = f"Provider request failed with HTTP {error.code}: {detail}"
        raise ProviderError(message, retryable=retryable, status_code=error.code) from error
    except urllib.error.URLError as error:
        raise ProviderError(f"Provider request could not reach {url}: {error.reason}", retryable=True) from error
    except TimeoutError as error:
        raise ProviderError(f"{provider_label} request timed out after {timeout} seconds.", retryable=True) from error
    except OSError as error:
        raise ProviderError(f"{provider_label} request failed at the network layer: {error}", retryable=True) from error
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


class SambaNovaProvider(AIProvider):
    """SambaNova OpenAI-compatible API with a strict Free Tier allowlist."""

    name = "sambanova"
    default_base_url = "https://api.sambanova.ai/v1"
    free_model_order = (
        "gpt-oss-120b",
        "DeepSeek-V3.1",
        "Meta-Llama-3.3-70B-Instruct",
    )

    def __init__(self, *, token: str | None = None, base_url: str | None = None, free_only: bool = True):
        self.token = token or os.getenv("SAMBANOVA_API_KEY")
        requested_base = (base_url or os.getenv("SAMBANOVA_API_URL") or self.default_base_url).rstrip("/")
        self.free_only = free_only
        if free_only and requested_base != self.default_base_url:
            raise ProviderError("FREE_ONLY refuses a non-official SambaNova endpoint.")
        self.base_url = requested_base
        if not self.token:
            raise ProviderError("SAMBANOVA_API_KEY is required for the free-tier provider; no paid fallback is enabled.")

    def catalog(self) -> list[dict[str, Any]]:
        result = _json_request(
            f"{self.base_url}/models",
            token=self.token,
            provider_label="SambaNova",
            timeout=45,
        )
        if isinstance(result, dict):
            result = result.get("data", [])
        if not isinstance(result, list):
            raise ProviderError("SambaNova model catalog did not return a list.")
        return [item for item in result if isinstance(item, dict) and item.get("id")]

    def choose_models(self, requested: str = "auto") -> list[tuple[str, dict[str, Any]]]:
        catalog = self.catalog()
        by_id = {str(item["id"]): item for item in catalog}
        if requested and requested != "auto":
            if self.free_only and requested not in self.free_model_order:
                raise ProviderError(f"FREE_ONLY refuses model '{requested}'; choose a verified SambaNova Free Tier model.")
            if requested not in by_id:
                raise ProviderError(f"Requested SambaNova model '{requested}' is not active in the current catalog.")
            return [(requested, by_id[requested])]
        candidates = [(model_id, by_id[model_id]) for model_id in self.free_model_order if model_id in by_id]
        if not candidates:
            raise ProviderError("No verified SambaNova Free Tier model is active in the current catalog.")
        max_fallbacks = max(0, int(os.getenv("MAX_PROVIDER_FALLBACKS", "2")))
        return candidates[: max_fallbacks + 1]

    def _generate_one(self, system_prompt: str, user_prompt: str, selected: str, details: dict[str, Any]) -> GenerationResult:
        max_catalog_output = int(details.get("max_completion_tokens") or 16000)
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
            f"{self.base_url}/chat/completions",
            method="POST",
            token=self.token,
            payload=payload,
            provider_label="SambaNova",
            timeout=180,
        )
        if not isinstance(result, dict):
            raise ProviderError("SambaNova inference returned an unexpected response.")
        try:
            choice = result["choices"][0]
            text = str(choice["message"]["content"] or "").strip()
        except (KeyError, IndexError, TypeError) as error:
            raise ProviderError("SambaNova inference response did not contain message content.") from error
        if not text:
            raise ProviderError("SambaNova returned an empty completion.")
        return GenerationResult(
            text=text,
            model=selected,
            finish_reason=str(choice.get("finish_reason") or "stop"),
            usage=result.get("usage") or {},
            raw=result,
        )

    def generate(self, system_prompt: str, user_prompt: str, *, model: str = "auto") -> GenerationResult:
        candidates = self.choose_models(model)
        last_error: ProviderError | None = None
        for selected, details in candidates:
            try:
                return self._generate_one(system_prompt, user_prompt, selected, details)
            except ProviderError as error:
                last_error = error
                if not self.free_only or model != "auto" or not error.retryable:
                    raise
        raise ProviderError(f"All configured SambaNova Free Tier models were unavailable: {last_error}")


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
            provider_label="OpenAI",
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
    provider_name = os.getenv("AI_PROVIDER", "sambanova").strip().lower()
    free_only = env_bool("FREE_ONLY", True)
    if provider_name in {"sambanova", "sambacloud"}:
        return SambaNovaProvider(free_only=free_only)
    if provider_name == "openai":
        return OpenAIProvider(free_only=free_only)
    if provider_name in {"github-models", "github"}:
        raise ProviderError("GitHub Models has been retired; configure AI_PROVIDER=sambanova instead.")
    if provider_name == "groq":
        raise ProviderError("Groq is no longer the configured default; use AI_PROVIDER=sambanova instead.")
    raise ProviderError(f"Unknown AI_PROVIDER '{provider_name}'. Use sambanova or an explicit optional provider.")
