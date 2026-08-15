# Stock Analysis Strategies — Master List

**190 unique strategies** compiled from Wikipedia, Investopedia, Zerodha Varsity, QuantInsti, NSE Academy, and academic literature (Fama-French, Jegadeesh-Titman, Sloan, Novy-Marx, Gatev, Antonacci, Moskowitz et al.).

Each entry: **ID | Name | Core idea | Key signals/inputs | Edge source**.

## Category Overview

| Category | Count |
|---|---|
| Trend & Momentum | 17 |
| Oscillators | 10 |
| Volatility | 6 |
| Volume | 8 |
| Chart Patterns | 11 |
| Candlestick | 11 |
| Price Action | 12 |
| Momentum & Trend | 4 |
| Mean Reversion & Stat Arb | 7 |
| Calendar & Seasonal | 8 |
| Value | 10 |
| Growth | 5 |
| Quality | 7 |
| Factor Anomalies | 9 |
| Special Situations | 1 |
| Event-Driven | 15 |
| Sentiment & Behavioral | 8 |
| India-Specific | 9 |
| Options | 14 |
| Market Microstructure | 4 |
| ML & Quant | 8 |
| Macro & Top-Down | 6 |

---

## Trend & Momentum

| ID | Name | Core Idea | Key Signals | Edge Source |
|---|---|---|---|---|
| S001 | Moving Average Trend Filter | Stay long above a long-period MA (e.g., 200-day) and short/flat below it | Price vs 50/100/200 SMA or EMA | Trend persistence and herding |
| S002 | EMA Crossover (Fast/Slow) | Enter on fast EMA crossing above slow EMA and exit on reverse cross | 9/21, 20/50 EMA pairs | Smoothing lag tradeoff; trend confirmation |
| S003 | Golden Cross / Death Cross | Long-term bullish signal when 50-day MA crosses above 200-day MA (bearish on reverse) | 50 & 200 SMA cross | Long-cycle trend regime shifts |
| S004 | MACD Crossover | Trade MACD line crossing signal line in direction of histogram momentum | 12/26/9 MACD, histogram, zero line | Trend + momentum confirmation |
| S005 | MACD/RSI Divergence | Trade reversals when price makes a new extreme but the indicator makes an opposite one | MACD or RSI vs price extremes | Weakening momentum precedes reversal |
| S006 | ADX Trend Strength | Only take trend trades when ADX > 20-25 confirms a genuine trend | +DI/-DI crossover, ADX level | Filters chop and false breakouts |
| S007 | Supertrend | Trail stops along an ATR-based line; long above it, short below | ATR(10), multiplier 2-3 | ATR-adaptive trailing stops |
| S008 | Ichimoku Kinko Hyo | Buy when price is above the cloud and Tenkan crosses Kijun; cloud is S/R | Tenkan, Kijun, Senkou A/B, Chikou | Multi-timeframe trend confluence |
| S009 | Parabolic SAR | Trail stop dots below/above price; flip position when dots flip sides | SAR acceleration factor, price | Disciplined trailing exits in trends |
| S010 | Donchian Channel Breakout (Turtle) | Buy 20-day high breakout, exit on 10-day low, riding long trends | 20/55-day channel highs/lows | Breakout momentum + trend following |
| S012 | Vortex Indicator | Long when VI+ crosses above VI- after both coil together | VI+/VI- lines | Detects trend birth from ranges |
| S013 | TRIX | Trade sign changes of triple-smoothed EMA rate of change | TRIX vs signal line, zero cross | Removes whipsaw noise from EMAs |
| S014 | Elder Ray | Long when Bull Power (high-EMA) positive and rising; Bear Power negative shows selling | 13 EMA, bull/bear power | Trend force vs countertrend strength |
| S015 | Heikin-Ashi Trend Riding | Stay long while HA candles stay green with no lower wicks; exit on reversal candle | HA open/close smoothing | Noise-filtered trend signals |
| S016 | Renko Chart Trading | Trade brick-color changes; size bricks by fixed % or ATR | Brick size, direction flip | Filters time noise, pure price movement |
| S017 | Point & Figure | Trade X/O column breakouts and P&F trendlines | Box size, 3-box reversal | Objective supply/demand levels |
| S018 | Aroon Indicator | Long when Aroon Up > Aroon Down near 100; detects trend birth | Aroon Up/Down (25) | Timing of new trend emergence |

## Oscillators

