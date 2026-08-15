#!/usr/bin/env python3
"""Aggregate 6 independent rankings (5 model-diverse jurors + internet agent) into a consensus ranking.
Math is deterministic: mean rank, rank std-dev, mean score. No model in the loop."""
import json, re, statistics
from pathlib import Path

JURY = Path("/tmp/opencode/jury")
STRAT = Path("/home/ravan/Desktop/Startup/Stock_Analysis/research/strategies.md")
OUT = Path("/home/ravan/Desktop/Startup/Stock_Analysis")

names = {}
for line in STRAT.read_text().splitlines():
    m = re.match(r"\| (S\d{3}) \| ([^|]+) \|", line)
    if m:
        names[m.group(1)] = m.group(2).strip()

sources = {
    "juror-1": "hy3",
    "juror-2": "gpt-5.6-luna",
    "juror-3": "mimo-v2.5-pro",
    "juror-4": "kimi-k3",
    "juror-5": "qwen3.7-max",
    "internet": "minimax-m3 (web research)",
}

rankings = {}
for j in sources:
    f = JURY / j / "rankings.md"
    txt = f.read_text()
    rows = []
    for line in txt.splitlines():
        m = re.match(r"\s*\|?\s*(\d+)\s*\|\s*(S\d{3})\s*\|\s*(\d+(?:\.\d+)?)\s*\|?\s*$", line)
        if m:
            rows.append((int(m.group(1)), m.group(2), float(m.group(3))))
    by_rank = {}
    for r, sid, sc in sorted(rows, key=lambda x: x[0]):
        by_rank.setdefault(r, (sid, sc))
    # validate
    ids = [sid for r, (sid, sc) in sorted(by_rank.items())]
    assert len(ids) == 190, f"{j}: {len(ids)} entries"
    assert len(set(ids)) == 190, f"{j}: duplicate IDs"
    rankings[j] = {}
    for pos, (r, (sid, sc)) in enumerate(sorted(by_rank.items(), key=lambda x: x[0]), 1):
        rankings[j][sid] = {"rank": pos, "score": sc}

all_ids = sorted(names.keys())
assert len(all_ids) == 190

rows = []
for sid in all_ids:
    rs = [rankings[j][sid]["rank"] for j in sources]
    scs = [rankings[j][sid]["score"] for j in sources]
    rows.append({
        "id": sid, "name": names[sid],
        "mean_rank": statistics.mean(rs),
        "std_rank": statistics.pstdev(rs),
        "mean_score": statistics.mean(scs),
        "best": min(rs), "worst": max(rs),
        "per": {j: rankings[j][sid]["rank"] for j in sources},
    })

rows.sort(key=lambda x: (x["mean_rank"], x["std_rank"]))
for i, r in enumerate(rows, 1):
    r["final"] = i

json.dump(rows, (JURY / "consensus.json").open("w"), indent=1)

lines = []
lines.append("# Final Strategy Ranking — Model-Diverse Jury Consensus")
lines.append("")
lines.append(f"**{len(rows)} strategies** ranked by an independent jury of **6 agents, each a different model and isolated sandbox** (unaware of each other):")
for j, m in sources.items():
    lines.append(f"- `{j}` — {m}")
lines.append("")
lines.append("Aggregation is **deterministic** (no model in the math): final rank = ascending mean rank across all 6 rankings; consensus = lower rank std-dev means higher agreement; score = mean of juror edge scores (1-10). Rubric: pure expected return/edge.")
lines.append("")
lines.append("| Final | ID | Strategy | Mean Rank | Consensus (std) | Mean Edge Score | Best | Worst |")
lines.append("|---:|---:|---|---:|---:|---:|---:|---:|")
for r in rows:
    lines.append(f"| {r['final']} | {r['id']} | {r['name']} | {r['mean_rank']:.1f} | {r['std_rank']:.1f} | {r['mean_score']:.2f} | {r['best']} | {r['worst']} |")
lines.append("")
lines.append("## Top 20 (detailed rationale below, added by aggregator)")
lines.append("")
for r in rows[:20]:
    lines.append(f"{r['final']}. **{r['name']}** ({r['id']}) — mean rank {r['mean_rank']:.1f}, consensus {r['std_rank']:.1f}, edge {r['mean_score']:.2f}")
lines.append("")
lines.append("<!-- AGGREGATOR_NARRATIVE -->")

(OUT / "RANKINGS.md").write_text("\n".join(lines))
print(f"Wrote RANKINGS.md: {len(rows)} strategies")
print("Top 10:")
for r in rows[:10]:
    print(f"  {r['final']:3d}. {r['name']} ({r['id']}) mean_rank={r['mean_rank']:.1f} std={r['std_rank']:.1f} score={r['mean_score']:.2f}")
