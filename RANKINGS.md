# Final Strategy Ranking — Model-Diverse Jury Consensus

**190 strategies** ranked by an independent jury of **6 agents, each a different model and isolated sandbox** (unaware of each other):
- `juror-1` — hy3
- `juror-2` — gpt-5.6-luna
- `juror-3` — mimo-v2.5-pro
- `juror-4` — kimi-k3
- `juror-5` — qwen3.7-max
- `internet` — minimax-m3 (web research)

Aggregation is **deterministic** (no model in the math): final rank = ascending mean rank across all 6 rankings; consensus = lower rank std-dev means higher agreement; score = mean of juror edge scores (1-10). Rubric: pure expected return/edge.

| Final | ID | Strategy | Mean Rank | Consensus (std) | Mean Edge Score | Best | Worst |
|---:|---:|---|---:|---:|---:|---:|---:|
| 1 | S100 | Momentum Factor (Jegadeesh-Titman) | 1.2 | 0.4 | 9.83 | 1 | 2 |
| 2 | S104 | PEAD / SUE | 3.3 | 1.6 | 9.67 | 2 | 6 |
| 3 | S174 | Time-Series Momentum (MOP) | 5.5 | 3.5 | 9.50 | 2 | 12 |
| 4 | S096 | Gross Profitability (Novy-Marx) | 5.7 | 2.8 | 9.00 | 3 | 10 |
| 5 | S172 | Dual Momentum (Antonacci) | 7.5 | 2.6 | 8.83 | 5 | 11 |
| 6 | S101 | Low-Volatility Anomaly | 8.7 | 5.1 | 8.83 | 4 | 18 |
| 7 | S095 | Accruals-Based Quality | 10.2 | 6.0 | 8.50 | 4 | 22 |
| 8 | S099 | Value Factor (HML) | 10.5 | 6.3 | 8.50 | 2 | 20 |
| 9 | S081 | Piotroski F-Score | 11.8 | 8.2 | 8.67 | 7 | 30 |
| 10 | S102 | Quality Factor (RMW) | 12.0 | 5.5 | 8.50 | 4 | 21 |
| 11 | S105 | Analyst Revision Drift | 12.5 | 5.3 | 8.17 | 3 | 21 |
| 12 | S080 | Greenblatt Magic Formula | 13.8 | 9.2 | 8.83 | 5 | 29 |
| 13 | S110 | Merger Arbitrage (Risk Arb) | 16.7 | 6.3 | 8.17 | 6 | 27 |
| 14 | S103 | Investment Factor (CMA) | 17.2 | 7.1 | 8.00 | 9 | 30 |
| 15 | S076 | Graham Net-Net (NCAV) | 17.7 | 15.7 | 8.67 | 1 | 41 |
| 16 | S173 | Relative Strength vs Benchmark | 18.3 | 8.2 | 8.00 | 9 | 31 |
| 17 | S098 | Size Premium (SMB) | 20.5 | 5.6 | 7.67 | 13 | 30 |
| 18 | S107 | Buybacks & Insider Buying | 23.2 | 12.0 | 7.83 | 13 | 49 |
| 19 | S176 | Pairs Trading (Distance Method) | 23.3 | 13.2 | 7.83 | 10 | 42 |
| 20 | S177 | Cointegration Pairs Trading | 24.7 | 11.4 | 7.83 | 11 | 40 |
| 21 | S180 | Statistical Arbitrage (Cross-Sectional) | 25.3 | 10.2 | 7.67 | 6 | 41 |
| 22 | S111 | Index Inclusion / MSCI Rebalancing | 25.7 | 9.5 | 7.83 | 16 | 45 |
| 23 | S153 | Volatility Arbitrage (IV Rank) | 27.8 | 10.2 | 7.67 | 17 | 48 |
| 24 | S091 | High ROE/ROIC Quality | 28.8 | 11.5 | 7.33 | 12 | 44 |
| 25 | S122 | Promoter Buying Follow | 30.0 | 10.9 | 7.67 | 19 | 52 |
| 26 | S085 | Free Cash Flow Yield | 30.8 | 9.6 | 7.50 | 17 | 45 |
| 27 | S114 | Buyback Tender Arbitrage | 31.8 | 13.6 | 7.50 | 15 | 50 |
| 28 | S077 | Deep Value / Low P/B | 32.0 | 15.6 | 7.50 | 12 | 61 |
| 29 | S078 | Low P/E | 34.2 | 4.6 | 7.17 | 25 | 39 |
| 30 | S094 | Buffett-Style Moat | 36.7 | 11.7 | 7.17 | 25 | 60 |
| 31 | S181 | Index Arbitrage (Cash-Futures) | 36.7 | 16.8 | 7.17 | 16 | 70 |
| 32 | S115 | Open-Market Buyback Announcement | 37.3 | 13.6 | 7.33 | 24 | 60 |
| 33 | S120 | Demerger / Spin-off Sum-of-Parts | 39.2 | 20.1 | 7.33 | 16 | 78 |
| 34 | S106 | Earnings Quality (CFO > NI) | 39.2 | 20.6 | 7.17 | 19 | 73 |
| 35 | S178 | RSI(2) Reversion | 39.8 | 15.0 | 7.17 | 17 | 58 |
| 36 | S086 | CANSLIM | 40.5 | 16.4 | 7.17 | 18 | 67 |
| 37 | S083 | EV/EBITDA Value | 42.2 | 10.9 | 7.00 | 32 | 64 |
| 38 | S165 | NLP Earnings-Call Analysis | 48.8 | 15.4 | 6.67 | 29 | 72 |
| 39 | S079 | High Dividend Yield | 50.0 | 13.6 | 6.50 | 33 | 74 |
| 40 | S093 | Low Debt / Conservative Balance Sheet | 51.8 | 16.0 | 6.67 | 20 | 71 |
| 41 | S112 | Index Exclusion Exit | 54.3 | 23.6 | 6.67 | 20 | 95 |
| 42 | S126 | India VIX Fear Gauge | 55.8 | 24.1 | 6.17 | 27 | 99 |
| 43 | S074 | 52-Week High Breakout | 55.8 | 34.2 | 6.67 | 21 | 120 |
| 44 | S087 | GARP / PEG | 56.2 | 13.0 | 6.50 | 39 | 76 |
| 45 | S010 | Donchian Channel Breakout (Turtle) | 56.2 | 21.5 | 6.33 | 31 | 92 |
| 46 | S113 | Block/Bulk Deal Following | 56.5 | 14.8 | 6.50 | 43 | 81 |
| 47 | S166 | Sector Rotation | 57.0 | 13.7 | 6.50 | 40 | 80 |
| 48 | S161 | Kalman Filter Pairs Trading | 57.8 | 12.4 | 6.33 | 38 | 68 |
| 49 | S175 | Rotational Momentum (Sector/Index) | 59.8 | 62.3 | 6.83 | 12 | 190 |
| 50 | S082 | DCF Intrinsic Value | 60.5 | 14.2 | 6.17 | 43 | 81 |
| 51 | S090 | Minervini Trend Template | 60.5 | 51.3 | 7.00 | 19 | 170 |
| 52 | S127 | FII/DII Flow Following | 60.8 | 21.5 | 6.00 | 34 | 87 |
| 53 | S121 | Promoter Pledge Release Turnaround | 62.2 | 19.3 | 6.33 | 46 | 97 |
| 54 | S088 | Earnings Growth Investing | 63.0 | 10.6 | 6.33 | 43 | 75 |
| 55 | S167 | Business Cycle Timing | 66.0 | 16.7 | 6.00 | 46 | 92 |
| 56 | S092 | Margin Stability | 67.5 | 30.1 | 6.33 | 21 | 122 |
| 57 | S001 | Moving Average Trend Filter | 68.8 | 33.2 | 5.83 | 32 | 128 |
| 58 | S136 | Smallcap Momentum | 69.0 | 47.5 | 6.67 | 20 | 162 |
| 59 | S164 | ML Factor Models | 69.2 | 53.4 | 6.50 | 29 | 185 |
| 60 | S084 | Graham Number | 72.0 | 46.0 | 6.17 | 37 | 169 |
| 61 | S097 | Altman Z-Score Filter | 72.8 | 26.5 | 6.00 | 34 | 123 |
| 62 | S129 | Advance-Decline Breadth Extreme | 74.5 | 20.9 | 5.67 | 51 | 101 |
| 63 | S190 | Gap Mean Reversion (Markov-based) | 82.8 | 51.3 | 5.83 | 32 | 187 |
| 64 | S118 | Rights Issue Discount Capture | 83.2 | 39.3 | 5.83 | 48 | 164 |
| 65 | S125 | Put-Call Ratio Contrarian | 84.3 | 32.4 | 5.50 | 34 | 141 |
| 66 | S020 | Darvas Box | 84.5 | 27.0 | 5.50 | 57 | 140 |
| 67 | S168 | Interest-Rate Sensitivity Trading | 84.7 | 21.6 | 5.67 | 53 | 124 |
| 68 | S147 | Calendar Spread | 86.0 | 45.1 | 5.67 | 20 | 146 |
| 69 | S170 | Commodity Correlation Trading | 86.5 | 21.5 | 5.67 | 55 | 126 |
| 70 | S123 | News Sentiment Trading | 87.5 | 40.7 | 5.17 | 35 | 170 |
| 71 | S140 | Covered Call | 88.5 | 39.5 | 5.83 | 56 | 171 |
| 72 | S128 | Option Chain OI Analysis (Max Pain) | 88.7 | 31.2 | 5.00 | 37 | 142 |
| 73 | S144 | Iron Condor | 89.5 | 50.2 | 5.83 | 19 | 167 |
| 74 | S066 | Range Breakout Trading | 90.7 | 21.1 | 5.33 | 64 | 122 |
| 75 | S117 | Stock Split Momentum | 90.7 | 45.7 | 5.17 | 47 | 187 |
| 76 | S134 | Budget Sector Rotation | 91.7 | 31.8 | 5.17 | 62 | 160 |
| 77 | S007 | Supertrend | 92.5 | 21.2 | 5.17 | 63 | 121 |
| 78 | S151 | Short Strangle (Expiry-Day Theta) | 92.7 | 49.5 | 5.33 | 21 | 172 |
| 79 | S169 | INR/Currency-Based Trading | 93.3 | 29.8 | 5.50 | 54 | 140 |
| 80 | S124 | Social Media Buzz Fade | 93.8 | 35.2 | 5.17 | 68 | 171 |
| 81 | S089 | Revenue Growth / Fisher Scuttlebutt | 94.0 | 31.1 | 5.50 | 65 | 150 |
| 82 | S130 | GIFT Nifty Gap Trading | 94.3 | 31.4 | 5.17 | 52 | 143 |
| 83 | S183 | Turn-of-Month Effect | 95.8 | 62.8 | 5.00 | 30 | 184 |
| 84 | S139 | Corporate Action Calendar Trading | 97.0 | 36.8 | 5.17 | 53 | 165 |
| 85 | S185 | Sell in May (Halloween Effect) | 97.5 | 63.0 | 4.67 | 32 | 186 |
| 86 | S006 | ADX Trend Strength | 97.8 | 21.8 | 5.17 | 62 | 134 |
| 87 | S182 | January Effect | 97.8 | 60.8 | 4.50 | 29 | 183 |
| 88 | S032 | Bollinger Squeeze Breakout | 98.3 | 21.8 | 5.17 | 61 | 127 |
| 89 | S038 | VWAP Reversion | 98.3 | 25.5 | 5.17 | 55 | 140 |
| 90 | S035 | NR7/NR4 Volatility Breakout | 98.7 | 30.5 | 5.17 | 66 | 151 |
| 91 | S179 | Z-Score Reversion (Single Asset) | 99.0 | 48.8 | 5.33 | 33 | 187 |
| 92 | S135 | Monsoon / Rural Demand Play | 100.3 | 36.2 | 5.17 | 63 | 161 |
| 93 | S004 | MACD Crossover | 100.5 | 21.7 | 5.00 | 61 | 127 |
| 94 | S034 | Keltner-Bollinger Squeeze | 100.5 | 22.2 | 5.00 | 62 | 128 |
| 95 | S069 | Gap Trading (Gap & Go / Fill) | 100.5 | 34.8 | 5.00 | 63 | 168 |
| 96 | S154 | Order Flow Trading | 101.7 | 39.1 | 5.33 | 47 | 176 |
| 97 | S133 | Budget Day Straddle/Strangle | 101.7 | 39.2 | 5.33 | 61 | 159 |
| 98 | S171 | Global Index Correlation / Follow-the-Market | 102.2 | 41.5 | 5.33 | 56 | 186 |
| 99 | S162 | GARCH Volatility Modeling | 102.8 | 53.1 | 5.50 | 28 | 183 |
| 100 | S031 | Bollinger Bands Mean Reversion | 103.0 | 24.6 | 5.00 | 67 | 141 |
| 101 | S002 | EMA Crossover (Fast/Slow) | 104.3 | 24.4 | 4.83 | 59 | 129 |
| 102 | S003 | Golden Cross / Death Cross | 105.5 | 24.6 | 4.83 | 60 | 130 |
| 103 | S187 | Month-End/Expiry Rebalancing Effect | 105.8 | 61.8 | 4.67 | 33 | 188 |
| 104 | S042 | Volume Climax / Spikes | 106.0 | 28.9 | 4.83 | 54 | 146 |
| 105 | S073 | Inside Bar Breakout | 106.7 | 24.7 | 5.00 | 65 | 134 |
| 106 | S008 | Ichimoku Kinko Hyo | 107.2 | 25.7 | 4.83 | 64 | 144 |
| 107 | S108 | IPO Listing Gains Trading | 107.3 | 59.7 | 5.00 | 42 | 189 |
| 108 | S068 | Open Range Breakout (ORB) | 108.2 | 30.1 | 4.83 | 70 | 167 |
| 109 | S116 | Bonus Issue Liquidity Play | 112.3 | 53.9 | 4.83 | 48 | 186 |
| 110 | S109 | IPO Anchor & HNI Follow | 112.5 | 56.6 | 4.83 | 43 | 190 |
| 111 | S157 | Auction-Based Trading | 113.7 | 48.7 | 5.00 | 46 | 179 |
| 112 | S072 | Pullback/Retest Entry | 113.8 | 16.2 | 4.83 | 81 | 133 |
| 113 | S009 | Parabolic SAR | 114.0 | 22.6 | 4.67 | 65 | 131 |
| 114 | S137 | Circuit-Limit Momentum Trading | 115.8 | 43.5 | 4.50 | 63 | 183 |
| 115 | S149 | Collar | 116.5 | 45.9 | 4.67 | 57 | 180 |
| 116 | S037 | Volume Profile / POC Trading | 119.5 | 24.7 | 4.50 | 94 | 163 |
| 117 | S019 | Linear Regression Channel | 120.5 | 12.4 | 4.67 | 103 | 139 |
| 118 | S011 | Keltner Channel | 121.0 | 18.7 | 4.50 | 93 | 145 |
| 119 | S047 | Triangle Breakout (Asc/Desc/Sym) | 121.5 | 24.2 | 4.50 | 99 | 170 |
| 120 | S005 | MACD/RSI Divergence | 121.7 | 22.1 | 4.33 | 88 | 163 |
| 121 | S048 | Flag & Pennant | 121.7 | 24.8 | 4.50 | 98 | 171 |
| 122 | S049 | Cup & Handle | 121.8 | 25.4 | 4.50 | 97 | 172 |
| 123 | S119 | Special Dividend Capture | 121.8 | 46.8 | 4.83 | 62 | 188 |
| 124 | S015 | Heikin-Ashi Trend Riding | 122.0 | 21.7 | 4.33 | 81 | 149 |
| 125 | S044 | Head & Shoulders | 122.0 | 22.9 | 4.33 | 96 | 167 |
| 126 | S021 | RSI Overbought/Oversold | 122.3 | 12.7 | 4.50 | 99 | 141 |
| 127 | S016 | Renko Chart Trading | 123.0 | 21.7 | 4.33 | 82 | 150 |
| 128 | S017 | Point & Figure | 123.5 | 22.6 | 4.33 | 80 | 151 |
| 129 | S045 | Double Top / Double Bottom | 123.7 | 22.1 | 4.33 | 101 | 168 |
| 130 | S043 | Delivery-Based Volume | 123.7 | 30.0 | 4.50 | 74 | 152 |
| 131 | S036 | On-Balance Volume (OBV) | 124.3 | 25.5 | 4.33 | 95 | 162 |
| 132 | S046 | Triple Top / Triple Bottom | 124.5 | 22.4 | 4.33 | 100 | 169 |
| 133 | S156 | Market Depth / Liquidity Trading | 125.8 | 36.5 | 4.50 | 88 | 178 |
| 134 | S039 | Accumulation/Distribution (Chaikin) | 126.0 | 25.5 | 4.33 | 96 | 164 |
| 135 | S040 | Chaikin Money Flow | 127.0 | 25.5 | 4.33 | 97 | 165 |
| 136 | S138 | Lower-Circuit Contrarian Bounce | 127.0 | 39.4 | 4.33 | 76 | 184 |
| 137 | S184 | Holiday/Pre-Holiday Effect | 127.2 | 61.6 | 4.00 | 31 | 186 |
| 138 | S189 | Seasonal Sector Rotation | 127.7 | 49.5 | 4.33 | 58 | 190 |
| 139 | S022 | Stochastic Oscillator | 128.0 | 16.9 | 4.33 | 100 | 153 |
| 140 | S142 | Bull Call Spread | 131.8 | 41.7 | 4.67 | 53 | 173 |
| 141 | S033 | ATR-Based Stops/Sizing | 132.0 | 25.8 | 4.17 | 96 | 162 |
| 142 | S070 | Trendline Trading | 132.5 | 16.1 | 4.33 | 116 | 154 |
| 143 | S012 | Vortex Indicator | 132.5 | 30.0 | 4.17 | 83 | 184 |
| 144 | S143 | Bear Put Spread | 132.8 | 41.7 | 4.67 | 54 | 174 |
| 145 | S013 | TRIX | 133.2 | 29.4 | 4.17 | 84 | 183 |
| 146 | S018 | Aroon Indicator | 133.2 | 29.8 | 4.17 | 86 | 181 |
| 147 | S014 | Elder Ray | 133.8 | 28.9 | 4.17 | 85 | 182 |
| 148 | S155 | Bid-Ask Spread Analysis | 135.2 | 32.9 | 4.50 | 100 | 177 |
| 149 | S145 | Long Straddle | 136.2 | 33.2 | 4.17 | 67 | 168 |
| 150 | S146 | Long Strangle | 136.8 | 33.2 | 4.17 | 68 | 169 |
| 151 | S051 | Price Channel Trading | 137.8 | 25.0 | 4.17 | 102 | 174 |
| 152 | S023 | Commodity Channel Index (CCI) | 138.3 | 25.1 | 4.17 | 101 | 180 |
| 153 | S041 | Force Index | 138.7 | 28.9 | 4.17 | 98 | 174 |
| 154 | S148 | Butterfly Spread | 139.3 | 36.0 | 4.00 | 69 | 181 |
| 155 | S026 | Rate of Change (ROC) | 139.8 | 16.9 | 4.00 | 115 | 162 |
| 156 | S027 | Momentum Oscillator | 140.8 | 16.9 | 4.00 | 116 | 163 |
| 157 | S067 | Support/Resistance Flip | 140.8 | 24.6 | 4.00 | 113 | 182 |
| 158 | S131 | Diwali / Muhurat Session | 142.2 | 37.5 | 3.50 | 82 | 188 |
| 159 | S150 | Ratio Spread | 142.3 | 25.2 | 4.33 | 108 | 175 |
| 160 | S152 | Synthetic Long/Short (Risk Reversal) | 142.8 | 42.6 | 4.17 | 71 | 188 |
| 161 | S075 | Central Pivot Range (CPR) | 143.0 | 18.2 | 4.00 | 117 | 168 |
| 162 | S132 | Samvat Year Seasonality | 143.2 | 37.5 | 3.50 | 83 | 189 |
| 163 | S030 | Coppock Curve | 145.3 | 20.8 | 3.83 | 117 | 175 |
| 164 | S188 | Santa Claus Rally | 147.7 | 47.7 | 3.33 | 57 | 189 |
| 165 | S024 | Williams %R | 148.7 | 18.8 | 3.83 | 121 | 179 |
| 166 | S050 | Rising/Falling Wedge | 148.8 | 22.0 | 4.00 | 109 | 173 |
| 167 | S025 | Money Flow Index (MFI) | 149.3 | 18.3 | 3.83 | 122 | 178 |
| 168 | S056 | Bullish/Bearish Engulfing | 150.7 | 23.3 | 3.50 | 106 | 179 |
| 169 | S028 | StochRSI | 151.3 | 17.8 | 3.83 | 123 | 177 |
| 170 | S029 | Ultimate Oscillator | 152.0 | 17.3 | 3.83 | 124 | 176 |
| 171 | S053 | Rounding Bottom / Saucer | 152.5 | 18.7 | 3.83 | 121 | 176 |
| 172 | S059 | Morning / Evening Star | 153.0 | 24.6 | 3.50 | 105 | 182 |
| 173 | S052 | Harmonic Patterns (Gartley/Bat/Crab) | 153.3 | 24.4 | 3.67 | 111 | 186 |
| 174 | S060 | Three White Soldiers / Black Crows | 153.7 | 25.2 | 3.50 | 104 | 183 |
| 175 | S159 | Random Forest Signal Models | 156.8 | 25.4 | 3.83 | 112 | 181 |
| 176 | S186 | Day-of-Week Effect | 157.2 | 47.9 | 2.83 | 56 | 190 |
| 177 | S065 | Rising/Falling Window (Gap Candles) | 157.7 | 27.2 | 3.50 | 103 | 188 |
| 178 | S055 | Doji Reversal | 160.5 | 12.7 | 3.33 | 142 | 178 |
| 179 | S057 | Hammer & Hanging Man | 161.2 | 12.0 | 3.33 | 144 | 180 |
| 180 | S141 | Protective Put | 162.0 | 22.2 | 3.50 | 129 | 190 |
| 181 | S071 | Fibonacci Retracement | 162.0 | 24.2 | 3.33 | 117 | 189 |
| 182 | S058 | Harami / Harami Cross | 162.3 | 12.1 | 3.33 | 145 | 181 |
| 183 | S054 | Island Reversal / Gap Patterns | 163.0 | 14.4 | 3.50 | 141 | 181 |
| 184 | S158 | LSTM Price Prediction | 165.2 | 13.5 | 3.33 | 141 | 180 |
| 185 | S061 | Marubozu Continuation | 165.3 | 12.1 | 3.33 | 148 | 184 |
| 186 | S062 | Shooting Star / Inverted Hammer | 165.5 | 11.9 | 3.33 | 149 | 185 |
| 187 | S063 | Tweezer Tops/Bottoms | 166.8 | 12.0 | 3.33 | 150 | 186 |
| 188 | S160 | Reinforcement Learning Trading | 166.8 | 13.8 | 3.33 | 142 | 182 |
| 189 | S064 | Dark Cloud Cover / Piercing Line | 167.5 | 11.9 | 3.33 | 151 | 187 |
| 190 | S163 | Monte Carlo Portfolio Simulation | 180.3 | 9.4 | 3.00 | 162 | 190 |

