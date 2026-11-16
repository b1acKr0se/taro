import pytest

DOCS = [
    {"slug": "b", "title": "Beta", "text": "the beta and alpha"},
    {"slug": "a", "title": "Alpha", "text": "alpha alpha"},
]


def idx(docs=None):
    from sitegen.search import build_index
    return build_index(DOCS if docs is None else docs)




def test_tokenize_examples():
    from sitegen.search import tokenize
    assert tokenize("The Cat & the HAT, x2!") == ["cat", "hat", "x2"]
    assert tokenize("café") == ["caf"]
    assert tokenize("go go x") == ["go", "go", "x"]


def test_build_index_example_and_ordering():
    index = idx()
    expected = {"docs": {"a": {"title": "Alpha", "length": 3}, "b": {"title": "Beta", "length": 3}},
                "terms": {"alpha": {"a": 3, "b": 1}, "beta": {"b": 2}}}
    assert index == expected
    assert list(index["docs"]) == ["a", "b"]
    assert list(index["terms"]) == ["alpha", "beta"]
    assert list(index["terms"]["alpha"]) == ["a", "b"]


def test_build_index_empty():
    assert idx([]) == {"docs": {}, "terms": {}}


def test_build_index_invalid_docs_raise_value_error():
    from sitegen.search import build_index
    with pytest.raises(ValueError):
        build_index([{"slug": "a", "title": "t", "text": "x"},
                     {"slug": "a", "title": "u", "text": "y"}])
    with pytest.raises(ValueError):
        build_index([{"slug": "a", "title": "t"}])


def test_search_basic_and_case_insensitive_with_limit():
    from sitegen.search import search
    index = idx()
    assert search(index, "alpha") == ["a", "b"]
    assert search(index, "ALPHA", limit=1) == ["a"]


def test_search_requires_all_terms():
    from sitegen.search import search
    assert search(idx(), "alpha beta") == ["b"]


def test_search_duplicate_query_terms_count_once():
    from sitegen.search import search
    assert search(idx(), "alpha alpha") == ["a", "b"]


def test_search_no_results_cases():
    from sitegen.search import search
    index = idx()
    assert search(index, "the of") == []
    assert search(index, "zzz") == []
    assert search(index, "") == []
    assert search(index, "alpha zzz") == []


def test_search_ties_sorted_by_slug():
    from sitegen.search import search
    index = idx([{"slug": "z", "title": "foo", "text": ""},
                 {"slug": "m", "title": "foo", "text": ""}])
    assert search(index, "foo") == ["m", "z"]


