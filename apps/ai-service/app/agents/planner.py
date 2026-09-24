"""Planner agent: draft an action plan, department and SLA for officer approval.

The draft is never dispatched on its own. It sits in awaiting_approval until an officer
approves, edits or rejects it (coordinator.decide).
"""

import math

from ..llm.base import LLMUnavailable
from ..llm.gateway import LLMGateway
from ..schemas import ActionPlan, Cluster
from .common import department_for, new_id, now

STEPS = {
    "waste": ["Send the ward sanitation team to clear the garbage point.",
              "Disinfect the spot and place a dustbin if none exists.",
              "Add the spot to the daily collection route."],
    "water_drainage": ["Inspect the drain / sewer line at the reported spot.",
                       "Desilt or clear the blockage with a jetting machine.",
                       "Repair any broken cover or leaking pipe; check nearby lines."],
    "roads": ["Inspect and measure the damaged stretch.",
              "Fill potholes with cold-mix as an immediate fix and barricade if deep.",
              "Schedule permanent resurfacing if the damage is larger than 5 m²."],
    "streetlights": ["Send the lighting contractor to check the pole and fixture.",
                     "Replace the lamp / fix the wiring; isolate exposed wires immediately.",
                     "Confirm the light works after dark."],
    "public_infra": ["Inspect the site and assess the damage.",
                     "Assign repair to the responsible section.",
                     "Make the area safe for the public until repaired."],
}


def priority(severity: int, report_count: int, age_hours: float = 0) -> float:
    return round(severity * (1 + math.log2(max(report_count, 1))) + min(age_hours / 24, 5), 2)


def sla_for(category: str, severity: int) -> int:
    base = department_for(category)["sla_hours"]
    # Safety risks get half the normal SLA.
    return max(12, base // 2) if severity >= 4 else base


PLAN_PROMPT = """You are drafting a work order for a municipal officer in Lucknow. Given a
civic issue, return ONLY JSON: {"steps": ["3 to 4 short, concrete imperative steps"]}.
Do not promise dates or money. The officer will review before anything is sent."""


async def draft_plan(cluster: Cluster, sample_texts: list[str],
                     gateway: LLMGateway | None) -> ActionPlan:
    dept = department_for(cluster.category)
    steps = list(STEPS[cluster.category])
    drafted_by = "rules"
    if gateway is not None and gateway.providers:
        try:
            data, provider = await gateway.chat_json([
                {"role": "system", "content": PLAN_PROMPT},
                {"role": "user", "content": f"Category: {cluster.category}. Severity "
                                            f"{cluster.severity}/5. {cluster.report_count} "
                                            f"reports. Examples: {sample_texts[:3]}"}])
            llm_steps = [str(x)[:200] for x in data.get("steps", []) if str(x).strip()]
            if 2 <= len(llm_steps) <= 6:
                steps, drafted_by = llm_steps, provider
        except LLMUnavailable:
            pass
    return ActionPlan(id=new_id(), cluster_id=cluster.id, department_id=dept["id"],
                      department_name=dept["name"], steps=steps,
                      sla_hours=sla_for(cluster.category, cluster.severity), status="draft",
                      drafted_by=drafted_by, created_at=now())
