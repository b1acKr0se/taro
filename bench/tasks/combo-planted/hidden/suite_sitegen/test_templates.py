import pytest


def T(t, ctx=None):
    from sitegen.templates import render
    return render(t, {} if ctx is None else ctx)


def raises(t, ctx=None):
    from sitegen.errors import TemplateError
    with pytest.raises(TemplateError):
        T(t, ctx)


def test_simple_variable():
    assert T("Hello {{ name }}!", {"name": "World"}) == "Hello World!"


def test_autoescape_and_safe_filter():
    x = '<a href="u">&\''
    assert T("{{ x }}", {"x": x}) == "&lt;a href=&quot;u&quot;&gt;&amp;&#x27;"
    assert T("{{ x|safe }}", {"x": x}) == x


def test_escape_filter_not_double_escaped():
    assert T("{{ s|escape }}", {"s": "<b>"}) == "&lt;b&gt;"


def test_undefined_and_none_render_empty():
    assert T("[{{ missing }}][{{ a.b.c }}][{{ n }}]", {"a": {"b": {}}, "n": None}) == "[][][]"


def test_case_filters():
    assert T("{{ t|upper }} {{ t|lower }} {{ t|title }}", {"t": "hello woRLD"}) == (
        "HELLO WORLD hello world Hello World"
    )


def test_join_and_length_filters():
    ctx = {"tags": ["a", "b"]}
    assert T('{{ tags|join:", " }} / {{ tags|length }}', ctx) == "a, b / 2"
    assert T('{{ tags|join:" | "|safe }}', ctx) == "a | b"


def test_default_filter():
    t = '{{ nick|default:"anon" }}'
    assert T(t, {}) == "anon"
    assert T(t, {"nick": ""}) == "anon"
    assert T(t, {"nick": 0}) == "0"


def test_for_loop_with_loop_variables():
    t = "{% for t in tags %}{{ loop.index }}:{{ t }}{% if not loop.last %}, {% endif %}{% endfor %}"
    assert T(t, {"tags": ["a", "b"]}) == "1:a, 2:b"




def test_bad_if_expression_raises():
    raises("{% if n > 1 %}x{% endif %}")


def test_spec_syntax_errors_raise_template_error():
    for t in ["{{ a|bogus }}", "{{ name", "{% for x in y %}no end", "{% endif %}",
              "{% if a %}{% else %}{% else %}{% endif %}"]:
        raises(t, {"a": 1})


def test_more_invalid_templates_raise():
    for t in ["{{ }}", "{{ 1a }}", "{% unknown %}", "{% for k, v in x %}{% endfor %}",
              "{% if a %}x", "{% endfor %}", "{% else %}", "{% elif a %}",
              "{% if a %}{% else %}{% elif b %}{% endif %}",
              "{% if a %}{% for x in y %}{% endif %}{% endfor %}",
              "{{ a|upper:\"x\" }}", "{{ a|default }}", "{{ a|join }}",
              "{% endif x %}", "{% else x %}", "{{ \"lit\" }}"]:
        raises(t, {"a": 1})


def test_error_in_unexecuted_branch_still_raises():
    raises("{% if a %}x{% else %}{{ b|bogus }}{% endif %}", {"a": True})


def test_if_elif_else():
    t = "{% if a %}A{% elif b %}B{% else %}C{% endif %}"
    assert T(t, {"a": 0, "b": [1]}) == "B"
    assert T(t, {"a": 0, "b": []}) == "C"


def test_no_whitespace_trimming():
    t = "{% if x %}\nA\n{% endif %}\n"
    assert T(t, {"x": True}) == "\nA\n\n"
    assert T(t, {"x": False}) == "\n"


def test_for_over_posts_and_nothing():
    t = "{% for p in posts %}{{ p.title }}{% endfor %}|{% for p in nothing %}x{% endfor %}"
    assert T(t, {"posts": [{"title": "T1"}, {"title": "T2"}]}) == "T1T2|"


def test_empty_template_and_list_index():
    assert T("") == ""
    assert T("{{ items.0 }}-{{ items.5 }}", {"items": ["z"]}) == "z-"














def test_context_not_mutated_and_loop_var_scoped_to_body():
    ctx = {"x": "outer", "xs": [1, 2]}
    out = T("{% for x in xs %}{{ x }}{% endfor %}{{ x }}{{ loop }}", ctx)
    assert out == "12outer"
    assert ctx == {"x": "outer", "xs": [1, 2]}












