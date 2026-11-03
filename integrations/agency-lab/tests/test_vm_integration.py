"""End-to-end VM replay / GGUF debate / hardware provenance integration."""
import base64
import json
import os
import shutil

import pytest
from fastapi.testclient import TestClient
from agency.core import Store

os.environ["AGENCY_ADMIN_KEY"] = "unit-test-very-long-admin-key-123456"
from agency import api

ADMIN = {"x-agency-key": os.environ["AGENCY_ADMIN_KEY"]}


@pytest.fixture
def lab(tmp_path, monkeypatch):
    monkeypatch.setattr(api, "STORE", Store(tmp_path / "forum.sqlite"))
    with TestClient(api.app) as client:
        yield client


def thread(lab):
    r = lab.post("/api/threads", headers=ADMIN, json={
        "title": "Internal VM embedded test", "category": "hardware-test",
        "question": "Compare synthetic VM protocol behavior with later approved device evidence."})
    assert r.status_code == 200
    return r.json()["id"]


def test_vm_workstation_and_curation(lab):
    assert lab.get("/vm/").status_code == 200
    assert "INTERNAL COMPUTER" in lab.get("/vm/").text
    assert "class VirtualCPU" in lab.get("/vm/core.js").text
    assert lab.get("/api/vm/examples").status_code == 401
    r = lab.get("/api/vm/examples", headers=ADMIN)
    assert r.status_code == 200
    assert r.json()["hardware_access"] is False
    assert len(r.json()["examples"]) >= 5
    assert "vm_replay_available" in lab.get("/health").json()


@pytest.mark.skipif(shutil.which("node") is None, reason="requires Node.js 18+")
def test_actual_sandbox_execution_and_forum_context(lab):
    tid = thread(lab)
    source = 'PRINT "SENSOR SIM"\nMOV R0, 42\nPRINT R0\nHALT'
    request = {"name": "Synthetic sensor", "source": source, "thread_id": tid, "max_steps": 1000}
    assert lab.post("/api/vm/runs", json=request).status_code == 401
    r = lab.post("/api/vm/runs", headers=ADMIN, json=request)
    assert r.status_code == 200, r.text
    item = r.json()
    assert item["result"]["stdout"] == ["SENSOR SIM", "42"]
    assert item["result"]["ok"] is True
    assert item["result"]["hardware_access"] is False
    assert item["provenance"] == "server-replayed-vm-simulation"
    assert len(item["result_sha256"]) == 64
    assert len(item["source_sha256"]) == 64
    assert lab.get("/api/vm/runs/"+item["id"], headers=ADMIN).json()["source"] == source
    assert lab.get("/api/vm/runs", headers=ADMIN).json()["runs"][0]["id"] == item["id"]
    posts = lab.get(f"/api/threads/{tid}", headers=ADMIN).json()["posts"]
    assert posts[-1]["provenance"] == "vm-server-simulated"
    assert "SIMULATION ONLY" in posts[-1]["body"]
    assert not api.STORE.jobs()


@pytest.mark.skipif(shutil.which("node") is None, reason="requires Node.js 18+")
def test_vm_compile_errors_faults_and_instruction_budget(lab):
    bad_cases = [
        ('JS NOT EXECUTABLE', 'compile-error', False),
        ('MOV R0, 1\nDIV R0, 0\nHALT', 'fault', False),
        ('again:\nJMP again', 'step-budget-exhausted', False),
        ('PRINT "ok"\nHALT', 'halted', True),
    ]
    for src, outcome, passed in bad_cases:
        r = lab.post('/api/vm/runs', headers=ADMIN,
                     json={"name": "Bounded simulation", "source": src, "max_steps": 50})
        assert r.status_code == 200, r.text
        result = r.json()["result"]
        assert result["outcome"] == outcome
        assert result["ok"] is passed
        assert result["hardware_access"] is False
        assert result["cycles"] <= 50
    assert lab.post('/api/vm/runs', headers=ADMIN, json={"name": "Too short", "source": "NOP", "max_steps": 100001}).status_code == 422
    assert lab.post('/api/vm/runs', headers=ADMIN, json={"name": "Too short", "source": "NOP", "thread_id": 9000}).status_code == 404
    assert lab.get('/api/vm/runs/nonexistent', headers=ADMIN).status_code == 404


