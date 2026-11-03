# Release history

## v0.2.0 — Internal Computer integration

- Copied the supplied original Internal Computer browser emulator, including standalone HTML and its JavaScript unit/smoke tests, unchanged under `web/vm/`.
- Exposed `/vm/` from the existing FastAPI server.
- Added `agency/vm_lab.py` and `tools/vm_runner.js` to replay bounded 16-bit assembly with the same VirtualCPU interpreter using a separate Node.js process.
- Added five synthetic experiments and imported them into the lab catalog.
- Added authenticated VM execution, history, proposal, and evidence-linking API endpoints.
- Added SQLite virtual-run history, SHA-256 hashes, human-readable provenance and links to already completed device-reported jobs.
- Added a VM workspace panel to the existing forum UI, including browser-local source import, GGUF proposal review and hardware evidence linkage.
- Kept hardware UART TX policies, firmware and GGUF routing unchanged. No autonomous hardware action was introduced.
- Added Python VM integration tests and retained the supplied JavaScript tests.

## v0.1.0 — Original Agency Lab

- Original FastAPI forum, GGUF roles, UART gateway, device registry, hardware queue and defensive evidence tracking, preserved in the user-supplied v0.1.0 ZIP.
