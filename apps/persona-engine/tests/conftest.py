"""persona-engine tests — configure a Workspace up-front so persona_agent
modules that resolve paths at import time don't crash on collection."""
from __future__ import annotations

import tempfile
from pathlib import Path

import persona_agent as pa
from persona_agent.workspace import Workspace, configure

_BUNDLED = Path(pa.__file__).parent / "data"
_tmp = tempfile.TemporaryDirectory(prefix="pe_tests_")
_root = Path(_tmp.name)

configure(Workspace(
    root=_root,
    personas_dir=_root / "personas",
    builtin_personas_dir=_BUNDLED / "personas",
    prompts_dir=_BUNDLED / "prompts",
    config_dir=_BUNDLED / "config",
    reports_dir=_root / "reports",
))
