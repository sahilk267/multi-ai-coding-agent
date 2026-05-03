import json
import os
from typing import Any, Dict, List


def _env(*names: str) -> str:
    for name in names:
        value = os.getenv(name)
        if value:
            return value
    return ""


def get_provider_name(model: str) -> str:
    return {
        "chatgpt": "openai",
        "gemini": "gemini",
        "deepseek": "deepseek",
        "qwen": "qwen",
    }.get(model, model)


def call_model(model: str, system_prompt: str, user_prompt: str, fallback: Dict[str, Any]) -> Dict[str, Any]:
    api_key = _env(
        "OPENAI_API_KEY",
        "GEMINI_API_KEY",
        "DEEPSEEK_API_KEY",
        "QWEN_API_KEY",
    )
    if not api_key:
        return fallback
    return fallback


def extract_json(text: str) -> Any:
    try:
        return json.loads(text)
    except Exception:
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            return json.loads(text[start:end + 1])
        raise
