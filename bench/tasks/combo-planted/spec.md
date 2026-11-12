# Review task

This branch claims to implement SPEC Parts A and B. Review it, find and fix the defects, keep all behavior to the SPEC, commit.

The repository already contains a full implementation. The combined SPEC below is the contract it must meet; do not rewrite the project.

---

# Combined SPEC: sitegen + minisheet in one project

Build **two independent packages in one uv project**: Part A, `sitegen` (a static site generator), and Part B, `minisheet` (a mini spreadsheet engine with a CLI, an HTTP API and a web UI). Each Part is binding exactly as written, except for the project-level rules in this preamble, which override any project-name or layout rule inside a Part.

## Project-level rules (override the Parts)

- One `pyproject.toml` at the root: `name = "benchsuite"`, `requires-python = ">=3.12"`, `dependencies = []` (stdlib only at runtime), a `[build-system]` so `uv run` installs the project, and a dev dependency group with `pytest` and `playwright`. Set pytest `pythonpath = ["src"]`.
- Both packages live under `src/`: `src/sitegen/` (Part A's modules) and `src/minisheet/` (Part B's modules). Each must import as a top-level package (`import sitegen`, `import minisheet`).
- Your own tests go in `tests/sitegen/` and `tests/minisheet/`. `uv run pytest` from the root must run both and pass.
- Both entry points must work from the root: `uv run python -m sitegen ...` and `uv run python -m minisheet ...`.
- The two packages share no code. Neither imports the other.

---

# Part A: sitegen


Build `sitegen`, a static site generator, from scratch. This SPEC is the complete public contract; a hidden acceptance suite checks it exactly. Where a rule or example is given, follow it literally. "MUST" = tested.

## 0. Project setup

- Python >= 3.12, **stdlib only at runtime** (no third-party runtime dependencies). `uv` project: `pyproject.toml` with `name = "sitegen"`, `requires-python = ">=3.12"`, `dependencies = []`, a `[build-system]` so that `uv run` installs the package, and a dev dependency group containing `pytest`.
- Src layout: `src/sitegen/` containing `__init__.py` (may be empty), `errors.py`, `frontmatter.py`, `markdown.py`, `templates.py`, `slug.py`, `feed.py`, `search.py`, `links.py`, `site.py`, `cli.py`, `__main__.py`. Your own tests go in `tests/`.
- Commands that MUST work from the project root: `uv run pytest` and `uv run python -m sitegen ...`.
- Conventions: all text is UTF-8; generated files use `\n` newlines and are written byte-exact from the returned/rendered strings (no added trailing newline). Output is deterministic (no timestamps). Functions taking paths accept `str` or `os.PathLike`.
- HTML escape (`esc`) used by markdown, templates and the pages: replace `&`->`&amp;` `<`->`&lt;` `>`->`&gt;` `"`->`&quot;` `'`->`&#x27;` (same as `html.escape(s, quote=True)`).

## 1. errors.py

```python
class SitegenError(Exception): ...
class FrontmatterError(SitegenError, ValueError): ...
class TemplateError(SitegenError): ...
class BuildError(SitegenError): ...
```

Other invalid-argument cases below raise plain `ValueError`.

## 2. frontmatter.py

`parse(text: str) -> tuple[dict, str]` returns `(metadata, body)`.

Rules:
1. First normalize every `\r\n` in `text` to `\n`.
2. If the first line is not exactly `---`: return `({}, text)` (normalized text).
3. Otherwise the block ends at the next line that is exactly `---`. No closing line -> `FrontmatterError`. `body` is everything after the closing line's `\n`, verbatim (no stripping); if the closing line is last with no `\n`, body is `""`.
4. Inside the block: lines that are empty/whitespace-only, or whose first non-space char is `#`, are ignored. Every other line MUST match `^([A-Za-z_][A-Za-z0-9_-]*):(?: +(.*))?$` (no leading indentation) else `FrontmatterError`. Duplicate key -> `FrontmatterError`. Keys keep insertion order.
5. The value is stripped, then interpreted:
   - empty -> `""`
   - starts with `"`: double-quoted string; MUST end with the closing unescaped `"` and nothing after it. Escapes: `\"` `\\` `\n` `\t`; any other backslash sequence -> `FrontmatterError`. Unterminated -> `FrontmatterError`.
   - starts with `'`: single-quoted; `''` is a literal `'`; no other escapes; MUST terminate with nothing after it, else `FrontmatterError`.
   - starts with `[`: inline list. MUST end with `]` else `FrontmatterError`. Inner text empty/whitespace -> `[]`. Otherwise items are separated by commas outside quotes; items are stripped; a quoted item is parsed as above (commas and `]` allowed inside quotes); an unquoted item is parsed by the scalar rules below (bool/int/plain). An empty item (`[a,,b]`, `[a,]`) or a nested `[` -> `FrontmatterError`.
   - exactly `true` / `false` -> `True` / `False` (case-sensitive; `True`, `yes` are plain strings)
   - matches `^[+-]?[0-9]+$` -> `int` (`007` -> 7, `-5` -> -5)
   - otherwise a plain string (the stripped text). No inline `#` comments (kept literally); `null`, `~`, floats and dates stay strings; `a: b: c` -> `"b: c"`.

Examples:
| input | output |
|---|---|
| `"hello"` | `({}, "hello")` |
| `"---\ntitle: Hi\n---\nBody\n"` | `({"title": "Hi"}, "Body\n")` |
| `"---\r\ntitle: Hi\r\n---\r\nB"` | `({"title": "Hi"}, "B")` |
| `"---\nn: 42\nok: true\nno: false\ns: \"a: b\"\nt: 'it''s'\n---\n"` | `({"n": 42, "ok": True, "no": False, "s": "a: b", "t": "it's"}, "")` |
| `"---\ntags: [a, \"b, c\", 3, true]\nempty: []\ne:\n---\nx"` | `({"tags": ["a", "b, c", 3, True], "empty": [], "e": ""}, "x")` |
| `"---\n# note\n\ndate: 2024-01-15\nslug: -x\n---\n\n\nbody"` | `({"date": "2024-01-15", "slug": "-x"}, "\n\nbody")` |
| `"---\n---\nbody"` | `({}, "body")` |
| `"---\ntitle: x\n"` | raises `FrontmatterError` |
| `"---\ntitle x\n---\n"`, `"---\na: 1\na: 2\n---\n"`, `"---\na: [1,\n---\n"` | raise `FrontmatterError` |

## 3. markdown.py

`render(md: str) -> str`. Input `\r\n` -> `\n` first. Output = block HTML strings joined with `"\n"`, **no trailing newline**. Empty or whitespace-only input -> `""`. Every line is right-stripped (trailing whitespace removed) before block detection, except lines inside fenced code (kept verbatim). Blank = empty after strip.

### Blocks (checked per line in this priority; markers must start at column 0; an indented line is paragraph text)
1. **Fenced code**: a line starting with ```` ``` ````. Info string = rest of line stripped; language = its first whitespace-delimited token (if any). Closes at the next line that equals ```` ``` ```` after right-strip; unclosed -> runs to end of input. Output `<pre><code>` + escaped lines joined by `\n` + `</code></pre>`; with a language `<pre><code class="language-LANG">` (LANG escaped). No trailing newline inside; empty fence -> `<pre><code></code></pre>`.
2. **Heading**: matches `^(#{1,6}) +(.+)$` -> `<hN>inline</hN>`. No ids. No closing-`#` handling (kept literally). `#x`, `####### x` and a bare `#` are paragraphs.
3. **HR**: matches `^(?:-{3,}|\*{3,}|_{3,})$` -> `<hr>`. (No setext headings: `---` after text is an hr and ends the paragraph.)
4. **Blockquote**: consecutive lines starting with `>`; strip the `>` and one following space if present; join the remaining lines with `\n` and render recursively as markdown. Output `<blockquote>\n` + inner + `\n</blockquote>`; empty inner -> `<blockquote></blockquote>`. A line not starting with `>` ends it (no lazy continuation).
5. **Lists** (flat; no nesting): unordered item `^[-*+] +(.*)$`, ordered item `^[0-9]+\. +(.*)$`. Consecutive items of the same kind form one list; changing kind or a blank line starts a new list (no loose lists); a non-item line ends the list. Output `<ul>\n<li>x</li>\n<li>y</li>\n</ul>` (`<ol>` for ordered; the start number is ignored). Item text is inline-rendered, one line only.
6. **Paragraph**: consecutive non-blank lines that start no other block (a heading, fence, hr, blockquote or list item line interrupts a paragraph). Each line is stripped; lines joined with `\n` (soft breaks kept, no `<br>`); inline-rendered; `<p>...</p>`.

