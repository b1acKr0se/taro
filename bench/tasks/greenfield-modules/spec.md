# What the user wants (the decider's full intent)

A static site generator for Markdown notes: a front-matter parser, a Markdown subset renderer, an index
(home order, tags, backlinks), an HTML renderer with a template, and a CLI that ties them together. It
is built from scratch in four or five modules, so the work can be split.

## Stated in the brief (the owner already has these)

- The command, the output layout (`index.html`, `<slug>/index.html`, `tags/<tag>/index.html`), relative
  links, front matter keys, the Markdown subset, `[[note]]` links and the module interfaces.
- Out of scope: serving, watching, subfolders, themes.

## Details the user cares about (answer from these when asked)

- Front matter: `key: value` lines; `tags: [a, b]` (empty or missing means no tags); an unclosed `---`,
  a line that is not `key: value`, or a date that is not a real `YYYY-MM-DD` is a `ValueError`. A file
  without front matter is all body. Unknown keys are ignored.
- Markdown: a heading is `#`, `##` or `###` then a space; a paragraph is lines up to a blank line (lines
  joined with a space); a list is consecutive `- ` lines; a fenced block is ``` to ``` and its text is
  not interpreted. `[[target]]` outside code uses `resolve`; with no `resolve` it stays literal text;
  an unknown target is `<span class="broken-link">target</span>`.
- `index.build`: `home` is slugs in the home order; `tags` maps a tag to its slugs in that order;
  `backlinks` maps a slug to the sorted slugs that link to it (no self links, no duplicates); `broken`
  maps a slug to its unknown link targets.
- Templates: `{{title}}` (HTML-escaped) and `{{content}}` are replaced everywhere they appear, and what is
  inserted is never searched again; any other `{{x}}` stays. There is a default template with both.
- CLI output: `built 3 notes` (`built 1 note`) on stdout. No `.md` files: `no notes found`, exit 0,
  nothing written. The notes path not being a folder: `error: <path> is not a folder` on stderr, exit 2.
  A note that fails to parse is skipped with `skipped <file name>: <reason>` on stderr, the others are
  built, and the exit code is 1.
- Title fallback order: front matter, first `# ` heading, file name without `.md`.

## Hidden preferences (the brief leaves these out; reveal one only when a question touches it)

- P1: Slugs come from the file name without `.md`: lowercased, every run of characters other than
  `a-z` and `0-9` becomes one hyphen, hyphens trimmed from both ends; an empty result is `note`. Two
  files with the same slug get `-2`, `-3` in file-name order. A tag's folder name and a `[[target]]` are
  made into slugs by the same rule (`[[Buy Milk]]` links to `buy-milk`; a tag whose slug is empty gets no
  page). The link's label is the target note's title.
- P2: Output is safe: raw HTML in a note (and in a title or tag) is shown as text, escaped; a link whose
  address has a scheme other than `http`, `https` or `mailto` (`javascript:`, `data:`) is not made a
  link, only its text is written; addresses without a scheme (relative) stay links.
- P3: Rebuilding is clean and gentle: the build writes `.notesite-manifest.json` in the output folder
  listing the files it wrote; a rebuild deletes files the manifest names that this build no longer
  produces (and folders left empty), and never touches any file the manifest does not name. Output has
  no timestamps: building twice gives byte-identical files.

## How to answer

- Questions about slugs, collisions, link matching, tag folder names, escaping, unsafe addresses, stale
  output, rebuilds or the manifest touch P1, P2 or P3: answer from them and name it.
- Questions about front matter, Markdown details, index order, templates, messages or exit codes: answer
  from the details.
- Anything else the spec does not cover: pick the simplest option and say it is the owner's call.
