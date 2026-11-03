"""HTTP authentication, UART policy, device-reported evidence and forum flow."""
import os
import base64
from fastapi.testclient import TestClient
from agency.core import Store

os.environ["AGENCY_ADMIN_KEY"] = "unit-test-very-long-admin-key-123456"
from agency import api

ADMIN = {"x-agency-key": os.environ["AGENCY_ADMIN_KEY"]}


def test_full_api_workflow(tmp_path, monkeypatch):
    monkeypatch.setattr(api, "STORE", Store(tmp_path / "db.sqlite"))
    with TestClient(api.app) as client:
        assert client.get("/health").status_code == 200
        assert client.get("/api/overview").status_code == 401
        assert client.post("/api/devices/enroll", json={"name": "Unauthorized", "kind": "cyd"}).status_code == 401
        thread = client.post("/api/threads", headers=ADMIN, json={"title": "A UART test", "category": "hardware-test", "question": "Capture diagnostic bytes from the attached UART without sending bytes."})
        assert thread.status_code == 200
        tid = thread.json()["id"]
        enrolled = client.post("/api/devices/enroll", headers=ADMIN, json={"name": "3-wire peripheral", "kind": "uart-peripheral"})
        assert enrolled.status_code == 200
        did, token = enrolled.json()["device_id"], enrolled.json()["device_token"]
        devhead = {"x-device-token": token}
        assert client.get(f"/api/device/{did}/next").status_code == 401
        assert client.post(f"/api/device/{did}/heartbeat", headers=devhead, json={"capabilities": {"transport": "test"}}).status_code == 200
        assert client.post("/api/tests", headers=ADMIN, json={"device_id": did, "thread_id": tid, "operation": "uart_tx", "tx_hex": "50494E470A", "confirm_write": True}).status_code == 403
        assert client.post("/api/tests", headers=ADMIN, json={"device_id": did, "thread_id": tid, "operation": "uart_tx", "tx_hex": "50494E470A"}).status_code == 400
        captured = client.post("/api/tests", headers=ADMIN, json={"device_id": did, "thread_id": tid, "operation": "uart_capture", "duration_ms": 100, "max_bytes": 128})
        assert captured.status_code == 200
        jid = captured.json()["job_id"]
        lease = client.get(f"/api/device/{did}/next", headers=devhead)
        assert lease.status_code == 200
        assert lease.json()["job"]["id"] == jid
        assert client.get(f"/api/device/{did}/next", headers=devhead).json()["job"] is None
        bad = client.post(f"/api/device/{did}/result/{jid}", headers=devhead,
                          json={"ok": True, "rx_b64": "!!!!", "bytes_received": 4})
        assert bad.status_code == 400
        sample = base64.b64encode(b"HELLO").decode()
        received = client.post(f"/api/device/{did}/result/{jid}", headers=devhead,
                               json={"ok": True, "rx_b64": sample, "bytes_received": 5, "elapsed_ms": 123})
        assert received.status_code == 200
        assert client.post(f"/api/device/{did}/result/{jid}", headers=devhead,
                           json={"ok": True, "rx_b64": sample, "bytes_received": 5}).status_code == 409
        posts = client.get(f"/api/threads/{tid}", headers=ADMIN).json()["posts"]
        assert posts[-1]["provenance"] == "device-reported"
        assert client.get("/api/overview", headers=ADMIN).json()["jobs"][0]["status"] == "passed"
        policy = client.put(f"/api/devices/{did}/policy", headers=ADMIN,
                            json={"tx_enabled": True, "allowlist_hex": ["50494E470A"]})
        assert policy.status_code == 200
        assert client.post("/api/tests", headers=ADMIN, json={"device_id": did, "operation": "uart_tx", "tx_hex": "50494E470A", "confirm_write": True}).status_code == 200
        assert client.post("/api/tests", headers=ADMIN, json={"device_id": did, "operation": "uart_tx", "tx_hex": "44454C4554450A", "confirm_write": True}).status_code == 403


def test_model_role_and_thread_validation(tmp_path, monkeypatch):
    monkeypatch.setattr(api, "STORE", Store(tmp_path / "db.sqlite"))
    with TestClient(api.app) as client:
        assert client.post("/api/threads", headers=ADMIN, json={"title": "abc", "category": "wrong", "question": "short"}).status_code == 422
        assert client.put("/api/models/Red%20Team", headers=ADMIN,
                          json={"url": "http://127.0.0.1:8081/v1", "model": "local"}).status_code == 200
        assert client.put("/api/models/Unregistered", headers=ADMIN,
                          json={"url": "http://127.0.0.1:8081/v1", "model": "local"}).status_code == 404


def test_swarm_http_readonly(tmp_path, monkeypatch):
    monkeypatch.setattr(api, "STORE", Store(tmp_path / "db.sqlite"))
    with TestClient(api.app) as client:
        a = client.post("/api/devices/enroll", headers=ADMIN, json={"name": "A node", "kind": "cyd"}).json()["device_id"]
        b = client.post("/api/devices/enroll", headers=ADMIN, json={"name": "B node", "kind": "esp32-s3"}).json()["device_id"]
        ok = client.post("/api/swarms/diagnostics", headers=ADMIN, json={"device_ids": [a,b], "operation": "ping"})
        assert ok.status_code == 200
        assert len(ok.json()["job_ids"]) == 2
        assert client.post("/api/swarms/diagnostics", headers=ADMIN, json={"device_ids": [a,b], "operation": "uart_tx"}).status_code == 422
        assert len(api.STORE.jobs()) == 2


def test_catalog_and_six_roles(tmp_path, monkeypatch):
    monkeypatch.setattr(api, "STORE", Store(tmp_path / "db.sqlite"))
    with TestClient(api.app) as client:
        catalog = client.get("/api/catalog", headers=ADMIN).json()
        assert any("OpenWrt" in item["family"] for item in catalog["linux_inspirations"])
        assert any("UART" in item["name"] for item in catalog["safe_lab_tools"])
        created = client.post("/api/threads", headers=ADMIN, json={
            "title": "Review full board design", "category": "os-design", "question": "Propose a resource-bounded OS design for the authorized test board."}).json()["id"]
        async def stub_model(url, model, role, context):
            assert "Review full board design" in context
            return f"{role}: specific testable recommendation; independent physical acceptance pending"
        monkeypatch.setattr(api, "complete", stub_model)
        did = api.STORE.debate_start(created)
        api.RUNNING.add(created)
        import asyncio
        asyncio.run(api.run_debate(created, did))
        posts = api.STORE.get_thread(created)["posts"]
        assert len([p for p in posts if p["provenance"] == "model-draft"]) == 6
        assert api.STORE.debates()[0]["status"] == "done"
