"""Anthropic API usage tracker.

Install once at process start: ``install_tracking()``. From then on,
every ``anthropic.Anthropic().messages.create(...)`` invocation — whether
from our wrapper code, persona_agent's internal provider_router, or
anywhere else — appends one JSON line to ``USAGE_LOG_PATH`` (default
``/tmp/llm-usage.jsonl``).

Each line contains:
    ts              (unix seconds, float)
    service         (e.g. "persona-engine")
    route           (set via with_route context manager; "unknown" otherwise)
    request_id      (set via with_request_id; None otherwise)
    model           (e.g. "claude-sonnet-4-6")
    input_tokens
    output_tokens
    cache_read_tokens
    cache_creation_tokens
    duration_ms
    prompt_hash     (sha256[:16] of messages+system — for duplicate detection)
    prompt_preview  (first 200 chars, de-newlined — for eyeballing)

We patch the ``Messages.create`` method on the concrete class so every
``Anthropic`` instance in the process is covered. Patching is idempotent.
"""
from __future__ import annotations

import contextlib
import contextvars
import hashlib
import json
import logging
import os
import time
from pathlib import Path
from typing import Any, Iterator

logger = logging.getLogger(__name__)

_ROUTE: contextvars.ContextVar[str] = contextvars.ContextVar("llm_route", default="unknown")
_REQUEST_ID: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "llm_request_id", default=None,
)
_SERVICE: contextvars.ContextVar[str] = contextvars.ContextVar("llm_service", default="persona-engine")

_INSTALLED = False


def _log_path() -> Path:
    return Path(os.environ.get("USAGE_LOG_PATH", "/tmp/llm-usage.jsonl"))


def _append(entry: dict[str, Any]) -> None:
    path = _log_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception:  # pragma: no cover — logging must never break caller
        logger.exception("usage_logger: append failed")


def _hash(prompt_text: str) -> str:
    return hashlib.sha256(prompt_text.encode("utf-8", errors="replace")).hexdigest()[:16]


def _serialise_messages(messages: Any) -> str:
    try:
        return json.dumps(messages, ensure_ascii=False, sort_keys=True, default=str)
    except Exception:
        return repr(messages)


def _preview(prompt_text: str, n: int = 200) -> str:
    return prompt_text.replace("\n", " ").strip()[:n]


@contextlib.contextmanager
def with_route(route: str) -> Iterator[None]:
    """Tag every LLM call inside this block with ``route``."""
    tok = _ROUTE.set(route)
    try:
        yield
    finally:
        _ROUTE.reset(tok)


@contextlib.contextmanager
def with_request_id(request_id: str | None) -> Iterator[None]:
    """Tag every LLM call inside this block with ``request_id`` — use at
    the top of each background job so all downstream calls share it."""
    tok = _REQUEST_ID.set(request_id)
    try:
        yield
    finally:
        _REQUEST_ID.reset(tok)


def set_service(name: str) -> None:
    _SERVICE.set(name)


def install_tracking() -> None:
    """Monkey-patch ``anthropic.resources.messages.Messages.create`` (sync)
    and ``AsyncMessages.create`` (async) to log every call to JSONL."""
    global _INSTALLED
    if _INSTALLED:
        return

    import anthropic.resources.messages as _messages

    original_sync = _messages.Messages.create
    original_async = _messages.AsyncMessages.create

    def _record(
        kwargs: dict[str, Any],
        resp: Any,
        started: float,
    ) -> None:
        usage = getattr(resp, "usage", None)
        messages = kwargs.get("messages") or []
        system = kwargs.get("system") or ""
        system_str = system if isinstance(system, str) else json.dumps(system, default=str)
        prompt_text = _serialise_messages(messages) + "||" + system_str
        _append({
            "ts": time.time(),
            "service": _SERVICE.get(),
            "route": _ROUTE.get(),
            "request_id": _REQUEST_ID.get(),
            "model": kwargs.get("model"),
            "input_tokens": getattr(usage, "input_tokens", 0) if usage else 0,
            "output_tokens": getattr(usage, "output_tokens", 0) if usage else 0,
            "cache_read_tokens": getattr(usage, "cache_read_input_tokens", 0) if usage else 0,
            "cache_creation_tokens": getattr(usage, "cache_creation_input_tokens", 0) if usage else 0,
            "duration_ms": int((time.time() - started) * 1000),
            "prompt_hash": _hash(prompt_text),
            "prompt_preview": _preview(prompt_text),
        })

    def wrapped_sync(self, *args: Any, **kwargs: Any):
        started = time.time()
        resp = original_sync(self, *args, **kwargs)
        try:
            _record(kwargs, resp, started)
        except Exception:
            logger.exception("usage_logger: sync record failed")
        return resp

    async def wrapped_async(self, *args: Any, **kwargs: Any):
        started = time.time()
        resp = await original_async(self, *args, **kwargs)
        try:
            _record(kwargs, resp, started)
        except Exception:
            logger.exception("usage_logger: async record failed")
        return resp

    _messages.Messages.create = wrapped_sync
    _messages.AsyncMessages.create = wrapped_async
    _INSTALLED = True
    logger.info("usage_logger: installed; writing to %s", _log_path())