### Inline rendering (exactly this order)
1. **Code spans**: scan left-to-right for `` `([^`]+)` `` -> `<code>` + esc(content) + `</code>`. Content gets no other processing. Unmatched backticks are literal. Treat each span as an opaque placeholder (counts as a non-alphanumeric, non-space char for the rules below).
2. Escape everything else with `esc` (raw HTML never passes through; `&amp;` becomes `&amp;amp;`).
3. **Images** `!\[([^\]]*)\]\(([^)\s]+)\)` -> `<img src="URL" alt="ALT">`.
4. **Links** `\[([^\]]+)\]\(([^)\s]+)\)` -> `<a href="URL">TEXT</a>`. TEXT gets steps 5 below applied (emphasis); URL, `src` and `alt` are never emphasis-processed (so `a_b_c` in a URL is safe). URL/ALT are the already-escaped text. No title support, no URL filtering. Images and links are opaque placeholders for emphasis.
5. **Emphasis**, `re.sub` without DOTALL (cannot span a line break), applied in this order to the whole text:
   - `\*\*\*(?!\s)(.+?)(?<!\s)\*\*\*` -> `<strong><em>\1</em></strong>`
   - `\*\*(?!\s)(.+?)(?<!\s)\*\*` -> `<strong>\1</strong>`
   - `(?<![A-Za-z0-9])__(?!\s)(.+?)(?<!\s)__(?![A-Za-z0-9])` -> `<strong>\1</strong>`
   - `\*(?!\s)(.+?)(?<!\s)\*` -> `<em>\1</em>`
   - `(?<![A-Za-z0-9])_(?!\s)(.+?)(?<!\s)_(?![A-Za-z0-9])` -> `<em>\1</em>`
6. Restore placeholders. Backslash escapes, autolinks, hard breaks, reference links, titles are not supported (backslash is literal).

Examples (`md` -> output):
1. `# Hello` -> `<h1>Hello</h1>`
2. `Hello *world* and **bold**` -> `<p>Hello <em>world</em> and <strong>bold</strong></p>`
3. `a < b & "c" 'd'` -> `<p>a &lt; b &amp; &quot;c&quot; &#x27;d&#x27;</p>`
4. `<script>alert(1)</script>` -> `<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>`
5. `para one\nstill one\n\n\npara two\n` -> `<p>para one\nstill one</p>\n<p>para two</p>`
6. `- a\n- b\n\n1. x\n2. y` -> `<ul>\n<li>a</li>\n<li>b</li>\n</ul>\n<ol>\n<li>x</li>\n<li>y</li>\n</ol>`
7. the 3-line text: fence-open line with `python`, line `print('<hi>')`, fence-close line (three backticks each) -> `<pre><code class="language-python">print(&#x27;&lt;hi&gt;&#x27;)</code></pre>`
8. `> quote *x*\n> more` -> `<blockquote>\n<p>quote <em>x</em>\nmore</p>\n</blockquote>`
9. `[a](http://x.com/a_b_c?q=1&r=2)` -> `<p><a href="http://x.com/a_b_c?q=1&amp;r=2">a</a></p>`
10. `![alt](/i.png)` -> `<p><img src="/i.png" alt="alt"></p>`
11. `***bold italic***` -> `<p><strong><em>bold italic</em></strong></p>`
12. `**bold with *nested em* inside** and *em with **strong** inside*` -> `<p><strong>bold with <em>nested em</em> inside</strong> and <em>em with <strong>strong</strong> inside</em></p>`
13. ``use `a<b` and snake_case_name, 2 * 3 * 4`` -> `<p>use <code>a&lt;b</code> and snake_case_name, 2 * 3 * 4</p>`
14. `---` -> `<hr>`; the empty string and `"\n\n  \n"` -> the empty string `""`
15. `- a\n\n- b` -> `<ul>\n<li>a</li>\n</ul>\n<ul>\n<li>b</li>\n</ul>`
16. `## Title\ntext\n---\nmore` -> `<h2>Title</h2>\n<p>text</p>\n<hr>\n<p>more</p>`

## 4. templates.py

`render(template: str, context: dict) -> str`. Raises `TemplateError` on any syntax/semantic error listed below. The **whole template is parsed and validated before any output**, so errors in unexecuted branches still raise. `context` is not mutated.

### Syntax
- Text outside tags is copied verbatim. **No whitespace trimming of any kind** (no `{%-`); newlines around tags are output as written.
- Tags: `{{ expr }}` and `{% stmt %}`. A tag ends at the FIRST `}}` / `%}` after its opener, even inside a quoted string. Inner text is stripped. An opener with no closer -> `TemplateError`. A lone `{`, `}`, or `{#` is literal text. No comments, no escaping of `{{`.
- `expr` = `path` followed by zero or more `| filter`. `path` = `NAME(.SEG)*`, NAME `[A-Za-z_][A-Za-z0-9_]*`, SEG = NAME or `[0-9]+`. Anything else (empty `{{ }}`, `{{ 1a }}`, literals as base) -> `TemplateError`.
- A filter is `name` or `name:ARG` (whitespace allowed around `|` and `:`); ARG is a string in `"..."` or `'...'` with no escapes (ends at the first matching quote; may contain `|`, `:`, spaces). Filters are lowercase names matching `[a-z]+`.
- Statements: `if EXPR_C`, `elif EXPR_C`, `else`, `endif`, `for NAME in EXPR`, `endfor`. `EXPR_C` = `expr` or `not expr` (`not` then whitespace). `else`/`endif`/`endfor` take no arguments. Unknown statement, unbalanced/misnested blocks, `elif`/`else` after `else`, `elif`/`else`/`endif`/`endfor` outside their block, tuple loops (`for k, v in x`) -> `TemplateError`.

### Semantics
- **Lookup**: first segment is searched in the loop scopes (innermost first), then `context`. For each later segment: current is `dict` -> key lookup (string key); current is `list`/`tuple` and SEG is digits -> index; anything else, missing key, or out of range -> *undefined*. A key present with value `None` is defined (value `None`).
- **Output** of `{{ }}`: undefined and `None` -> `""`; `str` as is; otherwise Python `str(value)` (`True` -> `True`, `5` -> `5`, lists via `str(list)`). Unless the value is marked safe, the resulting text is passed through `esc`. **Undefined never raises.**
- **Truthiness**: Python truthiness; undefined is false.
- **Filters** (value flows left to right together with a safe flag; context values start unsafe):
  - `upper`, `lower`, `title` (`str.title()`): apply to `str(value)` (undefined/None -> `""`); safe flag preserved.
  - `escape`: `esc(str(value))`, marked safe (so never double-escaped). `safe`: marks safe, value unchanged.
  - `default:"x"`: if the value is undefined, `None`, or `""` -> the literal `x` (unsafe); otherwise unchanged (`0`, `False`, `[]` are kept).
  - `join:", "`: for a `list`/`tuple` -> `str(item)` of each joined by the ARG (result unsafe); undefined/None -> `""`; any other value -> `str(value)`.
  - `length`: `len()` for str/list/tuple/dict; undefined/None -> 0; other values `len(str(value))`.
  - Unknown filter, missing ARG for `default`/`join`, ARG given to any other filter -> `TemplateError`.
