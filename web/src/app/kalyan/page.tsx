"use client";

import Link from "next/link";
import MarketStatus from "@/components/MarketStatus";
import ThemeToggle from "@/components/ThemeToggle";

export default function KalyanPage() {
  return (
    <div className="min-h-screen bg-canvas text-paper">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-surface/80 px-4 py-3 backdrop-blur sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-paper text-[11px] font-bold tracking-widest text-ink">
            N
          </span>
          <span className="text-sm font-semibold tracking-tight text-paper">
            NIFTY <span className="font-normal text-muted">Kalyan dossier</span>
          </span>
        </Link>
        <div className="flex items-center gap-2 sm:gap-3">
          <MarketStatus />
          <ThemeToggle />
          <Link href="/" className="rounded-full border border-line bg-surface px-3 py-1.5 text-sm font-medium text-paper hover:bg-panel-2">
            ← Terminal
          </Link>
          <Link href="/screener" className="hidden rounded-full border border-line bg-surface px-3 py-1.5 text-sm font-medium text-muted hover:text-paper sm:inline-flex">
            Screener
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-[1100px] px-4 py-6 sm:px-6">
        <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm sm:p-6">
          <span className="inline-flex rounded-full bg-paper px-2.5 py-1 text-xs font-medium text-ink">
            Dossier · KALYANKJIL
          </span>
          <h1 className="mt-3 text-[28px] font-semibold leading-none tracking-tight sm:text-[36px]">
            KALYANKJIL <span className="align-middle text-xs font-medium tracking-wide text-muted">KALYAN JEWELLERS INDIA LTD</span>
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            <b className="font-medium text-paper">Kalyan Jewellers India Ltd</b> · NSE: KALYANKJIL · Retail Trade / Specialty Stores · NIFTY MIDCAP 150 · NIFTY 500 · Data: Moneycontrol primary · Yahoo (curl) · Generated 21 Aug 2026 14:30 IST
          </p>
          <p className="mt-3 inline-flex rounded-full border border-line bg-panel-2 px-3 py-1 text-xs text-muted ">8 sections · 6 charts · 831 candles · No investment advice</p>
        </div>

        {/* Snapshot */}
        <section className="mt-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold tracking-tight text-paper">01 — Executive snapshot</h2>
            <span className="rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-faint">As of 21 Aug 2026 · Close</span>
          </div>
          <div className="mt-3 rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-5">
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line bg-panel-2 text-left text-xs font-medium tracking-wide text-muted">
                    <th className="px-3 py-2">Field</th>
                    <th className="px-3 py-2">Value</th>
                    <th className="px-3 py-2">Context</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  <tr>
                    <td className="px-3 py-2 font-medium">Last price</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">₹602.25</td>
                    <td className="px-3 py-2">
                      <span className="rounded-full bg-up-soft px-2 py-0.5 text-xs font-medium text-up">+₹6.60 · +1.11%</span> <span className="text-xs text-faint">vs prev 596.00 · H 607.9 L 591.5</span>
                    </td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 font-medium">52W range</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">327.05 — 648.95</td>
                    <td className="px-3 py-2 text-sm"><span className="rounded-full bg-down-soft px-2 py-0.5 text-xs font-medium text-down">-7.2% off high</span> · +84% off low</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 font-medium">RSI (14)</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">60.03</td>
                    <td className="px-3 py-2"><span className="rounded-full border border-line bg-panel-2 px-2 py-0.5 text-xs text-muted">Neutral</span> repaired from June 330.8 trough</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 font-medium">Trend signal</td>
                    <td className="px-3 py-2 text-right"><span className="rounded-full bg-paper px-2 py-0.5 text-xs font-medium text-ink">Hold · 12 /100</span></td>
                    <td className="px-3 py-2 text-sm text-muted">SMA +20, RSI +6, MACD -13.9 — bullish structure but histogram drags</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 font-medium">Volatility</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums text-down">60.33% ann</td>
                    <td className="px-3 py-2 text-sm">ATR 21.88 (3.63%) · MaxDD -58.01% · Sharpe 3.58</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 font-medium">Volume</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">5.33M</td>
                    <td className="px-3 py-2 text-sm"><span className="rounded-full bg-down-soft px-2 py-0.5 text-xs font-medium text-down">RelVol 0.29 — thin</span> · 20d avg 18.6M</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-line bg-panel-2 p-3 ">
                <p className="text-xs font-medium tracking-wide text-faint uppercase">Structure</p>
                <p className="mt-1 text-sm font-medium">Price &gt; SMA50, SMA200 · <span className="text-up">Golden cross</span></p>
                <p className="text-xs text-muted">SMA20 602.39 · SMA50 507.37 · SMA200 447.60</p>
              </div>
              <div className="rounded-xl border border-line bg-panel-2 p-3 ">
                <p className="text-xs font-medium tracking-wide text-faint uppercase">Staleness</p>
                <p className="mt-1 text-sm font-medium">0 days · <span className="text-up">Fresh</span></p>
                <p className="text-xs text-muted">Last candle 21 Aug 2026 (Moneycontrol) · 831 bars</p>
              </div>
            </div>
          </div>
        </section>

        {/* Price action */}
        <section className="mt-8">
          <h2 className="text-sm font-semibold tracking-tight text-paper">02 — Price action</h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
              <img src="/kalyan/01_price_history_1y.png" alt="1Y price history" className="block w-full" />
              <p className="flex justify-between border-t border-line bg-panel-2 px-3 py-2 text-xs text-faint ">
                <span>01 — Price history · 1Y (831 bars)</span>
                <span>831 bars</span>
              </p>
            </div>
            <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
              <img src="/kalyan/02_moving_averages.png" alt="Moving averages" className="block w-full" />
              <p className="flex justify-between border-t border-line bg-panel-2 px-3 py-2 text-xs text-faint ">
                <span>02 — Moving averages · SMA20/50/200</span>
                <span>Alignment +20</span>
              </p>
            </div>
          </div>
          <p className="mt-3 rounded-xl border border-line bg-panel-2 p-3 text-sm leading-relaxed text-muted ">
            Price fell <b className="font-medium text-paper">-58% peak-to-trough</b> (787.9 on 02 Jan 2025 → 330.8 on 11 Jun 2026) then staged a sharp mean-reversion rally. Current 602 trades between SMA20 (602.39) and intraday high 607.9 — compression. Golden cross confirms regime shift. Support 588 / 561.25; resistance 621.8 → 648.95. BB %B 0.50 = mid-band.
          </p>
        </section>

        {/* Momentum */}
        <section className="mt-8">
          <h2 className="text-sm font-semibold tracking-tight text-paper">03 — Momentum & technicals</h2>
          <div className="mt-3 rounded-2xl border border-line bg-surface p-4 shadow-sm">
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line bg-panel-2 text-left text-xs font-medium text-muted">
                    <th className="px-3 py-2">Indicator</th>
                    <th className="px-3 py-2">Value</th>
                    <th className="px-3 py-2">Signal</th>
                    <th className="px-3 py-2">Context</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  <tr>
                    <td className="px-3 py-2">SMA 20/50/200</td>
                    <td className="px-3 py-2 font-mono tabular-nums">602.39 / 507.37 / 447.60</td>
                    <td className="px-3 py-2"><span className="rounded-full bg-up-soft px-2 py-0.5 text-xs font-medium text-up">Bull alignment</span></td>
                    <td className="px-3 py-2 text-muted">Price &gt;50/200</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2">RSI 14</td>
                    <td className="px-3 py-2 font-mono tabular-nums">60.03</td>
                    <td className="px-3 py-2 text-muted">Neutral</td>
                    <td className="px-3 py-2 text-muted">63.5 → 60.4 → 58.1 → 60.0</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2">MACD</td>
                    <td className="px-3 py-2 font-mono tabular-nums">22.99 / Sig 30.61</td>
                    <td className="px-3 py-2 text-down text-xs font-medium">Hist -7.62 Bearish cross</td>
                    <td className="px-3 py-2 text-muted">Negative but flattening</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2">Bollinger 20,2</td>
                    <td className="px-3 py-2 font-mono tabular-nums">Mid 602.39 · Up 633.71</td>
                    <td className="px-3 py-2 text-xs">%B 0.498 · BW 10.4%</td>
                    <td className="px-3 py-2 text-muted">Squeeze forming</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="mt-4 overflow-hidden rounded-xl border border-line">
              <img src="/kalyan/03_momentum_oscillators.png" alt="Momentum oscillators" className="block w-full" />
            </div>
          </div>
        </section>

        {/* Volatility */}
        <section className="mt-8">
          <h2 className="text-sm font-semibold tracking-tight text-paper">04 — Volatility & risk</h2>
          <div className="mt-3 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
              <img src="/kalyan/05_volatility_drawdown.png" alt="Volatility & drawdown" className="block w-full" />
              <p className="border-t border-line bg-panel-2 px-3 py-2 text-xs text-faint ">05 — Volatility & drawdown · -58.01% Max DD</p>
            </div>
            <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-line">
                  <tr><td className="px-2 py-2 text-muted">Ann vol (60d)</td><td className="px-2 py-2 text-right font-mono font-semibold tabular-nums text-down">60.33%</td></tr>
                  <tr><td className="px-2 py-2 text-muted">Max drawdown</td><td className="px-2 py-2 text-right font-mono tabular-nums text-down">-58.01%</td></tr>
                  <tr><td className="px-2 py-2 text-muted">Sharpe (rf 6.5%)</td><td className="px-2 py-2 text-right font-mono tabular-nums text-up">3.58</td></tr>
                  <tr><td className="px-2 py-2 text-muted">VaR 95% (1d)</td><td className="px-2 py-2 text-right font-mono tabular-nums text-down">-₹37.6 (-6.25%)</td></tr>
                </tbody>
              </table>
              <p className="mt-3 rounded-xl bg-panel-2 p-3 text-xs leading-relaxed text-muted ">VaR assumes normal — jewellery tails are fatter. Use ATR-based stops.</p>
            </div>
          </div>
        </section>

        {/* Peer */}
        <section className="mt-8">
          <h2 className="text-sm font-semibold tracking-tight text-paper">05 — Peer & sector</h2>
          <div className="mt-3 overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
            <img src="/kalyan/04_peer_comparison.png" alt="Peer comparison" className="block w-full" />
            <p className="border-t border-line bg-panel-2 px-3 py-2 text-xs text-faint ">04 — KALYAN vs TITAN vs THANGAMAYIL vs NIFTY (rebased 100)</p>
          </div>
          <div className="mt-3 overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-panel-2 text-left text-xs font-medium text-muted">
                  <th className="px-3 py-2">Peer</th>
                  <th className="px-3 py-2">1Y perf</th>
                  <th className="px-3 py-2">Read</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                <tr className="bg-up-soft/40"><td className="px-3 py-2 font-medium">Kalyan Jewellers</td><td className="px-3 py-2 font-mono tabular-nums text-up">+17.86%</td><td className="px-3 py-2 text-muted">Midcap pure-play · recovery leader since Jun</td></tr>
                <tr><td className="px-3 py-2">Titan</td><td className="px-3 py-2 font-mono tabular-nums text-up">+40.12%</td><td className="px-3 py-2 text-muted">NIFTY 50 anchor · lower vol</td></tr>
                <tr><td className="px-3 py-2">Thangamayil</td><td className="px-3 py-2 font-mono tabular-nums text-up">+159.74%</td><td className="px-3 py-2 text-muted">Small-cap torque</td></tr>
                <tr><td className="px-3 py-2">Senco</td><td className="px-3 py-2 font-mono tabular-nums text-down">-10.58%</td><td className="px-3 py-2 text-muted">Underperforming YTD</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* Forecast */}
        <section className="mt-8">
          <h2 className="text-sm font-semibold tracking-tight text-paper">06 — Forecast</h2>
          <div className="mt-3 overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
            <img src="/kalyan/06_forecast_fan.png" alt="Forecast fan" className="block w-full" />
            <p className="border-t border-line bg-panel-2 px-3 py-2 text-xs text-faint ">50% linear + 30% momentum + 20% mean-reversion · Not a prediction</p>
          </div>
          <div className="mt-3 overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-panel-2 text-left text-xs font-medium text-muted">
                  <th className="px-3 py-2">Horizon</th>
                  <th className="px-3 py-2 text-right">Bear</th>
                  <th className="px-3 py-2 text-right">Base</th>
                  <th className="px-3 py-2 text-right">Bull</th>
                  <th className="px-3 py-2 text-right">Implied</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                <tr><td className="px-3 py-2 font-medium">30 days</td><td className="px-3 py-2 text-right font-mono tabular-nums text-down">₹435.03</td><td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">₹610.51</td><td className="px-3 py-2 text-right font-mono tabular-nums text-up">₹1,000.52</td><td className="px-3 py-2 text-right font-mono tabular-nums">+1.35%</td></tr>
                <tr><td className="px-3 py-2 font-medium">90 days</td><td className="px-3 py-2 text-right font-mono tabular-nums text-down">₹406.39</td><td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">₹711.89</td><td className="px-3 py-2 text-right font-mono tabular-nums text-up">₹1,910.71</td><td className="px-3 py-2 text-right font-mono tabular-nums text-up">+18.20%</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <footer className="mt-10 flex flex-wrap justify-between gap-4 border-t border-line py-6 text-xs leading-relaxed text-muted">
          <span>Generated <b className="font-medium text-paper">21 Aug 2026 14:30 IST</b> · Data: Moneycontrol, Yahoo · Charts: matplotlib 3.8.2</span>
          <span className="text-right">NIFTY · Not investment advice</span>
        </footer>
      </main>
    </div>
  );
}