| ID | Name | Core Idea | Key Signals | Edge Source |
|---|---|---|---|---|
| S021 | RSI Overbought/Oversold | Buy RSI(14) < 30 and sell > 70, ideally aligned with trend | RSI 30/70, centerline 50 | Mean reversion at extremes |
| S022 | Stochastic Oscillator | Buy when %K crosses %D in oversold zone (<20); sell in overbought (>80) | %K(14,3), %D, 20/80 zones | Close-position momentum reversion |
| S023 | Commodity Channel Index (CCI) | Long from below -100, short from above +100 | CCI(20), +/-100/+/-200 levels | Statistical deviation extremes |
| S024 | Williams %R | Fade extremes: buy below -80, sell above -20 | %R(14), -20/-80 levels | Overbought/oversold mean reversion |
| S025 | Money Flow Index (MFI) | Buy MFI < 20 (oversold with volume), sell > 80; divergences warn | Price x volume flow, 20/80 | Volume-weighted oscillator |
| S026 | Rate of Change (ROC) | Trade ROC crossovers of the zero line | ROC(12), zero line | Momentum acceleration/deceleration |
| S027 | Momentum Oscillator | Trade above/below the 100 line and divergences from price | 10-14 period momentum, 100 line | Simple price-velocity measure |
| S028 | StochRSI | Buy when StochRSI exits oversold (<20) and crosses above 0.8 | RSI(14) fed into Stochastic | Refines RSI turning points |
| S029 | Ultimate Oscillator | Buy bullish divergences across 3 timeframes when below 30 | 7/14/28 weighted sum, 30/70 | Multi-timeframe momentum |
| S030 | Coppock Curve | Long-term buy signal when curve turns up from below zero | Monthly ROC sums (11/14) | Deep-market bottom timing (Nifty) |

## Volatility

| ID | Name | Core Idea | Key Signals | Edge Source |
|---|---|---|---|---|
| S011 | Keltner Channel | Trade price touches of ATR-based bands around an EMA | 20 EMA +/- 2x ATR | Volatility-normalized band edges |
| S019 | Linear Regression Channel | Mean-revert within the regression band or trade its breakout | Linear regression +/- 1-2 SD | Statistically defined fair-value band |
| S031 | Bollinger Bands Mean Reversion | Buy lower band touches in ranges, sell upper band, exit at middle band | 20 SMA +/- 2 SD, %B, bandwidth | Volatility-based overshoot |
| S032 | Bollinger Squeeze Breakout | Enter direction of breakout when bandwidth contracts then expands | Bandwidth percentile, band tag | Volatility cycle expansion |
| S033 | ATR-Based Stops/Sizing | Size positions and stop-losses in ATR multiples to equalize risk | ATR(14), 1-3x multiple | Normalized risk per trade |
| S034 | Keltner-Bollinger Squeeze | Trade breakout when BB goes inside Keltner channel then expands out | BB(20,2) vs KC(20,2ATR) | Volatility compression leads expansion |

## Volume

| ID | Name | Core Idea | Key Signals | Edge Source |
|---|---|---|---|---|
| S036 | On-Balance Volume (OBV) | Trade OBV trend breaks/divergences as confirmation of price moves | Cumulative volume sign, OBV trendlines | Volume precedes price |
| S037 | Volume Profile / POC Trading | Trade bounces off Point of Control and high-volume nodes; breakouts of low-volume zones | POC, HVN/LVN, VAH/VAL | Supply/demand by volume at price |
| S038 | VWAP Reversion | Intraday mean-revert or trend-trade around volume-weighted average price | VWAP +/- 1-2 std bands | Institutional fair-value anchor |
| S039 | Accumulation/Distribution (Chaikin) | Trade divergences between the A/D line and price | Close location value (CLV), A/D trend | Smart-money flow divergence |
| S040 | Chaikin Money Flow | Buy CMF above zero with price breaks; sell negative CMF | CMF(20/21), zero line | Net buying/selling pressure flow |
| S041 | Force Index | Trade direction changes of force = price change x volume | FI(13), zero cross, divergences | Volume-backed momentum |
| S042 | Volume Climax / Spikes | Fade exhaustion volume climaxes at trend extremes | 2-3x average volume bars, range | Capitulation marks reversals |
| S043 | Delivery-Based Volume | Buy breakouts backed by rising NSE delivery % | Delivery %, deliverable quantity | Real (non-speculative) accumulation |

## Chart Patterns

| ID | Name | Core Idea | Key Signals | Edge Source |
|---|---|---|---|---|
| S044 | Head & Shoulders | Short/exit on neckline break of H&S top; inverse H&S signals bottom | 3 peaks, neckline, volume | Distribution phase completion |
| S045 | Double Top / Double Bottom | Trade rejection of a level twice, entering on neckline break | Twin highs/lows, neckline, RSI | Failed retest = supply/demand flip |
| S046 | Triple Top / Triple Bottom | Trade third failed test of a level with neckline break confirmation | 3 tests, neckline volume | Stronger accumulation/distribution |
| S047 | Triangle Breakout (Asc/Desc/Sym) | Trade breakout direction of converging trendlines; target = pattern height | Trendlines, breakout volume | Compression release with consensus |
| S048 | Flag & Pennant | Trade continuation break in flagpole direction after consolidation | Flagpole, parallel/converging lines, volume drop | Pause-then-resume trend dynamics |
| S049 | Cup & Handle | Buy breakout above handle after U-shaped base on volume surge | Cup depth, handle retrace 30-50% | Institutional base accumulation |
| S050 | Rising/Falling Wedge | Rising wedge = bearish reversal; falling wedge = bullish reversal | Converging slanted lines, divergences | Exhaustion of trend slope |
| S051 | Price Channel Trading | Buy lower channel line in uptrend, sell upper in downtrend; trade channel breaks | Parallel trendlines | Mean reversion inside trend |
| S052 | Harmonic Patterns (Gartley/Bat/Crab) | Enter at D point of Fibonacci-retracement patterns with defined targets | XABCD ratios (0.618, 0.786, 1.27, 1.618) | Fib-geometry confluence zones |
| S053 | Rounding Bottom / Saucer | Accumulate as a slow U-base forms; breakout confirms | Curved base, volume pattern | Slow institutional accumulation |
| S054 | Island Reversal / Gap Patterns | Trade reversal when gap + cluster + gap isolate an extreme | Breakaway/runaway/exhaustion gaps | One-sided emotion snap-back |

