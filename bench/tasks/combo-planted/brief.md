## User's intent

This branch claims to implement Parts A and B of the attached specification (a static site generator, `sitegen`, and a spreadsheet engine, `minisheet`). Review it, find and fix the defects, and keep all behaviour to the specification. The repository already holds a full implementation and its tests, which pass; do not rewrite the project.

## Manager's notes

- Outcomes: every rule and example in the specification holds in the code, each defect found has a regression test that failed before its fix, and all existing tests still pass.
- Interfaces: unchanged; the specification is the contract.
- Related: none beyond the two packages under `src/` and their tests under `tests/`.
- Likely areas: anywhere under `src/sitegen/` and `src/minisheet/`.
- Out of scope: a rewrite; behaviour the specification does not define.
- Kind: fix. Owner model: set when the owner starts.

- Specification: attached as `SPEC.md` at the repository root.
