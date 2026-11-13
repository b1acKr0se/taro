## User's intent

I write posts as Markdown files with a small header and want them as a static website. Build `sitegen`, a static site generator in Python 3.12 (standard library only; the README states the goal). The full contract is the product specification I attach: follow its rules and examples literally, as an acceptance suite checks them exactly.

## Manager's notes

- Outcomes: I run `python3 -m sitegen` on a folder of posts and get the site, with feeds, search data, tag pages and a link report, byte for byte as the specification says.
- Interfaces: the nine modules and their functions named in the specification (`errors`, `frontmatter`, `markdown`, `templates`, `slug`, `feed`, `search`, `links`, `site`, `cli`, `__main__`), under `src/sitegen/`.
- Related: none found; the repository holds only a README.
- Likely areas: new modules under `src/sitegen/`, `pyproject.toml`, tests under `tests/`.
- Out of scope: serving the site, watching for changes, anything the specification does not list.
- Kind: change. Owner model: set when the owner starts.

- Specification: attached as `SPEC.md` at the repository root.
