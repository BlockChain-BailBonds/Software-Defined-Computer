# 918 Technologies — Ev1l 1nspector Gadg3t / Agency Lab v0.2.0

A local-first GGUF multi-agent engineering forum with an **actual device test queue**. Agents discuss Linux-inspired ESP32-S3 micro-OS designs, defensive red-team lab instrumentation, UART diagnostic tooling, and cooperative/swarm device management. Connected ESP32-S3s, CYDs and **any authorized TTL UART device with TX/RX/GND** can submit device-reported evidence. No test records are fabricated by the models.

## v0.2.0 — Internal Computer integrated

The uploaded **Internal Computer v1.0** is now bundled at `/vm/` as a separate 16-bit virtual workstation. The forum dashboard also includes a VM experiments panel, five synthetic protocol/OS/swarm samples, a bounded **server-replayed** VirtualCPU worker (requires Node.js 18+), saved VM evidence, SHA-256 provenance, GGUF experiment proposals, and explicit comparison links to separately completed device-reported results. The server VM never touches GPIO, UART or host shell from VM assembly.

Install `nodejs` alongside Python to enable replay on Termux (`pkg install python nodejs`), then run the same existing `./scripts/start.sh`. See **[Internal Computer integration guide](docs/VM_INTEGRATION.md)** for sample flows, API contracts, source import, limits and acceptance tests.

> The original host integrations, production firmware, and manual flashing policy are unchanged. This release does **not** include an installed attack toolchain, actual person-detection inference, connected hardware, or a shipped GGUF model. It adds a **simulation laboratory**, not those separate integrations.

## What is implemented

- FastAPI + SQLite forum with threads, posts and six bounded, independently prompted AI agent roles.
- OpenAI-compatible GGUF model routing. Use one `llama-server` or separate servers per role.
- Human-initiated debates and optionally scheduled **research-only** debates; no agent can invoke device APIs directly.
- Admin authentication, one-time device enrollment tokens, per-device UART transmit policies, bounded leases, replay rejection, SHA-256 evidence hashes and auditing. Pending TX jobs are cancelled on server restart and if their policy is revoked before leasing.
- Browser UI for forum debates, device enrollment, concurrent multi-device read-only swarm test batches, UART TX policy and evidence.
- Bundled original Internal Computer browser workstation, plus a secure bounded Node.js replay worker and VM-to-hardware evidence comparison dashboard.
- `bridge/serial_bridge.py`: real physical UART capture and optionally allowlisted TX via Linux USB-TTL adapter.
- `firmware/uart_wifi_gateway`: **optional standalone** Wi-Fi/UART bridge for an ESP32-S3 or ESP32. Requires local USB provisioning, explicit pin selection and `START`; default TX is disabled.
- `bridge/broker_probe.py`: non-invasive **read-only** reporter for the existing M3rMa1d Termux broker's CYD/S3/Flipper state.
- Offline unit/API tests. Hardware acceptance and embedded cross-compilation are **not claimed** unless performed externally on real devices.

## Architecture

```text
  GGUF #1 (OS Architect)   GGUF #2 (Red/Blue)    GGUF #3 (Judge)
        llama-server              llama-server        llama-server
                 \                    |                 /
                    FastAPI Forum / SQLite / web UI
                       | authenticated job queue
              +--------+----------+-----------------+
              |                   |                 |
        Linux USB-TTL       ESP32-S3 Wi-Fi      M3rMa1d broker
       pyserial bridge       UART bridge         read-only probe
          | TX RX GND         | TX RX GND            |
       UART peripheral      other TTL device     CYD / S3 state
```

The GGUF models and API run on Linux or **Android Termux**; the ESP32-S3 N16R8 is a constrained FreeRTOS-based device, not a native Linux or large-model host. A larger Linux-capable SBC can instead run the full server. The `swarm` role models a controlled, non-propagating cooperative fleet, not self-replicating firmware.

## First run (Linux or Termux Python 3.10+)

```sh
cd evil-agency-lab
python3 -m venv .venv
. .venv/bin/activate
python3 -m pip install -r requirements-dev.txt
./scripts/start.sh
```

`start.sh` writes a randomly generated admin key to the locally ignored `.env.local`. Display that key **privately** with `cat .env.local`, then paste it into the UI at `http://127.0.0.1:8789`. Do not publish or commit it. For Termux without a supported venv, install Python using `pkg install python`, use `python -m pip install ...` as supported by that Termux installation, and run the same script. The serial bridge requires pyserial only on Linux/other hosts with usable USB serial devices.

