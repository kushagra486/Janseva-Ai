from app.pipelines.schemes import match
from app.routers.schemes import schemes
from app.schemas import SchemeAnswers


def ids(results):
    return {r.scheme["id"] for r in results}


def test_sunita_widow_62():
    a = SchemeAnswers(age=62, gender="female", income_band="below_50k", occupation="homemaker",
                      category="obc", district="Lucknow", widowed=True, language="en")
    got = ids(match(schemes(), a))
    assert {"up-old-age-pension", "up-widow-pension"} <= got
    assert "pm-kisan" not in got and "atal-pension" not in got


def test_men_never_get_women_only_schemes():
    a = SchemeAnswers(age=62, gender="male", income_band="below_50k", occupation="retired",
                      category="general", district="Lucknow", widowed=True)
    got = ids(match(schemes(), a))
    assert "up-widow-pension" not in got and "pm-ujjwala" not in got


def test_income_band_crossing_limit_needs_check():
    a = SchemeAnswers(age=65, gender="male", income_band="50k_1l", occupation="retired",
                      category="general", district="Lucknow")
    res = {r.scheme["id"]: r for r in match(schemes(), a)}
    assert res["up-old-age-pension"].status == "needs_check"


def test_income_above_limit_excluded():
    a = SchemeAnswers(age=65, gender="male", income_band="1l_2_5l", occupation="retired",
                      category="general", district="Lucknow")
    assert "up-old-age-pension" not in ids(match(schemes(), a))


def test_ramesh_street_vendor():
    a = SchemeAnswers(age=48, gender="male", income_band="1l_2_5l", occupation="street_vendor",
                      category="obc", district="Lucknow")
    got = ids(match(schemes(), a))
    assert "pm-svanidhi" in got and "e-shram" in got
