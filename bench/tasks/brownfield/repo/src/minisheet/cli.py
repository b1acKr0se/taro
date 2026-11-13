"""Command line interface."""
from __future__ import annotations

import sys

from .csvio import load_csv, save_csv
from .refs import Ref, col_letters, parse_range, parse_ref
from .values import ErrorValue, display_text, format_number
from .workbook import Workbook

USAGE = "python -m minisheet [serve --port N [--load FILE]]"
SERVE_USAGE = "serve --port N [--load FILE]"

_SYNOPSIS = {
    "set": "set REF [RAW]",
    "get": "get REF",
    "show": "show RANGE",
    "load": "load PATH",
    "save": "save [--raw] PATH",
    "quit": "quit",
}


def _get_text(v) -> str:
    if isinstance(v, ErrorValue):
        return v.code
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, float):
        return format_number(v)
    if isinstance(v, str):
        return v
    return ""


def _grid(wb: Workbook, a: Ref, b: Ref) -> list:
    L = len(str(b.row + 1))
    cols = range(a.col, b.col + 1)
    texts = {}
    widths = {}
    for c in cols:
        letters = col_letters(c)
        w = len(letters)
        for r in range(a.row, b.row + 1):
            v = wb.get_cell(Ref(c, r))
            t = display_text(v)
            texts[(c, r)] = (t, isinstance(v, float) and not isinstance(v, bool))
            w = max(w, len(t))
        widths[c] = w
    lines = [" " * L + "".join(" " + col_letters(c).rjust(widths[c]) for c in cols)]
    for r in range(a.row, b.row + 1):
        parts = [str(r + 1).rjust(L)]
        for c in cols:
            t, num = texts[(c, r)]
            parts.append(" " + (t.rjust(widths[c]) if num else t.ljust(widths[c])))
        lines.append("".join(parts))
    return lines


def _run_repl(stdin, out) -> int:
    wb = Workbook()
    had_err = False

    def emit(line: str, err: bool = False) -> None:
        nonlocal had_err
        if err:
            had_err = True
        out.write(line + "\n")
        out.flush()

    for line in stdin:
        line = line.strip()
        if not line:
            continue
        parts = line.split(None, 1)
        word = parts[0]
        cmd = word.lower()
        rest = parts[1] if len(parts) > 1 else ""
        if cmd == "quit":
            break
        if cmd not in _SYNOPSIS:
            emit(f"ERR unknown command: {word}", True)
            continue
        usage = f"ERR usage: {_SYNOPSIS[cmd]}"
        if cmd == "set":
            sp = rest.split(None, 1)
            if not sp:
                emit(usage, True)
                continue
            try:
                parse_ref(sp[0])
            except ValueError:
                emit(f"ERR bad reference: {sp[0]}", True)
                continue
            wb.set(sp[0], sp[1] if len(sp) > 1 else "")
            emit("OK")
        elif cmd == "get":
            args = rest.split()
            if len(args) != 1:
                emit(usage, True)
                continue
            try:
                parse_ref(args[0])
            except ValueError:
                emit(f"ERR bad reference: {args[0]}", True)
                continue
            emit(_get_text(wb.get(args[0])))
        elif cmd == "show":
            args = rest.split()
            if len(args) != 1:
                emit(usage, True)
                continue
            try:
                if ":" in args[0]:
                    a, b = parse_range(args[0])
                else:
                    a = b = parse_ref(args[0])
            except ValueError:
                emit(f"ERR bad reference: {args[0]}", True)
                continue
            for ln in _grid(wb, a, b):
                emit(ln)
        elif cmd == "load":
            if not rest:
                emit(usage, True)
                continue
            try:
                wb = load_csv(rest)
            except (OSError, ValueError):
                emit(f"ERR cannot load: {rest}", True)
                continue
            emit("OK")
        elif cmd == "save":
            raw = False
            path = rest
            sp = rest.split(None, 1)
            if sp and sp[0] == "--raw":
                raw = True
                path = sp[1] if len(sp) > 1 else ""
            if not path:
                emit(usage, True)
                continue
            try:
                save_csv(wb, path, values=not raw)
            except (OSError, ValueError):
                emit(f"ERR cannot save: {path}", True)
                continue
            emit("OK")
    return 2 if had_err else 0


def _serve(args, out) -> int:
    port = None
    load = None
    i = 0
    ok = True
    while i < len(args):
        a = args[i]
        if a in ("--port", "--load") and i + 1 < len(args):
            if a == "--port":
                try:
                    port = int(args[i + 1])
                    if not 0 <= port <= 65535:
                        ok = False
                except ValueError:
                    ok = False
            else:
                load = args[i + 1]
            i += 2
        else:
            ok = False
            break
    if not ok or port is None:
        out.write(f"ERR usage: {SERVE_USAGE}\n")
        out.flush()
        return 2
    wb = Workbook()
    if load is not None:
        try:
            wb = load_csv(load)
        except (OSError, ValueError):
            out.write(f"ERR cannot load: {load}\n")
            out.flush()
            return 2
    from .server import create_server
    try:
        server = create_server(wb, port)
    except OSError:
        out.write(f"ERR cannot bind: {port}\n")
        out.flush()
        return 2
    out.write(f"Serving on http://127.0.0.1:{server.server_address[1]}\n")
    out.flush()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        return 0
    finally:
        server.server_close()
    return 0


def main(argv=None, stdin=None, stdout=None) -> int:
    if argv is None:
        argv = sys.argv[1:]
    if stdin is None:
        stdin = sys.stdin
    if stdout is None:
        stdout = sys.stdout
    argv = list(argv)
    if not argv:
        return _run_repl(stdin, stdout)
    if argv[0] == "serve":
        return _serve(argv[1:], stdout)
    stdout.write(f"ERR usage: {USAGE}\n")
    stdout.flush()
    return 2