## Top 20 (detailed rationale below, added by aggregator)

1. **Momentum Factor (Jegadeesh-Titman)** (S100) — mean rank 1.2, consensus 0.4, edge 9.83
2. **PEAD / SUE** (S104) — mean rank 3.3, consensus 1.6, edge 9.67
3. **Time-Series Momentum (MOP)** (S174) — mean rank 5.5, consensus 3.5, edge 9.50
4. **Gross Profitability (Novy-Marx)** (S096) — mean rank 5.7, consensus 2.8, edge 9.00
5. **Dual Momentum (Antonacci)** (S172) — mean rank 7.5, consensus 2.6, edge 8.83
6. **Low-Volatility Anomaly** (S101) — mean rank 8.7, consensus 5.1, edge 8.83
7. **Accruals-Based Quality** (S095) — mean rank 10.2, consensus 6.0, edge 8.50
8. **Value Factor (HML)** (S099) — mean rank 10.5, consensus 6.3, edge 8.50
9. **Piotroski F-Score** (S081) — mean rank 11.8, consensus 8.2, edge 8.67
10. **Quality Factor (RMW)** (S102) — mean rank 12.0, consensus 5.5, edge 8.50
11. **Analyst Revision Drift** (S105) — mean rank 12.5, consensus 5.3, edge 8.17
12. **Greenblatt Magic Formula** (S080) — mean rank 13.8, consensus 9.2, edge 8.83
13. **Merger Arbitrage (Risk Arb)** (S110) — mean rank 16.7, consensus 6.3, edge 8.17
14. **Investment Factor (CMA)** (S103) — mean rank 17.2, consensus 7.1, edge 8.00
15. **Graham Net-Net (NCAV)** (S076) — mean rank 17.7, consensus 15.7, edge 8.67
16. **Relative Strength vs Benchmark** (S173) — mean rank 18.3, consensus 8.2, edge 8.00
17. **Size Premium (SMB)** (S098) — mean rank 20.5, consensus 5.6, edge 7.67
18. **Buybacks & Insider Buying** (S107) — mean rank 23.2, consensus 12.0, edge 7.83
19. **Pairs Trading (Distance Method)** (S176) — mean rank 23.3, consensus 13.2, edge 7.83
20. **Cointegration Pairs Trading** (S177) — mean rank 24.7, consensus 11.4, edge 7.83

