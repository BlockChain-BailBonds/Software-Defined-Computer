# Architecture: internal computer and external orchestration

## System boundaries

```text
                    Samsung / Linux / Termux host
             +----------------------------------------+
             | Optional GGUF model servers / agents   |
             | Authenticated FastAPI + SQLite forum   |
             | Scheduler (research-only if enabled)   |
             +--------------------+-------------------+
                                  |
                   +--------------+--------------+
                   |                             |
     +-------------v-------------+ +-------------v----------------+
     | Offline 16-bit Virtual CPU | | Authorized gateway / job queue |
     | Browser or bounded Node VM | | Leased, policy-scoped bridge    |
     | 8 regs / 64 KiB / 1 MiB FS | | Evidence + SHA-256 + audit      |
     +---------------------------+ +-------------+----------------+
                                                 |
                                ESP32-S3 / CYD / TTL-UART devices
                                (separately verified physical test)
```

The Internal Computer is NOT an emulator for x86, ARM, Xtensa or RISC-V instructions and is not a general-purpose Linux kernel. User assembly is interpreted by `VirtualCPU` in the source. The browser VM uses local storage for virtual filesystem persistence and has no host-side networking or shell access. The backend replay worker is bounded and remains simulation-only.

## Internal computer v1 hardware model

- CPU: eight 16-bit general-purpose registers; instruction pointer and status flags; deterministic instruction interpreter.
- RAM: 65,536 virtual bytes. Virtual programs can read/write via the interpreted instruction set.
- Storage: 1 MiB virtual filesystem, bounded individual files and directory entry counts; stored in browser state/local storage.
- Control: Run, step, pause, reset, read registers, inspect memory, edit and save assembly.
- Execution: custom instruction set, 100,000 maximum cycles; safety bounds against unlimited execution.

## Agent control plane

Agency Lab v0.2.0 is an actual separate FastAPI + SQLite process with independently prompted model roles, structured debate threads, authenticated API and policies restricting device commands. `agency/vm_lab.py` orchestrates bounded Node VM runs. `tools/vm_runner.js` executes the original CPU interpreter; simulation results include source/result digests and do not create live device traffic.

Model outputs are hypotheses; device-reported evidence requires authorization, provenance and separate controls. Never merge VM output and hardware observations into one evidence class. A GGUF endpoint may produce misleading content; the system's recorded execution and validation are the relevant evidence.

## RedLab / ESP32 division

The phone's Termux/Android environment runs the full Python control plane and optional PRoot Ubuntu or local GGUF inference. ESP32-S3 N16R8 is an embedded microcontroller with 16 MiB flash and 8 MiB PSRAM, not a general Ubuntu host. The experimental ESP-S3 Linux NOMMU port is a different OS environment requiring exact-board build, peripheral support and flash safety acceptance. The RedLab original source does not verify an assembled Linux image or hardware success.

## Trust zones

- **Zone 0 — offline virtual simulation:** no host commands, network or GPIO.
- **Zone 1 — host application:** authenticated local process, auditable tasks, separate model server.
- **Zone 2 — bridge:** device enrollment, bounded leases and UART policy; TX denied unless explicitly enabled.
- **Zone 3 — physical device:** only tested pins, supported voltage levels, authorized scope and approved firmware.

Transition across any boundary requires a separately authenticated, documented interface, not a model-generated instruction string. No autonomous actor may silently promote a simulated result to physical evidence.
