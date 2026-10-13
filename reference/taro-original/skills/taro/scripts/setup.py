#!/usr/bin/env python3
"""Prepare Backlog.md and connect repositories using instructions from this checkout.

Setup only: no task commands, agent launcher, database, or background process.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

BACKLOG_VERSION = "1.53.0"
STATUSES = "Backlog,Planning,Ready,In Progress,Reviewing,Awaiting acceptance,Blocked,Cancelled,Done"
EXECUTION_BOUNDARIES = ("pull-request", "local-review")
SKILL_ROOT = Path(__file__).resolve().parents[1]


def run(arguments: list[str], *, cwd: Path | None = None, backlog_root: Path | None = None) -> str:
    environment = dict(os.environ)
    environment.pop("BACKLOG_CWD", None)
    if backlog_root:
        environment["BACKLOG_CWD"] = str(backlog_root)
    result = subprocess.run(arguments, cwd=cwd, env=environment, text=True,
                            capture_output=True, timeout=180)
    if result.returncode:
        raise ValueError(f"{arguments[0]} {arguments[1]} failed: {result.stderr.strip() or result.stdout.strip()}")
    return result.stdout.strip()


def git(repository: Path, *arguments: str) -> str:
    return run(["git", "-c", "core.hooksPath=/dev/null", "-C", str(repository), *arguments])


def write_json(path: Path, document: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w") as output:
            json.dump(document, output, indent=2)
            output.write("\n")
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def read_json(path: Path) -> dict:
    return json.loads(path.read_text())


def ensure_acceptance_status(config_path: Path) -> None:
    """Add the owner handoff to Taro's inline JSON status list without changing tickets."""
    content = config_path.read_text()
    match = re.search(r"(?m)^statuses: (\[.*\])\s*$", content)
    if not match:
        raise ValueError("Expected Taro's inline statuses list; inspect the Backlog configuration.")
    statuses = json.loads(match.group(1))
    if not isinstance(statuses, list) or not statuses or statuses[-1] != "Done":
        raise ValueError("Taro's statuses must be a list with Done last.")
    if "Awaiting acceptance" in statuses:
        return
    position = statuses.index("Reviewing") + 1 if "Reviewing" in statuses else statuses.index("Done")
    statuses.insert(position, "Awaiting acceptance")
    config_path.write_text(content[:match.start(1)] + json.dumps(statuses) + content[match.end(1):])


def backlog_executable(explicit: str | None, home: Path) -> str:
    candidate = explicit
    if not candidate and (home / "setup.json").exists():
        candidate = read_json(home / "setup.json")["backlogBin"]
    candidate = candidate or shutil.which("backlog")
    if not candidate:
        raise ValueError("Backlog.md is missing. Run setup.py prepare first.")
    executable = shutil.which(candidate)
    if not executable:
        raise ValueError(f"Backlog.md executable not found: {candidate}")
    if run([executable, "--version"]) != BACKLOG_VERSION:
        raise ValueError(f"Taro setup requires Backlog.md {BACKLOG_VERSION}; run setup.py prepare.")
    return str(Path(executable).absolute())


def prepare(arguments: argparse.Namespace) -> dict:
    home = Path(arguments.home).expanduser().resolve()
    if arguments.backlog_bin:
        executable = backlog_executable(arguments.backlog_bin, home)
    else:
        try:
            executable = backlog_executable(None, home)
        except ValueError:
            npm = shutil.which("npm")
            if not npm:
                raise ValueError("Install Node.js/npm, then rerun setup.py prepare.") from None
            dependency_root = home / "dependencies"
            run([npm, "install", "--prefix", str(dependency_root), "--no-audit", "--no-fund",
                 f"backlog.md@{BACKLOG_VERSION}"])
            executable = backlog_executable(str(dependency_root / "node_modules/.bin/backlog"), home)
    destinations = arguments.skills_dir or []
    installed = []
    for directory in destinations:
        target = Path(directory).expanduser().resolve() / "taro"
        if target == SKILL_ROOT:
            installed.append(str(target))
            continue
        if target.exists() and not (target / ".taro-installed").is_file():
            raise ValueError(f"Refusing to overwrite an unrelated skill at {target}")
        target.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix=".taro-install-", dir=target.parent) as temporary:
            staged = Path(temporary) / "taro"
            shutil.copytree(SKILL_ROOT, staged, ignore=shutil.ignore_patterns("__pycache__"))
            (staged / ".taro-installed").write_text("Managed by Taro setup\n")
            if target.exists():
                shutil.rmtree(target)
            shutil.move(str(staged), target)
        installed.append(str(target))
    document = {"backlogBin": executable, "backlogVersion": BACKLOG_VERSION, "skills": installed,
                "instructionFile": str(SKILL_ROOT / "SKILL.md")}
    write_json(home / "setup.json", document)
    return {**document, "paseoAvailable": bool(shutil.which("paseo")),
            "next": "Read instructionFile directly and continue onboarding; no skill installation is required."}