- **for**: list/tuple iterate elements; dict iterates keys; anything else (undefined, None, str, numbers) -> zero iterations. The loop variable and `loop` exist only inside the body (outer values restored after; nested loops shadow `loop`). `loop` is a dict: `index` (1-based), `index0`, `first` (bool), `last` (bool), `length`.
- **if/elif/else**: first branch whose condition is truthy renders; else the `else` body; otherwise nothing.

Examples (`template` | context -> output):
1. `Hello {{ name }}!` | `{"name": "World"}` -> `Hello World!`
2. `{{ x }}` | `x = '<a href="u">&\''` -> `&lt;a href=&quot;u&quot;&gt;&amp;&#x27;`; `{{ x|safe }}` -> the raw text unchanged
3. `{{ s|escape }}` | `s = "<b>"` -> `&lt;b&gt;` (once, not double-escaped)
4. `[{{ missing }}][{{ a.b.c }}][{{ n }}]` | `{"a": {"b": {}}, "n": None}` -> `[][][]`
5. `{{ t|upper }} {{ t|lower }} {{ t|title }}` | `t = "hello woRLD"` -> `HELLO WORLD hello world Hello World`
6. `{{ tags|join:", " }} / {{ tags|length }}` | `{"tags": ["a", "b"]}` -> `a, b / 2`; `{{ tags|join:" | "|safe }}` -> `a | b`
7. `{{ nick|default:"anon" }}` | `{}` -> `anon`; `{"nick": ""}` -> `anon`; `{"nick": 0}` -> `0`
8. `{% for t in tags %}{{ loop.index }}:{{ t }}{% if not loop.last %}, {% endif %}{% endfor %}` | `{"tags": ["a", "b"]}` -> `1:a, 2:b`
9. `{% if n > 1 %}x{% endif %}` -> `TemplateError` (bad `if` expression); `{{ a|bogus }}`, `{{ name`, `{% for x in y %}no end`, `{% endif %}`, `{% if a %}{% else %}{% else %}{% endif %}` -> `TemplateError`
10. `{% if a %}A{% elif b %}B{% else %}C{% endif %}` | `{"a": 0, "b": [1]}` -> `B`; `{"a": 0, "b": []}` -> `C`
11. `{% if x %}\nA\n{% endif %}\n` | `{"x": True}` -> `\nA\n\n`; `{"x": False}` -> `\n`
12. `{% for p in posts %}{{ p.title }}{% endfor %}|{% for p in nothing %}x{% endfor %}` | `{"posts": [{"title": "T1"}, {"title": "T2"}]}` -> `T1T2|`
13. `` (empty template) -> `` ; `{{ items.0 }}-{{ items.5 }}` | `{"items": ["z"]}` -> `z-`

## 5. slug.py

`slugify(text: str) -> str`: (1) Unicode NFKD normalize; (2) encode to ASCII ignoring unencodable chars (accents drop, CJK etc. vanish); (3) lowercase; (4) replace each run of characters outside `[a-z0-9]` with one `-`; (5) strip leading/trailing `-`. May return `""`.

`unique_slug(text: str, taken: set[str]) -> str`: `base = slugify(text) or "untitled"`. If `base not in taken` return it; else return the first of `base-2`, `base-3`, ... not in `taken`. Does **not** mutate `taken`.

Examples: `slugify("Hello, World!")`=`hello-world`; `"  Multiple   Spaces  "`=`multiple-spaces`; `"Café Münster"`=`cafe-munster`; `"C++ & Rust"`=`c-rust`; `"Don't Stop"`=`don-t-stop`; `"snake_case v1.2.3"`=`snake-case-v1-2-3`; `"---"`, `""`, `"日本語"` = `""`. `unique_slug("Hello", set())`=`hello`; `("Hello", {"hello"})`=`hello-2`; `("Hello", {"hello","hello-2"})`=`hello-3`; `("!!!", set())`=`untitled`; `("!!!", {"untitled"})`=`untitled-2`; `("Hello 2", {"hello-2"})`=`hello-2-2`.

## 6. feed.py

`build_rss(site: dict, posts: list[dict]) -> str`. `site` needs `title`, `url`; each post needs `title`, `url` (site-relative, e.g. `/posts/first/`), `date` (str matching `^\d{4}-\d{2}-\d{2}$` and a valid calendar date), optional `summary` (default `""`). Missing keys or an invalid date -> `ValueError`.

Rules:
- Posts sorted by `date` descending, ties by `url` ascending; only the first 20 are emitted. Input list not mutated.
- `base = site["url"].rstrip("/")`. Channel link = `base + "/"`. Item link = `base + "/" + post["url"].lstrip("/")`.
- pubDate = the date at 00:00:00 UTC formatted `%a, %d %b %Y %H:%M:%S +0000` with English day/month abbreviations (never locale-dependent).
- XML text escaping applies to title, links, summary: only `&`->`&amp;`, `<`->`&lt;`, `>`->`&gt;` (quotes untouched). No CDATA.
- Channel `<description>` = escaped `site["title"]`. Element order in `<item>`: title, link, guid, pubDate, description (always present, empty if no summary). `<guid>` = item link. No indentation, no blank lines; lines joined with `\n`; no trailing newline; no `lastBuildDate`.

Example: `site={"title":"My Blog","url":"https://example.com/","author":"A"}`, `posts=[{"title":"First & Best","url":"/posts/first/","date":"2024-01-15","summary":"Hi <you>"}]` ->
```
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
<title>My Blog</title>
<link>https://example.com/</link>
<description>My Blog</description>
<item>
<title>First &amp; Best</title>
<link>https://example.com/posts/first/</link>
<guid>https://example.com/posts/first/</guid>
<pubDate>Mon, 15 Jan 2024 00:00:00 +0000</pubDate>
<description>Hi &lt;you&gt;</description>
</item>
</channel>
</rss>
```
With `posts=[]`: the same without any `<item>` block (declaration, `<rss>`, `<channel>`, title, link, description, `</channel>`, `</rss>`). Other pubDates: `2024-03-01` -> `Fri, 01 Mar 2024 00:00:00 +0000`; `2023-12-25` -> `Mon, 25 Dec 2023 00:00:00 +0000`. 21 posts -> 20 items, the 21st-newest dropped.

## 7. search.py

`STOPWORDS` (module constant, a frozenset): `a an and are as at be by for from in is it of on or that the to with`.

`tokenize(s: str) -> list[str]`: `re.findall(r"[a-z0-9]+", s.lower())`, then drop stopwords. Order and repeats kept. (Non-ASCII letters split words: `café` -> `["caf"]`.) One-letter non-stopword tokens are kept.

`build_index(docs: list[dict]) -> dict`: each doc has `slug`, `title`, `text` (all str). A doc's tokens = `tokenize(title) + tokenize(text)`. Missing keys or a duplicate slug -> `ValueError`. Shape (insertion order sorted: terms alphabetical, slugs alphabetical):
```
{"docs": {SLUG: {"title": TITLE, "length": NUM_TOKENS}}, "terms": {TERM: {SLUG: TF}}}
```
TF = occurrences of TERM in the doc's tokens (only TF >= 1 present).

`search(index: dict, query: str, limit: int = 10) -> list[str]`: terms = distinct `tokenize(query)` tokens. No terms -> `[]`. A doc matches only if it contains **all** terms (AND). Score = sum of TF of the terms in that doc. Sort by score descending, then slug ascending; return the first `limit` slugs (`limit <= 0` -> `[]`). An unknown term -> `[]`.

