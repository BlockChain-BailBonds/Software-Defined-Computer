"""Deterministic source-to-evidence bridge for the bundled offline 16-bit VM.

Running VM assembly does not run host shell commands, send UART, or access devices.
Node executes a fixed, reviewed interpreter. The server labels runs as SIMULATED.
"""
import asyncio
import hashlib
import json
import os
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RUNNER = ROOT / "tools" / "vm_runner.js"
VM_DIR = ROOT / "web" / "vm"
RUN_LIMIT = asyncio.Semaphore(2)

EXAMPLES = (
    {
        "id": "uart-frame-guard",
        "name": "Simulated UART frame guard",
        "category": "hardware-test",
        "description": "Models a small, synthetic status frame with a simple header check in VM registers. No UART access.",
        "source": 'PRINT "SIMULATED UART HEADER CHECK"\nMOV R0, 0xA5\nCMP R0, 0xA5\nJNZ bad\nPRINT "HEADER ACCEPTED"\nJMP done\nbad:\nPRINT "HEADER REJECTED"\ndone:\nHALT',
    },
    {
        "id": "sensor-threshold",
        "name": "Synthetic sensor threshold",
        "category": "defense",
        "description": "Compares an artificial sensor measurement with a fixed threshold; demonstrates deterministic event logic.",
        "source": 'PRINT "SENSOR TEST (SYNTHETIC)"\nMOV R0, 42\nMOV R1, 40\nCMP R0, R1\nJG alarm\nPRINT "NORMAL"\nJMP finish\nalarm:\nPRINT "THRESHOLD EXCEEDED"\nfinish:\nHALT',
    },
    {
        "id": "checksum-demo",
        "name": "Toy checksum simulator",
        "category": "red-team-lab",
        "description": "Demonstrates a checksum over fixed sample bytes. Not a real serial protocol or exploit.",
        "source": 'PRINT "CHECKSUM DEMO"\nMOV R0, 16\nADD R0, 32\nADD R0, 48\nAND R0, 255\nPRINT R0\nHALT',
    },
    {
        "id": "cooperative-tasks",
        "name": "Micro-OS scheduler concept",
        "category": "os-design",
        "description": "Demonstrates a bounded cooperative task counter, not an ESP32 firmware build.",
        "source": 'PRINT "SCHEDULER SIMULATION"\nMOV R0, 0\ntick:\nPRINT R0\nINC R0\nCMP R0, 3\nJL tick\nPRINT "ALL TASK SLOTS VISITED"\nHALT',
    },
    {
        "id": "swarm-quorum",
        "name": "Synthetic swarm quorum",
        "category": "swarm",
        "description": "Computes a quorum decision from simulated votes; no remote enrollment or network access.",
        "source": 'PRINT "SYNTHETIC QUORUM"\nMOV R0, 2\nMOV R1, 3\nCMP R0, R1\nJL insufficient\nPRINT "QUORUM"\nJMP done\ninsufficient:\nPRINT "MORE VOTES REQUIRED"\ndone:\nHALT',
    },
)


def available():
    return shutil.which("node") is not None and RUNNER.is_file() and (VM_DIR / "core.js").is_file()


def examples():
    return list(EXAMPLES)


async def simulate(source: str, max_steps: int):
    node = shutil.which("node")
    if node is None:
        raise RuntimeError("Node.js is not installed; browser workstation remains available")
    try:
        source_bytes = source.encode("utf-8")
    except UnicodeEncodeError as exc:
        raise ValueError("VM source must contain valid UTF-8 characters") from exc
    if len(source_bytes) > 16384:
        raise ValueError("VM source exceeds 16384 UTF-8 bytes")
    if not 1 <= max_steps <= 100000:
        raise ValueError("VM step limit must be between 1 and 100000")
    payload = json.dumps({"source": source, "max_steps": max_steps}, ensure_ascii=False).encode("utf-8")
    async with RUN_LIMIT:
        proc = await asyncio.create_subprocess_exec(
            node, "--max-old-space-size=64", str(RUNNER),
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE, cwd=str(ROOT),
            env={"PATH": os.environ.get("PATH", "")},
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(payload), timeout=6.0)
        except asyncio.TimeoutError as exc:
            proc.kill()
            await proc.communicate()
            raise RuntimeError("Virtual CPU worker exceeded its 6-second wall-clock limit") from exc
    if proc.returncode != 0 or len(stdout) > 30000:
        raise RuntimeError("Virtual CPU worker failed: " + stderr.decode(errors="replace")[:120])
    try:
        result = json.loads(stdout)
    except (ValueError, UnicodeDecodeError) as exc:
        raise RuntimeError("Virtual CPU worker returned invalid evidence") from exc
    if not isinstance(result, dict) or result.get("hardware_access") is not False:
        raise RuntimeError("Virtual CPU worker returned an invalid boundary declaration")
    result["provenance"] = "server-replayed-vm-simulation"
    result["source_sha256"] = hashlib.sha256(source.encode("utf-8")).hexdigest()
    return result
