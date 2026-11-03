# Software-Defined Computer

**918 Technologies · Internal Computer / NTL / Ev1l 1nspector Gadg3t / Agency Lab**

A real, source-preserved collection of programmable virtual-computer implementations and integrations with an optional local multi-agent forum and separately controlled embedded-device gateways. Its central artifact is a fully offline, 16-bit, deterministic browser-based virtual workstation. All other capabilities are distinct modules with explicit trust boundaries.

**Release classification:** source publication of previously built components; validated software execution; no certified hardware integration. **Licensing:** source-available, all rights reserved, see [LICENSE](LICENSE) and [IP/IP_REGISTER.md](IP/IP_REGISTER.md). Public distribution does not preserve trade-secret confidentiality.

## What is included

| Path | Actual source | Execution environment |
| --- | --- | --- |
| `core/` | Original Internal Computer v1, CPU, assembler, browser UI, filesystem, self-tests | Browser + optional Node.js tests |
| `extensions/ntl/` | NTL Internal Computer with comparison/diff functionality and its test suite | Browser / Node.js |
| `integrations/agency-lab/` | Original v0.2.0 multi-agent forum, FastAPI, SQLite, server-side VM replay, GGUF routing, UART queue/bridge, device evidence handling | Linux / Termux host; optional embedded gateway |
| `integrations/redlab-os/` | Original RedLab v0.1.0 phone control plane, dashboard, scope enforcement, read-only SSH diagnostics, ESP Linux overlay, tests | Termux / experimental ESP Linux, subject to platform acceptance |
| `docs/` | System architecture, operating instructions, validation matrix, evolution roadmap | Documentation |
| `IP/` | Ownership/provenance register, restrictions, inventorship records, third-party and patent-readiness cautions | Governance documentation |

Source files from the archived component releases remain unmodified inside their respective module trees unless identified by a future commit; this top-level release adds packaging, notices, documentation, validation and provenance. Do not mistake a forked tree for an integrated ESP32 image.

## The actual internal computer

The v1 computer has eight 16-bit registers, 64 KiB of virtual RAM, a 1 MiB virtual filesystem, a parser/assembler, step/run/debug commands, program examples and a 100,000-cycle execution limit. Programs use custom instructions (`MOV`, `ADD`, `STORE`, `LOAD`, `CMP`, `JMP`, `PRINT`, `HALT`, etc.), not native CPU instructions. It deliberately lacks access to the host shell, Wi-Fi, real files, external APIs and GPIO.

### Quick start: virtual workstation

```sh
cd core
python3 -m http.server --bind 127.0.0.1 8080
```

Open `http://127.0.0.1:8080/`. Open `core/index.html` or `core/internal_computer.html` as the application entrypoint. For the NTL extension, use the same approach within `extensions/ntl/` on a different port.

### Quick start: Agency Lab on Linux / Termux

```sh
cd integrations/agency-lab
python3 -m pip install -r requirements-dev.txt
./scripts/start.sh
```

The local dashboard is at `http://127.0.0.1:8789`. The original integration provides `/vm/` for the standalone workstation, plus a bounded Node.js interpreter for server-side simulation and evidence linkage. Node.js 18+ is needed for server replay. The forum can use local `llama.cpp`-compatible GGUF endpoints; language models do **not** run inside the virtual CPU. Never expose the default local API to untrusted networks.

### Quick start: RedLab on Termux

```sh
cd integrations/redlab-os
python3 -m unittest discover -s tests -v
python3 phone/redlab.py serve
```

Visit `http://127.0.0.1:9180` on the phone. Any installed PRoot Ubuntu runs on Android, **not** on ESP32. Its experimental native Linux overlay is not a validated firmware image for any particular board.

## Safety boundaries and acceptance

1. **VM / simulation:** no real hardware control; VM examples are synthetic, not probe results.
2. **AI forum:** models write draft proposals; the device test queue requires authenticated control and applicable transmit policy. AI suggestions must not be represented as validated findings.
3. **Physical hardware:** UART, Wi-Fi, LCD, camera, Flipper and full-flash Linux require separate hardware-specific verification. Do not flash a board using this release without validated exact-board wiring, backup and build acceptance.
4. **No unrestricted autonomy:** no self-replicating firmware or unbounded unattended physical actions. An eventual scheduler must obey bounded jobs, explicit scope, review gates, audit trails and reversibility.

Detailed controls: [Architecture](docs/ARCHITECTURE.md), [Verification](docs/VALIDATION.md), [Roadmap](docs/ROADMAP.md), [Hardware acceptance](integrations/agency-lab/docs/HARDWARE_ACCEPTANCE.md).

## Verify locally

```sh
python3 -m pip install -r integrations/agency-lab/requirements-dev.txt
bash scripts/verify.sh
python3 scripts/verify_release.py
```

These checks cover source checksums, virtual machine tests, API / integration tests, and RedLab tests. A passing software test does not certify actual firmware hardware acceptance. The manifest contains SHA-256 hashes of committed files, excluding itself and other generated ledger files.

## Intellectual property and disclosure status

Read [IP/IP_REGISTER.md](IP/IP_REGISTER.md), [IP/RIGHTS_PROVENANCE.md](IP/RIGHTS_PROVENANCE.md), [IP/INVENTION_RECORD.md](IP/INVENTION_RECORD.md), [IP/PATENT_AND_PUBLICATION.md](IP/PATENT_AND_PUBLICATION.md), and [LICENSE](LICENSE). These preserve evidence and communicate intended rights reservations; they do **not** replace chain-of-title review, signed inventor assignments, patent filings or counsel. Because this repository is public, any original, unfiled patent concepts disclosed here may become public disclosures with jurisdiction-dependent consequences.

## Source origins and integrity

This publication reconstructs a single browsable tree from four previously created archived releases: `internal_computer_source.zip`, `NTL_Internal_Computer_Source_v1_1.zip`, `Evil_Agency_Lab_Internal_Computer_v0.2.0.zip`, and `Evil_Inspector_Gadget_RedLab_OS_v0.1.0.zip`. Source archive hashes and provenance are recorded in `IP/RIGHTS_PROVENANCE.md`; file-level hashes appear in `SHA256SUMS` and `RELEASE_MANIFEST.json`. The earlier UART swarm source is represented by the directly derived Agency Lab v0.2.0 release, with an original-manifest reference preserved in `integrations/agency-lab/docs/`.

No previously existing projects were modified by this repository package; it is a separate publishable source collection.
