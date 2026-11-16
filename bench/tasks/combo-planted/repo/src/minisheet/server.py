"""HTTP server."""
from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer, ThreadingHTTPServer
from pathlib import Path

from .csvio import load_csv_text, to_csv_text
from .values import Empty, ErrorValue, display_text
from .workbook import Workbook

STATIC = Path(__file__).parent / "static" / "index.html"


def _json_value(v):
    if isinstance(v, ErrorValue):
        return {"error": v.code}
    if v is Empty:
        return None
    return v


def cell_json(wb: Workbook, name: str) -> dict:
    v = wb.get(name)
    return {"raw": wb.raw(name), "value": _json_value(v), "display": display_text(v)}


class _Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"

    def log_message(self, format, *args):  # noqa: A002
        pass

    # -- plumbing --------------------------------------------------------
    def _send(self, status: int, ctype: str, body: bytes) -> None:
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _json(self, status: int, obj) -> None:
        self._send(status, "application/json; charset=utf-8",
                   json.dumps(obj, ensure_ascii=False).encode("utf-8"))

    def _path(self) -> str:
        return self.path.split("?", 1)[0].split("#", 1)[0]

    def _body(self) -> bytes:
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            n = 0
        return self.rfile.read(n) if n > 0 else b""

    def _not_found(self) -> None:
        self._json(404, {"error": "not found"})

    do_PUT = do_DELETE = do_PATCH = do_HEAD = do_OPTIONS = _not_found

    # -- routes ----------------------------------------------------------
    def do_GET(self):
        path = self._path()
        srv = self.server
        with srv.lock:
            wb = srv.workbook
            if path == "/":
                self._send(200, "text/html; charset=utf-8", STATIC.read_bytes())
            elif path == "/api/cells":
                self._json(200, {"cells": {n: cell_json(wb, n) for n in wb.cells()}})
            elif path == "/api/csv":
                self._send(200, "text/csv; charset=utf-8", to_csv_text(wb, True).encode("utf-8"))
            else:
                self._not_found()

    def do_POST(self):
        path = self._path()
        srv = self.server
        if path not in ("/api/cells", "/api/csv"):
            self._body()
            self._not_found()
            return
        body = self._body()
        with srv.lock:
            wb = srv.workbook
            if path == "/api/cells":
                try:
                    obj = json.loads(body.decode("utf-8"))
                except (ValueError, UnicodeDecodeError):
                    obj = None
                if not isinstance(obj, dict):
                    self._json(400, {"error": "invalid JSON"})
                    return
                ref, raw = obj.get("ref"), obj.get("raw")
                if not isinstance(ref, str) or not isinstance(raw, str):
                    self._json(400, {"error": "ref and raw must be strings"})
                    return
                try:
                    wb.set(ref, raw)
                except ValueError:
                    self._json(400, {"error": f"bad reference: {ref}"})
                    return
                self._json(200, {"changed": {n: cell_json(wb, n) for n in wb.last_changed}})
            else:
                try:
                    new = load_csv_text(body.decode("utf-8"), True)
                except (ValueError, UnicodeDecodeError):
                    self._json(400, {"error": "invalid CSV"})
                    return
                wb._replace_with(new)
                self._json(200, {"cells": {n: cell_json(wb, n) for n in wb.cells()}})


class _Server(ThreadingHTTPServer):
    daemon_threads = True


def create_server(wb: Workbook, port: int = 0) -> HTTPServer:
    server = _Server(("127.0.0.1", port), _Handler)
    server.workbook = wb
    server.lock = threading.Lock()
    return server
