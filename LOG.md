# Project Log

This file is the single source of truth for everything done in this project. Every session, change, and decision must be documented here with a timestamp.

---

## 2026-08-16 — Session 2: Strategy Research + Model-Diverse Jury

### Final Jury Lineup (all isolated sandboxes, unaware of each other)
- juror-1: `opencode-go/hy3` (replaced glm-5.2, which never wrote output)
- juror-2: `opencode-go/gpt-5.6-luna`
- juror-3: `opencode-go/mimo-v2.5-pro` (replaced grok-4.5 — too slow, user aborted)
- juror-4: `opencode-go/kimi-k3`
- juror-5: `opencode-go/qwen3.7-max`
- internet agent: `opencode-go/minimax-m3` (web research; wrote table format instead of pipe format; skipped Sources section — noted)
- aggregator narrative: `opencode-go/qwen3.7-plus` (7th distinct model)

### Results
- `research/strategies.md`: 190 unique strategies, 22 categories, sourced from Wikipedia, Investopedia, Zerodha Varsity (partial - rate-limited), QuantInsti, academic literature.
- All 6 rankings validated: 190/190 unique IDs, ranks 1..190, no ties.
- Aggregation is deterministic (`scripts/aggregate_rankings.py`): final rank = ascending mean rank; consensus = std of ranks; mean edge score 1-10. No model in the math.
- Bug fixed during aggregation: tuple unpacking in enumerate loop bound `sid` to rank int instead of ID (KeyError S001).
- `RANKINGS.md`: full ranked table (190) + Top-20 detailed rationale.
- Top 3: Momentum Factor (JT), PEAD/SUE, Time-Series Momentum (MOP).
- `jury/consensus.json`: per-juror ranks for every strategy.

### Goal
- Research 100+ stock analysis strategies, rank them via a jury of isolated subagents running different opencode-go models (no shared knowledge), plus one internet-research agent; final aggregation into `RANKINGS.md`.

### Decisions made (with user)
- Jury: 5 model-diverse jurors + 1 internet-research agent + deterministic aggregation.
- Juror models: glm-5.2, gpt-5.6-luna, grok-4.5, kimi-k3, qwen3.7-max. Internet agent: minimax-m3.
- Rubric: rank ALL strategies by pure expected return/edge (1-10 score), India context allowed but edge is primary.
- Output: full ranked list + top 20 detailed rationale in `RANKINGS.md`.
- Aggregation math done by deterministic script (no model in the math).

### Phase 0 done
- Verified all 6 models respond via headless `opencode run` pings (all OK).
- Created directory structure: `research/`, `jury/juror-1..5/`, `jury/internet/`, `scripts/`.

---

## 2026-08-16 — Session 1

### Project Initialization
- `git init` — initialized empty Git repository on `master` branch.
- Created `LOG.md` — this file. It will be updated with every change made to the project.

### Project Scope
- Stock analysis project, currently focused on **Indian stock exchanges** (NSE, BSE).
- Scope will expand gradually to broader topics/features over time.

### Planned Direction (no commitments yet)
- Add features one by one; nothing decided yet.

---

## Rules for This Log
1. Add a new entry for every work session or significant change.
2. Use `## YYYY-MM-DD` headings, newest at the top.
3. Document what was done, why, and any decisions made.
