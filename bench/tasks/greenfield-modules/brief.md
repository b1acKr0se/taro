## User's intent

I keep notes as Markdown files in a folder and want them as a small website I can open from disk. Build `notesite`, a static site generator in Python 3.12 (standard library only; the README in the repository states the goal and the command).

`python3 -m notesite build <notes folder> <output folder> [--template <file>]` reads the `*.md` files directly in the notes folder (not subfolders) and writes the site:

- `index.html`: the home page, a list of every note, newest `date` first, notes without a date last (ties by title).
- `<slug>/index.html`: one page per note, with its title, date, tags (each linking to its tag page), the body, and a "Linked from" list of the notes that link to it.
- `tags/<tag>/index.html`: one page per tag listing its notes in the same order as the home page.

A note may start with front matter between `---` lines holding `title:`, `date:` (`YYYY-MM-DD`) and `tags:` (`[a, b]`); the title falls back to the first `# ` heading, then the file name. The body is Markdown: `#` to `###` headings, paragraphs, `-` lists, fenced code blocks, and `**bold**`, `*em*`, `` `code` ``, `[text](url)`. `[[other-note]]` links to another note's page. Pages link to each other with relative URLs, so the site works from any folder (`../other/` from a note page).

## Manager's notes

- Outcomes: I build my notes folder and open `index.html` to browse them, follow links between notes and tags, and see what links to a note.
- Interfaces (the packages' tests will call these): `notesite.frontmatter.parse(text) -> (meta, body)` (raises `ValueError` on bad front matter); `notesite.markdown.to_html(text, resolve=None) -> str` (`resolve(target)` returns `(href, label)` or `None`); `notesite.index.build(notes) -> dict` with `home`, `tags`, `backlinks` and `broken` (each note a dict with `slug`, `title`, `date`, `tags`, `body`); `notesite.render.apply_template(template, title, content)`, `render_note(...)` and `render_list(...)`; `notesite.cli.main(argv) -> int`.
- Related: none found.
- Likely areas: new modules under `notesite/`, tests under `tests/`, `README.md`.
- Out of scope: serving the site, watching for changes, subfolders, themes beyond one template file.
- Kind: change. Owner model: set when the owner starts.
