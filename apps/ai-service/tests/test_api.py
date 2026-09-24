import io
from pathlib import Path

from PIL import Image

from .conftest import ADMIN, OFFICER

NOTICES = Path(__file__).resolve().parents[3] / "data" / "sample-notices"


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["store"] == "memory" and body["corpus_chunks"] > 10


def test_decode_text_masks_and_explains(client):
    text = (NOTICES / "01-lmc-property-tax-hi.txt").read_text("utf-8")
    r = client.post("/v1/decode", json={"text": text, "language": "en"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert "9876543210" not in d["masked_text"] and "[AADHAAR]" in d["masked_text"]
    assert d["fields"]["amount"]["value"] == 4860
    assert "₹4,860" in d["explanation"]["what_you_owe"]
    assert d["citations"] and d["citations"][0]["source_id"] == "property-tax-lucknow"
    assert d["provider"] == "rules"


def test_decode_upload_text_file(client):
    data = (NOTICES / "04-uppcl-electricity-en.txt").read_bytes()
    r = client.post("/v1/decode/upload", files={"file": ("n.txt", data, "text/plain")},
                    data={"language": "hi"})
    assert r.status_code == 200
    assert r.json()["fields"]["notice_type"]["value"] == "electricity_bill"


def test_decode_rejects_unreadable(client):
    r = client.post("/v1/decode", json={"text": "blurry", "language": "hi"})
    assert r.status_code == 422


def test_ask_cites_source(client):
    r = client.post("/v1/ask", json={"question": "birth certificate kaise banwayein?"})
    assert r.status_code == 200
    d = r.json()
    assert d["citations"][0]["source_id"] == "birth-certificate"
    assert d["language"] == "hi"
    assert "crsorgi.gov.in" in d["answer"]


def test_ask_hindi_water_connection(client):
    r = client.post("/v1/ask", json={"question": "नया पानी कनेक्शन कैसे लें?"})
    assert r.json()["citations"][0]["source_id"] == "water-connection-lucknow"


def test_ask_stream(client):
    with client.stream("POST", "/v1/ask", json={"question": "how to pay house tax online",
                                                "stream": True}) as r:
        body = "".join(r.iter_text())
    assert "event: citations" in body and "event: done" in body


def test_schemes_match(client):
    r = client.post("/v1/schemes/match", json={
        "age": 62, "gender": "female", "income_band": "below_50k", "occupation": "homemaker",
        "category": "general", "district": "Lucknow", "widowed": True, "language": "hi"})
    assert r.status_code == 200
    names = [m["id"] for m in r.json()["matches"]]
    assert "up-widow-pension" in names and r.json()["provider"] == "rules"


def test_report_lifecycle(client):
    # Two reports of the same drain a few metres apart merge into one issue.
    loc = {"lat": 26.8601, "lng": 80.9201}
    a = client.post("/v1/reports/triage", headers={"X-Demo-User": "u1"}, json={
        "text": "Drain overflowing near the temple, dirty water on the road", "location": loc,
        "has_photo": True}).json()
    b = client.post("/v1/reports/triage", headers={"X-Demo-User": "u2"}, json={
        "text": "नाली ओवरफ्लो, सड़क पर गंदा पानी", "location": {"lat": 26.86012, "lng": 80.92015}
    }).json()
    assert a["report"]["category"] == "water_drainage"
    assert b["merged"] and b["cluster"]["id"] == a["cluster"]["id"]
    assert b["cluster"]["report_count"] == 2
    cid = a["cluster"]["id"]

    # Citizens cannot see the officer queue or approve.
    assert client.get("/v1/clusters").status_code == 403
    assert client.post(f"/v1/clusters/{cid}/decision", json={"decision": "approve"}
                       ).status_code == 403

    # Officer edits then approves; every report in the cluster is assigned.
    r = client.post(f"/v1/clusters/{cid}/decision", headers=OFFICER,
                    json={"decision": "edit", "sla_hours": 24, "steps": ["Clear the drain"]})
    assert r.json()["plan"]["steps"] == ["Clear the drain"]
    r = client.post(f"/v1/clusters/{cid}/decision", headers=OFFICER, json={"decision": "approve"})
    assert r.json()["status"] == "assigned" and r.json()["plan"]["due_at"]

    rid = a["report"]["id"]
    for s in ("in_progress", "resolved"):
        assert client.post(f"/v1/clusters/{cid}/status", headers=OFFICER,
                           json={"status": s}).status_code == 200

    # Verifier: identical before/after photos look unchanged.
    buf = io.BytesIO()
    Image.new("RGB", (64, 64), "brown").save(buf, "PNG")
    img = buf.getvalue()
    v = client.post(f"/v1/reports/{rid}/verify", headers={"X-Demo-User": "u1"},
                    files={"after": ("a.png", img, "image/png"),
                           "before": ("b.png", img, "image/png")})
    assert v.json()["verdict"] == "not_fixed"

    # Another citizen cannot confirm someone else's report.
    assert client.post(f"/v1/reports/{rid}/feedback", headers={"X-Demo-User": "u2"},
                       json={"confirmed": True}).status_code == 403
    # Dispute reopens the whole issue for the officer.
    r = client.post(f"/v1/reports/{rid}/feedback", headers={"X-Demo-User": "u1"},
                    json={"confirmed": False, "rating": 2, "comment": "still overflowing"})
    assert r.json()["status"] == "reopened"
    timeline = client.get(f"/v1/reports/{rid}", headers={"X-Demo-User": "u1"}).json()["timeline"]
    statuses = [e["status"] for e in timeline]
    assert statuses[:2] == ["submitted", "triaged"] and statuses[-1] == "reopened"
    assert "assigned" in statuses and "resolved" in statuses

    an = client.get("/v1/analytics", headers=OFFICER).json()
    assert an["reopen_rate"] == 1.0 and an["satisfaction"] == 2.0


def test_far_apart_reports_do_not_merge(client):
    a = client.post("/v1/reports/triage", json={
        "text": "pothole on road", "location": {"lat": 26.80, "lng": 80.90}}).json()
    b = client.post("/v1/reports/triage", json={
        "text": "pothole on road", "location": {"lat": 26.81, "lng": 80.90}}).json()
    assert not b["merged"] and a["cluster"]["id"] != b["cluster"]["id"]


def test_high_severity_needs_photo(client):
    r = client.post("/v1/reports/triage", json={
        "text": "open manhole, a child fell in, urgent", "location": {"lat": 26.83, "lng": 80.93}
    }).json()
    assert r["report"]["severity"] == 3
    assert "photo_needed_for_high_severity" in r["report"]["flags"]


def test_admin_ingest_then_ask(client):
    doc = ("## Steps\n1. Apply for a dog licence at the Nagar Nigam veterinary office.\n"
           "2. Bring rabies vaccination proof.\n\n## Fees\nThe dog licence fee is paid yearly.")
    assert client.post("/v1/admin/ingest", json={"title": "Dog licence", "content": doc}
                       ).status_code == 403
    r = client.post("/v1/admin/ingest", headers=ADMIN,
                    json={"title": "Dog licence", "content": doc, "url": "https://lmc.up.nic.in"})
    assert r.status_code == 200 and len(r.json()["chunks"]) == 2
    ans = client.post("/v1/ask", json={"question": "How do I get a dog licence?"}).json()
    assert ans["citations"][0]["source_id"] == "dog-licence"
