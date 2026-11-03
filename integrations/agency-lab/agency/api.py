"""HTTP forum, policy-enforced device scheduling, and per-device token auth."""
import asyncio
import base64
import json
import os
import secrets
import time
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, HTTPException, Header, Depends
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, ConfigDict
from .core import Store, ROLES, validate_hex
from .catalog import LINUX_INSPIRED_DESIGNS, SAFE_LAB_TOOLS
from .llm import complete
from .vm_lab import examples as vm_examples, available as vm_available, simulate as vm_simulate, VM_DIR

DB_PATH = os.environ.get("AGENCY_DB", str(Path(__file__).resolve().parent.parent / "data" / "forum.sqlite"))
ADMIN_KEY = os.environ.get("AGENCY_ADMIN_KEY", "")
if len(ADMIN_KEY) < 24:
    raise RuntimeError("Set AGENCY_ADMIN_KEY to a random secret of at least 24 characters")
STORE = Store(DB_PATH)
MODEL_URL = os.environ.get("AGENCY_LLM_URL", "http://127.0.0.1:8081/v1")
MODEL_NAME = os.environ.get("AGENCY_LLM_MODEL", "local")
WEB_DIR = Path(__file__).resolve().parent.parent / "web"

async def admin(x_agency_key: str = Header(default="")):
    if not secrets.compare_digest(x_agency_key, ADMIN_KEY):
        raise HTTPException(401, "Invalid admin key")

async def device_auth(device_id: str, x_device_token: str = Header(default="")):
    if not STORE.valid_device_token(device_id, x_device_token):
        raise HTTPException(401, "Invalid device credentials")

class ThreadCreate(BaseModel):
    title: str = Field(min_length=5, max_length=120)
    category: str = Field(pattern=r"^(os-design|red-team-lab|defense|swarm|hardware-test)$")
    question: str = Field(min_length=10, max_length=10000)

class PostCreate(BaseModel):
    author: str = Field(default="Operator", min_length=1, max_length=60)
    body: str = Field(min_length=1, max_length=16000)