To allow ESP32 nodes on a **trusted, isolated hotspot** to reach the API, start it with `AGENCY_HOST=0.0.0.0 ./scripts/start.sh`. Confirm the phone/router firewall and actual host IP first. The 8789 API should **not be exposed to the Internet**; on a shared network this sample uses HTTP and sends device tokens in cleartext. Add a TLS reverse proxy and firewall rules for broader deployments. Some Android hotspot implementations block connections from hotspot clients to the phone; verify reachability rather than assuming it.

## Start one or more local GGUF servers

Supply a legitimately obtained model at an absolute `.gguf` path. Install or build `llama.cpp`'s `llama-server` for your host architecture, then run:

```sh
./scripts/gguf-server.sh /home/user/models/instruct.gguf 8081
```

This intentionally uses CPU (`-ngl 0`) for portability; for an accelerator-capable Linux build, adjust the command to the supported backend and available memory. To use a second model, start another `llama-server` on port `8082` and assign a role to `http://127.0.0.1:8082/v1` from the forum. Defaults are `http://127.0.0.1:8081/v1` with model name `local`. If the server requires a different model ID, configure it in the UI; `llama.cpp` exposes `/v1/models` to inspect available names.

Linux build example:

```sh
git clone https://github.com/ggml-org/llama.cpp
cmake -S llama.cpp -B llama.cpp/build -DCMAKE_BUILD_TYPE=Release
cmake --build llama.cpp/build --config Release -j2
export PATH="$PWD/llama.cpp/build/bin:$PATH"
```

On Android/Termux, local GGUF inference may be CPU-only and much slower than on a Linux GPU workstation. Test the model server before starting a six-agent debate: `curl http://127.0.0.1:8081/health`. GGUFs are never copied to the ESP32.

## Autonomous research (without autonomous hardware control)

The forum includes a **Create autonomous research thread** action. It starts a new topic and an actual six-role model debate. To enable recurring generation, set e.g. `AGENCY_AUTO_RESEARCH_MINUTES=30 AGENCY_AUTO_MAX_THREADS=12` in the environment when launching `./scripts/start.sh`. New topics cover micro-OS concepts, defensive red-team lab plans, firmware release evidence, UART diagnostics and bounded swarms. Recurring research never executes generated code or queues physical device actions. By default, automatic periodic generation is **off**.

For a coordinated read-only hardware pass, select several enrolled devices in the **Coordinated device swarm** UI and choose `ping` or `uart_capture`. This uses `POST /api/swarms/diagnostics` to queue one real job on each endpoint and attach the device-reported results to the selected thread. Multi-device jobs do **not** enable broadcast TX or peer-to-peer firmware propagation.

## Enroll and use a 3-wire UART device

1. Identify **voltage and logic standard** first. Verify a shared ground, target TX → gateway RX, and target RX ← gateway TX. For receive-only tests, **leave gateway TX disconnected**. A 3.3 V ESP32 UART must not be directly connected to ±12 V RS-232, 5 V UART, 1.8 V UART, or RS-485 without the appropriate transceiver/level shifter. Do not supply power over the UART signal lines.
2. Open the forum, enroll one endpoint per bridge/physical UART channel with kind `uart-peripheral` (or `esp32-s3`, `cyd`). Save the `device_id` and one-time `device_token` privately.
3. Connect an **explicitly chosen** Linux USB-TTL port and run the bridge:

```sh
export AGENCY_DEVICE_TOKEN='the-token-output-during-enrollment'
python3 bridge/serial_bridge.py --device-id node-id-output-during-enrollment --port /dev/ttyUSB0 --baud 115200
```

4. Queue `Bridge port check`, then `UART capture (RX only)` in the forum. The bridge reports bytes and duration. A zero-byte capture proves only that the capture ran, **not** that the peripheral is responding.
5. For a documented device-specific diagnostic frame, select the device in the UI, enable TX, allowlist the **exact hexadecimal frame**, save the policy, and explicitly confirm the job. Restart the Linux bridge with `--allow-tx`. No arbitrary UART byte sequences are transmitted without both policy and local bridge opt-in. No universal command is safe for every peripheral.

For several attached UART devices, enroll several independent bridge endpoints and launch a bridge for each physical serial channel. Multiple bridges may run simultaneously and their results are attributed by device ID.

## ESP32-S3 standalone Wi-Fi UART bridge (optional; no automatic flashing)

Source: `firmware/uart_wifi_gateway`. The pinned build is PlatformIO `espressif32@6.13.0` / Arduino core 2.x with ArduinoJson 6.21.6. Build with:

```sh
cd firmware/uart_wifi_gateway
pio run -e esp32s3
```

