# ADR 0003 — fundamentals & analyst data source (TASK-66)

**Status:** accepted (interim) · **Date:** 2026-08-23 · **Agent:** NOVA
**Context:** Yahoo quoteSummary v10 — the only wired source for statement-level
fundamentals and analyst estimates — is IP-blocked **both** on local egress and
GitHub Actions runners (circuit opens after 3 consecutive failures; nightly
nifty500 sweep aborted, see pipelines run 32639305187). TASK-57's factor tables
(fundamentals, analyst_data) stay empty until a viable source exists. Strategies
affected: S081 F-Score, S099 value, S104 PEAD+revisions, S105 analyst revision,
quality composite.

## Empirical findings (probed 2026-08-23)

| candidate | result |
|---|---|
| NSE `quote-equity` API | **403 Akamai** with bootstrapped session cookie jar (the jar that works for NextApi price history) |
| NSE `NextApi GetQuoteApi getQuoteData` | **403** — the NextApi allowlist covers historical trade data / periodic years only (what TASK-30 uses), not quote/fundamental views |
| screener.in public pages | HTML tables exist but no keyless JSON; scraping is brittle against their markup churn and unfriendly ToS; rejected without a prototype |
| BSE API | same Akamai family as NSE; not probed further after NSE quote endpoints failed |

Conclusion: **no keyless source reaches statement depth** (quarterly EPS history,
balance-sheet statements, cashflow statements, analyst estimate trends). NSE's
keyless surface is deliberately limited to market data.

## Decision

1. **Keep the Yahoo path intact.** It self-heals whenever runner/local IPs are
   clean — the ingest scripts' cache-fallback + freshness windows mean zero code
   changes are needed to resume.
2. **Do not wire shallow substitutes** (NSE quote metrics: P/E, P/B, yield,
   market cap). They cannot feed S081/S099's statement logic, and a second
   half-populated schema would repeat the TASK-15/26 lineage lesson at the
   semantic layer.
3. **Recommend a paid statement-level vendor for launch**, evaluated by owner:
   Financial Modeling Prep (~$30/mo tier covers statements + estimates),
   TrueData / Global Datafeeds (India-focused, quote+corporate filings),
   Alpha Vantage premium. Selection criteria: quarterly EPS history with dates
   (S104/S105), balance-sheet + cashflow statements (S081/S099), analyst
   estimate trends (S105), NSE symbol coverage, licensing for redistribution in
   share cards.
4. Until then, factor strategies honestly return null (existing behavior); the
   signals pipeline logs coverage so empty-factor strategies are visible rather
   than silently absent.

## Consequences

- TASK-57 AC0/AC2-partial stay blocked on this decision; the runner wiring
  (getFundamentals/getAnalyst, landed 4aa5e73) means ANY conforming source is a
  drop-in: fill two tables, keep keys bare-symbol, shapes per s105.test.mjs fixtures.
- Nightly pipeline keeps attempting Yahoo first — if an IP window opens, tables
  populate automatically and factor strategies resume scoring without deploy.
