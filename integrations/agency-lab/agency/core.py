"""SQLite persistence and bounded hardware job state transitions."""
import hashlib
import hmac
import json
import re
import secrets
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path

ROLES = {
    "OS Architect": "Design Linux-inspired, resource-aware operating environments. ESP32-S3 cannot run full GNU/Linux: propose FreeRTOS/ESP-IDF components with clear RAM, storage, and CPU budgets. Larger Linux-capable boards may run Linux.",
    "Red Team": "In an explicitly authorized lab, propose bounded tests, threat hypotheses, reproducible attack-surface assessments, and safe proofs of concept. Do not seek unknown targets or advise covert use.",
    "Blue Team": "Challenge the design with mitigations, safety boundaries, authentication, isolation, and device recovery plans.",
    "Firmware Engineer": "Translate proposals into reproducible firmware, board-specific pin contracts, UART protocols, test fixtures, and non-destructive release gates. Never assume an ESP32 wiring pinout.",
    "Swarm Coordinator": "Plan Borg-like cooperative local agents: enrollment, capability negotiation, distributed tasks, resource budgeting, consensus on evidence, auditability, and safe revocation. Never self-propagate.",
    "Evidence Judge": "Distinguish speculation, simulated runs, device-reported hardware results, and independently verified tests. Issue a constrained verdict and next measurable experiment.",
}

SCHEMA = """
CREATE TABLE IF NOT EXISTS threads(
 id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, category TEXT NOT NULL,
 question TEXT NOT NULL, created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS posts(
 id INTEGER PRIMARY KEY AUTOINCREMENT, thread_id INTEGER NOT NULL REFERENCES threads(id),
 author TEXT NOT NULL, body TEXT NOT NULL, provenance TEXT NOT NULL, created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS devices(
 id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL,
 token_sha256 TEXT NOT NULL, tx_enabled INTEGER NOT NULL DEFAULT 0,
 tx_allowlist TEXT NOT NULL DEFAULT '[]', capabilities TEXT NOT NULL DEFAULT '{}',
 last_seen REAL, created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs(
 id TEXT PRIMARY KEY, device_id TEXT NOT NULL REFERENCES devices(id),
 thread_id INTEGER REFERENCES threads(id), batch_id TEXT, operation TEXT NOT NULL, request TEXT NOT NULL,
 status TEXT NOT NULL, result TEXT, evidence_sha256 TEXT,
 created_at REAL NOT NULL, leased_at REAL, finished_at REAL
);
CREATE TABLE IF NOT EXISTS debates(
 id TEXT PRIMARY KEY, thread_id INTEGER NOT NULL REFERENCES threads(id),
 status TEXT NOT NULL, detail TEXT, created_at REAL NOT NULL, finished_at REAL
);
CREATE TABLE IF NOT EXISTS vm_runs(
 id TEXT PRIMARY KEY, thread_id INTEGER REFERENCES threads(id), name TEXT NOT NULL,
 source TEXT NOT NULL, source_sha256 TEXT NOT NULL, result TEXT NOT NULL,
 result_sha256 TEXT NOT NULL, provenance TEXT NOT NULL, created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS vm_hardware_links(
 vm_run_id TEXT NOT NULL REFERENCES vm_runs(id),
 job_id TEXT NOT NULL REFERENCES jobs(id), created_at REAL NOT NULL,
 PRIMARY KEY(vm_run_id,job_id)
);
CREATE INDEX IF NOT EXISTS idx_vm_runs_thread ON vm_runs(thread_id,created_at);
CREATE TABLE IF NOT EXISTS audit(
 id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, subject TEXT NOT NULL,
 detail TEXT NOT NULL, created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_posts_thread ON posts(thread_id, id);
CREATE INDEX IF NOT EXISTS idx_jobs_device_status ON jobs(device_id, status, created_at);
"""

