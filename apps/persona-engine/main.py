"""41rpm Persona Engine — FastAPI service wrapping persona_agent.

Endpoints:
    POST /analyses          submit a new analysis job
    GET  /analyses/{id}     status + progress
    GET  /analyses/{id}/result  final result (findings, report_url, evolution delta)
    GET  /personas          list available personas (workspace + builtin)
    POST /personas          create a new persona from a TesterProfile
    GET  /health

This service is stateless w.r.t. 41rpm's Postgres. Jobs are file-backed
under $PERSONA_ENGINE_WORKSPACE (default /var/persona_jobs). The 41rpm
Express API remains the source of truth for test_reports, personas, etc.
"""
from __future__ import annotations

import logging
import os
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

# NOTE: persona_agent MUST be configured before ``lowlevel`` is imported.
# Several internal modules read ``_EVENTS_DIR = get_workspace().events_dir``
# at import time; without configure() they raise ConfigurationError.
WORKSPACE_ROOT = Path(os.environ.get("PERSONA_ENGINE_WORKSPACE", "/var/persona_jobs"))
WORKSPACE_ROOT.mkdir(parents=True, exist_ok=True)

# Bundled read-only data lives inside the installed persona_agent package
# (src/persona_agent/data/). We point prompts_dir / config_dir directly at
# it — no copy needed. builtin_personas_dir also points there so the overlay
# loader can read p_impulsive, p_cautious, etc. Writes (generated personas
# + observations/reflections) go to workspace/personas/ separately.
import persona_agent as _pa_pkg  # noqa: E402

_BUNDLED = Path(_pa_pkg.__file__).parent / "data"

from persona_agent.workspace import Workspace, configure  # noqa: E402

configure(Workspace(
    root=WORKSPACE_ROOT,
    personas_dir=WORKSPACE_ROOT / "personas",
    builtin_personas_dir=_BUNDLED / "personas",
    prompts_dir=_BUNDLED / "prompts",
    config_dir=_BUNDLED / "config",
    reports_dir=WORKSPACE_ROOT / "reports",
))
(WORKSPACE_ROOT / "personas").mkdir(parents=True, exist_ok=True)
(WORKSPACE_ROOT / "reports").mkdir(parents=True, exist_ok=True)

# Now safe to pull in the rest.
from fastapi import BackgroundTasks, FastAPI, HTTPException, status  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402

import persona_agent as pa  # noqa: E402
from persona_agent.lowlevel import (  # noqa: E402
    create_persona,
    generate_cohort_report,
    list_personas,
    run_cohort,
    run_session,
)

from adapters.job_store import JobStore  # noqa: E402
from adapters.tester_to_soul import TesterProfile, tester_profile_to_soul_with_traits  # noqa: E402

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
logger = logging.getLogger(__name__)

PORT = int(os.environ.get("PORT", "4200"))

_job_store: JobStore | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _job_store
    _job_store = JobStore(WORKSPACE_ROOT / "jobs")
    logger.info("persona-engine lifespan started (workspace=%s)", WORKSPACE_ROOT)
    yield


app = FastAPI(
    title="41rpm Persona Engine",
    version="0.1.0",
    description="persona_agent FastAPI wrapper for 41r-persona-market",
    lifespan=lifespan,
)


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class AnalysisRequest(BaseModel):
    """Single-persona autotest — always browser mode (real Playwright session).

    For multi-persona text-mode prediction, use /cohort-analyses instead.
    Triggered after 41rpm API has verified USDC payment. `persona_id` must
    exist in workspace or bundled built-ins.
    """

    persona_id: str = Field(..., description="e.g. 'p_pragmatic' or 'tester_abc123'")
    url: str
    task: str


class CohortAnalysisRequest(BaseModel):
    cohort_run_id: str
    url: str
    task: str
    mode: Literal["text", "browser"] = "text"
    max_workers: int = 5


class CreatePersonaRequest(BaseModel):
    persona_id: str
    profile: TesterProfile


class JobResponse(BaseModel):
    job_id: str
    status: str
    progress: int = 0


class JobResultResponse(BaseModel):
    job_id: str
    status: str
    outcome: str | None = None
    total_turns: int | None = None
    duration_sec: float | None = None
    report_id: str | None = None
    report_path: str | None = None
    error: str | None = None
    # session observations appended during this run
    new_observations: int = 0


# ---------------------------------------------------------------------------
# Background runners
# ---------------------------------------------------------------------------


