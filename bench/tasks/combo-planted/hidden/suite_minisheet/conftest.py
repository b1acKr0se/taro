"""Shared fixtures for the minisheet hidden acceptance suite."""
import json
import queue
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

import pytest


def _free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def _pump(stream, q):
    try:
        for line in iter(stream.readline, ""):
            q.put(line)
    except Exception:
        pass
    q.put(None)


@pytest.fixture
def server():
    """Fresh server (fresh workbook) per test; yields the base URL."""
    port = _free_port()
    proc = subprocess.Popen(
        [sys.executable, "-m", "minisheet", "serve", "--port", str(port)],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
    )
    q = queue.Queue()
    threading.Thread(target=_pump, args=(proc.stdout, q), daemon=True).start()
    url = None
    deadline = time.time() + 10
    try:
        while time.time() < deadline:
            try:
                line = q.get(timeout=0.2)
            except queue.Empty:
                continue
            if line is None:
                break
            if line.startswith("Serving on "):
                url = line[len("Serving on "):].strip()
                break
        if url is None:
            pytest.fail("server did not print a 'Serving on ...' line within 10s")
        yield url
    finally:
        proc.kill()
        try:
            proc.wait(timeout=5)
        except Exception:
            pass


class Api:
    def __init__(self, base):
        self.base = base

    def request(self, method, path, body=None):
        """Return (status, headers, body_bytes)."""
        req = urllib.request.Request(self.base + path, data=body, method=method)
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                return r.status, r.headers, r.read()
        except urllib.error.HTTPError as e:
            return e.code, e.headers, e.read()

    def post_json(self, path, obj):
        status, headers, data = self.request("POST", path, json.dumps(obj).encode("utf-8"))
        return status, json.loads(data.decode("utf-8"))

    def get_json(self, path):
        status, headers, data = self.request("GET", path)
        return status, json.loads(data.decode("utf-8"))

    def post_cell(self, ref, raw):
        return self.post_json("/api/cells", {"ref": ref, "raw": raw})


@pytest.fixture
def api(server):
    return Api(server)
