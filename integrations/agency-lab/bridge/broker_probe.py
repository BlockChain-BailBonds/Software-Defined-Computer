#!/usr/bin/env python3
"""Read-only M3rMa1d broker adapter: verifies broker-reported CYD/S3 presence."""
import argparse
import os
import time
import httpx


def main():
    p = argparse.ArgumentParser(description="Read-only adapter for the existing M3rMa1d Termux broker")
    p.add_argument("--agency", default="http://127.0.0.1:8789")
    p.add_argument("--broker", default="http://127.0.0.1:8787")
    p.add_argument("--broker-token", default=os.getenv("CODEXBRIDGE_TOKEN", ""))
    p.add_argument("--device-id", required=True)
    p.add_argument("--device-token", default=os.getenv("AGENCY_DEVICE_TOKEN", ""))
    p.add_argument("--component", choices=("cyd", "s3", "flipper"), required=True)
    args = p.parse_args()
    if not args.device_token or not args.broker_token:
        p.error("Set AGENCY_DEVICE_TOKEN and CODEXBRIDGE_TOKEN (or pass explicit flags)")
    if not args.broker.startswith("http://127.0.0.1:") and not args.broker.startswith("http://localhost:"):
        p.error("Broker read-only probe is local-only")
    if not args.agency.startswith("http://127.0.0.1:") and not args.agency.startswith("http://localhost:"):
        p.error("Agency adapter is local-only")
    auth = {"x-device-token": args.device_token}
    broker_auth = {"X-CodexBridge-Token": args.broker_token}
    with httpx.Client(timeout=5, trust_env=False) as client:
        while True:
            try:
                response = client.get(args.broker + "/v1/state", headers=broker_auth)
                response.raise_for_status()
                state = response.json()
                observed = state.get(args.component) is True
                beat = {"capabilities": {"transport": "m3rmaid-broker-readonly", "component": args.component,
                                          "broker_reports_present": observed, "operations": ["ping"],
                                          "physical_acceptance": "not independently verified"}}
                r = client.post(args.agency + f"/api/device/{args.device_id}/heartbeat", headers=auth, json=beat)
                r.raise_for_status()
                r = client.get(args.agency + f"/api/device/{args.device_id}/next", headers=auth)
                r.raise_for_status()
                job = r.json()["job"]
                if job:
                    if job["operation"] == "ping":
                        result = {"ok": observed, "rx_b64": "", "bytes_received": 0, "elapsed_ms": 0,
                                  "error": "" if observed else "Broker did not report component connected",
                                  "bridge": "broker-reported presence only; not physical signal verification"}
                    else:
                        result = {"ok": False, "rx_b64": "", "bytes_received": 0, "elapsed_ms": 0,
                                  "error": "Read-only broker adapter does not support UART jobs",
                                  "bridge": "m3rmaid-broker-readonly"}
                    r = client.post(args.agency + f"/api/device/{args.device_id}/result/{job['id']}", headers=auth, json=result)
                    r.raise_for_status()
                time.sleep(2)
            except (httpx.HTTPError, ValueError, KeyError) as exc:
                print("Read-only broker adapter issue:", exc, flush=True)
                time.sleep(4)


if __name__ == "__main__":
    try: main()
    except KeyboardInterrupt: print("Broker probe stopped")
