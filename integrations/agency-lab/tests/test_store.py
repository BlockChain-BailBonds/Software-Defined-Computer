"""Persistence, least-privilege TX, lease, evidence and credential regression tests."""
import base64
import hashlib
import json
import time
import pytest
from agency.core import Store, ROLES, validate_hex


def test_uart_tx_policy_is_default_deny(tmp_path):
    s = Store(tmp_path / "test.sqlite")
    peer = s.register("Authorized sensor", "uart-peripheral", {"transport": "ttl-uart"})
    did, token = peer["device_id"], peer["device_token"]
    assert s.valid_device_token(did, token)
    assert not s.valid_device_token(did, "a different token")
    assert not s.valid_device_token("unknown", token)
    with pytest.raises(PermissionError):
        s.create_job(did, None, "uart_tx", 250, 16, "50494E470A")
    assert s.policy(did, True, ["50494e470a"])
    with pytest.raises(PermissionError):
        s.create_job(did, None, "uart_tx", 250, 16, "44454C4554450A")
    jid = s.create_job(did, None, "uart_tx", 250, 16, "50494E470A")
    job = s.lease(did)
    assert job["id"] == jid and job["request"]["tx_hex"] == "50494E470A"
    assert s.lease(did) is None
    outcome = {"ok": True, "rx_b64": base64.b64encode(b"PONG").decode(), "bytes_received": 4,
               "elapsed_ms": 200, "bridge": "test", "error": ""}
    assert s.finish(did, jid, outcome)
    assert not s.finish(did, jid, outcome)
    row = next(j for j in s.jobs() if j["id"] == jid)
    assert row["status"] == "passed"
    canonical = json.dumps(outcome, sort_keys=True, separators=(",", ":"))
    assert row["evidence_sha256"] == hashlib.sha256((jid + "\n" + canonical).encode()).hexdigest()
    assert not s.policy("nonexistent", False, [])


def test_uart_capture_and_expired_lease_do_not_reexecute(tmp_path):
    s = Store(tmp_path / "db.sqlite")
    did = s.register("RX-only", "esp32-s3", {})["device_id"]
    jid = s.create_job(did, None, "uart_capture", 1500, 256)
    assert s.lease(did)["operation"] == "uart_capture"
    with s.connect() as db:
        db.execute("UPDATE jobs SET leased_at=? WHERE id=?", (time.time() - 40, jid))
    assert s.lease(did) is None
    row = next(j for j in s.jobs() if j["id"] == jid)
    assert row["status"] == "expired"
    assert not s.finish(did, jid, {"ok": True})


def test_thread_evidence_provenance(tmp_path):
    s = Store(tmp_path / "db.sqlite")
    tid = s.thread("UART diagnostic acceptance", "hardware-test", "Record the byte count accurately")
    device = s.register("UART bench", "uart-peripheral", {})
    jid = s.create_job(device["device_id"], tid, "uart_capture", 500, 128)
    s.lease(device["device_id"])
    assert s.finish(device["device_id"], jid, {"ok": True, "bytes_received": 0, "rx_b64": ""})
    posts = s.get_thread(tid)["posts"]
    assert posts[-1]["provenance"] == "device-reported"
    assert "device-reported" in posts[-1]["body"].lower()
    assert len(ROLES) == 6


@pytest.mark.parametrize("invalid", ["", "A", "QQ", "aa ", "a", "112233z4", "f" * 514])
def test_invalid_hex(invalid):
    with pytest.raises(ValueError):
        validate_hex(invalid)


def test_swarm_atomic_and_revocation(tmp_path):
    s = Store(tmp_path / "swarm.sqlite")
    a = s.register("A", "cyd", {})["device_id"]
    b = s.register("B", "esp32-s3", {})["device_id"]
    with pytest.raises(LookupError):
        s.swarm_diagnostics([a, "invalid"], None, "ping", 100, 20)
    assert s.jobs() == []
    with pytest.raises(PermissionError):
        s.swarm_diagnostics([a, b], None, "uart_tx", 100, 20)
    result = s.swarm_diagnostics([a, b], None, "uart_capture", 100, 20)
    assert len(result["job_ids"]) == 2
    assert s.lease(a)["batch_id"] == result["batch_id"]
    assert s.lease(b)["batch_id"] == result["batch_id"]
    s.policy(a, True, ["50494E470A"])
    tx_id = s.create_job(a, None, "uart_tx", 100, 20, "50494E470A")
    s.policy(a, False, [])
    assert next(j for j in s.jobs() if j["id"] == tx_id)["status"] == "cancelled"
    assert s.lease(a) is None
