import json


def _ct(headers):
    return headers.get("Content-Type", "").lower().replace(" ", "")


def test_example1_post_number(api):
    status, body = api.post_cell("A1", "2")
    assert status == 200
    assert body == {"changed": {"A1": {"raw": "2", "value": 2.0, "display": "2.00"}}}


def test_example2_dependents_in_changed_and_lowercase_ref(api):
    api.post_cell("A1", "2")
    status, body = api.post_cell("b1", "=A1*2")
    assert status == 200
    assert body == {"changed": {"B1": {"raw": "=A1*2", "value": 4.0, "display": "4.00"}}}
    status, body = api.post_cell("A1", "5")
    assert status == 200
    assert body == {"changed": {
        "A1": {"raw": "5", "value": 5.0, "display": "5.00"},
        "B1": {"raw": "=A1*2", "value": 10.0, "display": "10.00"},
    }}


def test_example3_error_and_boolean_cells(api):
    _, body = api.post_cell("C1", "=1/0")
    assert body["changed"]["C1"] == {
        "raw": "=1/0", "value": {"error": "#DIV/0!"}, "display": "#DIV/0!"}
    _, body = api.post_cell("C2", "TRUE")
    assert body["changed"]["C2"] == {"raw": "TRUE", "value": True, "display": "TRUE"}


def test_bad_reference_is_400_and_state_unchanged(api):
    status, body = api.post_cell("AAA1", "1")
    assert status == 400
    assert body == {"error": "bad reference: AAA1"}
    assert api.get_json("/api/cells") == (200, {"cells": {}})


def test_non_json_and_non_object_bodies_are_invalid_json(api):
    status, _, data = api.request("POST", "/api/cells", b"not json")
    assert status == 400
    assert json.loads(data) == {"error": "invalid JSON"}
    status, _, data = api.request("POST", "/api/cells", b"[1]")
    assert status == 400
    assert json.loads(data) == {"error": "invalid JSON"}


def test_missing_or_non_string_ref_raw_is_400(api):
    for obj in [{"ref": "A1"}, {"raw": "1"}, {"ref": "A1", "raw": 5}, {"ref": 1, "raw": "1"}]:
        status, body = api.post_json("/api/cells", obj)
        assert status == 400, obj
        assert body == {"error": "ref and raw must be strings"}, obj


def test_get_cells_and_get_csv(api):
    api.post_cell("A1", "1")
    api.post_cell("B1", "=A1/4")
    status, body = api.get_json("/api/cells")
    assert status == 200
    assert body == {"cells": {
        "A1": {"raw": "1", "value": 1.0, "display": "1.00"},
        "B1": {"raw": "=A1/4", "value": 0.25, "display": "0.25"},
    }}
    status, headers, data = api.request("GET", "/api/csv")
    assert status == 200
    assert _ct(headers) == "text/csv;charset=utf-8"
    assert data.decode("utf-8") == "1,0.25\n"


def test_post_csv_replaces_workbook_and_bad_csv_is_400(api):
    api.post_cell("C5", "1")
    status, _, data = api.request("POST", "/api/csv", b"a,2\n=B1*2\n")
    assert status == 200
    assert json.loads(data) == {"cells": {
        "A1": {"raw": "a", "value": "a", "display": "a"},
        "B1": {"raw": "2", "value": 2.0, "display": "2.00"},
        "A2": {"raw": "=B1*2", "value": 4.0, "display": "4.00"},
    }}
    status, _, data = api.request("POST", "/api/csv", b"\xff\xfe\x00")
    assert status == 400
    assert json.loads(data) == {"error": "invalid CSV"}
    assert "A1" in api.get_json("/api/cells")[1]["cells"]