class Enroll(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    kind: str = Field(pattern=r"^(esp32-s3|cyd|uart-peripheral|linux-host|other)$")
    capabilities: dict = Field(default_factory=dict)

class Policy(BaseModel):
    tx_enabled: bool = False
    allowlist_hex: list[str] = Field(default_factory=list, max_length=24)

class TestRequest(BaseModel):
    device_id: str
    thread_id: int | None = None
    operation: str = Field(pattern=r"^(ping|uart_capture|uart_tx)$")
    duration_ms: int = Field(default=500, ge=100, le=2500)
    max_bytes: int = Field(default=256, ge=1, le=1024)
    tx_hex: str | None = None
    confirm_write: bool = False

class SwarmDiagnostics(BaseModel):
    device_ids: list[str] = Field(min_length=1, max_length=25)
    thread_id: int | None = None
    operation: str = Field(pattern=r"^(ping|uart_capture)$")
    duration_ms: int = Field(default=500, ge=100, le=2500)
    max_bytes: int = Field(default=256, ge=1, le=1024)

class Report(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ok: bool
    rx_b64: str = Field(default="", max_length=5500)
    bytes_received: int = Field(default=0, ge=0, le=2048)
    elapsed_ms: int = Field(default=0, ge=0, le=10000)
    error: str = Field(default="", max_length=300)
    bridge: str = Field(default="", max_length=100)

class Heartbeat(BaseModel):
    capabilities: dict = Field(default_factory=dict)

class VMRunRequest(BaseModel):
    name: str = Field(default="Virtual hardware experiment", min_length=3, max_length=100)
    source: str = Field(min_length=1, max_length=16384)
    thread_id: int | None = None
    max_steps: int = Field(default=10000, ge=1, le=100000)

class VMLinkRequest(BaseModel):
    job_id: str = Field(pattern=r"^test-[0-9a-f]{20}$")

class VMProposalRequest(BaseModel):
    thread_id: int
    role: str = Field(default="Firmware Engineer", pattern=r"^(Firmware Engineer|OS Architect|Blue Team|Red Team|Swarm Coordinator|Evidence Judge)$")

class ModelTarget(BaseModel):
    url: str = Field(min_length=12, max_length=300)
    model: str = Field(min_length=1, max_length=128)

MODEL_TARGETS: dict[str, ModelTarget] = {}
RUNNING: set[int] = set()
TASKS: set[asyncio.Task] = set()
RESEARCH_TOPICS = [
    ("Alpine/OpenWrt micro-OS", "os-design", "Design a memory-budgeted ESP32-S3 FreeRTOS micro-OS using modular BusyBox and OpenWrt-style configuration ideas, secure boot review, reproducible builds, resource limits, and restore procedures."),
    ("UART lab", "hardware-test", "Design a reusable, electrical-level-aware, receive-only UART test fixture with explicit human approval for framed diagnostic transmission and reproducible loopback acceptance."),
    ("Kali/Parrot-inspired lab", "red-team-lab", "Develop an authorized microcontroller security validation workflow based on Kali/Parrot testing practices with on-device resource limitations, safe negative tests, and evidence preservation."),
    ("Swarm coordinator", "swarm", "Design revocable, non-propagating cooperative ESP32-S3/CYD nodes with capability manifests, bounded job leases, and quorum-based interpretation of device-reported test results."),
    ("Debian-inspired release", "defense", "Specify Debian-inspired firmware package provenance and cross-board safety gates for ESP32-S3 N16R8/CYD, protecting camera/LCD/touch pins, existing images, credentials, and rollback."),
]
AUTO_RESEARCH_INTERVAL = int(os.environ.get("AGENCY_AUTO_RESEARCH_MINUTES", "0"))
AUTO_MAX_THREADS = int(os.environ.get("AGENCY_AUTO_MAX_THREADS", "12"))
AUTO_NEXT = 0


def start_research_thread():
    global AUTO_NEXT
    title, category, question = RESEARCH_TOPICS[AUTO_NEXT % len(RESEARCH_TOPICS)]
    AUTO_NEXT += 1
    tid = STORE.thread(f"Agency Research #{AUTO_NEXT}: {title}", category, question)
    RUNNING.add(tid)
    debate_id = STORE.debate_start(tid)
    task = asyncio.create_task(run_debate(tid, debate_id))
    TASKS.add(task)
    task.add_done_callback(TASKS.discard)
    return {"thread_id": tid, "debate_id": debate_id}


async def periodic_research():
    """Opt-in ideas/reviews only; never dispatches hardware actions."""
    generated = 0
    while generated < AUTO_MAX_THREADS:
        await asyncio.sleep(AUTO_RESEARCH_INTERVAL * 60)
        while RUNNING:
            await asyncio.sleep(10)
        if generated < AUTO_MAX_THREADS:
            start_research_thread()
            generated += 1


async def run_debate(thread_id: int, debate_id: str):
    try:
        thread = STORE.get_thread(thread_id)
        if thread is None:
            raise RuntimeError("Thread removed")
        for role in ROLES:
            thread = STORE.get_thread(thread_id)
            context = "Title: " + thread["title"] + "\nGoal: " + thread["question"] + "\n\nRecent forum posts:\n"
            context += "\n\n".join(p["author"] + " [" + p["provenance"] + "]: " + p["body"][:1400] for p in thread["posts"][-12:])
            context += "\n\nRecent VM findings are simulated, NOT device evidence.\n" + "\n".join(
                "VM " + r["id"] + " outcome=" + str(r["result"].get("outcome"))
                + " cycles=" + str(r["result"].get("cycles")) + " simulation_sha256=" + r["result_sha256"]
                for r in STORE.vm_runs(10) if r["thread_id"] == thread_id)
            context += "\n\nRecent hardware test records:\n" + "\n".join(
                "Test " + j["id"] + " status=" + j["status"] + " evidence=" + str(j["evidence_sha256"])
                for j in thread["jobs"][:10])
            target = MODEL_TARGETS.get(role, ModelTarget(url=MODEL_URL, model=MODEL_NAME))
            body = await complete(target.url, target.model, role, context)
            STORE.post(thread_id, role, body, "model-draft")
        STORE.debate_end(debate_id, True, "Six-agent review completed; proposals remain unverified without tests")
    except Exception as exc:
        STORE.debate_end(debate_id, False, type(exc).__name__ + ": " + str(exc))
        STORE.post(thread_id, "Forum System", "Debate halted: " + type(exc).__name__ + ": " + str(exc)[:500], "system")
    finally:
        RUNNING.discard(thread_id)

@asynccontextmanager
async def lifespan(app: FastAPI):
    if AUTO_RESEARCH_INTERVAL >= 5 and AUTO_MAX_THREADS > 0:
        task = asyncio.create_task(periodic_research())
        TASKS.add(task)
        task.add_done_callback(TASKS.discard)
    yield
    if TASKS:
        for t in TASKS:
            t.cancel()
        await asyncio.gather(*TASKS, return_exceptions=True)

app = FastAPI(title="Evil Inspector Gadget Agency Lab", version="0.2.0", lifespan=lifespan)

@app.get("/", response_class=HTMLResponse)
async def homepage():
    return HTMLResponse((WEB_DIR / "index.html").read_text(encoding="utf-8"))

@app.get("/health")
async def health():
    return {"ok": True, "product": "Evil Agency Lab", "model_server": MODEL_URL, "hardware_tests": "device-reported", "vm_replay_available": vm_available()}

app.mount("/vm", StaticFiles(directory=VM_DIR, html=True), name="internal_computer")

@app.get("/api/vm/examples", dependencies=[Depends(admin)])
async def get_vm_examples():
    return {"examples": vm_examples(), "execution": "16-bit virtual machine only", "hardware_access": False,
            "vm_workstation": "/vm/", "server_replay_available": vm_available()}

@app.get("/api/vm/runs", dependencies=[Depends(admin)])
async def list_vm_runs():
    return {"runs": STORE.vm_runs()}

@app.get("/api/vm/runs/{run_id}", dependencies=[Depends(admin)])
async def get_vm_run(run_id: str):
    run = STORE.get_vm_run(run_id)
    if run is None:
        raise HTTPException(404, "Unknown VM run")
    return run

@app.post("/api/vm/runs", dependencies=[Depends(admin)])
async def create_vm_run(request: VMRunRequest):
    if request.thread_id is not None and STORE.get_thread(request.thread_id) is None:
        raise HTTPException(404, "Unknown thread")
    try:
        result = await vm_simulate(request.source, request.max_steps)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc
    return STORE.save_vm_run(request.thread_id, request.name, request.source, result)

@app.post("/api/vm/runs/{run_id}/link-hardware", dependencies=[Depends(admin)])
async def link_vm_hardware(run_id: str, request: VMLinkRequest):
    try:
        return STORE.link_vm_job(run_id, request.job_id)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc

@app.post("/api/vm/proposals", dependencies=[Depends(admin)])
async def vm_proposals(request: VMProposalRequest):
    thread = STORE.get_thread(request.thread_id)
    if thread is None:
        raise HTTPException(404, "Unknown thread")
    target = MODEL_TARGETS.get(request.role, ModelTarget(url=MODEL_URL, model=MODEL_NAME))
    prompt = ("Create a human-reviewable 16-bit VM assembly experiment for this research topic. "
              "VM ops are MOV, LOAD, STORE, ADD, SUB, MUL, DIV, MOD, AND, OR, XOR, SHL, SHR, "
              "INC, DEC, CMP, JMP, JZ, JNZ, JG, JL, NOP, HALT, PUSH, POP, PRINT, PRINTC. "
              "No network, GPIO, UART, Linux, device, or host calls exist in this VM. "
              "Explain expected simulated evidence, limitations, and why it is NOT hardware acceptance. "
              "Never claim to have run code or send hardware commands. "
              "Topic: " + thread["title"] + "\nRequirements: " + thread["question"][:3000])
    try:
        proposal = await complete(target.url, target.model, request.role, prompt)
    except Exception as exc:
        raise HTTPException(502, "Local GGUF proposal failed: " + type(exc).__name__) from exc
    STORE.post(request.thread_id, request.role, proposal, "model-vm-proposal-unverified")
    return {"thread_id": request.thread_id, "role": request.role, "proposal": proposal,
            "provenance": "model-vm-proposal-unverified", "executed": False}

@app.get("/api/catalog", dependencies=[Depends(admin)])
async def tool_catalog():
    return {"linux_inspirations": [{"family": n, "adaptation": d} for n, d in LINUX_INSPIRED_DESIGNS],
            "safe_lab_tools": [{"name": n, "purpose": d} for n, d in SAFE_LAB_TOOLS]}

@app.get("/api/overview", dependencies=[Depends(admin)])
async def overview():
    return {"threads": STORE.all_threads(), "devices": STORE.devices(), "jobs": STORE.jobs(),
            "debates": STORE.debates(), "roles": list(ROLES), "model_targets": {k: v.model_dump() for k, v in MODEL_TARGETS.items()}, "vm_runs": STORE.vm_runs(15)}

@app.post("/api/threads", dependencies=[Depends(admin)])
async def add_thread(request: ThreadCreate):
    return {"id": STORE.thread(request.title, request.category, request.question)}

@app.get("/api/threads/{thread_id}", dependencies=[Depends(admin)])
async def read_thread(thread_id: int):
    item = STORE.get_thread(thread_id)
    if item is None:
        raise HTTPException(404, "Unknown thread")
    return item

@app.post("/api/threads/{thread_id}/posts", dependencies=[Depends(admin)])
async def add_post(thread_id: int, request: PostCreate):
    if STORE.get_thread(thread_id) is None:
        raise HTTPException(404, "Unknown thread")
    STORE.post(thread_id, request.author, request.body, "operator")
    return {"ok": True}

@app.post("/api/threads/{thread_id}/debate", dependencies=[Depends(admin)])
async def debate(thread_id: int):
    if STORE.get_thread(thread_id) is None:
        raise HTTPException(404, "Unknown thread")
    if thread_id in RUNNING:
        raise HTTPException(409, "Debate already active")
    RUNNING.add(thread_id)
    debate_id = STORE.debate_start(thread_id)
    task = asyncio.create_task(run_debate(thread_id, debate_id))
    TASKS.add(task)
    task.add_done_callback(TASKS.discard)
    return {"debate_id": debate_id, "status": "running"}

@app.post("/api/research/next", dependencies=[Depends(admin)])
async def research_next():
    if RUNNING:
        raise HTTPException(409, "A forum debate is already running")
    return start_research_thread()

@app.post("/api/swarms/diagnostics", dependencies=[Depends(admin)])
async def swarm_diagnostics(request: SwarmDiagnostics):
    try:
        return STORE.swarm_diagnostics(request.device_ids, request.thread_id, request.operation,
                                       request.duration_ms, request.max_bytes)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except (ValueError, PermissionError) as exc:
        raise HTTPException(400, str(exc)) from exc

@app.put("/api/models/{role}", dependencies=[Depends(admin)])
async def set_role_model(role: str, target: ModelTarget):
    if role not in ROLES:
        raise HTTPException(404, "Unknown role")
    if not (target.url.startswith("http://localhost:") or target.url.startswith("http://127.0.0.1:") or os.getenv("AGENCY_ALLOW_REMOTE_LLM") == "1"):
        raise HTTPException(400, "Only localhost model endpoints unless explicitly opted in")
    MODEL_TARGETS[role] = target
    return {"ok": True, "role": role, "url": target.url, "model": target.model}

@app.post("/api/devices/enroll", dependencies=[Depends(admin)])
async def enroll(request: Enroll):
    return STORE.register(request.name, request.kind, request.capabilities)

@app.put("/api/devices/{device_id}/policy", dependencies=[Depends(admin)])
async def set_policy(device_id: str, request: Policy):
    try:
        ok = STORE.policy(device_id, request.tx_enabled, request.allowlist_hex)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if not ok:
        raise HTTPException(404, "Unknown device")
    return {"ok": True}

@app.post("/api/tests", dependencies=[Depends(admin)])
async def schedule_test(request: TestRequest):
    tx_hex = None
    if request.operation == "uart_tx":
        if not request.confirm_write:
            raise HTTPException(400, "Explicit confirmation required for TX")
        try:
            tx_hex = validate_hex(request.tx_hex)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
    elif request.tx_hex is not None:
        raise HTTPException(400, "TX data is only accepted for uart_tx")
    try:
        jid = STORE.create_job(request.device_id, request.thread_id, request.operation,
                               request.duration_ms, request.max_bytes, tx_hex)
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    return {"job_id": jid, "status": "queued", "hardware_result": "pending"}

@app.post("/api/device/{device_id}/heartbeat", dependencies=[Depends(device_auth)])
async def heartbeat(device_id: str, request: Heartbeat):
    serialized = json.dumps(request.capabilities)
    if len(serialized) > 3000:
        raise HTTPException(413, "Capabilities too large")
    STORE.device_seen(device_id, request.capabilities)
    return {"ok": True}

@app.get("/api/device/{device_id}/next", dependencies=[Depends(device_auth)])
async def next_job(device_id: str):
    STORE.device_seen(device_id)
    item = STORE.lease(device_id)
    if item is None:
        return {"job": None}
    return {"job": {"id": item["id"], "operation": item["operation"], "request": item["request"]}}

@app.post("/api/device/{device_id}/result/{job_id}", dependencies=[Depends(device_auth)])
async def report(device_id: str, job_id: str, request: Report):
    try:
        raw = base64.b64decode(request.rx_b64, validate=True)
    except Exception as exc:
        raise HTTPException(400, "Invalid base64") from exc
    if len(raw) != request.bytes_received or len(raw) > 2048:
        raise HTTPException(400, "Result byte length mismatch")
    if not STORE.finish(device_id, job_id, request.model_dump()):
        raise HTTPException(409, "Job not leased to this device or already completed")
    return {"ok": True}
