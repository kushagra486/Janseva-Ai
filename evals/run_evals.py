"""Evaluate the AI pipelines and print the numbers for the README and pitch slide.

    python evals/run_evals.py            # uses whatever LLM_PROVIDERS is set to
    LLM_PROVIDERS= python evals/run_evals.py   # rules-only baseline (what CI runs)

Measures: notice field accuracy (exact match on type, authority, amount, deadline),
retrieval hit rate and answer grounding on the Q&A set, duplicate-detection precision and
recall, and decode latency. Writes evals/results/latest.json.
"""

import asyncio
import json
import sys
import time
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "ai-service"))

from app.agents import cluster as cluster_agent  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.llm.embeddings import try_embed  # noqa: E402
from app.rag.reranker import rerank  # noqa: E402
from app.rag.retriever import get_retriever  # noqa: E402
from app.routers.ask import ask  # noqa: E402
from app.routers.decode import decode_text  # noqa: E402
from app.schemas import AskRequest, Cluster, Location  # noqa: E402
from app.store.memory import MemoryStore  # noqa: E402

HERE = Path(__file__).parent
FIELDS = ["notice_type", "authority", "amount", "deadline"]


def load(name):
    return [json.loads(line) for line in (HERE / name).read_text("utf-8").splitlines() if line]


async def eval_notices():
    rows = load("notices_golden.jsonl")
    correct = {f: 0 for f in FIELDS}
    latencies, failures = [], []
    for row in rows:
        text = (ROOT / "data" / "sample-notices" / row["file"]).read_text("utf-8")
        t0 = time.perf_counter()
        res = await decode_text(text, "en", 1.0)
        latencies.append(time.perf_counter() - t0)
        for f in FIELDS:
            got = getattr(res.fields, f).value
            want = row[f]
            ok = (got is None and want is None) or (
                want is not None and got is not None and
                (abs(float(got) - want) < 1 if f == "amount" else got == want))
            correct[f] += ok
            if not ok:
                failures.append({"file": row["file"], "field": f, "want": want, "got": got})
    n = len(rows)
    per_field = {f: round(correct[f] / n, 3) for f in FIELDS}
    return {"n": n, "per_field": per_field,
            "overall": round(sum(correct.values()) / (n * len(FIELDS)), 3),
            "latency_p50_s": round(sorted(latencies)[n // 2], 3),
            "latency_max_s": round(max(latencies), 3), "failures": failures}


async def eval_rag():
    rows = load("rag_qa.jsonl")
    hit1 = hit3 = grounded = cited = 0
    misses = []
    for row in rows:
        hits = rerank(await get_retriever().search(row["q"], k=8), max_sources=3)
        ids = [h.chunk.source.id for h in hits]
        hit1 += bool(ids) and ids[0] == row["source"]
        hit3 += row["source"] in ids
        ans = await ask(AskRequest(question=row["q"]), user=None)
        cited += bool(ans.citations)
        grounded += row["must"].lower() in ans.answer.lower()
        if not ids or ids[0] != row["source"]:
            misses.append({"q": row["q"], "want": row["source"], "got": ids[:3]})
    n = len(rows)
    return {"n": n, "top1": round(hit1 / n, 3), "top3": round(hit3 / n, 3),
            "answer_contains_fact": round(grounded / n, 3), "cited": round(cited / n, 3),
            "misses": misses}


async def eval_duplicates():
    rows = load("duplicates.jsonl")
    tp = fp = fn = tn = 0
    for row in rows:
        store = MemoryStore()
        base = Location(lat=26.85, lng=80.95)
        va = (await try_embed([row["a"]]) or [None])[0]
        now = __import__("datetime").datetime.now(__import__("datetime").timezone.utc)
        await store.add_cluster(Cluster(
            id="c1", category=row["category"], title=row["a"], centroid=base, ward=None,
            report_count=1, severity=2, priority=2, status="awaiting_approval",
            created_at=now, updated_at=now), va)
        dlat = row["meters"] / 111_320  # metres north
        vb = (await try_embed([row["b"]]) or [None])[0]
        match, _, _ = await cluster_agent.find_match(store, base.lat + dlat, base.lng,
                                                     row["category"], vb)
        pred = match is not None
        tp += pred and row["dup"]
        fp += pred and not row["dup"]
        fn += (not pred) and row["dup"]
        tn += (not pred) and not row["dup"]
    precision = tp / (tp + fp) if tp + fp else 1.0
    recall = tp / (tp + fn) if tp + fn else 1.0
    return {"n": len(rows), "precision": round(precision, 3), "recall": round(recall, 3),
            "tp": tp, "fp": fp, "fn": fn, "tn": tn}


async def main():
    s = get_settings()
    await get_retriever().load_dir(s.data_dir / "services")
    results = {
        "date": date.today().isoformat(),
        "providers": s.providers or ["rules-only"],
        "embed_provider": s.embed_provider,
        "notices": await eval_notices(),
        "rag": await eval_rag(),
        "duplicates": await eval_duplicates(),
    }
    out = HERE / "results"
    out.mkdir(exist_ok=True)
    (out / "latest.json").write_text(json.dumps(results, indent=2, ensure_ascii=False))
    n, r, d = results["notices"], results["rag"], results["duplicates"]
    print(f"Providers: {', '.join(results['providers'])} · embeddings: {s.embed_provider}")
    print(f"Notice fields ({n['n']} notices): overall {n['overall']:.0%} · "
          + " · ".join(f"{k} {v:.0%}" for k, v in n["per_field"].items())
          + f" · p50 {n['latency_p50_s']}s")
    print(f"Q&A retrieval ({r['n']} questions): top-1 {r['top1']:.0%} · top-3 {r['top3']:.0%} · "
          f"answer has key fact {r['answer_contains_fact']:.0%} · cited {r['cited']:.0%}")
    print(f"Duplicates ({d['n']} pairs): precision {d['precision']:.0%} · recall {d['recall']:.0%}")
    for f in n["failures"]:
        print("  notice miss:", f)
    for m in r["misses"]:
        print("  retrieval miss:", m)
    # CI gate: fail if we regress below the blueprint targets.
    ok = n["overall"] >= 0.9 and r["cited"] == 1.0 and d["precision"] >= 0.8
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    asyncio.run(main())
