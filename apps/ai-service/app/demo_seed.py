"""Seed the in-memory store with a few Lucknow issues so the dashboard is not empty."""

from .agents import coordinator
from .agents.graph import run_triage
from .llm.gateway import LLMGateway
from .schemas import Location, PlanDecision, TriageRequest
from .store.base import Store

SEED = [
    ("Overflowing drain near Hazratganj market, dirty water on the road for 5 days",
     26.8508, 80.9465, True),
    ("नाला ओवरफ्लो हो रहा है, सड़क पर गंदा पानी भरा है", 26.8510, 80.9467, False),
    ("Drain blocked and overflowing outside the market", 26.8507, 80.9462, True),
    ("Big pothole on the main road in Aliganj sector B, two-wheelers are falling", 26.8962,
     80.9422, True),
    ("Aliganj sector B road pe bada gaddha hai", 26.8963, 80.9424, False),
    ("कूड़े का ढेर कई दिनों से नहीं उठा, बहुत बदबू है", 26.8437, 80.9312, True),
    ("Streetlight not working for 2 weeks in Gomti Nagar Vivek Khand", 26.8567, 81.0062, False),
    ("Park bench broken and the park gate is damaged", 26.8802, 80.9962, False),
]


async def seed(store: Store) -> None:
    null_gateway = LLMGateway([])  # seed deterministically, no model calls at startup
    last = None
    for i, (text, lat, lng, photo) in enumerate(SEED):
        st = await run_triage(TriageRequest(text=text, location=Location(lat=lat, lng=lng),
                                            has_photo=photo), f"seed-user-{i % 3}", store,
                              null_gateway)
        last = st.cluster
    # One issue already approved, to show the assigned state.
    if last and last.plan:
        await coordinator.decide(store, last, PlanDecision(decision="approve"), "officer:seed")
