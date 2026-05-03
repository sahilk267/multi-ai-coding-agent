"""
AI Provider Layer — auto-selects between local Ollama and cloud APIs.

Selection order (first available wins):
  1. Ollama (local open-source LLM) — pinged at OLLAMA_HOST (default localhost:11434)
  2. Cloud API matching the requested model role (key from env)
  3. Rule-based structured fallback (no LLM, always succeeds)

Supported cloud providers:
  - OpenAI       (OPENAI_API_KEY)          → chatgpt / gpt-4o-mini
  - Google Gemini (GEMINI_API_KEY)         → gemini-1.5-flash
  - DeepSeek     (DEEPSEEK_API_KEY)        → deepseek-chat   (OpenAI-compat)
  - Qwen/Dashscope (QWEN_API_KEY)          → qwen-plus       (OpenAI-compat)

Environment variables:
  OLLAMA_HOST      = http://localhost:11434   (override Ollama base URL)
  OLLAMA_MODEL     = qwen2.5-coder:7b        (override which model Ollama uses)
  OPENAI_API_KEY   — enables ChatGPT
  GEMINI_API_KEY   — enables Gemini
  DEEPSEEK_API_KEY — enables DeepSeek
  QWEN_API_KEY     — enables Qwen/Dashscope
  LLM_TIMEOUT      = 60                      (per-request timeout in seconds)
  LLM_MAX_RETRIES  = 2                       (retries per provider before fallback)
"""
from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from typing import Any, Dict, Optional, Tuple

from .logger import get_logger

log = get_logger("ai_providers")


# ── Config ─────────────────────────────────────────────────────────────────────

OLLAMA_HOST    = os.getenv("OLLAMA_HOST", "http://localhost:11434").rstrip("/")
OLLAMA_MODEL   = os.getenv("OLLAMA_MODEL", "qwen2.5-coder:7b")
LLM_TIMEOUT    = int(os.getenv("LLM_TIMEOUT", "60"))
LLM_MAX_RETRIES = int(os.getenv("LLM_MAX_RETRIES", "2"))

# Map agent model roles to cloud provider details
_CLOUD_PROVIDERS: Dict[str, Dict[str, str]] = {
    "chatgpt": {
        "env_key": "OPENAI_API_KEY",
        "base_url": "https://api.openai.com/v1/chat/completions",
        "model": "gpt-4o-mini",
        "auth_header": "Authorization",
        "auth_prefix": "Bearer ",
    },
    "gemini": {
        "env_key": "GEMINI_API_KEY",
        "base_url": "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent",
        "model": "gemini-1.5-flash",
        "auth_header": "x-goog-api-key",
        "auth_prefix": "",
    },
    "deepseek": {
        "env_key": "DEEPSEEK_API_KEY",
        "base_url": "https://api.deepseek.com/v1/chat/completions",
        "model": "deepseek-chat",
        "auth_header": "Authorization",
        "auth_prefix": "Bearer ",
    },
    "qwen": {
        "env_key": "QWEN_API_KEY",
        "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
        "model": "qwen-plus",
        "auth_header": "Authorization",
        "auth_prefix": "Bearer ",
    },
}


# ── Ollama ping (cached) ────────────────────────────────────────────────────────

_ollama_available: Optional[bool] = None
_ollama_checked_at: float = 0.0
_OLLAMA_CACHE_TTL = 30  # re-check every 30 s


def _check_ollama() -> bool:
    global _ollama_available, _ollama_checked_at
    now = time.time()
    if _ollama_available is not None and (now - _ollama_checked_at) < _OLLAMA_CACHE_TTL:
        return _ollama_available
    try:
        req = urllib.request.Request(f"{OLLAMA_HOST}/api/tags", method="GET")
        with urllib.request.urlopen(req, timeout=3) as resp:
            _ollama_available = resp.status == 200
    except Exception:
        _ollama_available = False
    _ollama_checked_at = now
    if _ollama_available:
        log.info(f"[provider] Ollama available at {OLLAMA_HOST} (model={OLLAMA_MODEL})")
    return _ollama_available


# ── HTTP helpers ───────────────────────────────────────────────────────────────

