# Internal Computer ↔ Evil Agency Lab integration (v0.2.0)

## Guarantees and boundaries

The bundled Internal Computer is a 16-bit *virtual instruction interpreter*, not Linux, Android, an x86 emulator, a real ESP32 runtime, or a physical UART adapter. Its 64 KiB RAM, register bank and virtual filesystem exist in browser memory or browser local storage. Its programs **cannot** execute shell commands, access sensors, drive GPIO/UART pins, scan networks, or invoke the AI forum by themselves.

The existing Agency Lab hardware job controller remains unchanged. Device tests still require an administrator, registered hardware bridges, and separate UART transmit policies. A simulation never transmits to any board. A comparison links **already completed** hardware evidence to VM replay results; it cannot lease a device job or start transmissions. Do not confuse software regression tests with independent GPIO acceptance.

## What was integrated

| Layer | Path | Behavior |
|---|---|---|
| Virtual workstation | `http://127.0.0.1:8789/vm/` | Bundled unmodified browser virtual computer with assembler, CPU inspector, browser-local files, backup and restore |
| Forum VM panel | `http://127.0.0.1:8789/` | Example source editor, run and replay history, source import from browser VM storage, GGUF proposals, evidence linkage |
| VM server worker | `tools/vm_runner.js` | Separate Node.js process running the **original** `VirtualCPU` interpreter on bounded input; no `eval` of assembly |
| VM integration layer | `agency/vm_lab.py` | Async worker execution, 2-process concurrency bound, 6-second wall-clock limit, step count and source byte limits |
| Database persistence | `agency/core.py` | `vm_runs`, `vm_hardware_links`, audit log, simulated evidence posts with source/result SHA-256 |
| Local GGUF | `POST /api/vm/proposals` | Writes **unverified model draft** into selected forum thread. No execution or device tool calling |
| Hardware comparison | `POST /api/vm/runs/{run_id}/link-hardware` | Records a reference to a completed device-reported job in the **same thread**, without sending any commands |
| Examples/catalog | `agency/vm_lab.py`, `agency/catalog.py` | Five synthetic programs, clearly classified as simulations |

VM example experiments: synthetic UART header guard, sensor threshold, checksum, cooperative scheduler, quorum voting. The underlying virtual computer's sample `fibonacci.asm`, `memory.asm`, `countdown.asm` and `hello.asm` remain available in the full workstation.

## Termux installation

Run in a Termux session with the project extracted. The existing Python setup remains valid:

```sh
pkg update
pkg install python nodejs
cd /path/to/evil-agency-lab
python -m pip install -r requirements-dev.txt
./scripts/start.sh
```

Or create a virtual environment with `python -m venv .venv` when supported. A current `nodejs` package is needed for server replay; Node.js 18+ is supported. The browser-only virtual workstation works without Node.js, although server run/evidence endpoints return HTTP 503 when it is absent.

The startup script creates `.env.local` containing a private admin key if missing. Start the API on localhost by default, open `http://127.0.0.1:8789`, enter that key, and click **Connect**. Click **Open full virtual workstation** to use the richer CPU/terminal/filesystem interface.

To transfer an assembly program from the workstation into the forum, save the `.asm` file inside the workstation. Return to the forum using the **same browser origin/profile** and select the saved file from **Import saved .asm**. Browser-local disk is not a server-side file; it may disappear when browser storage is cleared. Import copies the text into the forum editor. It does not execute anything until the operator presses **Run on server VM**.

## Example flow

1. Select or create a forum thread, ideally in **Hardware test**.
2. Choose a curated VM sample or import a saved `.asm` program; press **Run on server VM**.
3. Inspect the output, cycles, 16-bit registers and simulation evidence digest.
4. Press **Run six-agent review** to let the local GGUF roles discuss the simulation with explicit provenance, or use **Ask selected GGUF role to propose a VM experiment** and review its draft. The models require a working llama.cpp-compatible `/v1/chat/completions` server; this package does not embed GGUF weights.
5. If an authorized real test is required, use the **existing** Live hardware panel to queue a read-only capture or separately allowlisted diagnostic. The ESP32/CYD/UART bridge must itself be connected and enrolled.
6. After the device reports a completed test, choose it in **Completed device-reported hardware job** and press **Link simulated result to hardware evidence**.
7. The forum records both provenance labels and evidence hashes. A link **does not prove** that a VM computation ran on the ESP32 or that the real peripheral passed any electrical acceptance gate.

## Authenticated API

All endpoints require the `x-agency-key` header used by the existing forum. The device-specific APIs retain their own `x-device-token` and are unchanged.

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/vm/examples` | Built-in source examples and replay availability |
| POST | `/api/vm/runs` | Execute bounded virtual assembly, optionally attach to thread |
| GET | `/api/vm/runs` | List 30 most recent VM results |
| GET | `/api/vm/runs/{run_id}` | Retrieve stored VM source and result |
| POST | `/api/vm/proposals` | Call configured GGUF role for an **unexecuted** VM proposal |
| POST | `/api/vm/runs/{run_id}/link-hardware` | Link completed device-reported evidence in same thread |

Example request (replace the admin key, and use a `thread_id` from `/api/threads` if you want a forum discussion):

```sh
curl -sS -X POST http://127.0.0.1:8789/api/vm/runs \
  -H "x-agency-key: $AGENCY_ADMIN_KEY" \
  -H 'content-type: application/json' \
  -d '{"name":"Counter demo","source":"MOV R0, 918\nPRINT R0\nHALT","max_steps":1000}'
```

The response includes `source_sha256`, `result_sha256`, `provenance=server-replayed-vm-simulation`, registers, output, cycles, and `hardware_access=false`. Successful execution means only **virtual instruction completion**. The evidence digest is integrity bookkeeping, not device attestation.

## Safe operational limits

- Source size: 16,384 UTF-8 bytes; single VM instruction cap remains 3,000 from the upstream interpreter.
- Instruction budget: 1–100,000 per server request; interpreter's original safety limit remains 100,000 cycles.
- Concurrency: two server replay processes; 6-second wall-clock maximum per process.
- Output: at most 256 messages and 16,000 UTF-8 output bytes; additional output is explicitly marked truncated.
- Node process heap cap: 64 MiB; static runner and virtual CPU logic are committed sources, never generated code.
- Browser: content security policy prevents VM network calls and host resource access. The VM is not an isolation substitute for arbitrary untrusted JavaScript or native executables.
- Device evidence: linked only when the device job has status `passed` or `failed`, a persisted evidence hash, and the same `thread_id`. No automatic hardware transmission.
- Do not expose the API to the public Internet; default bind remains `127.0.0.1`. TLS and stronger deployment security are necessary outside a trusted local lab.

## Acceptance

```sh
python -m pytest -q
python -m compileall -q agency bridge
node --check tools/vm_runner.js
(cd web/vm && node --test core.test.js ui.smoke.test.js)
```

The acceptance tests assert no implicit hardware jobs from simulated runs, simulated-vs-device provenance, step-budget exhaustion, invalid instruction rejection, authenticated APIs, completed-job-only linkage, scoped same-thread pairing, and no model proposal execution. They do not assert physical ESP32, camera, CYD touch, UART pin or GGUF model acceptance.

## Preserved originals

The v0.1.0 Agency Lab startup, hardware bridge files, GPIO configuration, device queue, and protective UART TX controls are preserved. The original Internal Computer split-source app and standalone HTML are copied into `web/vm/`. `core.js` and `app.js` remain byte-identical to the uploaded source and retain their own independent unit/smoke tests. Neither original ZIP is modified.