Example `docs=[{"slug":"b","title":"Beta","text":"the beta and alpha"},{"slug":"a","title":"Alpha","text":"alpha alpha"}]`:
`build_index` -> `{"docs":{"a":{"title":"Alpha","length":3},"b":{"title":"Beta","length":3}},"terms":{"alpha":{"a":3,"b":1},"beta":{"b":2}}}`.
`search(idx,"alpha")` -> `["a","b"]`; `"ALPHA"` with `limit=1` -> `["a"]`; `"alpha beta"` -> `["b"]`; `"alpha alpha"` -> `["a","b"]` (duplicate query terms count once); `"the of"` -> `[]`; `"zzz"` -> `[]`; `""` -> `[]`. Tie: docs `z` and `m` both only `foo`: `search(idx,"foo")` -> `["m","z"]`. `build_index([])` -> `{"docs":{},"terms":{}}`. `tokenize("The Cat & the HAT, x2!")` -> `["cat","hat","x2"]`.

## 8. links.py

`find_broken_links(pages: dict[str, str]) -> list[tuple[str, str]]`. `pages` maps a site-absolute file path (MUST start with `/`, else `ValueError`), e.g. `/index.html`, `/posts/a/index.html`, `/feed.xml`, to its content. Every key counts as an existing target. Only keys ending `.html` are scanned for links/ids; other files normally have content `""`.

- **Extraction**: find start tags `<a\s[^>]*>` (case-insensitive); in each, the attribute `(?<![\w-])href\s*=\s*(?:"([^"]*)"|'([^']*)')` (case-insensitive; unquoted hrefs ignored). The value is stripped of surrounding whitespace and used as-is (no entity/percent decoding). Ids of a page = all values of `(?<![\w-])id\s*=\s*(?:"([^"]*)"|'([^']*)')` over the entire HTML string.
- **Skipped (not checked)**: empty href; href with a scheme (`^[A-Za-z][A-Za-z0-9+.-]*:`, e.g. `https:`, `mailto:`, `tel:`, `javascript:`); href starting with `//`.
- **Internal** = everything else. Split at the first `#` into `rest` and `frag`; cut `rest` at the first `?` (query dropped). If `rest` is empty -> target is the current page. Else `joined = rest` if it starts with `/`, otherwise (directory of the current page, including its trailing `/`) + `rest`. Resolve: split on `/`, ignore empty and `.` segments, `..` pops one (no-op at root). `result = "/" + "/".join(segments)`. If `joined` ends with `/` or its last segment is `.` or `..` (or no segments remain) the target is `result.rstrip("/") + "/index.html"` (root -> `/index.html`). Otherwise the target is `result`; if it is not a key but `result + "/index.html"` is, that is the target. Case-sensitive exact key comparison.
- **Broken** if the target is not a key; or `frag` is non-empty and the target is not a `.html` key whose ids contain `frag` exactly. Empty `frag` (`#`) never fails by itself; `#top` gets no special treatment.
- **Output**: `(page_path, href)` per broken link, pages in ascending string order of path, links in document order within a page; duplicates kept; href as stripped.

Examples:
1. `{"/index.html": '<a href="/about.html">A</a> <a href="/missing.html">M</a>', "/about.html": ""}` -> `[("/index.html", "/missing.html")]`
2. `{"/posts/a/index.html": '<a href="../b/">x</a><a href="../c/">y</a>', "/posts/b/index.html": ""}` -> `[("/posts/a/index.html", "../c/")]`
3. `{"/index.html": '<h2 id="s1">h</h2><a href="#s1">1</a><a href="#s2">2</a><a href="/other.html#z">3</a><a href="/other.html#y">4</a>', "/other.html": "<p id='y'></p>"}` -> `[("/index.html", "#s2"), ("/index.html", "/other.html#z")]`
4. `{"/index.html": '<a href="https://x.com/a">e</a><a href="mailto:a@b.c">m</a><a href="//cdn.x/y">c</a><a href="">e</a><a HREF="/nope">n</a>'}` -> `[("/index.html", "/nope")]`
5. `{"/index.html": '<a href="posts/p">1</a><a href="./posts/p/">2</a><a href="/style.css">3</a><a href="/style.css#x">4</a><a href="?q=1">5</a><a href=\'/../index.html\'>6</a>', "/posts/p/index.html": "", "/style.css": ""}` -> `[("/index.html", "/style.css#x")]`
6. `{"/b.html": '<a href="/z">1</a>', "/a.html": '<a href="/y">2</a><a href="/y">3</a>'}` -> `[("/a.html", "/y"), ("/a.html", "/y"), ("/b.html", "/z")]`

## 9. site.py

`build(src: Path, out: Path) -> BuildReport`. All failures raise `BuildError` (wrap `FrontmatterError`, `TemplateError`, `OSError`, `tomllib.TOMLDecodeError`; chain with `from`; the message names the offending file).

```python
@dataclass
class BuildReport:
    posts: int          # published (non-draft) posts
    drafts: int         # content files skipped as drafts
    tag_pages: int      # tag pages written
    static_files: int   # static files copied
    output_files: list[str]  # every file written by this build, relative POSIX paths ("index.html", "posts/x/index.html"), sorted ascending
```

### Input layout
```
SRC/site.toml            required
SRC/templates/post.html  required
SRC/templates/index.html required
SRC/templates/tag.html   required
SRC/content/*.md         optional directory
SRC/static/**            optional directory
```
- `site.toml` (read with `tomllib`): required string keys `title`, `url`, `author` (missing / non-str -> `BuildError`); extra keys are allowed and kept. Missing `site.toml`/template/`SRC` -> `BuildError`. No template inheritance.
- Content: only regular files directly in `content/` whose names end with `.md` and don't start with `.`; subdirectories and other files ignored. Processed in ascending filename order (plain string sort of the name).
- Each file: `frontmatter.parse`. Front matter: `draft` (optional; MUST be a bool if present, else `BuildError`): `true` -> the file is a draft: skipped entirely (no further validation, no slug taken, counted in `drafts`). Required: `title` (non-empty str after strip) and `date` (str matching `^\d{4}-\d{2}-\d{2}$` and a valid calendar date). Optional: `slug` (str; empty counts as absent), `tags` (list of str; default `[]`; other types -> `BuildError`), `summary` (str, default `""`). Violations -> `BuildError`.
- Slug: `slug = unique_slug(fm_slug if given else title, taken)` (explicit slugs are slugified too), then added to `taken`. Collisions get `-2`, `-3`... in filename order.
- Post dict (same shape in every context): `title`, `slug`, `date` (str), `tags` (list[str] as written), `summary`, `url` = `/posts/<slug>/`, `content` = `markdown.render(body)`, `tag_links` = list of `{"name","slug","url"}` for the post's tags (below).
- Tags: tag slug = `slugify(tag)`; tags with an empty slug get no `tag_links` entry/page. Tags with the same slug are one tag (name = first occurrence in filename order then listed order); a duplicate within one post counts once for it. Tag dict: `{"name", "slug", "url": "/tags/<slug>/", "count": <number of published posts>}`. `tag_links` keeps the post's tag order.
- Post order everywhere (`posts` lists): date descending, ties slug ascending. Tag list: slug ascending.

### Template contexts
- `post.html` (once per post, `post` dict): `{"site": <site.toml dict>, "post": post}`
- `index.html` (once): `{"site": site, "posts": all published posts, "tags": all tag dicts}`
- `tag.html` (once per tag): `{"site": site, "tag": tag dict, "posts": published posts having that tag}`

### Output layout (under `OUT`; created with parents; existing contents are NOT removed, generated files overwrite)
- `OUT/index.html`, `OUT/posts/<slug>/index.html`, `OUT/tags/<tag-slug>/index.html` (one per tag with >= 1 published post): the template output, exact.
- `OUT/feed.xml` = `build_rss(site, posts)` with each post dict reduced to `title`, `url`, `date`, `summary`; `site` = the `site.toml` dict.
- `OUT/search.json` = `json.dumps(build_index(docs), sort_keys=True, ensure_ascii=False, separators=(",", ":"))` where `docs` = one `{"slug","title","text"}` per published post, `text` = the raw markdown body (post front matter).
- `SRC/static/<rel>` copied byte-for-byte to `OUT/<rel>` (e.g. `static/css/a.css` -> `OUT/css/a.css`); recursive; counted in `static_files`. A static file whose output path equals a generated file -> `BuildError`.
- Drafts appear nowhere (pages, index, tags, counts, feed, search, slugs).

