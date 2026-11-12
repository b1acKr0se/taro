import re
from collections import Counter

STOPWORDS = frozenset(
    "a an and are as at be by for from in is it of on or that the to with".split()
)


def tokenize(s: str) -> list[str]:
    return [t for t in re.findall(r"[a-z0-9]+", s.lower()) if t not in STOPWORDS]


def build_index(docs: list[dict]) -> dict:
    seen: set[str] = set()
    per_doc: dict[str, tuple[str, Counter, int]] = {}
    for d in docs:
        for key in ("slug", "title", "text"):
            if key not in d:
                raise ValueError(f"doc is missing {key!r}")
        slug = d["slug"]
        if slug in seen:
            raise ValueError(f"duplicate slug: {slug!r}")
        seen.add(slug)
        tokens = tokenize(d["title"]) + tokenize(d["text"])
        per_doc[slug] = (d["title"], Counter(tokens), len(tokens))
    terms: dict[str, dict[str, int]] = {}
    for slug in sorted(per_doc):
        for term, tf in per_doc[slug][1].items():
            terms.setdefault(term, {})[slug] = tf
    return {
        "docs": {
            slug: {"title": per_doc[slug][0], "length": per_doc[slug][2]}
            for slug in sorted(per_doc)
        },
        "terms": {t: dict(sorted(terms[t].items())) for t in sorted(terms)},
    }


def search(index: dict, query: str, limit: int = 10) -> list[str]:
    terms = list(dict.fromkeys(tokenize(query)))
    if not terms or limit <= 0:
        return []
    postings = index.get("terms", {})
    candidates = None
    for t in terms:
        p = postings.get(t)
        if not p:
            return []
        candidates = set(p) if candidates is None else candidates & set(p)
    scored = [(-sum(postings[t][s] for t in terms), s) for s in candidates]
    scored.sort()
    return [s for _, s in scored[:limit]]