## Candlestick

| ID | Name | Core Idea | Key Signals | Edge Source |
|---|---|---|---|---|
| S055 | Doji Reversal | Doji at trend extreme signals indecision; confirm with next candle | Doji, dragonfly/gravestone variants | Indecision = momentum stall |
| S056 | Bullish/Bearish Engulfing | Second candle body engulfs the first, reversing short-term momentum | Candle bodies, trend context | Absorption of prior move |
| S057 | Hammer & Hanging Man | Hammer after decline = bullish; hanging man after rally = bearish | Long lower shadow, small body | Selling rejection by buyers |
| S058 | Harami / Harami Cross | Small body inside prior large candle flags trend exhaustion | Inner candle containment, doji cross | Momentum stall after thrust |
| S059 | Morning / Evening Star | 3-candle reversal: thrust, star gap, opposite close into body | Star position, 3rd candle close | Gap-then-fail = reversal |
| S060 | Three White Soldiers / Black Crows | Three consecutive large same-direction bodies confirm reversal/continuation | 3 large bodies closing at extremes | Sustained shift in control |
| S061 | Marubozu Continuation | Full-body candle with no wicks shows one-sided control; trade direction | Open=low/close=high (or inverse) | Strong single-session conviction |
| S062 | Shooting Star / Inverted Hammer | Shooting star after rally = bearish; inverted hammer after fall = bullish | Long upper shadow, small body | Rejection of highs/lows |
| S063 | Tweezer Tops/Bottoms | Matching extreme shadows at a level signal reversal, esp. with other patterns | Equal highs/lows of 2+ candles | Double rejection of a level |
| S064 | Dark Cloud Cover / Piercing Line | 2-candle reversals closing past the midpoint of the prior body | Open gap + 50%+ penetration | Counter-thrust overwhelms |
| S065 | Rising/Falling Window (Gap Candles) | Windows act as support/resistance until filled | Gap between candle bodies | Gap zones as order magnets |

## Price Action

| ID | Name | Core Idea | Key Signals | Edge Source |
|---|---|---|---|---|
| S020 | Darvas Box | Buy when price breaks above a consolidation box top on rising volume | Box tops, volume surge, 52-wk highs | Momentum + box breakout |
| S035 | NR7/NR4 Volatility Breakout | Trade breakout of the narrowest range day of last 7/4 days in expansion direction | Day range ranking, breakout level | Compression-to-expansion tendency |
| S066 | Range Breakout Trading | Buy/sell break of an established consolidation range with volume confirmation | Range high/low, volume, retest | Trapped traders fuel the move |
| S067 | Support/Resistance Flip | Trade bounces at S/R; after a break, the old level flips roles | Horizontal S/R, wick tests | Anchoring and order clustering |
| S068 | Open Range Breakout (ORB) | Trade breakout of first 15-60 min high/low with stop at the opposite end | Opening range, volume, VWAP | Opening auction imbalance |
| S069 | Gap Trading (Gap & Go / Fill) | Trade gap continuation with trend, or fade to fill common gaps | Gap %, gap type, pre-open move | Overnight information shock |
| S070 | Trendline Trading | Buy pullbacks to rising trendline, sell rallies to falling one; break = reversal | 3+ touch trendlines, angle | Trend structure memory |
| S071 | Fibonacci Retracement | Enter at 38.2/50/61.8% pullbacks in direction of the trend | Fib levels from swing H/L | Self-fulfilling retracement levels |
| S072 | Pullback/Retest Entry | Enter on first retest of a broken level/EMA instead of chasing the breakout | Retest candle confirmation, volume | Second-chance entries with lower risk |
| S073 | Inside Bar Breakout | Trade breakout of the mother bar after inside-bar compression | Inside bar, mother bar range | Compression precedes expansion |
| S074 | 52-Week High Breakout | Buy stocks making 52-week highs/ATHs on high volume | ATH/52-wk high, volume | No overhead supply = free upside |
| S075 | Central Pivot Range (CPR) | Trade above/below the prior day's CPR with volume (popular in Indian markets) | TC, P, BC from prior day HLC | Day-frame fair-value anchor |

## Momentum & Trend