Example: `content/b.md` = `---\ntitle: Hello World\ndate: 2024-01-02\ntags: [Python, web dev]\n---\nHi *you*`; `content/a.md` = `---\ntitle: Hello World\ndate: 2024-01-05\ndraft: false\n---\nx`; `content/d.md` has `draft: true`; `static/css/s.css`. Slugs: `a.md` -> `hello-world`, `b.md` -> `hello-world-2`. Output files: `css/s.css feed.xml index.html posts/hello-world-2/index.html posts/hello-world/index.html search.json tags/python/index.html tags/web-dev/index.html`; report `BuildReport(posts=2, drafts=1, tag_pages=2, static_files=1, output_files=[...those, sorted])`. If `post.html` is `<h1>{{ post.title }}</h1>\n{{ post.content|safe }}`, the page for `b.md` is `<h1>Hello World</h1>\n<p>Hi <em>you</em></p>` (no trailing newline). Index `posts` order: `hello-world` (2024-01-05), `hello-world-2` (2024-01-02).

## 10. cli.py and __main__.py

`main(argv: list[str] | None = None) -> int` (argv excludes the program name; default `sys.argv[1:]`). It never raises `SystemExit`: usage errors (argparse) return their code. `__main__.py` does `sys.exit(main())`.

- `python -m sitegen build SRC OUT`: runs `site.build`. Success: stdout one line `built: {posts} posts, {tag_pages} tag pages, {static_files} static files, {drafts} drafts skipped`, exit 0. Any `SitegenError`: stderr `error: {message}`, exit 1.
- `python -m sitegen check OUT`: if `OUT` is not a directory: stderr `error: not a directory: {OUT}`, exit 1. Otherwise build `pages` from every file under `OUT` (recursive): key = `"/" + relative POSIX path`; value = the UTF-8 text (`errors="replace"`) for `.html` files, `""` for all others. Run `find_broken_links`. For each result, stdout `broken: {page} -> {href}` in the returned order; then always a final stdout line `checked {P} pages, {N} broken links` (P = number of `.html` files). Exit 1 if N > 0 else 0.
- Usage errors -> exit 2 (message on stderr): no command, unknown command, wrong number of positional arguments, unknown option. `-h/--help` prints usage and exits 0.

## 11. Out of scope

Nested lists, loose lists, tables, setext headings, reference links, autolinks, raw HTML pass-through, hard line breaks, backslash escapes; YAML maps/multi-line values/block lists/anchors; template inheritance/includes/macros/`set`/comments/whitespace control/comparison operators/`and`/`or`; non-ASCII slug transliteration; pagination; draft previews; watch/serve mode; incremental builds; config files other than `site.toml`; Windows-specific path handling in link resolution; network access.


---

# Part B: minisheet


Mini spreadsheet engine (CLI, HTTP API, web UI). Binding; where silent, untested.

## 0. Setup and layout
- Python >= 3.12, stdlib only at runtime, uv project, `src/minisheet/`. Run: `uv run python -m minisheet`, `uv run pytest`. `pyproject.toml`: project `minisheet`, a build backend, dev deps `pytest` `playwright`, `pythonpath=["src"]`.
- Modules (public names exactly as listed; extra helpers allowed): `refs lexer parser values evaluator functions workbook csvio cli __main__ server` and `static/index.html`. `minisheet/__init__.py` exports `Workbook`.
- Value = `float | str | bool | Empty | ErrorValue`; numbers are ALWAYS `float`, never `int`.

## 1. refs
- `Ref(col, row, abs_col=False, abs_row=False)`: frozen dataclass, 0-based (`A1` = `Ref(0,0)`). Columns A..ZZ (0..701), rows 1..9999.
- `parse_ref(s)`: `s` must fully match `\$?[A-Za-z]{1,2}\$?[1-9][0-9]{0,3}`, else `ValueError` (`A0`, `A01`, `AAA1`, `A10000`).
- `parse_range(s) -> (Ref, Ref)`: `ref:ref`, normalized to (top-left, bottom-right); each axis's `$` flag follows the corner supplying that axis's min/max (tie: first corner). `A1:A1` valid; bare `A1` -> `ValueError`.
- `to_a1(ref)`: uppercase, `$` before col/row if flagged; out of range -> `ValueError`.

| Call | Result |
|---|---|
| `parse_ref("B12")` | `Ref(1,11,False,False)` |
| `parse_ref("$zz$9999")` | `Ref(701,9998,True,True)` |
| `parse_range("$C3:A$1")` | `(Ref(0,0,False,True), Ref(2,2,True,False))` |
| `to_a1(Ref(26,0,True,False))` | `"$AA1"` |
| `parse_ref("A0")`, `parse_ref("AAA1")` | `ValueError` |

## 2. lexer
`tokenize(text) -> list[Token]`; `text` is the formula body WITHOUT the leading `=`. `Token(kind, text, pos)` dataclass, `pos` = 0-based index in `text`. No EOF token; spaces/tabs skipped.

| kind | rule | `Token.text` |
|---|---|---|
| `NUM` | `\d+(\.\d*)?\|\.\d+` then optional `[eE][+-]?\d+` | source |
| `STR` | `"..."`, `""` = one `"` | decoded |
| `REF` | `\$?[A-Za-z]+\$?[0-9]+`, not followed by `[A-Za-z0-9_]` nor directly by `(` | uppercased |
| `RANGE` | REF-shaped, `:` (no spaces), REF-shaped | uppercased |
| `NAME` | `[A-Za-z_][A-Za-z0-9_]*` (incl. REF-shaped followed by `(`, and `A1E3`) | uppercased |
| `OP` | longest of `<> <= >= + - * / ^ & = < > %` | operator |
| `LPAREN RPAREN COMMA` | `( ) ,` | char |

REF-shaped need not be in bounds (`AAA1` is a REF token). `FormulaSyntaxError(msg, pos)` (a `ValueError`), `.pos`: unterminated string -> its opening `"`; any other illegal char (`!`, `@`, `'`, lone `$`/`:`) -> that char.

| `tokenize(...)` | Result |
|---|---|
| `"A1+2"` | REF `A1`@0, OP `+`@2, NUM `2`@3 |
| `'"a""b"&sum(1)'` | STR `a"b`@0, OP `&`@6, NAME `SUM`@7, LPAREN@10, NUM@11, RPAREN@12 |
| `"$A$1:b2 <> 1e3"` | RANGE `$A$1:B2`@0, OP `<>`@8, NUM `1e3`@11 |
| `'"abc'` / `"1 + #"` | error pos 0 / pos 4 |

## 3. parser
`parse(text) -> Node` (same `text` convention; raises `FormulaSyntaxError`). Frozen dataclasses on base `Node`:

| Class | Fields |
|---|---|
| `Num` | `value: float` |
| `Str` | `value: str` |
| `Bool` | `value: bool` (bare `TRUE`/`FALSE`, any case, not before `(`) |
| `CellRef` | `ref: Ref` (flags kept) |
| `RangeRef` | `start: Ref`, `end: Ref` (normalized like `parse_range`) |
| `BadRef` | `text: str` (uppercased REF/RANGE token rejected by `parse_ref`/`parse_range`) |
| `Name` | `name: str` (other bare NAME, uppercased) |
| `UnaryOp` | `op: str` (`"-"`/`"+"`), `operand` |
| `Percent` | `operand` |
| `BinOp` | `op: str` (`+ - * / ^ & = <> < <= > >=`), `left`, `right` |
| `Call` | `name: str` (uppercased), `args: tuple[Node, ...]` |

