import os
import sys
import time
import json
import subprocess
from pathlib import Path
from typing import List, Optional, Dict, Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

BASE_DIR = Path(__file__).resolve().parent

app = FastAPI(
    title="Axion Stock AI Service",
    description="Dedicated Machine Learning and Quantitative Analysis API for Axion",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class RunScriptRequest(BaseModel):
    scriptName: str
    args: Optional[List[str]] = []
    timeoutMs: Optional[int] = 60000
    requiredArtifacts: Optional[List[str]] = []

def resolve_script(script_name: str) -> Optional[Path]:
    target = Path(script_name)
    if target.is_absolute() and target.exists():
        return target
    candidates = [
        BASE_DIR / script_name,
        BASE_DIR / "src" / script_name,
        BASE_DIR / "scripts" / script_name,
    ]
    for c in candidates:
        if c.exists():
            return c
    return None

@app.get("/")
def root():
    return {
        "service": "Axion Stock AI Engine",
        "status": "online",
        "python_version": sys.version,
        "base_dir": str(BASE_DIR)
    }

@app.get("/health")
def health():
    models_dir = BASE_DIR / "models"
    available_models = [f.name for f in models_dir.glob("*.pkl")] if models_dir.exists() else []
    return {
        "status": "ok",
        "timestamp": time.time(),
        "models": available_models
    }

@app.post("/run")
def run_script(req: RunScriptRequest):
    start_time = time.time()
    script_path = resolve_script(req.scriptName)

    if not script_path:
        return {
            "success": False,
            "status": "MISSING_SCRIPT",
            "exitCode": None,
            "durationMs": int((time.time() - start_time) * 1000),
            "stdout": "",
            "stderr": f"Script '{req.scriptName}' not found in stock-ai.",
            "error": f"Script '{req.scriptName}' not found."
        }

    # Snapshot artifact modification times
    before_mtimes = {}
    if req.requiredArtifacts:
        for rel in req.requiredArtifacts:
            art = BASE_DIR / rel
            if art.exists():
                before_mtimes[rel] = art.stat().st_mtime

    cmd = [sys.executable, str(script_path)] + (req.args or [])
    timeout_sec = (req.timeoutMs or 60000) / 1000.0

    try:
        proc = subprocess.run(
            cmd,
            cwd=str(BASE_DIR),
            capture_output=True,
            text=True,
            timeout=timeout_sec,
            env={**os.environ, "PYTHONUNBUFFERED": "1"}
        )
        duration_ms = int((time.time() - start_time) * 1000)

        # Check artifact freshness
        artifact_meta = {}
        all_fresh = True
        if req.requiredArtifacts:
            for rel in req.requiredArtifacts:
                art = BASE_DIR / rel
                exists = art.exists()
                if exists:
                    mtime = art.stat().st_mtime
                    is_fresh = mtime > before_mtimes.get(rel, 0)
                    if not is_fresh:
                        all_fresh = False
                    artifact_meta[rel] = {"exists": True, "mtimeMs": mtime * 1000, "isFresh": is_fresh}
                else:
                    all_fresh = False
                    artifact_meta[rel] = {"exists": False, "isFresh": False}

        success = proc.returncode == 0
        return {
            "success": success,
            "status": "SUCCESS" if success else "NONZERO_EXIT",
            "exitCode": proc.returncode,
            "durationMs": duration_ms,
            "stdout": proc.stdout[-32768:],  # Cap response size
            "stderr": proc.stderr[-32768:],
            "artifactsFresh": all_fresh if req.requiredArtifacts else True,
            "artifactMetadata": artifact_meta
        }
    except subprocess.TimeoutExpired:
        return {
            "success": False,
            "status": "TIMEOUT",
            "exitCode": None,
            "durationMs": int((time.time() - start_time) * 1000),
            "stdout": "",
            "stderr": f"Execution timed out after {timeout_sec}s.",
            "error": "Process timed out."
        }
    except Exception as e:
        return {
            "success": False,
            "status": "LAUNCH_ERROR",
            "exitCode": None,
            "durationMs": int((time.time() - start_time) * 1000),
            "stdout": "",
            "stderr": str(e),
            "error": f"Failed to execute process: {str(e)}"
        }

@app.get("/predictions")
def get_predictions():
    pred_path = BASE_DIR / "outputs" / "latest_predictions.json"
    if not pred_path.exists():
        raise HTTPException(status_code=404, detail="No predictions generated yet.")
    with open(pred_path, "r", encoding="utf-8") as f:
        return json.load(f)

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 7860))
    uvicorn.run("app:app", host="0.0.0.0", port=port, reload=False)
