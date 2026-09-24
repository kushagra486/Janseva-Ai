from app.privacy.pii_mask import mask_pii


def test_masks_aadhaar_phone_pan_email():
    text = "आधार 2345 6789 0123, mobile +91 98765 43210, PAN ABCDE1234F, a@b.in"
    out, counts = mask_pii(text)
    assert "2345" not in out and "98765" not in out and "ABCDE1234F" not in out
    assert counts == {"AADHAAR": 1, "PHONE": 1, "PAN": 1, "EMAIL": 1}


def test_devanagari_digits_are_masked():
    out, counts = mask_pii("फ़ोन ९८७६५४३२१०")
    assert counts.get("PHONE") == 1 and "[PHONE]" in out


def test_amounts_and_dates_survive():
    out, _ = mask_pii("₹4,860 by 31/10/2026, property 123/45")
    assert "4,860" in out and "31/10/2026" in out and "123/45" in out
