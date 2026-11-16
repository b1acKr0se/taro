import sys

from .cli import main

if __name__ == "__main__":
    for _stream in (sys.stdout, sys.stderr):
        if hasattr(_stream, "reconfigure"):
            try:
                _stream.reconfigure(encoding="utf-8", newline="\n")
            except Exception:
                pass
    sys.exit(main())