| ID | Name | Core Idea | Key Signals | Edge Source |
|---|---|---|---|---|
| S172 | Dual Momentum (Antonacci) | Rotate between domestic/international equity and safe asset using absolute + relative momentum | 12m absolute return vs T-bills; relative strength ranking | Absolute + relative momentum persistence |
| S173 | Relative Strength vs Benchmark | Overweight strongest recent performers vs index, underweight laggards | Rolling 6-12m relative return vs NIFTY | Cross-sectional momentum premium |
| S174 | Time-Series Momentum (MOP) | Long assets with positive own-past returns, short negatives (12m, skip last month) | T-12 to T-1 return sign; cross-asset | Time-series persistence across 58 markets (2012) |
| S175 | Rotational Momentum (Sector/Index) | Hold top-k performing sectors/indices each period, rotate out of weakest | Monthly rank across NSE sector indices | Cross-sectional momentum in liquid universe |

## Mean Reversion & Stat Arb

| ID | Name | Core Idea | Key Signals | Edge Source |
|---|---|---|---|---|
| S176 | Pairs Trading (Distance Method) | Long underperformer, short outperformer of co-moving pair when gap > threshold | 12m correlation; normalized spread > 2 SD entry | Temporary mispricing of linked pairs (Gatev 2006) |
| S177 | Cointegration Pairs Trading | Trade OLS residual of cointegrated stocks via z-score bands | ADF test; hedge ratio; z-score +/-1.5-2 | Long-run equilibrium (validated on NSE large caps) |
| S178 | RSI(2) Reversion | Buy when 2-period RSI < 10, sell when > 90 on indices/ETFs | RSI(2) extremes; NIFTY or index ETFs | Short-term oversold bounce; overreaction reversal |
| S179 | Z-Score Reversion (Single Asset) | Enter when price deviates N std from rolling mean; exit at mean | Rolling mean/std (20-50d); z > 2 / z < -2 | Statistical reversion in sideways regimes |
| S180 | Statistical Arbitrage (Cross-Sectional) | Trade basket ranked by residual return after removing market/sector factors | OLS residuals; rank extremes; decay half-life | Temporary mispricing vs equilibrium exposure |
| S181 | Index Arbitrage (Cash-Futures) | Exploit NIFTY spot-futures mispricing until basis converges at expiry | Basis vs cost-of-carry; rollover | Convergence to spot at expiry |
| S190 | Gap Mean Reversion (Markov-based) | Fade overnight gaps when Markov-state model flags statistical excess | Gap vs ATR units; transition-probability regime filter | Overreaction to overnight news; intraday reversal |

## Calendar & Seasonal

| ID | Name | Core Idea | Key Signals | Edge Source |
|---|---|---|---|---|
| S182 | January Effect | Small-caps rally in January as investors reinvest after December selling | Month dummies; small vs large January returns | Tax-loss selling and window dressing reversal |
| S183 | Turn-of-Month Effect | Long equities last trading day through first days of month | T-1 to T+3 of month turn calendar | Systematic payroll/institutional flows |
| S184 | Holiday/Pre-Holiday Effect | Hold long before market holidays which show positive drift | NSE/BSE holiday calendar; pre-holiday returns | Optimism and thin-volume upward drift |
| S185 | Sell in May (Halloween Effect) | Equities Nov-Apr; cash May-Oct exploiting seasonal weakness | Month-of-year regime filter | Seasonal risk appetite cycle |
| S186 | Day-of-Week Effect | Exploit weekday return differences (weak Mondays / strong Fridays) | Weekday dummies on NIFTY | Weekend information absorption, settlement flows |
| S187 | Month-End/Expiry Rebalancing Effect | Trade drift around month-end and F&O expiry when funds rebalance | Expiry Thursday; month-end; rebalancing dates | Forced rebalancing and hedging flows |
| S188 | Santa Claus Rally | Long during year-end sessions (last 5 + first 2 of new year) | Calendar window flags | Festive liquidity and sentiment buying |
| S189 | Seasonal Sector Rotation | Overweight sectors with recurring seasonal strength (autos pre-festive, agro in monsoon) | Monthly seasonality tables per NSE sector | Demand seasonality in Indian economy |

## Value