@pytest.mark.skipif(shutil.which("node") is None, reason="requires Node.js 18+")
def test_vm_evidence_links_only_completed_scoped_hardware(lab):
    tid = thread(lab)
    alt = thread(lab)
    vm = lab.post('/api/vm/runs', headers=ADMIN, json={
        'name': 'Protocol simulation', 'source': 'PRINT "status"\nHALT', 'thread_id': tid}).json()
    enr = lab.post('/api/devices/enroll', headers=ADMIN,
                   json={'name': 'Bench UART adapter', 'kind': 'uart-peripheral'}).json()
    device_id, token = enr['device_id'], enr['device_token']
    other = lab.post('/api/tests', headers=ADMIN, json={
        'device_id': device_id, 'thread_id': alt, 'operation': 'uart_capture'}).json()['job_id']
    pending = lab.post('/api/tests', headers=ADMIN, json={
        'device_id': device_id, 'thread_id': tid, 'operation': 'uart_capture'}).json()['job_id']
    link_url = f"/api/vm/runs/{vm['id']}/link-hardware"
    assert lab.post(link_url, headers=ADMIN, json={'job_id': other}).status_code == 409
    assert lab.post(link_url, headers=ADMIN, json={'job_id': pending}).status_code == 409
    assert lab.post(link_url, headers=ADMIN, json={'job_id': 'test-' + 'a'*20}).status_code == 404
    device_header = {'x-device-token': token}
    assert lab.get(f'/api/device/{device_id}/next', headers=device_header).json()['job']['id'] == other
    assert lab.post(f'/api/device/{device_id}/result/{other}', headers=device_header,
                    json={'ok': True, 'rx_b64': '', 'bytes_received': 0, 'elapsed_ms': 100}).status_code == 200
    assert lab.post(link_url, headers=ADMIN, json={'job_id': other}).status_code == 409
    assert lab.get(f'/api/device/{device_id}/next', headers=device_header).json()['job']['id'] == pending
    received = base64.b64encode(b'STATUS').decode()
    assert lab.post(f'/api/device/{device_id}/result/{pending}', headers=device_header,
                    json={'ok': True, 'rx_b64': received, 'bytes_received': 6, 'elapsed_ms': 200}).status_code == 200
    response = lab.post(link_url, headers=ADMIN, json={'job_id': pending})
    assert response.status_code == 200, response.text
    linked = response.json()
    assert linked['physical_validation'] is False
    assert linked['vm_provenance'] == 'server-replayed-vm-simulation'
    assert linked['device_provenance'] == 'device-reported'
    assert lab.post(link_url, headers=ADMIN, json={'job_id': pending}).status_code == 409
    posts = lab.get(f'/api/threads/{tid}', headers=ADMIN).json()['posts']
    assert posts[-1]['provenance'] == 'vm-to-device-evidence-link'
    assert not [j for j in api.STORE.jobs() if j['operation'] == 'uart_tx']


def test_gguf_proposal_is_draft_and_never_executes(lab, monkeypatch):
    tid = thread(lab)
    called = []
    async def fake_complete(url, model, role, context):
        called.append((url, role, context))
        return 'PRINT "draft only"\nHALT'
    monkeypatch.setattr(api, 'complete', fake_complete)
    r = lab.post('/api/vm/proposals', headers=ADMIN,
                 json={'thread_id': tid, 'role': 'Firmware Engineer'})
    assert r.status_code == 200
    assert r.json()['executed'] is False
    assert 'No network, GPIO, UART' in called[0][2]
    assert lab.get(f'/api/threads/{tid}', headers=ADMIN).json()['posts'][-1]['provenance'] == 'model-vm-proposal-unverified'
    assert not api.STORE.vm_runs()
    assert not api.STORE.jobs()
    assert lab.post('/api/vm/proposals', headers=ADMIN,
                    json={'thread_id': tid, 'role': 'Unknown'}).status_code == 422


def test_node_missing_returns_unavailable_without_record(lab, monkeypatch):
    from agency import vm_lab
    monkeypatch.setattr(vm_lab.shutil, 'which', lambda name: None)
    response = lab.post('/api/vm/runs', headers=ADMIN, json={
        'name': 'Offline', 'source': 'HALT', 'max_steps': 100})
    assert response.status_code == 503
    assert not api.STORE.vm_runs()
    assert lab.get('/api/vm/examples', headers=ADMIN).json()['server_replay_available'] is False
    assert lab.get('/vm/').status_code == 200


def test_source_ui_import_contract_and_model_api_exposure(lab):
    main = lab.get('/').text
    assert 'id="vmSavedPrograms"' in main
    assert 'id="vmRun"' in main
    assert '/api/vm/proposals' in main
    assert '/api/vm/runs/' in main
    assert 'internal-computer-v1-filesystem' in main
    catalog = lab.get('/api/catalog', headers=ADMIN).json()
    assert any('Internal Computer' in tool['name'] for tool in catalog['safe_lab_tools'])


@pytest.mark.skipif(shutil.which("node") is None, reason="requires Node.js 18+")
def test_vm_runs_persist_across_store_reopen(lab):
    r = lab.post('/api/vm/runs', headers=ADMIN,
                 json={'name': 'Persistence', 'source': 'PRINT 918\nHALT'}).json()
    reopened = Store(api.STORE.path)
    saved = reopened.get_vm_run(r['id'])
    assert saved['result']['stdout'] == ['918']
    assert saved['source_sha256'] == r['source_sha256']
    assert saved['result_sha256'] == r['result_sha256']
    assert not reopened.jobs()