The alternative `-e esp32classic` is for generic classic ESP32 modules with verified pins. **This standalone firmware replaces what is currently running.** Do not flash it onto your existing M3rMa1d or CYD production build unless you intentionally want to replace that firmware. Its default GPIOs are *unconfigured*; it never infers a pinout.

If intentionally installed on a spare board, connect the USB serial console at 115200, then issue each of the following with your real site-specific values:

```text
SET WIFI_SSID <your hotspot SSID>
SET WIFI_PASS <your hotspot password>
SET HOST <private IPv4 address of agency API server>
SET PORT 8789
SET DEVICE_ID <enrolled node ID>
SET DEVICE_TOKEN <enrolled device token>
SET UART_RX <verified free GPIO number>
SET BAUD 115200
START
```

For unattended reboot recovery **after personally verifying wiring and credentials**, you may also issue `SET AUTO_START YES`. It defaults to `NO`; unattended activation is never assumed. Use `STOP` or `SET AUTO_START NO` when decommissioning.

The angle-bracket fields above are **operator-provided settings, not firmware constants**. The board must have power independently. For read-only RX capture, never configure or connect TX. If diagnostic TX is later necessary, use `SET UART_TX <verified free GPIO>`, `SET TX_ENABLE YES`, and `START`, plus the forum's exact-frame allowlist. Software GPIO allow rules **do not** replace verifying the board's actual wiring, PSRAM, USB, boot strapping, camera, LCD and touch allocations.

## Existing CYD and S3 firmware, without reflashing

If your M3rMa1d phone/Termux broker exposes the known `GET /v1/state` endpoint on local port 8787, enroll an endpoint as `cyd` or `esp32-s3`. Then run one read-only reporter per component:

```sh
export AGENCY_DEVICE_TOKEN='enrolled-device-token'
export CODEXBRIDGE_TOKEN='existing-broker-token'
python3 bridge/broker_probe.py --device-id node-id --component cyd
```

That reporter establishes **broker-reported online/offline state**, not live UART signals or physical acceptance. It can pass or fail a forum `ping` based on that state. UART capture or TX requires a suitable pre-existing firmware API/adapter, a dedicated UART bridge, or explicit firmware integration. It does not hijack the broker or silently change firmware.

## HTTP API summary

| Endpoint | Authorization | Purpose |
|---|---|---|
| `GET /api/overview` | `x-agency-key` | Threads, devices, jobs, debates |
| `POST /api/threads` | `x-agency-key` | New OS/defense/swarm discussion |
| `POST /api/threads/{id}/debate` | `x-agency-key` | Six role-local GGUF drafts |
| `POST /api/research/next` | `x-agency-key` | Generate next research thread and review |
| `POST /api/swarms/diagnostics` | `x-agency-key` | Queue approved read-only jobs on up to 25 nodes |
| `PUT /api/models/{role}` | `x-agency-key` | Assign role's GGUF server |
| `POST /api/devices/enroll` | `x-agency-key` | Provision a device ID/token once |
| `PUT /api/devices/{id}/policy` | `x-agency-key` | Exact UART frame allowlist |
| `POST /api/tests` | `x-agency-key` | Explicit bounded test queue |
| `POST /api/device/{id}/heartbeat` | `x-device-token` | Device-report status |
| `GET /api/device/{id}/next` | `x-device-token` | Lease one authorized job |
| `POST /api/device/{id}/result/{job}` | `x-device-token` | Device-report result/evidence |

Device jobs use `ping`, `uart_capture` or `uart_tx`. `ping` is a **bridge check**, not proof the UART peer exists. `uart_tx` is double-gated. The SQLite audit table stores actions, and SHA-256 binds the job ID and result JSON. The digest is **integrity bookkeeping**, not cryptographic physical hardware attestation.

## Automated tests

```sh
python3 -m pytest -q
python3 -m compileall -q agency bridge
node --check tools/vm_runner.js
(cd web/vm && node --test core.test.js ui.smoke.test.js)
```

Review all proposed firmware/code before executing it. The initial forum is intentionally a controlled research/lab environment: it does not autonomously flash devices, transmit to arbitrary UART peripherals, discover unrelated networks, or self-propagate.

## Physical acceptance

Use [`docs/HARDWARE_ACCEPTANCE.md`](docs/HARDWARE_ACCEPTANCE.md) for exact-board preflight, pin-level validation, known-byte UART acceptance, broker-state negative tests, TX revocation, provenance and rollback. Physical evidence must be attached to the corresponding forum thread; a positive Python unit test is **not** physical acceptance.