def onboard(arguments: argparse.Namespace) -> dict:
    requested_boundary = arguments.execution_boundary
    if requested_boundary is not None and requested_boundary not in EXECUTION_BOUNDARIES:
        raise ValueError("Execution boundary must be pull-request or local-review.")
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", arguments.project):
        raise ValueError("Project must be a lowercase identifier, e.g. shop or shop-api.")
    if not re.fullmatch(r"[A-Z]{2,6}", arguments.prefix) or arguments.prefix.lower() in {"draft", "doc", "decision"}:
        raise ValueError("Ticket prefix must be 2-6 uppercase letters, excluding reserved prefixes.")
    repository = Path(arguments.repo).expanduser().resolve()
    home = Path(arguments.home).expanduser().resolve()
    common = Path(git(repository, "rev-parse", "--path-format=absolute", "--git-common-dir")).resolve()
    checkouts = [line.removeprefix("worktree ") for line in git(repository, "worktree", "list", "--porcelain").splitlines()
                 if line.startswith("worktree ")]
    primary = Path(checkouts[0]).resolve()
    if any(home.is_relative_to(Path(checkout).resolve()) for checkout in checkouts):
        raise ValueError("Taro's setup home must be outside the repository and its worktrees.")
    git(repository, "check-ref-format", "--branch", arguments.base_branch)
    branch = "taro/backlog"
    if arguments.base_branch == branch:
        raise ValueError("The code base branch cannot be taro/backlog.")
    executable = backlog_executable(arguments.backlog_bin, home)
    manifest_path = home / "projects" / arguments.project / "project.json"
    backlog_root = home / "backlogs" / arguments.project
    expected = {"schemaVersion": 1, "project": arguments.project, "prefix": arguments.prefix,
                "primaryRoot": str(primary), "gitCommonDir": str(common),
                "backlogRoot": str(backlog_root), "backlogBranch": branch,
                "baseBranch": arguments.base_branch}
    for manifest in (home / "projects").glob("*/project.json"):
        other = read_json(manifest)
        if other.get("gitCommonDir") == str(common) and other.get("project") != arguments.project:
            raise ValueError(f"Repository is already registered as {other['project']}.")
    saved = read_json(manifest_path) if manifest_path.exists() else {}
    if manifest_path.exists():
        if any(saved.get(key) != value for key, value in expected.items()):
            raise ValueError("Project settings differ from the saved connection; inspect project.json first.")

    refs = git(repository, "for-each-ref", "--format=%(refname)").splitlines()
    if not backlog_root.exists():
        if "origin" in git(repository, "remote").splitlines():
            git(repository, "fetch", "origin", arguments.base_branch)
            start = f"refs/remotes/origin/{arguments.base_branch}"
            remote_branch = git(repository, "ls-remote", "--heads", "origin", f"refs/heads/{branch}")
            if remote_branch:
                git(repository, "fetch", "origin", f"refs/heads/{branch}:refs/remotes/origin/{branch}")
                refs.append(f"refs/remotes/origin/{branch}")
        else:
            start = f"refs/heads/{arguments.base_branch}"
        backlog_root.parent.mkdir(parents=True, exist_ok=True)
        if f"refs/heads/{branch}" in refs:
            git(repository, "worktree", "add", str(backlog_root), branch)
        else:
            if f"refs/remotes/origin/{branch}" in refs:
                start = f"refs/remotes/origin/{branch}"
            git(repository, "worktree", "add", "-b", branch, str(backlog_root), start)
    if (Path(git(backlog_root, "rev-parse", "--path-format=absolute", "--git-common-dir")).resolve() != common
            or git(backlog_root, "symbolic-ref", "--short", "HEAD") != branch):
        raise ValueError("The backlog path must be this repository's taro/backlog worktree.")

    portable_path = backlog_root / "backlog/taro.json"
    portable = {"schemaVersion": 1, "project": arguments.project, "prefix": arguments.prefix,
                "baseBranch": arguments.base_branch}
    shared = read_json(portable_path) if portable_path.exists() else {}
    if portable_path.exists() and any(shared.get(key) != value for key, value in portable.items()):
        raise ValueError("Shared backlog/taro.json conflicts with the requested project settings.")
    local_boundary = saved.get("executionBoundary")
    shared_boundary = shared.get("executionBoundary")
    if local_boundary and shared_boundary and local_boundary != shared_boundary:
        raise ValueError("Local and shared execution boundaries conflict; inspect both settings first.")
    boundary = requested_boundary or local_boundary or shared_boundary or "pull-request"
    if boundary not in EXECUTION_BOUNDARIES:
        raise ValueError("Unknown saved execution boundary; inspect project settings first.")
    expected["executionBoundary"] = portable["executionBoundary"] = boundary
    configs = [backlog_root / name for name in ("backlog/config.yml", ".backlog/config.yml", "backlog.config.yml")]
    initialized = any(config.exists() for config in configs)
    def backlog(*command: str) -> str:
        return run([executable, *command], cwd=backlog_root, backlog_root=backlog_root)
    if initialized and not portable_path.exists():
        raise ValueError("An existing Backlog.md project was found; this setup initializes fresh Taro projects only.")
    if not initialized:
        backlog("init", arguments.project, "--defaults", "--integration-mode", "none",
                "--task-prefix", arguments.prefix, "--zero-padded-ids", "3",
                "--check-branches", "false", "--include-remote", "false",
                "--auto-open-browser", "false")
        config_path = backlog_root / "backlog/config.yml"
        config_text, replacements = re.subn(r"(?m)^statuses:.*$", "statuses: " + json.dumps(STATUSES.split(",")),
                                            config_path.read_text(), count=1)
        if replacements != 1:
            raise ValueError("Generated Backlog configuration has no statuses line.")
        config_path.write_text(config_text)
        backlog("config", "set", "defaultStatus", "Backlog")
        backlog("config", "set", "autoCommit", "false")
    ensure_acceptance_status(next(config for config in configs if config.is_file()))
    tasks = json.loads(backlog("task", "list", "--json"))
    if shared != portable:
        write_json(portable_path, portable)
    instruction_file = str(SKILL_ROOT / "SKILL.md")
    write_json(manifest_path, {**expected, "backlogBin": executable, "instructionFile": instruction_file})
    return {"connection": str(manifest_path), **expected, "backlogBin": executable,
            "instructionFile": instruction_file, "taskDataReadable": isinstance(tasks, dict),
            "next": "Read instructionFile directly, then start or reuse the project manager through Paseo.",
            "sharing": "Commit backlog/ on taro/backlog; push only when authorized. No commits or pushes were made."}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="action", required=True)
    for name, handler in (("prepare", prepare), ("onboard", onboard)):
        command = commands.add_parser(name)
        command.add_argument("--home", default=str(Path.home() / ".taro"), help="setup connections and shared backlog worktrees")
        command.add_argument("--backlog-bin")
        command.set_defaults(handler=handler)
        if name == "prepare":
            command.add_argument("--skills-dir", action="append", help="optional skill installation directory; default: read instructions from this checkout")
        else:
            command.add_argument("--repo", required=True)
            command.add_argument("--project", required=True)
            command.add_argument("--prefix", required=True)
            command.add_argument("--base-branch", required=True)
            command.add_argument("--execution-boundary", choices=EXECUTION_BOUNDARIES,
                                 help="new projects default to pull-request; existing projects retain their setting unless explicitly changed")
    arguments = parser.parse_args()
    try:
        print(json.dumps(arguments.handler(arguments), indent=2))
        return 0
    except (ValueError, OSError, subprocess.TimeoutExpired) as error:
        print(f"Setup failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
