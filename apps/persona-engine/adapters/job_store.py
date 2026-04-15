"""File-backed job store. No external dependencies — one JSON per job.

Sufficient for hackathon/MVP. Swap for Redis/Postgres in production at
persona-engine 0.2+.
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


@dataclass
class JobState:
    job_id: str
    kind: str                   # "session" | "cohort"
    status: str = "queued"      # queued | running | completed | failed
    progress: int = 0
    request: dict[str, Any] = field(default_factory=dict)
    created_at: str = ""
    updated_at: str = ""
    outcome: str | None = None
    total_turns: int | None = None
    duration_sec: float | None = None
    report_id: str | None = None
    report_path: str | None = None
    error: str | None = None
    new_observations: int = 0


class JobStore:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, job_id: str) -> Path:
        if not job_id.replace("_", "").isalnum():
            raise ValueError(f"invalid job_id: {job_id}")
        return self.root / f"{job_id}.json"

    def create(self, job_id: str, kind: str, request: dict) -> JobState:
        now = datetime.now(timezone.utc).isoformat()
        state = JobState(
            job_id=job_id, kind=kind, request=request,
            created_at=now, updated_at=now,
        )
        self._write(state)
        return state

    def get(self, job_id: str) -> JobState | None:
        p = self._path(job_id)
        if not p.exists():
            return None
        with open(p) as f:
            data = json.load(f)
        return JobState(**data)

    def update(self, job_id: str, **fields: Any) -> JobState:
        state = self.get(job_id)
        if state is None:
            raise KeyError(f"job {job_id} not found")
        for k, v in fields.items():
            setattr(state, k, v)
        state.updated_at = datetime.now(timezone.utc).isoformat()
        self._write(state)
        return state

    def _write(self, state: JobState) -> None:
        tmp = self._path(state.job_id).with_suffix(".json.tmp")
        with open(tmp, "w") as f:
            json.dump(asdict(state), f, ensure_ascii=False, indent=2)
        tmp.replace(self._path(state.job_id))
