from datetime import date
from pathlib import Path

from app.pipelines.explain import fmt_inr, template_explain
from app.pipelines.extract import merge, rules_extract

NOTICES = Path(__file__).resolve().parents[3] / "data" / "sample-notices"
TODAY = date(2026, 9, 1)


def read(name):
    return (NOTICES / name).read_text("utf-8")


def test_hindi_property_tax_notice():
    f = rules_extract(read("01-lmc-property-tax-hi.txt"), TODAY)
    assert f.notice_type.value == "property_tax"
    assert f.authority.value == "Lucknow Nagar Nigam"
    assert f.amount.value == 4860
    assert f.deadline.value == "2026-10-31"
    assert f.period.value == "2026-27"
    assert "अधिभार" in f.penalty.value


def test_total_is_preferred_over_line_items():
    f = rules_extract(read("08-lmc-property-tax-arrears-hi.txt"), TODAY)
    assert f.amount.value == 6410
    assert f.deadline.value == "2026-09-30"


def test_missing_date_is_not_invented():
    f = rules_extract(read("10-lmc-property-tax-nodate-hi.txt"), TODAY)
    assert f.deadline.value is None
    exp = template_explain(f, "en")
    assert "No date" in exp.deadline


def test_english_month_formats():
    assert rules_extract(read("12-jalkal-water-en.txt"), TODAY).deadline.value == "2026-12-15"
    assert rules_extract(read("09-court-summons-en.txt"), TODAY).deadline.value == "2026-11-14"


def test_llm_disagreement_lowers_confidence():
    rules = rules_extract(read("01-lmc-property-tax-hi.txt"), TODAY)
    agreed = merge(rules, {"amount": 4860, "deadline": "2026-10-31"})
    disagreed = merge(rules, {"amount": 9999})
    assert agreed.amount.confidence > rules.amount.confidence
    assert disagreed.amount.value == 4860 and disagreed.amount.confidence <= 0.5


def test_indian_number_format():
    assert fmt_inr(4860) == "₹4,860"
    assert fmt_inr(1234567) == "₹12,34,567"