def _run_session_job(job_id: str, req: AnalysisRequest) -> None:
    """Execute a single-persona browser session in background."""
    assert _job_store is not None
    try:
        _job_store.update(job_id, status="running", progress=10)
        log = run_session(req.persona_id, req.url, req.task)
        _job_store.update(job_id,
            status="completed", progress=100,
            outcome=getattr(log, "outcome", "task_complete"),
            total_turns=getattr(log, "total_turns", None),
            duration_sec=getattr(log, "duration_sec", None),
        )
    except pa.PersonaAgentError as e:
        logger.exception("job %s failed with PersonaAgentError", job_id)
        _job_store.update(job_id, status="failed", error=f"{type(e).__name__}: {e}")
    except Exception as e:
        logger.exception("job %s failed unexpectedly", job_id)
        _job_store.update(job_id, status="failed", error=str(e))


def _run_cohort_job(job_id: str, req: CohortAnalysisRequest) -> None:
    assert _job_store is not None
    try:
        _job_store.update(job_id, status="running", progress=10)
        result = run_cohort(
            cohort_run_id=req.cohort_run_id,
            url=req.url, task=req.task,
            mode=req.mode, max_workers=req.max_workers,
        )
        _job_store.update(job_id, status="running", progress=80)
        report_id = generate_cohort_report(result["output_path"])
        _job_store.update(job_id,
            status="completed", progress=100,
            report_id=report_id,
            report_path=str(WORKSPACE_ROOT / "reports" / f"cohort_rpt_{report_id}"),
        )
    except pa.PersonaAgentError as e:
        logger.exception("cohort job %s failed", job_id)
        _job_store.update(job_id, status="failed", error=f"{type(e).__name__}: {e}")
    except Exception as e:
        logger.exception("cohort job %s failed unexpectedly", job_id)
        _job_store.update(job_id, status="failed", error=str(e))


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.get("/health")
def health():
    return {
        "status": "ok",
        "persona_agent_version": pa.__version__,
        "workspace": str(WORKSPACE_ROOT),
    }


@app.get("/personas")
def get_personas():
    return {"personas": list_personas()}


@app.post("/personas", status_code=status.HTTP_201_CREATED)
def post_persona(req: CreatePersonaRequest):
    try:
        soul_text, _traits = tester_profile_to_soul_with_traits(req.profile, req.persona_id)
        create_persona(req.persona_id, soul_text)
    except pa.PersonaExistsError:
        raise HTTPException(409, f"persona {req.persona_id} already exists")
    except pa.PersonaAgentError as e:
        raise HTTPException(400, str(e))
    return {"persona_id": req.persona_id, "status": "created"}


@app.post("/analyses", status_code=status.HTTP_202_ACCEPTED)
def submit_analysis(req: AnalysisRequest, bg: BackgroundTasks):
    """Kick off a single-persona analysis. Returns job_id immediately."""
    assert _job_store is not None
    if req.persona_id not in list_personas():
        raise HTTPException(404, f"persona {req.persona_id} not found")
    job_id = f"job_{uuid.uuid4().hex[:8]}"
    _job_store.create(job_id, kind="session", request=req.model_dump())
    bg.add_task(_run_session_job, job_id, req)
    return JobResponse(job_id=job_id, status="queued")


@app.post("/cohort-analyses", status_code=status.HTTP_202_ACCEPTED)
def submit_cohort(req: CohortAnalysisRequest, bg: BackgroundTasks):
    """Run an existing generated cohort (multi-persona)."""
    assert _job_store is not None
    job_id = f"job_{uuid.uuid4().hex[:8]}"
    _job_store.create(job_id, kind="cohort", request=req.model_dump())
    bg.add_task(_run_cohort_job, job_id, req)
    return JobResponse(job_id=job_id, status="queued")


@app.get("/analyses/{job_id}", response_model=JobResponse)
def get_status(job_id: str):
    assert _job_store is not None
    job = _job_store.get(job_id)
    if job is None:
        raise HTTPException(404, f"job {job_id} not found")
    return JobResponse(job_id=job_id, status=job.status, progress=job.progress)


@app.get("/analyses/{job_id}/result", response_model=JobResultResponse)
def get_result(job_id: str):
    assert _job_store is not None
    job = _job_store.get(job_id)
    if job is None:
        raise HTTPException(404, f"job {job_id} not found")
    if job.status != "completed":
        raise HTTPException(409, f"job not yet completed (status={job.status})")
    return JobResultResponse(
        job_id=job_id,
        status=job.status,
        outcome=job.outcome,
        total_turns=job.total_turns,
        duration_sec=job.duration_sec,
        report_id=job.report_id,
        report_path=job.report_path,
        new_observations=job.new_observations,
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=PORT, reload=False)