class Store:
    def __init__(self, path):
        self.path = str(path)
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.executescript(SCHEMA)
            columns = {row["name"] for row in db.execute("PRAGMA table_info(jobs)")}
            if "batch_id" not in columns:
                db.execute("ALTER TABLE jobs ADD COLUMN batch_id TEXT")
            # After a host restart, never reissue an in-flight diagnostic or a previously
            # authorized TX command without an operator explicitly resubmitting it.
            db.execute("UPDATE jobs SET status='expired',finished_at=? WHERE status='leased'", (time.time(),))
            db.execute("UPDATE jobs SET status='cancelled',finished_at=? WHERE status='queued' AND operation='uart_tx'", (time.time(),))
            # An interrupted worker is never represented as completed.
            db.execute("UPDATE debates SET status='interrupted' , detail='server restarted', finished_at=? WHERE status='running'", (time.time(),))

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("PRAGMA busy_timeout=10000")
        try:
            yield db
        finally:
            db.close()

    def audit(self, kind, subject, detail):
        with self.connect() as db:
            db.execute("INSERT INTO audit(kind,subject,detail,created_at) VALUES (?,?,?,?)",
                       (kind, str(subject)[:120], json.dumps(detail, sort_keys=True)[:8000], time.time()))

    def thread(self, title, category, question):
        with self.connect() as db:
            cur = db.execute("INSERT INTO threads(title,category,question,created_at) VALUES(?,?,?,?)",
                             (title, category, question, time.time()))
            tid = cur.lastrowid
            db.execute("INSERT INTO posts(thread_id,author,body,provenance,created_at) VALUES (?,?,?,?,?)",
                       (tid, "Forum Moderator", question, "user", time.time()))
        self.audit("thread_created", tid, {"category": category})
        return tid

    def post(self, tid, author, body, provenance="model"):
        with self.connect() as db:
            db.execute("INSERT INTO posts(thread_id,author,body,provenance,created_at) VALUES (?,?,?,?,?)",
                       (tid, author[:80], body[:40000], provenance, time.time()))

    def all_threads(self):
        with self.connect() as db:
            return [dict(r) for r in db.execute("SELECT * FROM threads ORDER BY id DESC LIMIT 100")]

    def get_thread(self, tid):
        with self.connect() as db:
            item = db.execute("SELECT * FROM threads WHERE id=?", (tid,)).fetchone()
            if item is None:
                return None
            out = dict(item)
            out["posts"] = [dict(r) for r in db.execute("SELECT * FROM posts WHERE thread_id=? ORDER BY id", (tid,))]
            out["jobs"] = [dict(r) for r in db.execute("SELECT * FROM jobs WHERE thread_id=? ORDER BY created_at DESC LIMIT 40", (tid,))]
            return out

    def save_vm_run(self, thread_id, name, source, result):
        """Persist deterministic VM replay as simulation evidence, never hardware evidence."""
        run_id = "vm-" + secrets.token_hex(12)
        source_hash = hashlib.sha256(source.encode("utf-8")).hexdigest()
        result_json = json.dumps(result, sort_keys=True, separators=(",", ":"))
        result_hash = hashlib.sha256((run_id + "\n" + source_hash + "\n" + result_json).encode()).hexdigest()
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            if thread_id is not None and db.execute("SELECT id FROM threads WHERE id=?", (thread_id,)).fetchone() is None:
                db.execute("ROLLBACK")
                raise LookupError("Unknown thread")
            db.execute("INSERT INTO vm_runs(id,thread_id,name,source,source_sha256,result,result_sha256,provenance,created_at) "
                       "VALUES(?,?,?,?,?,?,?,?,?)", (run_id, thread_id, name, source, source_hash,
                       result_json, result_hash, "server-replayed-vm-simulation", time.time()))
            if thread_id is not None:
                lines = result.get("stdout", [])
                summary = ("VM SIMULATION ONLY — no real device executed this code.\n"
                           + "Run: " + run_id + "\nProgram: " + name
                           + "\nOutcome: " + str(result.get("outcome"))
                           + "\nCycles: " + str(result.get("cycles"))
                           + "\nOutput: " + json.dumps(lines, ensure_ascii=False)[:1800]
                           + "\nSource SHA-256: " + source_hash
                           + "\nEvidence SHA-256: " + result_hash)
                db.execute("INSERT INTO posts(thread_id,author,body,provenance,created_at) VALUES(?,?,?,?,?)",
                           (thread_id, "Internal Computer", summary, "vm-server-simulated", time.time()))
            db.execute("COMMIT")
        self.audit("vm_run", run_id, {"thread": thread_id, "outcome": result.get("outcome"), "sha256": result_hash})
        return self.get_vm_run(run_id)

    def vm_runs(self, limit=30):
        with self.connect() as db:
            rows = db.execute("SELECT id,thread_id,name,source_sha256,result_sha256,provenance,created_at,result "
                              "FROM vm_runs ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
        items = []
        for r in rows:
            out = dict(r)
            out["result"] = json.loads(out["result"])
            items.append(out)
        return items

    def get_vm_run(self, run_id):
        with self.connect() as db:
            item = db.execute("SELECT * FROM vm_runs WHERE id=?", (run_id,)).fetchone()
        if item is None:
            return None
        out = dict(item)
        out["result"] = json.loads(out["result"])
        return out

    def link_vm_job(self, run_id, job_id):
        """Link to an ALREADY COMPLETED job; no commands are queued or transmitted."""
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            run = db.execute("SELECT * FROM vm_runs WHERE id=?", (run_id,)).fetchone()
            job = db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
            if run is None or job is None:
                db.execute("ROLLBACK")
                raise LookupError("Unknown VM run or hardware job")
            if run["thread_id"] != job["thread_id"]:
                db.execute("ROLLBACK")
                raise ValueError("VM run and hardware job must belong to the same thread")
            if job["status"] not in ("passed", "failed") or not job["evidence_sha256"]:
                db.execute("ROLLBACK")
                raise ValueError("Hardware job requires a completed device-reported result")
            if db.execute("SELECT job_id FROM vm_hardware_links WHERE vm_run_id=? AND job_id=?",
                          (run_id, job_id)).fetchone() is not None:
                db.execute("ROLLBACK")
                raise ValueError("Hardware result already linked")
            db.execute("INSERT INTO vm_hardware_links(vm_run_id,job_id,created_at) VALUES(?,?,?)",
                       (run_id, job_id, time.time()))
            if run["thread_id"] is not None:
                body = ("VM/HARDWARE EVIDENCE LINK — comparison only, not proof of physical correctness.\n"
                        "VM run: " + run_id + " (server-replayed simulation; sha256=" + run["result_sha256"] + ")\n"
                        "Hardware job: " + job_id + " (device-reported; sha256=" + job["evidence_sha256"] + ")\n"
                        "Hardware status: " + job["status"] + "; operation: " + job["operation"] + ".\n"
                        "These environments are distinct; a matching output does not verify physical pins or firmware.")
                db.execute("INSERT INTO posts(thread_id,author,body,provenance,created_at) VALUES(?,?,?,?,?)",
                           (run["thread_id"], "Evidence Comparator", body, "vm-to-device-evidence-link", time.time()))
            db.execute("COMMIT")
        self.audit("vm_hardware_link", run_id, {"job": job_id})
        return {"vm_run_id": run_id, "job_id": job_id, "vm_provenance": "server-replayed-vm-simulation",
                "device_provenance": "device-reported", "hardware_job_status": job["status"],
                "vm_sha256": run["result_sha256"], "device_sha256": job["evidence_sha256"],
                "physical_validation": False}

    def register(self, name, kind, capabilities):
        ident = "node-" + secrets.token_hex(8)
        token = secrets.token_urlsafe(32)
        with self.connect() as db:
            db.execute("INSERT INTO devices(id,name,kind,token_sha256,capabilities,created_at) VALUES(?,?,?,?,?,?)",
                       (ident, name, kind, hashlib.sha256(token.encode()).hexdigest(),
                        json.dumps(capabilities), time.time()))
        self.audit("device_enrolled", ident, {"name": name, "kind": kind})
        return {"device_id": ident, "device_token": token}

    def valid_device_token(self, did, token):
        with self.connect() as db:
            row = db.execute("SELECT token_sha256 FROM devices WHERE id=?", (did,)).fetchone()
        return row is not None and hmac.compare_digest(row["token_sha256"], hashlib.sha256(token.encode()).hexdigest())

    def device_seen(self, did, capabilities=None):
        with self.connect() as db:
            if capabilities is None:
                db.execute("UPDATE devices SET last_seen=? WHERE id=?", (time.time(), did))
            else:
                db.execute("UPDATE devices SET last_seen=?,capabilities=? WHERE id=?",
                           (time.time(), json.dumps(capabilities), did))

    def devices(self):
        with self.connect() as db:
            rows = [dict(r) for r in db.execute("SELECT id,name,kind,tx_enabled,tx_allowlist,capabilities,last_seen,created_at FROM devices ORDER BY created_at DESC")]
        for item in rows:
            item["online"] = item["last_seen"] is not None and time.time() - item["last_seen"] < 20
            item["tx_allowlist"] = json.loads(item["tx_allowlist"])
            item["capabilities"] = json.loads(item["capabilities"])
        return rows

    def policy(self, did, enabled, approved):
        approved = [validate_hex(value) for value in approved]
        with self.connect() as db:
            cur = db.execute("UPDATE devices SET tx_enabled=?,tx_allowlist=? WHERE id=?",
                             (int(enabled), json.dumps(approved), did))
            if cur.rowcount == 0:
                return False
            # Never lease a queued command after its authorization was revoked.
            db.execute("UPDATE jobs SET status='cancelled',finished_at=? "
                       "WHERE device_id=? AND operation='uart_tx' AND status='queued' "
                       "AND ( ?=0 OR json_extract(request,'$.tx_hex') NOT IN "
                       "(SELECT value FROM json_each(?)) )",
                       (time.time(), did, int(enabled), json.dumps(approved)))
        self.audit("tx_policy_updated", did, {"enabled": enabled, "hex_commands": approved})
        return True

    def create_job(self, did, tid, operation, duration_ms, max_bytes, tx_hex=None):
        with self.connect() as db:
            device = db.execute("SELECT * FROM devices WHERE id=?", (did,)).fetchone()
            if device is None:
                raise LookupError("Unknown device")
            if tid is not None and db.execute("SELECT id FROM threads WHERE id=?", (tid,)).fetchone() is None:
                raise LookupError("Unknown thread")
            if operation == "uart_tx":
                if not device["tx_enabled"] or tx_hex not in json.loads(device["tx_allowlist"]):
                    raise PermissionError("TX denied: explicitly enable TX and allowlist this exact diagnostic frame")
            req = {"duration_ms": duration_ms, "max_bytes": max_bytes}
            if tx_hex is not None:
                req["tx_hex"] = tx_hex
            jid = "test-" + secrets.token_hex(10)
            db.execute("INSERT INTO jobs(id,device_id,thread_id,operation,request,status,created_at) VALUES(?,?,?,?,?,?,?)",
                       (jid, did, tid, operation, json.dumps(req), "queued", time.time()))
        self.audit("test_queued", jid, {"device": did, "operation": operation, "thread": tid})
        return jid

    def swarm_diagnostics(self, ids, tid, operation, duration_ms, max_bytes):
        """Atomic, human-initiated receive-only or link-check work across devices."""
        if operation not in ("ping", "uart_capture"):
            raise PermissionError("Swarm diagnostics never transmit")
        if not 1 <= len(ids) <= 25 or len(set(ids)) != len(ids):
            raise ValueError("Provide 1–25 distinct devices")
        batch = "swarm-" + secrets.token_hex(8)
        created = []
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            if tid is not None and db.execute("SELECT id FROM threads WHERE id=?", (tid,)).fetchone() is None:
                db.execute("ROLLBACK")
                raise LookupError("Unknown thread")
            known = {r["id"] for r in db.execute("SELECT id FROM devices WHERE id IN (" + ",".join("?" for _ in ids) + ")", ids)}
            if known != set(ids):
                db.execute("ROLLBACK")
                raise LookupError("Unknown device in swarm")
            for did in ids:
                job_id = "test-" + secrets.token_hex(10)
                request = json.dumps({"duration_ms": duration_ms, "max_bytes": max_bytes})
                db.execute("INSERT INTO jobs(id,device_id,thread_id,batch_id,operation,request,status,created_at) "
                           "VALUES(?,?,?,?,?,?,?,?)",
                           (job_id, did, tid, batch, operation, request, "queued", time.time()))
                created.append(job_id)
            db.execute("COMMIT")
        self.audit("swarm_diagnostics_queued", batch, {"devices": ids, "operation": operation, "jobs": created})
        return {"batch_id": batch, "job_ids": created, "operation": operation}

    def lease(self, did):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            # Recover a lost worker with a bounded timeout rather than running commands twice.
            # Expired work is marked failed; operator must explicitly resubmit.
            stale = time.time() - 30
            db.execute("UPDATE jobs SET status='expired',finished_at=? WHERE device_id=? AND status='leased' AND leased_at<?",
                       (time.time(), did, stale))
            db.execute("UPDATE jobs SET status='cancelled',finished_at=? WHERE device_id=? "
                       "AND operation='uart_tx' AND status='queued' AND ("
                       "(SELECT tx_enabled FROM devices WHERE id=?)=0 OR "
                       "json_extract(jobs.request,'$.tx_hex') NOT IN "
                       "(SELECT value FROM json_each((SELECT tx_allowlist FROM devices WHERE id=?))))",
                       (time.time(), did, did, did))
            row = db.execute("SELECT * FROM jobs WHERE device_id=? AND status='queued' ORDER BY created_at LIMIT 1", (did,)).fetchone()
            if row is None:
                db.execute("COMMIT")
                return None
            db.execute("UPDATE jobs SET status='leased',leased_at=? WHERE id=? AND status='queued'", (time.time(), row["id"]))
            db.execute("COMMIT")
            out = dict(row)
            out["request"] = json.loads(out["request"])
            return out

    def finish(self, did, jid, result):
        result_payload = json.dumps(result, sort_keys=True, separators=(",", ":"))
        digest = hashlib.sha256((jid + "\n" + result_payload).encode()).hexdigest()
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM jobs WHERE id=? AND device_id=? AND status='leased'", (jid, did)).fetchone()
            if row is None:
                db.execute("ROLLBACK")
                return False
            status = "passed" if result.get("ok") is True else "failed"
            db.execute("UPDATE jobs SET status=?, result=?, evidence_sha256=?, finished_at=? WHERE id=?",
                       (status, result_payload, digest, time.time(), jid))
            db.execute("COMMIT")
        self.audit("device_reported_result", jid, {"status": status, "sha256": digest})
        if row["thread_id"] is not None:
            self.post(row["thread_id"], "Lab Evidence", f"Device-reported {row['operation']} on {did}: {status}. SHA-256 {digest}. Result: {result_payload[:3000]}", "device-reported")
        return True

    def jobs(self):
        with self.connect() as db:
            return [dict(r) for r in db.execute("SELECT * FROM jobs ORDER BY created_at DESC LIMIT 100")]

    def debate_start(self, tid):
        ident = "debate-" + secrets.token_hex(8)
        with self.connect() as db:
            db.execute("INSERT INTO debates(id,thread_id,status,created_at) VALUES(?,?,?,?)",
                       (ident, tid, "running", time.time()))
        return ident

    def debate_end(self, did, success, detail):
        with self.connect() as db:
            db.execute("UPDATE debates SET status=?,detail=?,finished_at=? WHERE id=?",
                       ("done" if success else "failed", str(detail)[:1500], time.time(), did))

    def debates(self):
        with self.connect() as db:
            return [dict(r) for r in db.execute("SELECT * FROM debates ORDER BY created_at DESC LIMIT 100")]


def validate_hex(value):
    if not isinstance(value, str) or len(value) < 2 or len(value) > 512 or len(value) % 2 or re.fullmatch(r"[0-9a-fA-F]+", value) is None:
        raise ValueError("TX must be 1–256 bytes as even-length hexadecimal without separators")
    return value.upper()