Precedence, tightest first, binary ops LEFT-associative: `:` (in RANGE) > prefix `-` `+` > postfix `%` > `^` > `* /` > `+ -` > `&` > comparisons. So `-2^2` = `(-2)^2` = 4 and `2^3^2` = `(2^3)^2` = 64. Grammar: `power := percent ('^' percent)*`, `percent := unary '%'*`, `unary := ('-'|'+') unary | primary`; so `2^-1` parses. Call = `NAME` `(` args `)` (spaces between tokens fine); `F()` valid; an empty arg (`F(1,)`) is an error. Error pos = pos of the offending token, or `len(text)` at premature end.

| `parse(...)` | Result |
|---|---|
| `"1+2*3"` | `BinOp("+",Num(1.0),BinOp("*",Num(2.0),Num(3.0)))` |
| `"2^3^2"` | `BinOp("^",BinOp("^",Num(2.0),Num(3.0)),Num(2.0))` |
| `"-2^2"` | `BinOp("^",UnaryOp("-",Num(2.0)),Num(2.0))` |
| `"50%+1"` | `BinOp("+",Percent(Num(50.0)),Num(1.0))` |
| `"sum(a1:b2,3)"` | `Call("SUM",(RangeRef(Ref(0,0),Ref(1,1)),Num(3.0)))` |
| `"AAA1+foo+true"` | `BinOp("+",BinOp("+",BadRef("AAA1"),Name("FOO")),Bool(True))` |
| `"($A$1)"`, `"F()"` | `CellRef(Ref(0,0,True,True))`, `Call("F",())` (no paren node) |
| `"1+"`, `"(1"`, `"1 2"`, `"1+*2"` | error pos 2 (all four) |
| `"SUM(1,)"`, `""` | error pos 6, pos 0 |

## 4. values
- `Empty`: singleton, falsy. `ErrorValue(code)`: frozen dataclass, eq by code, `str()` = code.
- Constants: `DIV0`=`#DIV/0!`, `VALUE`=`#VALUE!`, `REF`=`#REF!`, `NAME`=`#NAME?`, `CIRC`=`#CIRC!`.
- Helpers (an `ErrorValue` arg is returned unchanged; failure -> `VALUE`):
  - `to_number(v)`: float; bool -> 1/0; Empty -> 0; str -> strip, `""` -> 0, else fully match `[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?` and be finite.
  - `to_bool(v)`: bool; float -> `!=0`; Empty -> False; str -> `TRUE`/`FALSE` (stripped, any case).
  - `to_text(v)`: str; bool -> `TRUE`/`FALSE`; Empty -> `""`; float -> `format_number`.
  - `format_number(x)`: `format(x,".15g")`, `"-0"` -> `"0"`.

| Call | Result |
|---|---|
| `to_number("  3.5 ")`, `("")`, `("abc")` | `3.5`, `0.0`, `VALUE` |
| `format_number` of `3.0`, `2.5`, `0.1+0.2` | `"3"`, `"2.5"`, `"0.3"` |
| `format_number` of `1/3`, `1e20`, `-0.0` | `"0.333333333333333"`, `"1e+20"`, `"0"` |

## 5. evaluator
`evaluate(node, get_cell) -> Value`; `get_cell(ref: Ref) -> Value` gives one cell's value (`Empty` if blank).
- Top-level `Empty` -> `0.0`; top-level range -> `VALUE`. Inside expressions `Empty` stays.
- `CellRef` -> `get_cell`; `BadRef` -> `REF`; `Name` -> `NAME`. A `RangeRef` is legal only as a direct function argument, where it is a `list` of values in row-major order; anywhere else -> `VALUE`.
- Unary `-`: `to_number` then negate; `+`: `to_number`; `Percent`: `to_number(x)/100`. Operand error wins, then coercion.
- Binary ops evaluate both operands (no short-circuit), then: (1) left error -> it; (2) right error -> it; (3) coerce left (`to_number`; `to_text` for `&`), failure -> `VALUE`; (4) right likewise; (5) compute.
- `/` by 0 (incl. 0/0) -> `DIV0`. `^`: `0^negative` -> `DIV0`; negative base with non-integer exponent, or overflow/inf/nan from any arithmetic -> `VALUE`; `0^0` = 1. `&` = `to_text(l)+to_text(r)`.
- Comparisons give bool. Empty first becomes the other side's zero (0.0 / `""` / False; Empty vs Empty equal). Same types compare naturally (strings via `.lower()`, `FALSE<TRUE`); different types order `number < text < bool`, no coercion.
- `Call`: unknown name -> `NAME` (args not evaluated). Normal function: all args evaluated left to right, then `fn(*args)`; no pre-check of errors/arity. Lazy function: see 6.

| Formula | Value |
|---|---|
| `-2^2`, `2^3^2`, `2^-1`, `50%`, `200%*3` | `4.0`, `64.0`, `0.5`, `0.5`, `6.0` |
| `1/0`, `0/0`, `0^-1`, `(-8)^0.5` | `DIV0`, `DIV0`, `DIV0`, `VALUE` |
| `1&2`, `"a"&1.5&TRUE` | `"12"`, `"a1.5TRUE"` |
| `"3"+1`, `""+1`, `"x"+1`, `TRUE+1` | `4.0`, `1.0`, `VALUE`, `2.0` |
| `1<"a"`, `"a"<TRUE`, `"A"="a"`, `2="2"`, `TRUE<5` | `True`, `True`, `True`, `False`, `False` |
| blank A1: `A1+1`, `A1&"x"`, `A1=0`, `A1=""`, `A1` | `1.0`, `"x"`, `True`, `True`, `0.0` |
| `(1/0)+NOPE()`, `NOPE()+(1/0)`, `"a"+(1/0)` | `DIV0`, `NAME`, `DIV0` |
| `FOO`, `NOPE(1/0)`, `AAA1`, `A0`, `A1:A2+1` | `NAME`, `NAME`, `REF`, `REF`, `VALUE` |

## 6. functions
`FUNCTIONS: dict` (uppercase keys). `@register(name, *, lazy=False)` stores the function under `name.upper()`, returns it. `functions.LAZY` = set of lazy names. Normal function: `fn(*args)`, each arg a scalar Value or a `list` (range). It validates its own arity (`VALUE` if wrong) and never raises. Lazy function (built-in: only `IF`): each arg is a zero-argument callable returning that argument's evaluated Value/list; call only what is needed.

Order: arity, then the FIRST error among args (left to right; row-major inside a range) is returned, then coercion. Only `SUM AVERAGE MIN MAX COUNT AND OR CONCAT` accept ranges; any other function given a list -> `VALUE`.

| Fn | Arity | Rule |
|---|---|---|
| `SUM` | >=1 | sum of collected numbers, left-to-right `+` from `0.0`; none -> `0.0` |
| `AVERAGE` | >=1 | sum/count; count 0 -> `DIV0` |
| `MIN` `MAX` | >=1 | none -> `0.0` |
| `COUNT` | >=1 | count of collected numbers (float) |
| `ROUND(x,n)` | 2 | `to_number` both; `n` truncated toward 0; round `Decimal(repr(x))` at `n` digits half AWAY from zero (`ROUND_HALF_UP`), to float; `-0.0` -> `0.0` |
| `ABS(x)` | 1 | `abs(to_number(x))` |
| `IF(c,a[,b])` | 2-3 | lazy; `c` error -> it; `to_bool(c)`; evaluate only the chosen branch; list result/cond -> `VALUE`; missing `b` and false -> `False` |
| `AND` `OR` | >=1 | collected bools: all/any; none collected -> `VALUE`; no short-circuit |
| `NOT(x)` | 1 | `not to_bool(x)` |
| `CONCAT` | >=1 | join `to_text` of scalars and of every range element (error element -> that error) |
| `LEN(s)` | 1 | `float(len(to_text(s)))` |
| `UPPER` `LOWER` | 1 | `.upper()`/`.lower()` of `to_text` |
| `LEFT(s[,n])` `RIGHT` | 1-2 | `n` default 1, `to_number` truncated toward 0; `n<0` -> `VALUE`; `n>=len` -> all; `n=0` -> `""` |