def _http_post(url: str, body: Dict[str, Any], headers: Dict[str, str], timeout: int) -> Tuple[int, Any]:
    """Synchronous POST. Returns (status_code, parsed_json_or_str)."""
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    for k, v in headers.items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            try:
                return resp.status, json.loads(raw)
            except json.JSONDecodeError:
                return resp.status, raw
    except urllib.error.HTTPError as e:
        try:
            body_str = e.read().decode("utf-8")
            return e.code, json.loads(body_str)
        except Exception:
            return e.code, str(e)
    except urllib.error.URLError as e:
        raise TimeoutError(str(e)) from e


def _with_retry(fn, max_retries: int):
    """Call fn(); on 429 or timeout retry with exponential back-off."""
    delays = [1, 4, 16]
    for attempt in range(max_retries + 1):
        try:
            status, result = fn()
            if status == 429:
                if attempt < max_retries:
                    wait = delays[min(attempt, len(delays) - 1)]
                    log.warning(f"[provider] Rate limited (429) — retrying in {wait}s (attempt {attempt+1})")
                    time.sleep(wait)
                    continue
                raise RuntimeError("Rate limit exceeded after retries")
            if status in (401, 403):
                raise PermissionError(f"Auth failed ({status})")
            return status, result
        except TimeoutError:
            if attempt < max_retries:
                log.warning(f"[provider] Timeout — retrying (attempt {attempt+1})")
                time.sleep(2)
                continue
            raise
    return None, None


# ── Ollama call ───────────────────────────────────────────────────────────────

def _call_ollama(system_prompt: str, user_prompt: str) -> str:
    """Call local Ollama API. Returns the assistant text."""
    body = {
        "model": OLLAMA_MODEL,
        "stream": False,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": user_prompt[:8000]},
        ],
        "options": {"temperature": 0.2},
    }
    url = f"{OLLAMA_HOST}/api/chat"
    status, result = _with_retry(
        lambda: _http_post(url, body, {}, LLM_TIMEOUT),
        LLM_MAX_RETRIES,
    )
    if status != 200:
        raise RuntimeError(f"Ollama error {status}: {str(result)[:200]}")
    if isinstance(result, dict):
        return result.get("message", {}).get("content", "")
    return str(result)


# ── OpenAI-compatible call (OpenAI / DeepSeek / Qwen) ────────────────────────

def _call_openai_compat(provider_cfg: Dict[str, str], system_prompt: str, user_prompt: str) -> str:
    api_key = os.getenv(provider_cfg["env_key"], "")
    if not api_key:
        raise PermissionError(f"No API key for {provider_cfg['env_key']}")
    headers = {
        provider_cfg["auth_header"]: f"{provider_cfg['auth_prefix']}{api_key}".strip()
    }
    body = {
        "model": provider_cfg["model"],
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": user_prompt[:8000]},
        ],
        "temperature": 0.2,
        "max_tokens": 4096,
    }
    status, result = _with_retry(
        lambda: _http_post(provider_cfg["base_url"], body, headers, LLM_TIMEOUT),
        LLM_MAX_RETRIES,
    )
    if status != 200:
        raise RuntimeError(f"Provider error {status}: {str(result)[:200]}")
    if isinstance(result, dict):
        choices = result.get("choices", [{}])
        return choices[0].get("message", {}).get("content", "") if choices else ""
    return str(result)


# ── Gemini call ───────────────────────────────────────────────────────────────

def _call_gemini(system_prompt: str, user_prompt: str) -> str:
    api_key = os.getenv("GEMINI_API_KEY", "")
    if not api_key:
        raise PermissionError("No GEMINI_API_KEY")
    cfg = _CLOUD_PROVIDERS["gemini"]
    url = f"{cfg['base_url']}?key={api_key}"
    body = {
        "system_instruction": {"parts": [{"text": system_prompt}]},
        "contents": [{"parts": [{"text": user_prompt[:30000]}]}],
        "generationConfig": {"temperature": 0.2, "maxOutputTokens": 4096},
    }
    status, result = _with_retry(
        lambda: _http_post(url, body, {}, LLM_TIMEOUT),
        LLM_MAX_RETRIES,
    )
    if status != 200:
        raise RuntimeError(f"Gemini error {status}: {str(result)[:200]}")
    if isinstance(result, dict):
        candidates = result.get("candidates", [{}])
        parts = candidates[0].get("content", {}).get("parts", []) if candidates else []
        return parts[0].get("text", "") if parts else ""
    return str(result)


