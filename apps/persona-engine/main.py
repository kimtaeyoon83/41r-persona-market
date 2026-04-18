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

import asyncio
import logging
import os
import uuid
from concurrent.futures import ThreadPoolExecutor
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
from fastapi.responses import FileResponse  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402

import persona_agent as pa  # noqa: E402
from persona_agent.lowlevel import (  # noqa: E402
    create_persona,
    generate_cohort_report,
    list_personas,
    list_session_screenshots,
    run_cohort,
    run_session,
)

from adapters.checklist_adapter import score_checklist  # noqa: E402
from adapters.job_store import JobStore  # noqa: E402
from adapters.questionnaire_generator import answer_questionnaire  # noqa: E402
from adapters.tester_to_soul import TesterProfile, tester_profile_to_soul_with_traits  # noqa: E402
from report_generator import generate_structured_report  # noqa: E402
from scorers import compute_quality_score  # noqa: E402
from usage_logger import install_tracking, set_service, with_request_id, with_route  # noqa: E402

# Turn on Anthropic usage logging for every LLM call the engine makes —
# covers persona_agent's internal provider_router too, since we patch
# the SDK at the class level.
install_tracking()
set_service("persona-engine")

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
logger = logging.getLogger(__name__)

PORT = int(os.environ.get("PORT", "4200"))
WORKER_THREADS = int(os.environ.get("PERSONA_ENGINE_WORKERS", "4"))

_job_store: JobStore | None = None
# Browser sessions are CPU/IO heavy and synchronous (run_session calls
# asyncio.run_until_complete internally). They must NOT run in the FastAPI
# event loop or uvicorn becomes unresponsive to status polls. Push them
# to a dedicated thread pool.
_executor: ThreadPoolExecutor | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _job_store, _executor
    _job_store = JobStore(WORKSPACE_ROOT / "jobs")
    _executor = ThreadPoolExecutor(
        max_workers=WORKER_THREADS,
        thread_name_prefix="pe-worker",
    )
    logger.info(
        "persona-engine lifespan started (workspace=%s, worker_threads=%d)",
        WORKSPACE_ROOT, WORKER_THREADS,
    )
    yield
    if _executor:
        _executor.shutdown(wait=False, cancel_futures=False)


app = FastAPI(
    title="41rpm Persona Engine",
    version="0.1.0",
    description="persona_agent FastAPI wrapper for 41r-persona-market",
    lifespan=lifespan,
)


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class ChecklistInput(BaseModel):
    id: str
    task: str
    expected: str = ""


class QuestionnaireInput(BaseModel):
    id: str
    question: str
    type: Literal["rating_1_5", "rating_1_10", "free_text"] = "free_text"


class AnalysisRequest(BaseModel):
    """Single-persona autotest.

    `mode="browser"` runs a real Playwright session with screenshots (slow,
    expensive). `mode="text"` runs LLM-only prediction (fast, cheap, no
    screenshots). Triggered after 41rpm API has verified USDC payment.
    `persona_id` must exist in workspace or bundled built-ins.

    If ``checklist`` is provided, the engine scores each item against the
    resulting session log and includes per-item status + an aggregate
    quality_score (1-5) in the result. ``questionnaire`` items yield
    persona-voiced answers. ``generate_report=True`` also produces a
    structured UX report (ux_scores, pain_points, recommendations).
    """

    persona_id: str = Field(..., description="e.g. 'p_pragmatic' or 'tester_abc123'")
    url: str
    task: str
    mode: Literal["text", "browser"] = "browser"
    checklist: list[ChecklistInput] = Field(default_factory=list)
    questionnaire: list[QuestionnaireInput] = Field(default_factory=list)
    generate_report: bool = False


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
    # Absolute filesystem paths to per-turn PNG screenshots (browser mode
    # only). The embedding server (41rpm Express) is responsible for
    # uploading these to R2/S3 and translating to public URLs before
    # storing in its own DB. persona-engine does NOT upload.
    screenshot_paths: list[str] = []
    # Session id the screenshots belong to (= log.session_id from run_session)
    session_id: str | None = None
    # Per-item checklist outcome + aggregated 1-5 quality score. Both are
    # empty/None when the request omits a checklist.
    checklist_results: list[dict] = []
    quality_score: float | None = None
    quality_breakdown: dict = {}
    # Persona-voiced questionnaire answers (empty if no items submitted).
    questionnaire_answers: list[dict] = []
    # Structured UX report (empty dict when generate_report=False).
    structured_report: dict = {}


# ---------------------------------------------------------------------------
# Background runners
# ---------------------------------------------------------------------------


