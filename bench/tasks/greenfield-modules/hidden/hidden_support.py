"""Helpers for the hidden tests: run the CLI in a scratch folder and read its output."""
import importlib
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class _Lazy:
    """A module imported when first used, so a missing module fails its own tests and not the whole file."""

    def __init__(self, name: str) -> None:
        self._name = name

    def __getattr__(self, attribute: str):
        return getattr(importlib.import_module(self._name), attribute)


def lazy(name: str) -> _Lazy:
    return _Lazy(name)


def write_notes(folder: Path, notes: dict[str, str]) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    for name, text in notes.items():
        (folder / name).write_text(text, encoding="utf-8")


def snapshot(folder: Path) -> dict[str, bytes]:
    return {str(path.relative_to(folder)): path.read_bytes() for path in sorted(folder.rglob("*")) if path.is_file()}


class SiteCase(unittest.TestCase):
    """A scratch notes folder and output folder per test."""

    def setUp(self) -> None:
        self._scratch = tempfile.TemporaryDirectory()
        self.addCleanup(self._scratch.cleanup)
        self.src = Path(self._scratch.name) / "notes"
        self.out = Path(self._scratch.name) / "site"

    def build(self, *extra: str, src: Path | None = None) -> subprocess.CompletedProcess:
        return subprocess.run(
            [sys.executable, "-m", "notesite", "build", str(src or self.src), str(self.out), *extra],
            cwd=ROOT, capture_output=True, text=True, env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
        )

    def page(self, relative: str) -> str:
        return (self.out / relative).read_text(encoding="utf-8")

    def files(self) -> list[str]:
        return sorted(str(path.relative_to(self.out)) for path in self.out.rglob("*") if path.is_file())