# ── JSON extraction ────────────────────────────────────────────────────────────

def extract_json(text: str) -> Any:
    """Extract first JSON object or array from text (handles markdown code fences)."""
    if not text:
        raise ValueError("Empty text")
    # strip markdown fences
    cleaned = text
    if "```json" in text:
        cleaned = text.split("```json", 1)[1].split("```", 1)[0]
    elif "```" in text:
        cleaned = text.split("```", 1)[1].split("```", 1)[0]
    cleaned = cleaned.strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass
    # try to find first { or [
    for start_char, end_char in [('{', '}'), ('[', ']')]:
        start = text.find(start_char)
        end = text.rfind(end_char)
        if start >= 0 and end > start:
            try:
                return json.loads(text[start:end + 1])
            except json.JSONDecodeError:
                continue
    raise ValueError(f"No JSON found in response: {text[:200]}")


# ── Main entry point ───────────────────────────────────────────────────────────

def call_model(
    model: str,
    system_prompt: str,
    user_prompt: str,
    fallback: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Call an LLM and return parsed JSON.

    Selection order:
      1. Ollama (if reachable)
      2. Cloud provider matching `model` (if key present)
      3. `fallback` dict (rule-based, always succeeds)

    Returns: parsed dict from LLM, or `fallback` if no LLM is available/successful.
    """
    provider_used = "fallback"

    # 1. Try Ollama
    if _check_ollama():
        try:
            raw = _call_ollama(system_prompt, user_prompt)
            parsed = extract_json(raw)
            if isinstance(parsed, dict):
                log.info(f"[provider] ollama/{OLLAMA_MODEL} → success for role={model}")
                return parsed
        except Exception as e:
            log.warning(f"[provider] Ollama failed for role={model}: {e} — trying cloud")

    # 2. Try matching cloud provider
    cfg = _CLOUD_PROVIDERS.get(model)
    if cfg and os.getenv(cfg["env_key"]):
        try:
            if model == "gemini":
                raw = _call_gemini(system_prompt, user_prompt)
            else:
                raw = _call_openai_compat(cfg, system_prompt, user_prompt)
            parsed = extract_json(raw)
            if isinstance(parsed, dict):
                log.info(f"[provider] cloud/{model} → success")
                return parsed
        except PermissionError as e:
            log.warning(f"[provider] Auth failed for {model}: {e}")
        except RuntimeError as e:
            log.warning(f"[provider] Cloud call failed for {model}: {e}")
        except Exception as e:
            log.warning(f"[provider] Unexpected error for {model}: {e}")

    # 3. Rule-based fallback
    log.info(f"[provider] Using rule-based fallback for role={model}")
    return fallback


def get_active_provider() -> str:
    """Return a human-readable description of the active provider."""
    if _check_ollama():
        return f"ollama/{OLLAMA_MODEL}"
    for model, cfg in _CLOUD_PROVIDERS.items():
        if os.getenv(cfg["env_key"]):
            return f"cloud/{model}"
    return "rule-based fallback"


def get_provider_status() -> Dict[str, Any]:
    """Return full provider health status for diagnostics."""
    ollama_ok = _check_ollama()
    cloud_keys = {
        model: bool(os.getenv(cfg["env_key"]))
        for model, cfg in _CLOUD_PROVIDERS.items()
    }
    return {
        "active_provider": get_active_provider(),
        "ollama": {
            "available": ollama_ok,
            "host": OLLAMA_HOST,
            "model": OLLAMA_MODEL,
        },
        "cloud": cloud_keys,
        "fallback_mode": not ollama_ok and not any(cloud_keys.values()),
        "config": {
            "timeout_s": LLM_TIMEOUT,
            "max_retries": LLM_MAX_RETRIES,
        },
    }