def _run_session_job(job_id: str, req: AnalysisRequest) -> None:
    """Execute a single-persona session in background. mode=browser runs a
    Playwright session with per-turn screenshots; mode=text runs LLM-only
    prediction with no screenshots. When ``req.checklist`` is non-empty,
    the session log is scored per-item and an aggregate quality score is
    computed."""
    assert _job_store is not None
    try:
      # All downstream Anthropic calls made during this job will share
      # request_id=job_id in the usage log, so scripts/usage-summary.ts
      # can ask "how many LLM calls did one /analyses/run cost?".
      with with_request_id(job_id):
        _job_store.update(job_id, status="running", progress=10)
        with with_route("run_session"):
            log = run_session(req.persona_id, req.url, req.task, mode=req.mode)
        session_id = getattr(log, "session_id", None)
        shot_paths: list[str] = []
        if session_id and req.mode == "browser":
            shot_paths = [str(p) for p in list_session_screenshots(session_id)]

        _job_store.update(job_id, status="running", progress=80)

        checklist_dicts: list[dict] = []
        quality_score: float | None = None
        quality_breakdown: dict = {}
        scored = None
        if req.checklist:
            checklist_raw = [c.model_dump() for c in req.checklist]
            with with_route("checklist"):
                scored = score_checklist(checklist_raw, log, use_llm=True)
            checklist_dicts = [r.to_dict() for r in scored]
            with with_route("quality_score"):
                breakdown = compute_quality_score(log, req.persona_id, scored)
        else:
            # No checklist → still compute a faithfulness/outcome-only score
            # so callers always get a single headline number.
            with with_route("quality_score"):
                breakdown = compute_quality_score(log, req.persona_id, None)
        quality_score = breakdown.quality_score
        quality_breakdown = breakdown.to_dict()

        questionnaire_dicts: list[dict] = []
        if req.questionnaire:
            q_items = [q.model_dump() for q in req.questionnaire]
            with with_route("questionnaire"):
                answers = answer_questionnaire(q_items, log, req.persona_id, use_llm=True)
            questionnaire_dicts = [a.to_dict() for a in answers]

        report_dict: dict = {}
        if req.generate_report:
            with with_route("structured_report"):
                report = generate_structured_report(
                    log, req.persona_id, scored, use_llm=True,
                )
            report_dict = report.to_dict()

        _job_store.update(job_id,
            status="completed", progress=100,
            outcome=getattr(log, "outcome", "task_complete"),
            total_turns=getattr(log, "total_turns", None),
            duration_sec=getattr(log, "duration_sec", None),
            session_id=session_id,
            screenshot_paths=shot_paths,
            checklist_results=checklist_dicts,
            quality_score=quality_score,
            quality_breakdown=quality_breakdown,
            questionnaire_answers=questionnaire_dicts,
            structured_report=report_dict,
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
def submit_analysis(req: AnalysisRequest):
    """Kick off a single-persona analysis. Returns job_id immediately.

    Heavy work runs in a worker thread (NOT FastAPI's event loop) so the
    server stays responsive to status polls.
    """
    assert _job_store is not None and _executor is not None
    if req.persona_id not in list_personas():
        raise HTTPException(404, f"persona {req.persona_id} not found")
    job_id = f"job_{uuid.uuid4().hex[:8]}"
    _job_store.create(job_id, kind="session", request=req.model_dump())
    _executor.submit(_run_session_job, job_id, req)
    return JobResponse(job_id=job_id, status="queued")


@app.post("/cohort-analyses", status_code=status.HTTP_202_ACCEPTED)
def submit_cohort(req: CohortAnalysisRequest):
    """Run an existing generated cohort (multi-persona)."""
    assert _job_store is not None and _executor is not None
    job_id = f"job_{uuid.uuid4().hex[:8]}"
    _job_store.create(job_id, kind="cohort", request=req.model_dump())
    _executor.submit(_run_cohort_job, job_id, req)
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
        session_id=job.session_id,
        screenshot_paths=job.screenshot_paths,
        checklist_results=job.checklist_results,
        quality_score=job.quality_score,
        quality_breakdown=job.quality_breakdown,
        questionnaire_answers=job.questionnaire_answers,
        structured_report=job.structured_report,
    )


@app.get("/sessions/{session_id}/screenshots")
def list_screenshots_for_session(session_id: str):
    """List screenshot filenames for a session (so Express can iterate)."""
    if not _safe_session_id(session_id):
        raise HTTPException(400, "invalid session_id")
    paths = list_session_screenshots(session_id)
    return {
        "session_id": session_id,
        "count": len(paths),
        "filenames": [p.name for p in paths],
    }


@app.get("/sessions/{session_id}/screenshots/{filename}")
def get_screenshot(session_id: str, filename: str):
    """Return a single screenshot PNG.

    Express (apps/api) fetches these over HTTP and uploads to R2 using its
    existing services/r2.ts — the engine does NOT upload.
    """
    if not _safe_session_id(session_id):
        raise HTTPException(400, "invalid session_id")
    if not _safe_filename(filename):
        raise HTTPException(400, "invalid filename")
    path = WORKSPACE_ROOT / "sessions" / session_id / "screenshots" / filename
    if not path.exists() or not path.is_file():
        raise HTTPException(404, f"screenshot not found: {filename}")
    return FileResponse(path, media_type="image/png")


def _safe_session_id(sid: str) -> bool:
    return bool(sid) and all(c.isalnum() or c == "_" for c in sid) and len(sid) < 64


def _safe_filename(name: str) -> bool:
    return (
        name.endswith(".png")
        and all(c.isalnum() or c in "._-" for c in name)
        and ".." not in name
        and "/" not in name
        and len(name) < 64
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=PORT, reload=False)