## Top 20 — Detailed Rationale

### 1. Momentum Factor (Jegadeesh-Titman) (S100) — mean rank 1.2

Cross-sectional 12-1 momentum is the most replicated anomaly in finance, documented across 200+ years of data, 58+ markets, and multiple asset classes (Jegadeesh & Titman 1993; Moskowitz, Ooi & Pedersen 2012), historically delivering roughly 1%/month long-short. The edge is driven by deep behavioral biases — investor underreaction followed by herding — that are structural features of markets, and at 3–12 month holding periods turnover is low enough that the premium survives transaction costs. All six jurors ranked it in the top 2 (hy3, gpt-5.6-luna, mimo-v2.5-pro, kimi-k3, and internet-agent all placed it #1; qwen3.7-max #2), producing the tightest consensus in the entire exercise (std 0.4). The primary decay risk is momentum crashes during sharp reversals, plus gradual post-publication crowding as factor-based AUM has grown.

### 2. PEAD / SUE (S104) — mean rank 3.3

Post-earnings-announcement drift is perhaps the oldest and most well-documented anomaly in accounting research (Ball & Brown 1968; Bernard & Thomas 1989): prices continue drifting in the direction of earnings surprises for 60–90 days because investors systematically underreact to fundamental news. The signal is objective, high-capacity, liquid, recurring, and works in large caps, surviving transaction costs easily. Five of six jurors placed it in the top 5 (hy3 #2, gpt-5.6-luna #2, kimi-k3 #2, qwen3.7-max #3, mimo-v2.5-pro #5), with only internet-agent slightly more sceptical at #6 (std 1.6). Sophisticated event traders and faster information processing have narrowed the drift, but the sheer volume of earnings events and the behavioural underreaction mechanism keep the edge alive.

### 3. Time-Series Momentum (MOP) (S174) — mean rank 5.5

Moskowitz, Ooi & Pedersen (2012) showed that an asset's own past 12-month return predicts continuation across 58 diverse futures markets — commodities, currencies, bonds, equities — and over a century of data, with especially strong performance during extended trends and crises. The signal is slow-moving so turnover and costs are minimal, and its cross-asset diversification makes it far more robust than single-market momentum. Jury opinions were more dispersed (internet-agent #2, kimi-k3 #3, gpt-5.6-luna and qwen3.7-max #4, mimo-v2.5-pro #8, hy3 #12; std 3.5), reflecting the trade-off between its academic robustness and the practical reality of trend-reversal drawdowns. Capacity is finite per market, and leverage costs can erode the net premium.

### 4. Gross Profitability (Novy-Marx) (S096) — mean rank 5.7

Novy-Marx (2013) demonstrated that gross profits-to-assets predicts future returns about as strongly as the value factor but with low correlation to it, capturing a genuinely underpriced quality dimension: the top decile outperforms the bottom by several percentage points annually. The metric is easy to compute, robust out-of-sample, and structurally motivated — profitable firms are systematically underpriced. hy3, mimo-v2.5-pro, and internet-agent all ranked it #3, while gpt-5.6-luna was most cautious at #10 (std 2.8). Factor crowding in the quality space and the growing proliferation of profitability ETFs are the main decay risks.

### 5. Dual Momentum (Antonacci) (S172) — mean rank 7.5

Dual momentum combines absolute momentum (own return vs. cash) with relative momentum (cross-asset ranking), harvesting both the time-series and cross-sectional premia while providing built-in crash protection via regime switching to bonds or cash. Decades of backtested and out-of-sample evidence show equity-like or better returns with far smaller drawdowns, and monthly rotation keeps costs negligible. gpt-5.6-luna (#5), kimi-k3 (#5), and qwen3.7-max (#6) were most favourable; hy3 and internet-agent ranked it #11 (std 2.6). The edge depends on disciplined rebalancing and can suffer whipsaw losses in choppy, trendless markets.

### 6. Low-Volatility Anomaly (S101) — mean rank 8.7

Low-beta and low-volatility stocks earn higher risk-adjusted returns than high-vol stocks (Frazzini & Pedersen, "Betting Against Beta"), inverting the standard risk-return prediction. The premium is rooted in structural forces — leverage constraints on institutions and lottery preferences of retail — that resist arbitrage and crowding better than most anomalies, delivering persistent alpha with lower drawdowns. kimi-k3 (#4) and internet-agent (#5) were most bullish; gpt-5.6-luna was the most sceptical at #18 (std 5.1). Full exploitation requires leverage to tilt toward low-vol, and the proliferation of low-volatility smart-beta ETFs has compressed part of the premium.

### 7. Accruals-Based Quality (S095) — mean rank 10.2

Sloan (1996) showed that firms with high accruals (earnings exceeding cash flow) reliably underperform, while low-accrual firms outperform, with the effect persisting for years — the accounting-based mispricing is structural and survives transaction costs. hy3 (#4) and internet-agent (#4) led the jury; kimi-k3 was the most sceptical at #22 (std 6.0). The edge has narrowed as accrual information has become more widely monitored, and accounting rule changes can alter the signal's composition over time.

### 8. Value Factor (HML) (S099) — mean rank 10.5

The Fama-French book-to-market premium is a foundational, well-documented long-horizon anomaly with a large historical magnitude, supported by behavioural overreaction explanations that provide a structural basis for persistence across global markets. mimo-v2.5-pro (#2) and hy3 (#5) were most bullish, while gpt-5.6-luna (#20) and qwen3.7-max (#15) were far more sceptical, reflecting value's decade-long drawdown vs. growth (std 6.3). Crowding from the massive factor-investing industry and the possibility that the premium is compensation for distress risk are the principal caveats.

### 9. Piotroski F-Score (S081) — mean rank 11.8

The Piotroski F-Score is a fundamental scoring system that identifies strong value stocks within the cheap universe, combining profitability, leverage, and efficiency signals to filter out value traps. hy3 (#7), qwen3.7-max (#7), gpt-5.6-luna (#8), and kimi-k3 (#9) were closely clustered, but internet-agent ranked it a distant #30 (std 8.2). The edge is concentrated in small and micro-cap names, where transaction costs and capacity constraints can significantly erode realized returns.

### 10. Quality Factor (RMW) (S102) — mean rank 12.0

The Fama-French robust-minus-weak profitability factor shows that firms with high operating profitability systematically outperform low-profitability firms, controlling for size and value, reflecting the market's underpricing of sustainable earnings quality. mimo-v2.5-pro (#4) and internet-agent (#8) were most favourable; gpt-5.6-luna (#21) and qwen3.7-max (#16) were more cautious (std 5.5). Quality factor crowding and the high correlation among profitability, accruals, and investment factors limit incremental capacity when combined with other quality screens.

### 11. Analyst Revision Drift (S105) — mean rank 12.5

Analyst revision drift captures the continued price adjustment after estimate changes: revisions aggregate valuable private information, and the post-revision drift persists for weeks, complementing price momentum with a fundamentally anchored signal. gpt-5.6-luna (#3) was the strongest advocate; qwen3.7-max (#21) was the most sceptical, with hy3 and internet-agent at #14 (std 5.3). Crowding from quant funds trading revision signals and data-latency disadvantages for slower rebalancers are the key execution risks.

### 12. Greenblatt Magic Formula (S080) — mean rank 13.8

Greenblatt's Magic Formula combines earnings yield (EBIT/EV) with return on capital to rank stocks, capturing both cheapness and quality in a single screen that produced ~30% annualized returns in the original 17-year backtest, with annual rebalancing keeping turnover and costs low. qwen3.7-max (#5) and hy3 (#8) were most bullish; internet-agent (#29) and mimo-v2.5-pro (#24) were far more sceptical (std 9.2). The strategy has small-cap bias, capacity constraints in the liquid universe, and the dual-screen does not fully eliminate value-trap risk.

### 13. Merger Arbitrage (Risk Arb) (S110) — mean rank 16.7

Merger arbitrage captures the spread between a deal's announcement price and completion price, offering event-driven, market-neutral returns that are largely uncorrelated with broad equity risk. kimi-k3 (#6) was the strongest supporter; qwen3.7-max (#27) was the most sceptical (std 6.3). Deal-break risk creates fat-tailed losses, the edge is regime-dependent on M&A activity levels, and the growing concentration of deals among large-cap targets limits capacity.

### 14. Investment Factor (CMA) (S103) — mean rank 17.2

The Fama-French conservative-minus-aggressive investment factor documents that firms that invest less (lower asset growth) systematically outperform heavy investors, consistent with the q-factor model of investment under frictions. internet-agent (#13) and mimo-v2.5-pro (#9) were most favourable; hy3 (#30) was the most sceptical (std 7.1). The standalone edge is lower than value or momentum, and the factor works best as a complement within multi-factor portfolios rather than on its own.

### 15. Graham Net-Net (NCAV) (S076) — mean rank 17.7

Buying stocks below two-thirds of net current asset value has produced 20–30%+ annualized returns across decades of academic research (Oppenheimer 1986; Tweedy-Browne data), with a margin of safety so extreme that even with significant value-trap risk the aggregate edge survives costs. qwen3.7-max ranked it #1, gpt-5.6-luna #7, and hy3 #9; but mimo-v2.5-pro (#38) and internet-agent (#41) were deeply sceptical (std 15.7 — the highest in the top 20). The strategy is confined to micro- and small-cap names with severe liquidity constraints, and the universe has shrunk dramatically as screening tools have become ubiquitous.

### 16. Relative Strength vs Benchmark (S173) — mean rank 18.3

Relative strength ranking of stocks against a benchmark is a pure momentum variant that is simple, liquid, and well-documented across markets and time periods, with the advantage of a clear benchmark-anchored signal. internet-agent (#9) and hy3 (#15) were most favourable; kimi-k3 (#31) and gpt-5.6-luna (#28) were most sceptical (std 8.2). Momentum crash risk, crowding from systematic trend-followers, and regime dependence in mean-reverting markets are the key decay risks.

### 17. Size Premium (SMB) (S098) — mean rank 20.5

The Fama-French small-minus-big factor documents that small-cap stocks outperform large caps on average, one of the earliest and most studied anomalies in finance. internet-agent (#15) and hy3 (#13) were most favourable; qwen3.7-max (#30) was most sceptical (std 5.6). The premium is largely driven by micro-caps with high transaction costs, has been unreliable in recent decades, and its existence as a priced risk factor is debated.

### 18. Buybacks & Insider Buying (S107) — mean rank 23.2

Corporate insiders possess information advantages, and open-market insider purchases alongside corporate buyback programmes signal management confidence in undervaluation, generating documented positive abnormal returns. gpt-5.6-luna (#13) and kimi-k3 (#15) were most supportive; mimo-v2.5-pro (#49) was highly sceptical (std 12.0). Signal heterogeneity (not all buybacks are informed), timing difficulty, and regulatory changes to disclosure rules can reduce the edge.

### 19. Pairs Trading — Distance Method (S176) — mean rank 23.3

Pairs trading using the distance method identifies historically correlated stock pairs and trades mean-reversion when the spread diverges, offering a market-neutral, systematic statistical-arbitrage approach. qwen3.7-max (#10) and internet-agent (#10) were most favourable; kimi-k3 (#42) and gpt-5.6-luna (#39) were far more sceptical (std 13.2). Structural breaks in correlations, capacity constraints as more funds trade the same pairs, and transaction costs on frequent rebalancing are the main risks.

### 20. Cointegration Pairs Trading (S177) — mean rank 24.7

Cointegration-based pairs trading improves on the distance method by using formal econometric tests (Engle-Granger / Johansen) to ensure that the pair's spread is mean-reverting in a statistical sense, not just historically close, providing a more rigorous entry/exit framework. qwen3.7-max (#11) and mimo-v2.5-pro (#15) were most favourable; gpt-5.6-luna (#40) and kimi-k3 (#39) were most sceptical (std 11.4). Model estimation risk is significant — cointegration relationships can break down in regime changes — and capacity is limited by the number of valid cointegrated pairs available at any time.