| ID | Name | Core Idea | Key Signals | Edge Source |
|---|---|---|---|---|
| S076 | Graham Net-Net (NCAV) | Buy stocks priced below two-thirds of net current asset value, i.e., below liquidation value | NCAV = CA - total liabilities; price < 2/3 x NCAV; minimal debt | Behavioral overreaction to distressed stocks + margin of safety |
| S077 | Deep Value / Low P/B | Buy stocks trading at low price-to-book ratios; market overdiscounts asset-heavy firms | P/B bottom decile; HML factor exposure | Fama-French value premium (HML, 1992) |
| S078 | Low P/E | Buy low price-to-earnings stocks expecting mean reversion of depressed multiples | Trailing P/E bottom quintile; positive earnings; industry-relative P/E | Value premium; overreaction to bad news |
| S079 | High Dividend Yield | Buy high, sustainable dividend yielders to harvest income plus undervaluation | Dividend yield top decile; payout < 80%; 5y dividend growth | Yield seeking + mispricing of steady cash generators |
| S080 | Greenblatt Magic Formula | Rank by earnings yield (EBIT/EV) and return on capital, buy top ranked | EBIT/EV; EBIT/(net fixed assets + working capital); annual rebalance | Combines cheapness + quality anomalies |
| S081 | Piotroski F-Score | Within low P/B universe, pick high 9-signal financial-health scorers to avoid value traps | ROA, CFO, margins, leverage, dilution, CFO>NI | Value-trap avoidance; documented strong spread |
| S082 | DCF Intrinsic Value | Buy when discounted projected FCF exceeds price with margin of safety | FCF projections, WACC, terminal growth, margin of safety >= 30% | Independent intrinsic value estimate (Graham/Buffett) |
| S083 | EV/EBITDA Value | Buy low enterprise-value-to-EBITDA companies; whole-firm cheapness, debt-adjusted | EV/EBITDA vs sector; low multiples; positive EBITDA | Whole-firm mispricing ignoring capital structure |
| S084 | Graham Number | Buy stocks priced below sqrt(22.5 x EPS x BVPS) | EPS, BVPS, P/E <= 15, P/B <= 1.5 | Graham's dual cheapness filter |
| S085 | Free Cash Flow Yield | Buy high FCF/EV yield; actual cash generation over accounting earnings | FCF = CFO - capex; FCF yield top quartile | Cash-based value signal; manipulation resistant |

## Growth

