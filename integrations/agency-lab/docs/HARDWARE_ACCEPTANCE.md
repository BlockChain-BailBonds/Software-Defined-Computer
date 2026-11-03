# Hardware acceptance and integration record

This is the validation procedure for the **physical** ESP32-S3 N16R8, CYD, USB-TTL adapters, and attached TTL UART peripherals. Python CI evidence is not a substitute for any step below.

## 0 — Freeze and identify

1. Save a versioned, verified backup of each device's existing firmware and NVS configuration using its established workflow. Do not flash this optional bridge to a board whose display/camera firmware must remain intact.
2. Record the exact ESP32/board revision, PSRAM/flash size, UART logic level, camera or LCD/touch allocations, firmware commit, build environment and device-specific wiring diagram.
3. Check a physical common ground and the external peripheral's voltage specification **before connecting signal wires**. Use a UART level shifter or the appropriate RS-232/RS-485 transceiver where required.
4. Disconnect TX for all receive-only phases. Verify the chosen UART RX pin is unused and does not overlap boot, flash, PSRAM, USB, camera, LCD, touch or reset functions.

## 1 — Forum service

- `GET /health` returns `ok: true` locally.
- A request to `GET /api/overview` with no `x-agency-key` returns 401.
- A configured GGUF server responds to `GET /health` and a small `POST /v1/chat/completions` request.
- A forum thread can run six model roles without claiming a hardware test happened.
- A model-generated request cannot invoke device jobs without the operator/admin path.

## 2 — Existing M3rMa1d CYD and S3 (no firmware change)

- Verify `GET /v1/state` from the actual **locally running** Termux broker, with its configured header.
- Start `bridge/broker_probe.py` for each component, with distinct device credentials.
- Turn that component off and on; verify the next heartbeat updates broker-reported presence, not hardware test status.
- Queue `ping` and verify the forum records the broker's online/offline result as **broker-reported** evidence.
- Queue `uart_capture` intentionally to confirm it fails with "unsupported" for the read-only adapter; it must not fabricate UART bytes or invoke unrelated broker actions.

## 3 — 3-wire UART bridge

- Configure a USB-TTL interface or the optional ESP32 bridge for **RX only** and the verified baud rate.
- Connect target TX → bridge RX and common GND. Leave target RX unconnected for capture-only acceptance.
- Enroll the bridge with unique credentials. A bad device token must not lease jobs.
- Confirm a `ping` means the bridge is open/initialized; it is **not** proof that the external peer exists.
- Inject a known benign, controlled diagnostic output from a lab signal source into RX. Queue a capture and compare bytes, length and timing to the injected reference.
- Remove/disconnect the source and verify a zero-byte capture does not become a false claim of target reachability.
- Verify excessive frame lengths and invalid result base64 are rejected; verify a completed job cannot be submitted twice.

## 4 — Diagnostic TX only after explicit authorization

- Confirm the target device's actual protocol specification and prove the proposed frame is harmless on that **specific** target.
- Verify the forum's TX policy is initially disabled, and an unallowlisted frame is denied.
- If and only if needed, attach bridge TX → target RX using correct logic level and verified pins.
- Enable the exact diagnostic frame in the forum. Also enable TX in the local bridge (`--allow-tx` for Linux, `SET TX_ENABLE YES` for ESP32).
- Queue one approved diagnostic frame, verify capture against a reference, then disable TX again.
- Verify a queued frame becomes `cancelled` when its policy is revoked before leasing. **Already leased jobs are not revocable**, so keep the physical lab under operator control.

## 5 — Multi-node acceptance

- Enroll one independent endpoint for each serial channel. Use distinct IDs and device tokens.
- Run a coordinated swarm of `ping` operations across a CYD broker reporter and a separate UART bridge.
- Run `uart_capture` across two physically instrumented channels, and verify neither report is duplicated or attributed to the wrong device.
- Confirm timeouts become expired/failed and are **not automatically retried**, especially for TX.
- Confirm model posts label hardware outcomes as **device-reported** and do not assert independent physical validation.

## 6 — Release conditions

All of the following must be evidenced before labeling firmware/hardware integration `accepted`:

- Exact-source PlatformIO build with a recorded toolchain version, artifact hash and console log.
- Verified existing-firmware preservation or intentional, approved replacement.
- Pin-by-pin continuity and logic-level acceptance.
- Online/offline transition evidence for each registered bridge.
- Known-byte RX capture and safe, explicitly authorized TX (if the application requires TX).
- Negative permission tests, stale lease handling and recoverable network loss.
- Safe rollback and a written human sign-off.

**Present state:** The portable Python server and its unit/API suite are validated in this package. A cross-compiled firmware image, real UART pins, camera/LCD/touch coexistence and board behavior are **not** validated by these tests. The optional standalone firmware is not an overlay for an existing M3rMa1d or CYD app.