Collection, `SUM AVERAGE MIN MAX COUNT`: in a range only floats count (text, bool, Empty skipped). Scalars: float counts; bool counts as 1/0; Empty skipped; `""` skipped; other str counts if `to_number` succeeds, else `VALUE` (`COUNT`: skipped). So `SUM(A1)` with text in A1 is `VALUE`. `AND OR`: range: bool as is, float `!=0`, text/Empty skipped; scalar: `to_bool`, Empty skipped.

| Formula | Value |
|---|---|
| `SUM(1,2,3)`, `SUM()`, `SUM("2",TRUE)`, `SUM("x")` | `6.0`, `VALUE`, `3.0`, `VALUE` |
| `SUM(A1:A3)`, A1=1 A2="x" A3 blank / A2=`#DIV/0!` | `1.0` / `DIV0` |
| all-blank `AVERAGE(A1:A3)`, `MAX(A1:A3)` | `DIV0`, `0.0` |
| `AVERAGE(1,2)`, `MIN(3,-1,2)`, `COUNT(A1:A4)` over 1,"x",TRUE,blank | `1.5`, `-1.0`, `1.0` |
| `ROUND(2.5,0)`, `(-2.5,0)`, `(2.675,2)`, `(1234,-2)` | `3.0`, `-3.0`, `2.68`, `1200.0` |
| `ROUND(1)`, `ABS(-3)`, `ABS("-2")` | `VALUE`, `3.0`, `2.0` |
| `IF(1,"y","n")`, `IF(0,"y")`, `IF(TRUE,1,1/0)`, `IF("x",1,2)`, `IF(1/0,1,2)` | `"y"`, `False`, `1.0`, `VALUE`, `DIV0` |
| `AND(TRUE,1)`, `OR(0,FALSE)`, `AND(A1:A2)` (blank), `NOT("true")` | `True`, `False`, `VALUE`, `False` |
| `CONCAT("a",1,A1:A2)` (A1 blank, A2="z"), `LEN(12.50)`, `UPPER("aB")`, `LOWER(TRUE)` | `"a1z"`, `4.0`, `"AB"`, `"true"` |
| `LEFT("hello",2)`, `LEFT("hello")`, `RIGHT("hello",9)`, `RIGHT("hello",0)`, `LEFT("a",-1)` | `"he"`, `"h"`, `"hello"`, `""`, `VALUE` |

## 7. workbook
`Workbook()`. `ref_str` goes through `parse_ref` (any case, `$` ignored); a bad one raises `ValueError`, no change made.
- `set(ref_str, raw, *, literal=False)`. Classification in order: (1) `""` clears the cell; (2) first char `=` -> formula, body `raw[1:]`; (3) stripped raw matches the `to_number` grammar (finite) -> float; (4) stripped raw upper-cased is `TRUE`/`FALSE` -> bool; (5) else the string, unchanged. `literal=True` skips 2-4 (used by CSV).
- `get(ref_str) -> Value` (`Empty` if blank); `raw(ref_str) -> str` exactly as given (`""` if blank); `cells() -> list[str]`: canonical addresses (uppercase, no `$`) of non-empty cells, sorted by row then column.
- `recalc_count`: cumulative number of formula-cell evaluations. `last_changed -> list[str]`: the cells recomputed by the latest `set` (the cell first, then dependents, topological order; `[]` initially).
- A formula that does not parse keeps its raw, is `VALUE`, has no dependencies, and still counts as one evaluation per recompute.

**Dependencies** are static: every `CellRef` and every cell of every `RangeRef` anywhere in the AST (even an untaken `IF` branch or the args of an unknown function); `BadRef` adds none. A range depends on every cell in its rectangle, including cells blank now and set later.

**Recalc.** `set` computes D = the cell plus all transitive dependents, then evaluates each formula cell of D exactly once in topological order (+1 `recalc_count` each). A constant or cleared cell adds 0. No early cut-off; an identical raw still recalculates. `last_changed` = D.

**Cycles.** A cell is circular if on a cycle (self-reference and a range containing itself count) or transitively depending on a cycle cell. A circular cell is `CIRC` whatever its formula and is not evaluated (adds 0). Changing a cycle member so the cycle breaks recomputes all former members and dependents, which recover correct values.

Example 1 (fresh `wb`; Count = `recalc_count` after the call):

| Call | Count | Values afterwards |
|---|---|---|
| `set("A1","1")` | 0 | A1=1.0 |
| `set("B1","=A1+1")` | 1 | B1=2.0 |
| `set("C1","=B1*2")` | 2 | C1=4.0 |
| `set("A1","5")` | 4 | B1=6.0, C1=12.0 |
| `set("C1","=A1")` | 5 | C1=5.0 (B1 untouched) |
| `set("D1","=SUM(A1:A3)")` | 6 | D1=5.0 |
| `set("A3","9")` | 7 | D1=14.0 (A3 was blank) |
| `set("E1","=B1+C1")` | 8 | E1=11.0 |
| `set("A1","1")` | 12 | B1,C1,D1,E1 once each; E1=3.0 |
| `set("A1","")` | 16 | B1=1.0, C1=0.0, D1=9.0, E1=1.0 |
| `set("F1","=1+")` | 17 | F1=`VALUE`, raw `"=1+"` |

Example 2 (fresh `wb`): `set("A1","=B1")` -> count 1, A1=0.0. `set("B1","=A1")` -> A1,B1 `CIRC`, count 1. `set("C1","=A1+1")`, `set("D1","=C1")` -> `CIRC`, count 1. `set("B1","5")` -> count 4: A1=5.0, C1=6.0, D1=6.0. A self-reference (`A1` = `=A1+1`) is `CIRC`, count +0.
Example 3: raw `"007"` -> `get` 7.0, `raw` `"007"`; `" true "` -> `True`; `" =1"`, `"1,5"` -> strings; `"="` -> `VALUE`.

## 8. csvio
UTF-8, delimiter `,`, quote `"` (doubled inside), records end `\n` on write; read accepts `\n`, `\r\n`, `\r`, and quoted fields may contain them.
- `load_csv(path, formulas=True) -> Workbook`: record i, field j -> cell (col j, row i), first field = `A1`. Each non-empty field is `wb.set(ref, field)` (raw rules apply); empty fields skipped; a blank record still occupies a row. `formulas=False`: `=`-fields use `literal=True` (value and raw = the text). Out of A1..ZZ9999 -> `ValueError`; missing file -> `FileNotFoundError`. `recalc_count` after load: unspecified.
- `save_csv(wb, path, values=True)`: records for rows 1..last non-empty row; each lists columns A..last non-empty column of THAT row; a row without cells is the line `\n`. A field is quoted iff it contains `,` `"` `\n` or `\r`. Empty workbook -> empty file. Field text: `values=True`: `to_text` of the value, error -> its code; `values=False`: `wb.raw(ref)`.

| Case | Output / result |
|---|---|
| A1=`1`, B1=`=A1/4`, A2=text `say "hi", ok`, C2=`x` | `1,0.25\n"say ""hi"", ok",,x\n` |
| load `a,"b\nc"\n,=A1&"!"\n` | A1=`a`, B1=`"b\nc"`, B2=`"a!"`; with `formulas=False` B2=`=A1&"!"` text |

## 9. cli
`main(argv=None, stdin=None, stdout=None) -> int` (defaults from `sys`). Output: `\n`-terminated lines to `stdout`, flushed.
- `argv==[]`: REPL over `stdin` lines (stripped; blank ignored; no prompt). `argv[0]=="serve"`: section 10. Other argv: print `ERR usage: python -m minisheet [serve --port N [--load FILE]]`, return 2.
- Commands (name case-insensitive; args split on whitespace; REF = `parse_ref`; RANGE = `parse_range` or one cell):

