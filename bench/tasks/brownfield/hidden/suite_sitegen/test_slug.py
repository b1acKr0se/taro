def test_slugify_examples():
    from sitegen.slug import slugify
    assert slugify("Hello, World!") == "hello-world"
    assert slugify("  Multiple   Spaces  ") == "multiple-spaces"
    assert slugify("C++ & Rust") == "c-rust"
    assert slugify("Don't Stop") == "don-t-stop"
    assert slugify("snake_case v1.2.3") == "snake-case-v1-2-3"


def test_slugify_accents_dropped():
    from sitegen.slug import slugify
    assert slugify("Café Münster") == "cafe-munster"


def test_slugify_can_return_empty():
    from sitegen.slug import slugify
    assert slugify("---") == ""
    assert slugify("") == ""
    assert slugify("日本語") == ""


def test_unique_slug_collisions():
    from sitegen.slug import unique_slug
    assert unique_slug("Hello", set()) == "hello"
    assert unique_slug("Hello", {"hello"}) == "hello-2"
    assert unique_slug("Hello", {"hello", "hello-2"}) == "hello-3"
    assert unique_slug("Hello 2", {"hello-2"}) == "hello-2-2"


def test_unique_slug_untitled_and_no_mutation():
    from sitegen.slug import unique_slug
    assert unique_slug("!!!", set()) == "untitled"
    assert unique_slug("!!!", {"untitled"}) == "untitled-2"
    taken = {"hello"}
    unique_slug("Hello", taken)
    assert taken == {"hello"}