| ID | Name | Core Idea | Key Signals | Edge Source |
|---|---|---|---|---|
| S086 | CANSLIM | Buy accelerating EPS, new highs, institutional sponsorship, market support (O'Neil) | EPS +25% YoY; 3y EPS growth; 52-wk highs; RS >= 80; 7-8% stop | Momentum + growth + supply/demand (IBD backtests) |
| S087 | GARP / PEG | Buy growth stocks only when P/E is justified by growth rate (PEG <= 1) | PEG = forward P/E / expected EPS growth; PEG < 1 | Lynch's growth-at-reasonable-price avoids overpaying |
| S088 | Earnings Growth Investing | Buy companies with durable above-average EPS growth expected to continue | 5-10y EPS CAGR; forward estimates; upward revisions | Growth persistence; earnings power compounding |
| S089 | Revenue Growth / Fisher Scuttlebutt | Buy strong sustainable sales growth + superior products/management via deep research | Revenue CAGR; market share; R&D; management interviews | Information edge from qualitative research |
| S090 | Minervini Trend Template | Buy only stocks above rising 150d/200d MA, near 52-week high, high RS | Price > 150d & 200d MA; 200d uptrend; within 25% of high; RS >= 70 | Growth + trend confirmation combo |

## Quality

| ID | Name | Core Idea | Key Signals | Edge Source |
|---|---|---|---|---|
| S091 | High ROE/ROIC Quality | Buy consistently high return on equity/capital companies | ROE > 15-20% for 5-10y; ROIC > WACC; stable/rising ROE | Quality persistence; efficient capital allocation |
| S092 | Margin Stability | Buy companies with stable/expanding margins indicating pricing power | Gross/operating margin vs 5y average and sector | Predictable profitability under-rewarded |
| S093 | Low Debt / Conservative Balance Sheet | Favor low leverage, strong interest coverage that survive downturns | D/E, interest coverage >= 3x, net debt/EBITDA | Downside protection; avoids distress |
| S094 | Buffett-Style Moat | Buy wonderful businesses with durable competitive advantages at fair prices, hold long-term | Moat (brand, switching costs, network); high ROIC; predictable FCF | Compounding of franchise economics |
| S095 | Accruals-Based Quality | Avoid low earnings-quality firms where earnings exceed cash flow (Sloan) | Accruals = (NI - CFO)/avg total assets; low accruals decile | Accruals predict reversals (Sloan 1996) |
| S096 | Gross Profitability (Novy-Marx) | Buy high gross-profits-to-assets; predicts returns as strongly as value | GP/TA top decile; combine with value | Profitable firms systematically underpriced |
| S097 | Altman Z-Score Filter | Exclude elevated bankruptcy-risk stocks via financial distress score | Z-score; require Z > 3 or avoid Z < 1.8 | Solvency filtering removes tail-risk losers |

## Factor Anomalies

| ID | Name | Core Idea | Key Signals | Edge Source |
|---|---|---|---|---|
| S098 | Size Premium (SMB) | Small-cap stocks historically deliver higher returns than large caps | Market cap bottom deciles; micro/small-cap universe | Fama-French SMB; illiquidity premium |
| S099 | Value Factor (HML) | High book-to-market stocks outperform growth over long horizons | B/M top quintile; composite value (E/P, CF/P, B/P) | Fama-French 1992/93 value premium |
| S100 | Momentum Factor (Jegadeesh-Titman) | Buy past 12-month winners (skip last month), hold 3-12 months | 12-1 return ranking top decile; monthly rebalance | Underreaction + herding (JT 1993) |
| S101 | Low-Volatility Anomaly | Low-beta/low-vol stocks earn higher risk-adjusted returns than high-vol | 1y realized vol or beta bottom quintile; min-variance | Lottery preference; leverage constraints (BBW) |
| S102 | Quality Factor (RMW) | Profitable firms outperform unprofitable ones controlling for size/value | RMW = robust minus weak profitability | Fama-French 5-factor (2015) |
| S103 | Investment Factor (CMA) | Conservative asset-growth firms outperform aggressive investors | CMA = conservative minus aggressive; low asset growth | Asset growth negatively predicts returns |
| S104 | PEAD / SUE | Post-earnings drift: prices keep moving in surprise direction for weeks/months | SUE = (actual - expected EPS)/sigma; hold 1-3 months | Investor underreaction (Ball & Brown; Bernard & Thomas) |
| S105 | Analyst Revision Drift | Upward (downward) estimate revisions continue to outperform | Consensus EPS upgrade % over 1-3 months; revision breadth | Gradual incorporation of analyst info |
| S106 | Earnings Quality (CFO > NI) | Favor stocks whose operating cash flow exceeds net income | CFO/NI ratio > 1 sustained | Accounting conservatism predicts fewer surprises |

## Special Situations

| ID | Name | Core Idea | Key Signals | Edge Source |
|---|---|---|---|---|
| S107 | Buybacks & Insider Buying | Buy stocks where insiders and the company itself are buying shares | Net insider purchases; buyback yield; dilution trends | Informed-trader signal; supply reduction |

## Event-Driven

| ID | Name | Core Idea | Key Signals | Edge Source |
|---|---|---|---|---|
| S108 | IPO Listing Gains Trading | Buy oversubscribed IPOs on listing day when GMP strongly positive; exit within days | Subscription multiples, grey market premium, anchor lock-ins | Information asymmetry + retail demand in primary markets |
| S109 | IPO Anchor & HNI Follow | Follow quality anchor investors into IPOs as institutional certification | Anchor book composition, lock-up 30/90 days, QIB oversubscription | Institutional certification reduces adverse selection |
| S110 | Merger Arbitrage (Risk Arb) | Buy target after deal announcement; short acquirer in stock deals to capture spread | Deal terms, spread %, NCLT/CCI approvals, delisting rules | Deal-closure risk premium mispriced by retail-heavy markets |
| S111 | Index Inclusion / MSCI Rebalancing | Buy stocks pre-announced for Nifty/Sensex/MSCI inclusion ahead of passive rebalancing | Index committee announcements, free-float changes, ADV impact | Forced buying by passive funds |
| S112 | Index Exclusion Exit | Exit/avoid stocks deleted from Nifty/MSCI before effective date | Deletion announcements, ETF/F&O impact | Forced selling by index trackers |
| S113 | Block/Bulk Deal Following | Follow block/bulk deals where marquee investors buy large stakes at premiums | Exchange disclosures, buyer identity, deal price vs CMP | Smart-money signaling via SEBI disclosures |
| S114 | Buyback Tender Arbitrage | Tender for buybacks priced above market when acceptance ratio implies positive EV | Buyback price, acceptance ratio estimate, promoter participation | Retail under-participation inflates acceptance ratios |
| S115 | Open-Market Buyback Announcement | Long stocks announcing open-market buybacks (promoter >50% adds signal) | Buyback % of mcap, cash reserves, promoter holding | Management information advantage + floor support |
| S116 | Bonus Issue Liquidity Play | Trade price-volume momentum from bonus announcements (nominal price illusion) | Bonus ratio, record date, pre-announcement run-up | Retail behavioral bias around corporate actions |
| S117 | Stock Split Momentum | Buy ahead of splits of high-priced growth stocks as affordability improves | Split ratio, record date, retail ownership | Retail price-level anchoring |
| S118 | Rights Issue Discount Capture | Subscribe to deep-discount rights issues or trade ex-rights mispricing | Rights ratio, offer price vs TERP, renunciation trading | Retail confusion over renunciations creates mispricing |
| S119 | Special Dividend Capture | Buy before record date of large special dividends; exit post-ex-date if price drop < dividend | Dividend size vs price, record/ex-dates | Record-date arbitrage; tax-driven pricing |
| S120 | Demerger / Spin-off Sum-of-Parts | Buy parents announcing demergers; separated units often re-rate higher | Demerger ratio, segment values, NCLT approval | Conglomerate discount unwinds |
| S121 | Promoter Pledge Release Turnaround | Buy when promoters release pledged shares signaling easing distress | Pledged share %, release disclosures, debt reduction | Distress mispricing unwinds as solvency improves |
| S122 | Promoter Buying Follow | Mirror open-market promoter purchases; insiders time entries well | SEBI insider disclosures, purchase size | Insider information advantage; slow public response |

## Sentiment & Behavioral

| ID | Name | Core Idea | Key Signals | Edge Source |
|---|---|---|---|---|
| S123 | News Sentiment Trading | Trade short-term momentum after high-impact news using NLP sentiment | News headlines, sentiment scores, event type | Retail over/underreaction to news flow |
| S124 | Social Media Buzz Fade | Fade extreme social-media-driven rallies in smallcaps after buzz peaks | Buzz volume z-scores, trending tickers, volume divergence | Retail herding; hype peaks precede reversion |
| S125 | Put-Call Ratio Contrarian | Contrarian on Nifty at PCR extremes (high = fear/buy; low = greed/caution) | Nifty PCR (OI and volume), percentile bands | Crowded hedging unwinds |
| S126 | India VIX Fear Gauge | Buy when India VIX spikes >20-25; reduce when compressed <10-12 | India VIX level vs mean, term structure, percentile | Volatility risk premium mean reversion |
| S127 | FII/DII Flow Following | Ride persistent FII buying trends; note DII absorption during FII selling | Daily FII/DII net flows (SEBI/NSE data), flow persistence | Institutional flows drive Nifty; DII counter-flows mark bottoms |
| S128 | Option Chain OI Analysis (Max Pain) | Position around max-pain strike and largest OI walls; expect pinning near expiry | Nifty OI distribution, max pain, PCR skew | Option writers' hedging and pinning effects |
| S129 | Advance-Decline Breadth Extreme | Buy dips when breadth hits oversold extremes; trim at euphoric breadth | A/D ratio, % above 200-DMA, new high-low counts | Breadth divergences flag turns early |
| S130 | GIFT Nifty Gap Trading | Use GIFT Nifty overnight move to forecast Nifty gap; fade overreactions | GIFT Nifty vs Nifty close spread, global cues | 24-hour price discovery leaks overnight news |

## India-Specific

| ID | Name | Core Idea | Key Signals | Edge Source |
|---|---|---|---|---|
| S131 | Diwali / Muhurat Session | Trade the special Muhurat session and pre-Diwali week's positive seasonality | Muhurat date, historical session win-rate | Cultural optimism + thin festive volume drift |
| S132 | Samvat Year Seasonality | Initiate swing longs in the new Samvat year's first weeks | Samvat calendar, historical Samvat-week returns | Documented Indian seasonal pattern |
| S133 | Budget Day Straddle/Strangle | Buy long straddles/strangles on Nifty into Union Budget for volatility expansion | Budget date, pre-event IV vs realized range | Event-day volatility underpriced vs realized |
| S134 | Budget Sector Rotation | Pre-position in budget-favored sectors; exit after announcement spike | Budget speech, capex allocations, tax changes | Policy-driven demand shocks |
| S135 | Monsoon / Rural Demand Play | Long agro/FMCG/tractors on good monsoon; short vulnerable on deficient | IMD forecasts, reservoir levels, crop sowing | Rainfall drives rural income (India-unique) |
| S136 | Smallcap Momentum | Buy recent smallcap winners (6-12m momentum) in NSE Smallcap 100; rebalance monthly | Momentum rank, liquidity filter | Retail-dominant smallcaps trend longer |
| S137 | Circuit-Limit Momentum Trading | Buy stocks repeatedly locking upper circuit; avoid/short lower-circuit locked | Circuit filter hits, pending queue depth | Liquidity imbalance creates day-after continuation |
| S138 | Lower-Circuit Contrarian Bounce | Fade indiscriminate lower-circuit selling in intact smallcaps near support | Circuit streak, seller queue size, fundamentals | Panic overreaction overshoots fair value |
| S139 | Corporate Action Calendar Trading | Trade systematic pre/post record-date drift across splits/bonuses/buybacks/dividends | Corporate action calendar, post-event drift | Retail biases repeat around Indian corporate actions |

## Options

| ID | Name | Core Idea | Key Signals | Edge Source |
|---|---|---|---|---|
| S140 | Covered Call | Own stock and sell OTM call to collect premium while capping upside | Stock position, call IV, strike selection, expiry | Selling theta and overstated IV on neutral holding |
| S141 | Protective Put | Buy put against long stock to cap downside while keeping upside | Stock holding, put IV, drawdown horizon | Tail-risk insurance at fraction of position cost |
| S142 | Bull Call Spread | Buy call, sell higher-strike call for moderate rise with defined risk | Directional view, strikes, IV skew, debit | Capped-risk directional exposure |
| S143 | Bear Put Spread | Buy put, sell lower-strike put for moderate decline with limited cost | Downtrend view, support levels, put IV | Defined-risk bearish exposure |
| S144 | Iron Condor | Sell OTM put spread and call spread simultaneously for range-bound profit | Support/resistance range, IV, expiry | Collects theta from both sides when IV overstates range |
| S145 | Long Straddle | Buy same-strike call and put to profit from large move either direction | Event calendar (RBI, budget, earnings), IV | Long gamma/long vega ahead of binary events |
| S146 | Long Strangle | Buy OTM call and put for big move at lower cost than straddle | Volatility expansion, breakout signals | Cheaper convexity on directional uncertainty |
| S147 | Calendar Spread | Sell near-dated, buy longer-dated same strike to harvest front-month theta | IV term structure, theta differentials | Front-month decays faster; back-month retains vega |
| S148 | Butterfly Spread | Long wings, short middle strikes to profit from price pinning at center | Pin risk, strike clustering, IV | Precise mean-reversion to strike, tiny cost |
| S149 | Collar | Hold stock, buy protective put, sell covered call to finance protection | Cost of protection, call premium funding | Near-zero-cost downside insurance |
| S150 | Ratio Spread | Sell more options than bought for time decay with one-sided exposure | Delta/theta targets, IV | Asymmetric theta harvest with partial hedge |
| S151 | Short Strangle (Expiry-Day Theta) | Sell OTM call and put on weekly/expiry day for last-day theta decay | Gamma risk, strike distance, final-hours decay | Theta decays fastest on last day |
| S152 | Synthetic Long/Short (Risk Reversal) | Long call + short put (or inverse) to replicate stock with leverage | Put-call parity, skew, margin efficiency | Delta-1 replication with financing advantages |
| S153 | Volatility Arbitrage (IV Rank) | Sell option structures when IV percentile high; buy when low vs realized | India VIX, IV percentile, realized vol spread | Vol risk premium: implied structurally exceeds realized |

## Market Microstructure

| ID | Name | Core Idea | Key Signals | Edge Source |
|---|---|---|---|---|
| S154 | Order Flow Trading | Infer aggressive buying/selling from tape and order book imbalance | Trade tape, bid/ask imbalance, large prints | Revealed intent of aggressive participants precedes price |
| S155 | Bid-Ask Spread Analysis | Use spread width, depth, quote updates to gauge informed flow | Spread, quote staleness, depth at touch | Informed trading widens spreads before moves |
| S156 | Market Depth / Liquidity Trading | Fade or follow Level-2 walls where resting liquidity signals support | Order book depth, icebergs, cancellations | Liquidity imbalances predict short-term direction |
| S157 | Auction-Based Trading | Exploit price discovery in NSE call auction where imbalance revealed | Pre-open imbalance, MOC imbalance | Auction clearing prices reveal institutional demand |

## ML & Quant

| ID | Name | Core Idea | Key Signals | Edge Source |
|---|---|---|---|---|
| S158 | LSTM Price Prediction | Train LSTM networks on price sequences to forecast next-period returns | OHLCV, technical features, sequences | Captures nonlinear sequential dependencies |
| S159 | Random Forest Signal Models | Ensemble trees over features to classify up/down regimes | Feature set, labels, feature importance | Robust nonlinear interactions, low overfit |
| S160 | Reinforcement Learning Trading | Train agent (DQN/PPO) to maximize cumulative PnL | Reward shaping, environment, costs | Learns adaptive policies from reward feedback |
| S161 | Kalman Filter Pairs Trading | Time-varying hedge ratio between co-moving stocks; trade residual spread | Pair prices, dynamic hedge ratio, spread z-score | Adapts to drifting relationships |
| S162 | GARCH Volatility Modeling | Model conditional volatility for sizing or vol regime for option selling | Returns, volatility clustering, leverage effect | Better vol forecasts than constant vol |
| S163 | Monte Carlo Portfolio Simulation | Simulate return paths to estimate VaR/drawdown and optimize allocation | Correlations, vol estimates, distributions | Tail-aware risk estimates |
| S164 | ML Factor Models | Gradient boosting/NN over factors to rank NSE stock cross-section | Factor exposures, fundamentals, returns | Nonlinear combination of factor premia |
| S165 | NLP Earnings-Call Analysis | Score sentiment/tone of earnings calls to predict post-call drift | Transcripts, tone metrics, guidance language | Soft information in language predicts returns |

## Macro & Top-Down

| ID | Name | Core Idea | Key Signals | Edge Source |
|---|---|---|---|---|
| S166 | Sector Rotation | Overweight leading sectors, underweight lagging as cycle shifts | Relative sector momentum, cycle phase | Sector leadership rotates with business cycle |
| S167 | Business Cycle Timing | Map exposure (cyclicals vs defensives) to expansion/recession phases | PMI, GDP growth, IIP, credit growth | Cycle-phase tilts earn premia |
| S168 | Interest-Rate Sensitivity Trading | Rotate between rate-sensitives and bond proxies on RBI direction | RBI repo path, G-Sec yields | Rate-sensitive sectors reprice on policy shifts |
| S169 | INR/Currency-Based Trading | Long rupee-sensitive exporters or importers on INR trend | USD/INR, crude import bill, FPI flows | Currency moves shift sector margins mechanically |
| S170 | Commodity Correlation Trading | Trade Indian producers/users off commodity moves (crude, metals, agri) | Crude, metals, sugar, fertilizer prices | Global commodity prices lead Indian margins |
| S171 | Global Index Correlation / Follow-the-Market | Fade Nifty overnight gaps vs S&P/Nasdaq/Nikkei; trade global beta | Overnight global returns, ADR premia | India inherits overnight sentiment; gaps revert intraday |