| Command | Effect / output |
|---|---|
| `set REF [RAW]` | RAW = rest of line after REF, leading space stripped (may contain spaces; absent = `""`). Prints `OK` |
| `get REF` | float via `format_number`, bool `TRUE`/`FALSE`, str as is, error code; blank cell -> empty line |
| `show RANGE` | the grid below |
| `load PATH` | `load_csv(PATH)` replaces the workbook (PATH = rest of line). `OK` |
| `save [--raw] PATH` | `save_csv(wb,PATH,values=not raw)`. `OK` |
| `quit` | stop, no output (args ignored) |

- Errors print one line, processing continues: `ERR unknown command: <word as typed>`; wrong argument count: `ERR usage: <u>`, `<u>` = the command's synopsis in the table; `ERR bad reference: <token as typed>`; `OSError`/`ValueError` in load/save: `ERR cannot load: <PATH>` / `ERR cannot save: <PATH>`.
- Exit code at `quit`/end of input: `0` if no `ERR` line was printed, else `2`.

**show grid.** L = width of the largest row number. W_c = max(len(column letters), longest cell text in column c). Cell text: float `f"{x:.2f}"`; bool `TRUE`/`FALSE`; str with each `\n`,`\r` -> one space; error code; blank `""`. Floats right-aligned, everything else left-aligned. Header line = `" "*L` + per column `" "` + letters right-aligned to W_c. Row line = row number right-aligned to L + per column `" "` + text aligned to W_c. Nothing stripped.

A1=`1.5`, B1=`hi`, C1=`=A1*2`, A2=`=1/0`, B2=`TRUE`, C2=`=A1*100`; `show A1:C2` prints exactly (L=1, W=7,4,6):
```
        A    B      C
1    1.50 hi     3.00
2 #DIV/0! TRUE 150.00
```
Also: `set A1 3` -> `OK`, `get A1` -> `3`; `get AAA1` -> `ERR bad reference: AAA1` (exit 2).

## 10. server (P5)
`python -m minisheet serve --port N [--load FILE]` (any option order; `--port` required, 0 = free port): `load_csv(FILE)` if given (failure: `ERR cannot load: FILE`, return 2); bind `127.0.0.1`; print exactly one line `Serving on http://127.0.0.1:<actual port>` (flushed); serve until killed (`KeyboardInterrupt` -> 0). Bad/missing `--port`: `ERR usage: serve --port N [--load FILE]`, return 2. `server.create_server(wb, port=0)` returns the `HTTPServer`. Stdlib `http.server`, requests serialized by a lock, nothing else on stdout, query strings ignored. Any other method/path -> 404 `{"error":"not found"}`. JSON is UTF-8; success is 200.

**Cell** = `{"raw": str, "value": V, "display": str}`. V: float -> JSON number; str; bool -> `true`/`false`; `Empty` -> `null`; error -> `{"error":"#DIV/0!"}`. `display` = the show-grid cell text (section 9). `cells`/`changed` keys are canonical addresses.

| Request | Response |
|---|---|
| `GET /` | `text/html; charset=utf-8`, bytes of `static/index.html` |
| `GET /api/cells` | `{"cells":{ref:Cell,...}}`, non-empty cells only |
| `POST /api/cells` `{"ref","raw"}` | `{"changed":{ref:Cell}}` = exactly `last_changed`; a cleared cell is `{"raw":"","value":null,"display":""}` |
| `GET /api/csv` | `text/csv; charset=utf-8`, `save_csv(values=True)` content |
| `POST /api/csv` (UTF-8 CSV body) | replaces the workbook as `load_csv(formulas=True)`; responds like `GET /api/cells` |

400 `{"error":msg}` (state unchanged): body not a JSON object -> `invalid JSON`; `ref`/`raw` missing or not str -> `ref and raw must be strings`; bad ref -> `bad reference: <ref as sent>`; bad CSV (undecodable/out of bounds) -> `invalid CSV`.

Examples (fresh server):
1. `POST /api/cells {"ref":"A1","raw":"2"}` -> `{"changed":{"A1":{"raw":"2","value":2.0,"display":"2.00"}}}`.
2. `{"ref":"b1","raw":"=A1*2"}` -> `changed` = `{"B1":{"raw":"=A1*2","value":4.0,"display":"4.00"}}`; then `{"ref":"A1","raw":"5"}` -> `changed` has exactly `A1` (5.0) and `B1` (10.0, display `"10.00"`).
3. `{"ref":"C1","raw":"=1/0"}` -> C1 = `{"raw":"=1/0","value":{"error":"#DIV/0!"},"display":"#DIV/0!"}`; raw `TRUE` -> value `true`, display `"TRUE"`.
4. `{"ref":"AAA1","raw":"1"}` -> 400 `{"error":"bad reference: AAA1"}`; body `not json` -> 400 `{"error":"invalid JSON"}`.

## 11. web UI (P6): `static/index.html`
One file, inline vanilla JS + CSS, no CDN, no build; relative API URLs.

**DOM.** `<table id="grid" tabindex="0">`; header row of `<th>` A..Z (first empty); each body row: row-number `<th>` (1..50) then `<td data-ref="A1">`..`<td data-ref="Z50">` (1300 `td[data-ref]`, no other `data-ref`). `#cell-name` (text = selected ref), `#formula-bar` (`<input type="text">`, value = raw), `#status` (empty by default). `<body data-ready="true">` once the initial load rendered.

**Rendering.** td text = `display` (`""` if blank). Float value: class `num` and `text-align:right`; all else `text-align:left`. Error value: class `error`. One td has `selected`.

**Behaviour.**
- Load: fetch `/api/cells`, render, select A1, focus `#grid`.
- Select (click, arrow, commit move): set `selected`, `#cell-name`, bar := that cell's raw (`""` if blank; uncommitted text discarded); a click focuses `#grid`.
- Enter in bar: POST `{ref: selected, raw: bar}`. On 200: apply every `changed` entry to its td and the local raw store, `#status` := `""`, select the cell below (stay on row 50), focus `#grid`. Tab in bar: `preventDefault`, same commit, select the cell right (stay on Z). No page reload ever.
- Non-2xx or network failure: `#status` := response `error` (else `HTTP <code>`); selection and bar unchanged, bar keeps focus.
- Escape in bar: bar := selected raw, focus `#grid`. Double-click a td: select it, focus the bar.
- `keydown` with `key.length===1`, no ctrl/meta/alt, while `#grid` (not the bar) is focused: `preventDefault`, bar := that char, focus bar, caret at end.
- Arrow keys while the bar is not focused: `preventDefault`, move one cell, clamped to A1..Z50.

| Action | Resulting state |
|---|---|
| Page load, empty workbook | 1300 tds with empty text; A1 has `selected`; `#cell-name`=`A1`; bar value `""` |
| Bar `2`, Enter | A1 text `2.00`, class `num`, computed `text-align:right`; A2 `selected`; `#cell-name`=`A2` |
| A1: bar `=1/0`, Enter; later A1 := `7` | A1 `#DIV/0!` with class `error`, no `num`; then `7.00`, no `error` |
| Click B1 (`=A1*2`); ArrowUp; ArrowLeft x2 | `#cell-name`=`B1`, bar `=A1*2` (raw); then B1, A1, A1 selected |
| Grid focused, press `x` | bar value `x`, bar is the active element |
| POST fails 400 `{"error":"bad reference: X"}` | `#status`=`bad reference: X`; selection unchanged |
| A1 selected, type `5` in bar, Tab | A1 `5.00`; B1 `selected` |

## 12. Test harness
UI tests start `python -m minisheet serve --port <free port>` as a subprocess (waiting for the `Serving on` line) and drive it with Playwright (Python, headless Chromium).
