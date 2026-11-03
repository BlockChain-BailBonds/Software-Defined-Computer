#!/usr/bin/env python3
"""Linux USB-TTL / serial bridge. One explicitly selected port per enrolled device."""
import argparse
import base64
import os
import sys
import time
import httpx

try:
    import serial
except ImportError:
    print("pyserial is required: python -m pip install -r requirements.txt", file=sys.stderr)
    raise


def run_job(port, job, allow_tx):
    request = job["request"]
    operation = job["operation"]
    started = time.monotonic()
    rx = bytearray()
    maximum = min(request.get("max_bytes", 256), 1024)
    duration = min(request.get("duration_ms", 500), 2500) / 1000
    try:
        if operation == "ping":
            if not port.is_open:
                raise RuntimeError("Serial port is closed")
            # This proves the host adapter is open, not that the target responded.
            message = "Bridge serial port open; target not independently verified"
        elif operation in ("uart_capture", "uart_tx"):
            if operation == "uart_tx":
                if not allow_tx:
                    raise PermissionError("This bridge started without --allow-tx")
                value = request["tx_hex"]
                outgoing = bytes.fromhex(value)
                written = port.write(outgoing)
                port.flush()
                if written != len(outgoing):
                    raise IOError("Partial serial write")
            until = time.monotonic() + duration
            while time.monotonic() < until and len(rx) < maximum:
                chunk = port.read(min(64, maximum - len(rx)))
                rx.extend(chunk)
            message = "UART bytes collected; no protocol validity inferred"
        else:
            raise ValueError("Unknown job operation")
        return {"ok": True, "rx_b64": base64.b64encode(rx).decode(), "bytes_received": len(rx),
                "elapsed_ms": min(10000, int((time.monotonic() - started) * 1000)),
                "error": "", "bridge": message}
    except Exception as exc:
        return {"ok": False, "rx_b64": base64.b64encode(rx).decode(), "bytes_received": len(rx),
                "elapsed_ms": min(10000, int((time.monotonic() - started) * 1000)),
                "error": (type(exc).__name__ + ": " + str(exc))[:300], "bridge": "linux-usb-ttl"}


def main():
    parser = argparse.ArgumentParser(description="Registered USB-to-TTL bridge for the local AI Agency Lab")
    parser.add_argument("--server", default="http://127.0.0.1:8789")
    parser.add_argument("--device-id", required=True)
    parser.add_argument("--device-token", default=os.getenv("AGENCY_DEVICE_TOKEN"))
    parser.add_argument("--port", required=True, help="An explicitly authorized local serial port")
    parser.add_argument("--baud", type=int, choices=(9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600), default=115200)
    parser.add_argument("--allow-tx", action="store_true", help="Permit server-allowlisted diagnostic TX jobs")
    args = parser.parse_args()
    if not args.device_token:
        parser.error("--device-token or AGENCY_DEVICE_TOKEN is required")
    if args.server.startswith("https://") is False and not args.server.startswith("http://127.0.0.1:") and not args.server.startswith("http://localhost:"):
        parser.error("Remote HTTP server disallowed for Linux bridge; use HTTPS")
    headers = {"x-device-token": args.device_token}
    with serial.Serial(args.port, args.baud, timeout=0.08, write_timeout=1.0) as port:
        with httpx.Client(base_url=args.server, timeout=8, headers=headers, trust_env=False) as client:
            last_beat = 0.0
            while True:
                try:
                    if time.monotonic() - last_beat >= 8:
                        response = client.post(f"/api/device/{args.device_id}/heartbeat", json={
                            "capabilities": {"transport": "usb-ttl", "baud": args.baud, "port": args.port,
                                             "operations": ["ping", "uart_capture"] + (["uart_tx"] if args.allow_tx else [])}})
                        response.raise_for_status()
                        last_beat = time.monotonic()
                    response = client.get(f"/api/device/{args.device_id}/next")
                    response.raise_for_status()
                    job = response.json()["job"]
                    if job:
                        result = run_job(port, job, args.allow_tx)
                        delivered = client.post(f"/api/device/{args.device_id}/result/{job['id']}", json=result)
                        delivered.raise_for_status()
                        print(f"{job['id']} {job['operation']} {'PASS' if result['ok'] else 'FAIL'} bytes={result['bytes_received']}", flush=True)
                    else:
                        time.sleep(1)
                except (httpx.HTTPError, ValueError, KeyError) as exc:
                    print(f"Bridge communication issue: {exc}", file=sys.stderr, flush=True)
                    time.sleep(3)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("Serial bridge stopped")
