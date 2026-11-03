# Software-Defined Computer — 918 Technologies

A source-preserved family of **Internal Computer** virtual machines and **Evil Inspector Gadget** experimental agent / device-lab systems.

The base Internal Computer is an offline deterministic **16-bit VM** with 8 registers, 64 KiB virtual RAM, a bounded 1 MiB browser filesystem, an assembler, program editor, step/run debugging, and a 100,000-cycle execution limit. Its virtual programs cannot execute a host shell, access Wi-Fi, drive GPIO/UART, or run models themselves.

## Verified software suites (2026-11-03)
| Component | Tests |
| --- | ---: |
| Original VM | 14 passed |
| NTL VM extension | 30 passed |
| Agency Lab integrated VM | 14 passed |
| Agency Lab API and replay | 23 passed |
| RedLab phone controller | 32 passed |
| **Total** | **113 passed** |

These are separate source-package tests, not evidence of physical ESP32 hardware acceptance. Proposed self-improvement is not yet a finished integrated runtime.

## Modules and release assets
- `core/internal_computer.html`: browser VM, runnable independently.
- `extensions/ntl/NTL_Internal_Computer.html`: extended NTL computer, when the full extension is checked in.
- `integrations/agency-lab/`: local FastAPI/SQLite multi-agent forum, GGUF endpoints, isolated Node replay worker, bounded UART gateway and evidence queue.
- `integrations/redlab-os/`: Termux phone-side lab, optional experimental ESP Linux diagnostic overlay, explicit scope restrictions.
- `docs/`: architecture, verification, roadmap and deployment boundaries.
- `IP/`: IP register, provenance, publication cautions, inventorship and third-party rights notes.
- `LICENSE`: all rights reserved; no open-source grant.

**Legal caution:** This GitHub repository is PUBLIC. Publishing source can compromise trade-secret confidentiality and affect patent options; a restrictive license is not an NDA. Copyright and patent claims remain subject to valid ownership, third-party licenses, actual inventorship, jurisdiction and formal filings. The repository does not claim patent registration, executed assignments or confidential status.

**Source preservation:** Published original source HTML and technical guides reflect previously generated Codex-built archives. See release provenance and checksum records. Hardware flash builds must be independently validated on the exact device.
