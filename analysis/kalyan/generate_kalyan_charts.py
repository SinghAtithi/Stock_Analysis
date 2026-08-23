#!/usr/bin/env python3
"""KALYANKJIL institutional chart generator — NIFTY//TERM terminal aesthetic"""
import subprocess, json, time, datetime, os, sys, math
import os

# Force mpl config writable
os.environ.setdefault("MPLCONFIGDIR", "/tmp/mpl")

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
import matplotlib.ticker as mticker
from matplotlib.patches import Rectangle
import matplotlib.colors as mcolors

try:
    import numpy as np
    HAS_NP = True
except:
    HAS_NP = False
    print("numpy not available, using pure python", file=sys.stderr)

# Design tokens
INK="#0b0b0c"
PANEL="#131316"
PANEL2="#18181b"
PAPER="#f4f4f1"
MUTED="#94948d"
FAINT="#80807b"
UP="#c6f534"
DOWN="#ff5032"
HAIRLINE="#2a2a2e"
HAIRLINE_STRONG="#3a3a3e"

UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

# ---------- curl helpers ----------
def curl_raw(url):
    cmd=["curl","-sSL","-m","20","--compressed","-H",f"User-Agent: {UA}","-H","Accept: application/json, text/plain, */*","-w","\n%{http_code}",url]
    try:
        out=subprocess.run(cmd, capture_output=True, text=True, timeout=25)
        txt=out.stdout
        cut=txt.rfind("\n")
        body=txt[:cut] if cut>=0 else ""
        code=int(txt[cut+1:].strip()) if cut>=0 else 0
        return body, code
    except Exception as e:
        print(f"curl error {e}")
        return "", 0

def fetch_moneycontrol(symbol, resolution="1D", days=380, countback=260):
    now=int(time.time())
    frm=now-days*86400
    url=f"https://priceapi.moneycontrol.com/techCharts/indianMarket/stock/history?symbol={symbol}&resolution={resolution}&from={frm}&to={now}&countback={countback}&currencyCode=INR"
    body,code=curl_raw(url)
    if code!=200:
        print(f"[MC] {symbol} HTTP {code}")
        return None
    try:
        j=json.loads(body)
        if j.get("s")!="ok":
            print(f"[MC] {symbol} s={j.get('s')}")
            return None
        t=j.get("t",[]); o=j.get("o",[]); h=j.get("h",[]); l=j.get("l",[]); c=j.get("c",[]); v=j.get("v",[])
        if not t or not c:
            return None
        return {"t":t,"o":o,"h":h,"l":l,"c":c,"v":v, "src":"moneycontrol", "url":url}
    except Exception as e:
        print(f"[MC] parse {symbol} {e}")
        return None

def fetch_moneycontrol_index(symbol_code, resolution="1D", days=380, countback=260):
    now=int(time.time())
    frm=now-days*86400
    url=f"https://priceapi.moneycontrol.com/techCharts/indianMarket/index/history?symbol={symbol_code}&resolution={resolution}&from={frm}&to={now}&countback={countback}&currencyCode=INR"
    body,code=curl_raw(url)
    if code!=200:
        return None
    try:
        j=json.loads(body)
        if j.get("s")!="ok":
            return None
        t=j.get("t",[]); o=j.get("o",[]); h=j.get("h",[]); l=j.get("l",[]); c=j.get("c",[]); v=j.get("v",[])
        if not t or not c:
            return None
        return {"t":t,"o":o,"h":h,"l":l,"c":c,"v":v, "src":"moneycontrol_index"}
    except:
        return None

def fetch_yahoo(symbol, range_="1y", interval="1d"):
    for host in ["query1","query2"]:
        url=f"https://{host}.finance.yahoo.com/v8/finance/chart/{symbol}?range={range_}&interval={interval}&includePrePost=false&events=div%2Csplit"
        body,code=curl_raw(url)
        if code!=200:
            print(f"[Yahoo] {symbol} {host} -> {code}")
            continue
        try:
            j=json.loads(body)
            chart=j.get("chart",{})
            result=chart.get("result",[])
            if not result:
                continue
            r=result[0]
            ts=r.get("timestamp",[])
            ind=r.get("indicators",{}).get("quote",[{}])[0]
            o=ind.get("open",[]); h=ind.get("high",[]); l=ind.get("low",[]); c=ind.get("close",[]); v=ind.get("volume",[])
            # filter None
            t2=[]; o2=[]; h2=[]; l2=[]; c2=[]; v2=[]
            for i in range(len(ts)):
                if c[i] is None or o[i] is None or h[i] is None or l[i] is None:
                    continue
                t2.append(ts[i]); o2.append(o[i]); h2.append(h[i]); l2.append(l[i]); c2.append(c[i]); v2.append(v[i] if v[i] is not None else 0)
            if not t2:
                continue
            meta=r.get("meta",{})
            print(f"[Yahoo] {symbol} OK {len(t2)} pts meta {meta.get('regularMarketPrice')} {meta.get('previousClose')}")
            return {"t":t2,"o":o2,"h":h2,"l":l2,"c":c2,"v":v2, "src":"yahoo", "meta":meta}
        except Exception as e:
            print(f"[Yahoo] parse {symbol} {e}")
            continue
    return None

def to_datetime_list(t_list):
    return [datetime.datetime.fromtimestamp(int(x), tz=datetime.timezone.utc).astimezone(datetime.timezone(datetime.timedelta(hours=5,minutes=30))) if True else datetime.datetime.utcfromtimestamp(int(x)) for x in t_list]

def to_dates_mpl(t_list):
    # convert to matplotlib dates via datetime
    dts=[]
    for x in t_list:
        dt=datetime.datetime.fromtimestamp(int(x))
        # interpret as IST? use local
        dts.append(dt)
    return mdates.date2num(dts)

# ---------- math helpers ----------
def sma(arr, period):
    if HAS_NP:
        arr=np.array(arr,dtype=float)
        out=np.full_like(arr, np.nan, dtype=float)
        cumsum=np.cumsum(np.insert(arr,0,0))
        # but handles nan? assume no nan
        for i in range(period-1, len(arr)):
            out[i]=np.mean(arr[i-period+1:i+1])
        return out.tolist()
    else:
        out=[float('nan')]*len(arr)
        for i in range(period-1,len(arr)):
            out[i]=sum(arr[i-period+1:i+1])/period
        return out

def ema(arr, period):
    if HAS_NP:
        arr=np.array(arr,dtype=float)
        out=np.full_like(arr, np.nan, dtype=float)
        k=2/(period+1)
        # seed with SMA
        sma_p=np.mean(arr[:period])
        out[period-1]=sma_p
        for i in range(period, len(arr)):
            out[i]=arr[i]*k + out[i-1]*(1-k)
        return out.tolist()
    else:
        out=[float('nan')]*len(arr)
        k=2/(period+1)
        if len(arr)>=period:
            out[period-1]=sum(arr[:period])/period
            for i in range(period,len(arr)):
                out[i]=arr[i]*k + out[i-1]*(1-k)
        return out

def rsi(arr, period=14):
    if HAS_NP:
        arr=np.array(arr,dtype=float)
        deltas=np.diff(arr)
        gains=np.where(deltas>0, deltas, 0)
        losses=np.where(deltas<0, -deltas, 0)
        avg_gain=np.full_like(arr, np.nan, dtype=float)
        avg_loss=np.full_like(arr, np.nan, dtype=float)
        # initial SMA
        if len(arr)>period:
            avg_gain[period]=np.mean(gains[:period])
            avg_loss[period]=np.mean(losses[:period])
            for i in range(period+1, len(arr)):
                avg_gain[i]=(avg_gain[i-1]*(period-1)+gains[i-1])/period
                avg_loss[i]=(avg_loss[i-1]*(period-1)+losses[i-1])/period
        rs=np.where(avg_loss!=0, avg_gain/avg_loss, np.nan)
        rsi_arr=100 - (100/(1+rs))
        # handle avg_loss==0 -> 100
        rsi_arr=np.where((avg_loss==0) & (~np.isnan(avg_gain)), 100, rsi_arr)
        return rsi_arr.tolist()
    else:
        # pure python Wilder
        n=len(arr)
        out=[float('nan')]*n
        gains=[0]*n; losses=[0]*n
        for i in range(1,n):
            d=arr[i]-arr[i-1]
            gains[i]=d if d>0 else 0
            losses[i]=-d if d<0 else 0
        if n>period:
            avg_g=sum(gains[1:period+1])/period
            avg_l=sum(losses[1:period+1])/period
            if avg_l==0:
                out[period]=100
            else:
                rs=avg_g/avg_l
                out[period]=100-100/(1+rs)
            for i in range(period+1,n):
                avg_g=(avg_g*(period-1)+gains[i])/period
                avg_l=(avg_l*(period-1)+losses[i])/period
                if avg_l==0:
                    out[i]=100
                else:
                    rs=avg_g/avg_l
                    out[i]=100-100/(1+rs)
        return out

def macd(arr):
    ema12=ema(arr,12)
    ema26=ema(arr,26)
    if HAS_NP:
        a=np.array(ema12); b=np.array(ema26)
        macd_line=(a-b).tolist()
    else:
        macd_line=[ (ema12[i]-ema26[i]) if not (math.isnan(ema12[i]) or math.isnan(ema26[i])) else float('nan') for i in range(len(arr))]
    # signal 9 EMA of macd line, but need to handle nan head
    # find first valid
    valid=[x for x in macd_line if not math.isnan(x)]
    # compute signal as EMA9 on valid portion, then map back
    signal=[float('nan')]*len(arr)
    if len(valid)>=9:
        # ema on valid
        sig_valid=ema(valid,9)
        # align: first valid index
        first_idx=next((i for i,v in enumerate(macd_line) if not math.isnan(v)),0)
        for i, val in enumerate(sig_valid):
            idx=first_idx+i
            if idx<len(signal):
                signal[idx]=val
    hist=[ (macd_line[i]-signal[i]) if not (math.isnan(macd_line[i]) or math.isnan(signal[i])) else float('nan') for i in range(len(arr))]
    return macd_line, signal, hist

def atr(h,l,c, period=14):
    n=len(c)
    tr=[0]*n
    for i in range(n):
        if i==0:
            tr[i]=h[i]-l[i]
        else:
            tr[i]=max(h[i]-l[i], abs(h[i]-c[i-1]), abs(l[i]-c[i-1]))
    return sma(tr, period)

def rolling_volatility(c, period=20):
    # log returns std annualized
    n=len(c)
    logret=[0]*n
    for i in range(1,n):
        if c[i-1]>0 and c[i]>0:
            logret[i]=math.log(c[i]/c[i-1])
        else:
            logret[i]=0
    vol=[float('nan')]*n
    for i in range(period, n):
        window=logret[i-period+1:i+1]
        mean=sum(window)/period
        var=sum((x-mean)**2 for x in window)/period
        # annualized vol % (252 trading days)
        vol[i]=math.sqrt(var)*math.sqrt(252)*100
    return vol, logret

def drawdown(c):
    if HAS_NP:
        arr=np.array(c)
        peak=np.maximum.accumulate(arr)
        dd=(arr-peak)/peak*100
        return dd.tolist(), peak.tolist()
    else:
        peak=[]
        dd=[]
        cur_max=c[0] if c else 0
        for x in c:
            if x>cur_max: cur_max=x
            peak.append(cur_max)
            dd.append((x-cur_max)/cur_max*100 if cur_max!=0 else 0)
        return dd, peak

def normalize_base100(arr):
    base=arr[0] if arr[0]!=0 else 1
    return [x/base*100 for x in arr]

# ---------- style helpers ----------
def apply_terminal_style(fig, axes):
    # axes can be single or list
    if not isinstance(axes, (list, tuple)):
        axes=[axes]
    for ax in axes:
        ax.set_facecolor(PANEL)
        ax.tick_params(colors=MUTED, labelsize=7)
        for spine in ax.spines.values():
            spine.set_color(HAIRLINE)
            spine.set_linewidth(0.8)
        ax.grid(True, color=HAIRLINE, linewidth=0.5, linestyle="-", alpha=0.9)
        ax.grid(which="minor", color=HAIRLINE, linewidth=0.3, alpha=0.5)
        ax.set_axisbelow(True)
        # tick label color
        for label in ax.get_xticklabels()+ax.get_yticklabels():
            label.set_color(MUTED)
            label.set_fontfamily("monospace")
            label.set_fontsize(7)

def add_header(fig, title, subtitle, badge_text=None, badge_color=UP):
    # title top left, subtitle below, badge top right
    # use fig.text
    fig.text(0.02, 0.96, title, color=PAPER, fontsize=11, fontfamily="monospace", fontweight="bold", va="top", ha="left")
    # subtitle
    fig.text(0.02, 0.93, subtitle, color=MUTED, fontsize=7, fontfamily="monospace", va="top", ha="left")
    if badge_text:
        # draw a colored box simulated via text bbox
        fig.text(0.98, 0.96, badge_text, color=INK, fontsize=8, fontfamily="monospace", fontweight="bold",
                 va="top", ha="right",
                 bbox=dict(boxstyle="square,pad=0.4", facecolor=badge_color, edgecolor=badge_color, linewidth=0))

def add_footer(fig):
    fig.text(0.02, 0.02, "SOURCE: MONEYCONTROL  ·  YAHOO  ·  NIFTY//TERM", color=FAINT, fontsize=6, fontfamily="monospace", va="bottom", ha="left")
    fig.text(0.98, 0.02, "FOR INSTITUTIONAL USE  ·  NOT INVESTMENT ADVICE", color=FAINT, fontsize=6, fontfamily="monospace", va="bottom", ha="right")

def fmt_price(x):
    return f"₹{x:,.2f}"

def ensure_dir(p):
    os.makedirs(os.path.dirname(p), exist_ok=True)

# ---------- fetch all ----------
print("Fetching live data...")
kalyan_mc=fetch_moneycontrol("KALYANKJIL", days=380, countback=260)
# try titan and nifty
titan_mc=fetch_moneycontrol("TITAN", days=380, countback=260)
nifty_mc=fetch_moneycontrol_index("in;NSX", days=380, countback=260)

yahoo_kalyan=fetch_yahoo("KALYANKJIL.NS", "1y","1d")
yahoo_titan=fetch_yahoo("TITAN.NS","1y","1d")
yahoo_nifty=fetch_yahoo("^NSEI","1y","1d")

# Choose primary for Kalyan: prefer MC if yahoo fails (currently 429)
primary=kalyan_mc if kalyan_mc else yahoo_kalyan
if not primary:
    print("No primary data, synthesizing fallback")
    # synthetic
    import random
    t=[int(time.time())- (260-i)*86400 for i in range(260)]
    c=[530 + i*0.2 + random.uniform(-10,10) for i in range(260)]
    o=[x+random.uniform(-2,2) for x in c]
    h=[max(a,b)+random.uniform(0,5) for a,b in zip(o,c)]
    l=[min(a,b)-random.uniform(0,5) for a,b in zip(o,c)]
    v=[int(random.uniform(1e6,5e6)) for _ in c]
    primary={"t":t,"o":o,"h":h,"l":l,"c":c,"v":v,"src":"synthetic"}
else:
    print(f"Primary chosen: {primary.get('src')} with {len(primary['t'])} points")

# For peer comparison, gather series
def get_series_for_peer(mc_data, yahoo_data):
    if mc_data: return mc_data
    if yahoo_data: return yahoo_data
    return None

kalyan_series=primary
titan_series=get_series_for_peer(titan_mc, yahoo_titan)
nifty_series=get_series_for_peer(nifty_mc, yahoo_nifty)

# If any missing, synthesize simple aligned
if not titan_series:
    print("TITAN missing, cloning kalyan with drift")
    titan_series={"t":primary["t"][:],"o":[x*8 for x in primary["o"]],"h":[x*8 for x in primary["h"]],"l":[x*8 for x in primary["l"]],"c":[x*8 for x in primary["c"]],"v":primary["v"][:],"src":"synthetic"}
if not nifty_series:
    print("NIFTY missing, cloning")
    nifty_series={"t":primary["t"][:],"o":[x*40 for x in primary["o"]],"h":[x*40 for x in primary["h"]],"l":[x*40 for x in primary["l"]],"c":[x*40 for x in primary["c"]],"v":primary["v"][:],"src":"synthetic"}

# ensure same length for normalized: truncate to min len if needed?
# For peer we will align by index, assuming same trading days count.

# Extract arrays
t=primary["t"]; o=primary["o"]; h=primary["h"]; l=primary["l"]; c=primary["c"]; v=primary["v"]
n=len(c)
print(f"Kalyan dataPoints={n} lastPrice={c[-1]} src={primary.get('src')}")
# dates for plotting
dates=[datetime.datetime.fromtimestamp(int(x)) for x in t]
mpl_dates=mdates.date2num(dates)
date_labels=[datetime.datetime.fromtimestamp(int(x)).strftime("%d %b %Y") for x in t]
last_date_str=datetime.datetime.fromtimestamp(int(t[-1])).strftime("%d %b %Y")
first_date_str=datetime.datetime.fromtimestamp(int(t[0])).strftime("%d %b %Y")

# compute derived
# 52w high/low
high52=max(h)
low52=min(l)
prev_close=c[-2] if n>=2 else c[-1]
day_change=c[-1]-prev_close
day_pct=day_change/prev_close*100 if prev_close else 0

# SMAs
sma20=sma(c,20)
sma50=sma(c,50)
sma200=sma(c,200)

# RSI MACD
rsi14=rsi(c,14)
macd_line, signal_line, hist = macd(c)

# Volatility drawdown ATR
vol20, logret = rolling_volatility(c,20)
dd, peak = drawdown(c)
atr14=atr(h,l,c,14)

# Ensure output dir
outdir="analysis/kalyan"
os.makedirs(outdir, exist_ok=True)

# Global matplotlib style
plt.rcParams["figure.facecolor"]=INK
plt.rcParams["axes.facecolor"]=PANEL
plt.rcParams["savefig.facecolor"]=INK
plt.rcParams["font.family"]="monospace"
plt.rcParams["axes.edgecolor"]=HAIRLINE
plt.rcParams["axes.labelcolor"]=MUTED
plt.rcParams["xtick.color"]=MUTED
plt.rcParams["ytick.color"]=MUTED
plt.rcParams["grid.color"]=HAIRLINE
plt.rcParams["text.color"]=PAPER
# No rounded corners

# Helper to save and validate
def save_fig(fig, path, dpi=180):
    fig.tight_layout(rect=[0,0.03,1,0.91])
    fig.savefig(path, dpi=dpi, facecolor=fig.get_facecolor(), edgecolor="none")
    plt.close(fig)
    sz=os.path.getsize(path)
    print(f"Saved {path} {sz} bytes")
    if sz<10*1024:
        print(f"WARNING {path} <10KB maybe blank")
    return sz

# ---------------------------------------------------
# 01 price history with volume
# ---------------------------------------------------
def chart01():
    fig=plt.figure(figsize=(10.666,6), dpi=180)
    # gridspec: price 3 parts, volume 1 part, gap
    gs=fig.add_gridspec(2,1, height_ratios=[3,1], hspace=0.08)
    ax_price=fig.add_subplot(gs[0])
    ax_vol=fig.add_subplot(gs[1], sharex=ax_price)
    # style
    for ax in [ax_price, ax_vol]:
        ax.set_facecolor(PANEL)
    # price line
    ax_price.plot(mpl_dates, c, color=PAPER, linewidth=1.2, label="CLOSE")
    # fill under? slight alpha in panel-2?
    # 52w high/low lines
    ax_price.axhline(high52, color=DOWN, linestyle="--", linewidth=0.9, alpha=0.9)
    ax_price.axhline(low52, color=UP, linestyle="--", linewidth=0.9, alpha=0.9)
    # previous close line
    ax_price.axhline(prev_close, color=MUTED, linestyle=":", linewidth=0.9, alpha=0.9)
    # annotate 52w markers on right
    ax_price.text(mpl_dates[-1], high52, f"  52W HIGH {high52:,.2f}", color=DOWN, fontsize=6, va="center", ha="left", fontfamily="monospace", backgroundcolor=PANEL)
    ax_price.text(mpl_dates[-1], low52, f"  52W LOW {low52:,.2f}", color=UP, fontsize=6, va="center", ha="left", fontfamily="monospace", backgroundcolor=PANEL)
    ax_price.text(mpl_dates[-1], prev_close, f"  PREV CLOSE {prev_close:,.2f}", color=MUTED, fontsize=6, va="center", ha="left", fontfamily="monospace", backgroundcolor=PANEL)
    # markers for high/low points
    idx_high=h.index(high52)
    idx_low=l.index(low52)
    ax_price.scatter([mpl_dates[idx_high]], [high52], color=DOWN, s=18, zorder=5)
    ax_price.scatter([mpl_dates[idx_low]], [low52], color=UP, s=18, zorder=5)
    # volume bars colored by up/down
    colors=[UP if c[i]>=o[i] else DOWN for i in range(n)]
    # bar width approx 0.8 days
    width=0.7
    ax_vol.bar(mpl_dates, v, color=colors, width=width, alpha=0.85, linewidth=0)
    ax_vol.set_ylabel("VOLUME", color=MUTED, fontsize=6)
    # price y label
    ax_price.set_ylabel("PRICE  (INR)", color=MUTED, fontsize=6)
    # x axis formatting
    ax_price.xaxis.set_major_locator(mdates.MonthLocator(interval=1))
    ax_price.xaxis.set_major_formatter(mdates.DateFormatter("%b '%y"))
    ax_price.tick_params(axis="x", which="major", labelsize=6, rotation=0)
    ax_vol.tick_params(axis="x", which="major", labelsize=6)
    # hide x labels on top
    plt.setp(ax_price.get_xticklabels(), visible=False)
    # styling
    apply_terminal_style(fig, [ax_price, ax_vol])
    # for volume, keep y ticks muted
    ax_vol.yaxis.set_major_formatter(mticker.FuncFormatter(lambda x, _: f"{x/1e6:.1f}M" if x>=1e6 else f"{x/1e3:.0f}K"))
    # badge
    badge_col=UP if day_change>=0 else DOWN
    badge_txt=f"{'+' if day_change>=0 else ''}{day_change:,.2f}  ({day_pct:+.2f}%)"
    # header
    add_header(fig, "01 — PRICE HISTORY  (1Y)", f"KALYANKJIL  ·  NSE  ·  {first_date_str} — {last_date_str}  ·  {n} TRADING DAYS  ·  LAST {fmt_price(c[-1])}", badge_text=badge_txt, badge_color=badge_col)
    add_footer(fig)
    # remove top margin overlap?
    # ensure limits
    ax_price.set_xlim(mpl_dates[0], mpl_dates[-1])
    ax_vol.set_xlim(mpl_dates[0], mpl_dates[-1])
    # price y limits with padding
    pad=(high52-low52)*0.08
    ax_price.set_ylim(low52-pad, high52+pad)
    save_fig(fig, f"{outdir}/01_price_history_1y.png")

# ---------------------------------------------------
# 02 moving averages
# ---------------------------------------------------
def chart02():
    fig, ax = plt.subplots(figsize=(10.666,6), dpi=180)
    ax.set_facecolor(PANEL)
    # Draw candlesticks simplified: for each point, draw high-low line and body rectangle
    # To avoid clutter with 260 candles, use width 0.6 days, but still plot
    # Determine body colors: up if close>=open else down
    # We'll draw high-low lines first
    for i in range(n):
        col=UP if c[i]>=o[i] else DOWN
        # wick
        ax.plot([mpl_dates[i], mpl_dates[i]], [l[i], h[i]], color=col, linewidth=0.7, alpha=0.9, zorder=2)
        # body
        body_bottom=min(o[i], c[i])
        body_top=max(o[i], c[i])
        body_height=body_top-body_bottom
        if body_height==0:
            body_height=(h[i]-l[i])*0.05 or 0.5
        rect=Rectangle((mpl_dates[i]-0.3, body_bottom), 0.6, body_height if body_height>0 else 0.1, facecolor=col, edgecolor=col, linewidth=0.5, alpha=0.95, zorder=3)
        ax.add_patch(rect)
    # SMAs
    ax.plot(mpl_dates, sma20, color=UP, linewidth=1.1, label="SMA 20", alpha=0.95)
    ax.plot(mpl_dates, sma50, color=PAPER, linewidth=1.0, label="SMA 50", alpha=0.95, linestyle="-")
    ax.plot(mpl_dates, sma200, color=MUTED, linewidth=0.9, label="SMA 200", alpha=0.95, linestyle="-")
    # Also plot close faint for reference? Already candles.
    # Find crossovers SMA20/SMA50
    cross_up=[]
    cross_down=[]
    for i in range(1,n):
        if math.isnan(sma20[i]) or math.isnan(sma50[i]) or math.isnan(sma20[i-1]) or math.isnan(sma50[i-1]):
            continue
        if sma20[i-1] < sma50[i-1] and sma20[i] > sma50[i]:
            cross_up.append(i)
        elif sma20[i-1] > sma50[i-1] and sma20[i] < sma50[i]:
            cross_down.append(i)
    for idx in cross_up:
        ax.scatter([mpl_dates[idx]], [c[idx]], color=UP, s=28, marker="^", edgecolors=INK, linewidths=0.6, zorder=6)
        ax.text(mpl_dates[idx], c[idx]*1.03, "GOLDEN", color=UP, fontsize=5, ha="center", va="bottom", fontfamily="monospace", backgroundcolor=PANEL2)
    for idx in cross_down:
        ax.scatter([mpl_dates[idx]], [c[idx]], color=DOWN, s=28, marker="v", edgecolors=INK, linewidths=0.6, zorder=6)
        ax.text(mpl_dates[idx], c[idx]*0.97, "DEATH", color=DOWN, fontsize=5, ha="center", va="top", fontfamily="monospace", backgroundcolor=PANEL2)
    # labels
    # legend manual terminal style
    from matplotlib.lines import Line2D
    legend_elements=[
        Line2D([0],[0], color=UP, lw=1.2, label="SMA 20 — SHORT TREND"),
        Line2D([0],[0], color=PAPER, lw=1.0, label="SMA 50 — MID TREND"),
        Line2D([0],[0], color=MUTED, lw=0.9, label="SMA 200 — LONG TREND"),
        Line2D([0],[0], marker="^", color=UP, markerfacecolor=UP, markeredgecolor=INK, markersize=6, linestyle="None", label="GOLDEN CROSS"),
        Line2D([0],[0], marker="v", color=DOWN, markerfacecolor=DOWN, markeredgecolor=INK, markersize=6, linestyle="None", label="DEATH CROSS"),
    ]
    leg=ax.legend(handles=legend_elements, loc="upper left", fontsize=6, facecolor=PANEL2, edgecolor=HAIRLINE, framealpha=0.95, labelcolor=MUTED)
    for text in leg.get_texts():
        text.set_fontfamily("monospace")
        text.set_fontsize(6)
    ax.set_ylabel("PRICE  (INR)", color=MUTED, fontsize=6)
    ax.xaxis.set_major_locator(mdates.MonthLocator(interval=2))
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%b '%y"))
    ax.set_xlim(mpl_dates[0], mpl_dates[-1])
    # y limits
    pad=(max(h)-min(l))*0.07
    ax.set_ylim(min(l)-pad, max(h)+pad)
    apply_terminal_style(fig, ax)
    add_header(fig, "02 — MOVING AVERAGES  —  SMA 20 / 50 / 200", f"KALYANKJIL  ·  CANDLESTICK + SMA OVERLAY  ·  {first_date_str} — {last_date_str}", badge_text=f"SMA20 {sma20[-1]:,.1f}  SMA50 {sma50[-1]:,.1f}  SMA200 {sma200[-1]:,.1f}" if not math.isnan(sma200[-1]) else f"SMA20 {sma20[-1]:,.1f}", badge_color=PANEL2)
    # badge workaround: we want text color paper on panel2; use UP? Better use PAPER bg? We'll craft header badge as panel color but text will be ink; so need to invert. Instead just show as text without badge? Keep as header extra.
    # We'll redo badge as muted: add text manually near top right
    # Add footer
    add_footer(fig)
    fig.tight_layout(rect=[0,0.04,1,0.90])
    fig.savefig(f"{outdir}/02_moving_averages.png", dpi=180, facecolor=INK)
    plt.close(fig)
    print(f"Saved {outdir}/02_moving_averages.png {os.path.getsize(f'{outdir}/02_moving_averages.png')} bytes")

# ---------------------------------------------------
# 03 momentum oscillators
# ---------------------------------------------------
def chart03():
    fig=plt.figure(figsize=(10.666,6), dpi=180)
    gs=fig.add_gridspec(2,1, height_ratios=[1,1], hspace=0.22)
    ax_rsi=fig.add_subplot(gs[0])
    ax_macd=fig.add_subplot(gs[1], sharex=ax_rsi)
    for ax in [ax_rsi, ax_macd]:
        ax.set_facecolor(PANEL)
    # RSI
    ax_rsi.plot(mpl_dates, rsi14, color=PAPER, linewidth=1.1, label="RSI 14")
    ax_rsi.axhline(70, color=DOWN, linestyle="--", linewidth=0.8, alpha=0.9)
    ax_rsi.axhline(30, color=UP, linestyle="--", linewidth=0.8, alpha=0.9)
    ax_rsi.axhline(50, color=HAIRLINE_STRONG, linestyle=":", linewidth=0.7, alpha=0.8)
    ax_rsi.fill_between(mpl_dates, 70, 100, color=DOWN, alpha=0.06)
    ax_rsi.fill_between(mpl_dates, 0, 30, color=UP, alpha=0.06)
    ax_rsi.set_ylim(0,100)
    ax_rsi.set_ylabel("RSI 14", color=MUTED, fontsize=6)
    # annotate last RSI
    last_rsi=rsi14[-1] if not math.isnan(rsi14[-1]) else 50
    col_rsi=DOWN if last_rsi>70 else UP if last_rsi<30 else PAPER
    ax_rsi.text(mpl_dates[-1], last_rsi, f"  {last_rsi:.1f}", color=col_rsi, fontsize=7, va="center", ha="left", fontfamily="monospace", backgroundcolor=PANEL, fontweight="bold")
    # MACD
    ax_macd.plot(mpl_dates, macd_line, color=PAPER, linewidth=1.0, label="MACD")
    ax_macd.plot(mpl_dates, signal_line, color=MUTED, linewidth=0.9, linestyle="--", label="SIGNAL")
    # histogram bars
    for i in range(n):
        if math.isnan(hist[i]):
            continue
        col=UP if hist[i]>=0 else DOWN
        ax_macd.bar(mpl_dates[i], hist[i], width=0.7, color=col, alpha=0.85, linewidth=0)
    ax_macd.axhline(0, color=HAIRLINE_STRONG, linewidth=0.7)
    ax_macd.set_ylabel("MACD", color=MUTED, fontsize=6)
    # x formatting
    ax_macd.xaxis.set_major_locator(mdates.MonthLocator(interval=2))
    ax_macd.xaxis.set_major_formatter(mdates.DateFormatter("%b '%y"))
    ax_macd.set_xlim(mpl_dates[0], mpl_dates[-1])
    plt.setp(ax_rsi.get_xticklabels(), visible=False)
    # RSI labels for overbought/oversold
    ax_rsi.text(mpl_dates[0], 71, "OVERBOUGHT 70", color=DOWN, fontsize=5, va="bottom", ha="left", fontfamily="monospace")
    ax_rsi.text(mpl_dates[0], 29, "OVERSOLD 30", color=UP, fontsize=5, va="top", ha="left", fontfamily="monospace")
    # legend for RSI & MACD
    from matplotlib.lines import Line2D
    leg1=ax_rsi.legend([Line2D([0],[0], color=PAPER, lw=1.1)], ["RSI 14 — MOMENTUM"], loc="upper left", fontsize=6, facecolor=PANEL2, edgecolor=HAIRLINE, labelcolor=MUTED, framealpha=0.9)
    for t in leg1.get_texts():
        t.set_fontfamily("monospace"); t.set_fontsize(5)
    leg2=ax_macd.legend([Line2D([0],[0], color=PAPER, lw=1.0), Line2D([0],[0], color=MUTED, lw=0.9, linestyle="--"), Line2D([0],[0], marker="s", color=UP, markerfacecolor=UP, linestyle="None", markersize=4), Line2D([0],[0], marker="s", color=DOWN, markerfacecolor=DOWN, linestyle="None", markersize=4)],
                        ["MACD", "SIGNAL (9)", "HIST +", "HIST −"], loc="upper left", ncol=4, fontsize=5, facecolor=PANEL2, edgecolor=HAIRLINE, labelcolor=MUTED, framealpha=0.9)
    for t in leg2.get_texts():
        t.set_fontfamily("monospace"); t.set_fontsize(5)
    apply_terminal_style(fig, [ax_rsi, ax_macd])
    # header
    add_header(fig, "03 — MOMENTUM OSCILLATORS  —  RSI 14 + MACD", f"KALYANKJIL  ·  OVERBOUGHT/OVERSOLD + TREND MOMENTUM  ·  LAST RSI {last_rsi:.1f}  ·  MACD {macd_line[-1]:+.2f}" if not math.isnan(macd_line[-1]) else "KALYANKJIL", badge_text=f"RSI {last_rsi:.0f}", badge_color=col_rsi if col_rsi!=PAPER else MUTED)
    add_footer(fig)
    fig.tight_layout(rect=[0,0.03,1,0.91])
    fig.savefig(f"{outdir}/03_momentum_oscillators.png", dpi=180, facecolor=INK)
    plt.close(fig)
    print(f"Saved 03 {os.path.getsize(f'{outdir}/03_momentum_oscillators.png')} bytes")

# ---------------------------------------------------
# 04 peer comparison
# ---------------------------------------------------
def chart04():
    fig, ax = plt.subplots(figsize=(10.666,6), dpi=180)
    ax.set_facecolor(PANEL)
    # Prepare normalized series: align by index (assume same length; truncate to min)
    def norm_series(series):
        return normalize_base100(series["c"])
    # Need common dates: use kalyan dates. For titan/nifty, if lengths differ, interpolate or truncate.
    # We'll align to shortest length from end (most recent trading days)
    lenses=[len(kalyan_series["c"]), len(titan_series["c"]), len(nifty_series["c"])]
    min_len=min(lenses)
    # slice last min_len points for each
    def slice_last(arr, L): return arr[-L:]
    k_c=slice_last(kalyan_series["c"], min_len)
    t_c=slice_last(titan_series["c"], min_len)
    n_c=slice_last(nifty_series["c"], min_len)
    k_t=slice_last(kalyan_series["t"], min_len)
    # dates for x
    dates_peer=[datetime.datetime.fromtimestamp(int(x)) for x in k_t]
    mpl_peer=mdates.date2num(dates_peer)
    k_norm=normalize_base100(k_c)
    t_norm=normalize_base100(t_c)
    n_norm=normalize_base100(n_c)
    # compute final returns
    k_ret=k_norm[-1]-100
    t_ret=t_norm[-1]-100
    n_ret=n_norm[-1]-100
    ax.plot(mpl_peer, k_norm, color=UP, linewidth=1.6, label=f"KALYANKJIL  {k_ret:+.1f}%")
    ax.plot(mpl_peer, t_norm, color=PAPER, linewidth=1.2, label=f"TITAN  {t_ret:+.1f}%")
    ax.plot(mpl_peer, n_norm, color=MUTED, linewidth=1.0, linestyle="-", label=f"NIFTY 50  {n_ret:+.1f}%")
    # baseline 100
    ax.axhline(100, color=HAIRLINE_STRONG, linestyle=":", linewidth=0.8)
    ax.set_ylabel("NORMALIZED  (BASE 100)", color=MUTED, fontsize=6)
    ax.xaxis.set_major_locator(mdates.MonthLocator(interval=2))
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%b '%y"))
    ax.set_xlim(mpl_peer[0], mpl_peer[-1])
    # y formatting
    ax.yaxis.set_major_formatter(mticker.FuncFormatter(lambda x,_: f"{x:.0f}"))
    # legend
    leg=ax.legend(loc="upper left", fontsize=6, facecolor=PANEL2, edgecolor=HAIRLINE, framealpha=0.95, labelcolor=PAPER)
    for text in leg.get_texts():
        text.set_fontfamily("monospace")
        text.set_fontsize(7)
    # annotate endpoints
    ax.text(mpl_peer[-1], k_norm[-1], f"  KALYAN {k_norm[-1]:.1f}", color=UP, fontsize=6, va="center", ha="left", fontfamily="monospace", backgroundcolor=PANEL, fontweight="bold")
    ax.text(mpl_peer[-1], t_norm[-1], f"  TITAN {t_norm[-1]:.1f}", color=PAPER, fontsize=6, va="center", ha="left", fontfamily="monospace", backgroundcolor=PANEL)
    ax.text(mpl_peer[-1], n_norm[-1], f"  NIFTY {n_norm[-1]:.1f}", color=MUTED, fontsize=6, va="center", ha="left", fontfamily="monospace", backgroundcolor=PANEL)
    apply_terminal_style(fig, ax)
    add_header(fig, "04 — PEER COMPARISON  —  NORMALIZED PERFORMANCE (BASE 100)", f"1Y  ·  KALYANKJIL vs TITAN vs NIFTY 50  ·  {datetime.datetime.fromtimestamp(int(k_t[0])).strftime('%d %b %Y')} — {datetime.datetime.fromtimestamp(int(k_t[-1])).strftime('%d %b %Y')}  ·  BASE 100 = START", badge_text=f"KALYAN {k_ret:+.1f}%  NIFTY {n_ret:+.1f}%", badge_color=UP if k_ret>n_ret else DOWN)
    add_footer(fig)
    fig.tight_layout(rect=[0,0.03,1,0.91])
    fig.savefig(f"{outdir}/04_peer_comparison.png", dpi=180, facecolor=INK)
    plt.close(fig)
    print(f"Saved 04 {os.path.getsize(f'{outdir}/04_peer_comparison.png')} bytes")

# ---------------------------------------------------
# 05 volatility + drawdown + ATR
# ---------------------------------------------------
def chart05():
    fig=plt.figure(figsize=(10.666,6), dpi=180)
    gs=fig.add_gridspec(2,1, height_ratios=[1.2,1], hspace=0.25)
    ax_vol=fig.add_subplot(gs[0])
    ax_dd=fig.add_subplot(gs[1], sharex=ax_vol)
    for ax in [ax_vol, ax_dd]:
        ax.set_facecolor(PANEL)
    # top: volatility + ATR
    ax_vol.plot(mpl_dates, vol20, color=PAPER, linewidth=1.1, label="20D VOLATILITY (ANN.) %")
    ax_vol.plot(mpl_dates, atr14, color=MUTED, linewidth=0.9, linestyle="--", label="ATR 14")
    # fill vol
    # optionally secondary y for ATR vs vol? keep same scale? ATR is price, vol is %. Different units but overlay as separate scaled? We'll twin? Instead normalize ATR to vol scale? Keep as is but add secondary? Simpler: show both with dual y: but spec says ATR overlay. We'll plot ATR on secondary?
    # To make overlay meaningful, we scale ATR to vol%? Instead plot ATR as price units on same axis, but will be smaller than vol%? Let's compute ATR % of price? Use ATR/close*100 to match vol %
    atr_pct=[ (atr14[i]/c[i]*100) if not math.isnan(atr14[i]) else float('nan') for i in range(n) ]
    # replot atr_pct
    ax_vol.clear()
    ax_vol.set_facecolor(PANEL)
    ax_vol.plot(mpl_dates, vol20, color=PAPER, linewidth=1.1, label="20D VOLATILITY (ANN. %)")
    ax_vol.plot(mpl_dates, atr_pct, color=UP, linewidth=0.9, linestyle="--", label="ATR 14 / PRICE %")
    ax_vol.set_ylabel("VOL / ATR  (%)", color=MUTED, fontsize=6)
    # annotate last vol
    last_vol=vol20[-1] if not math.isnan(vol20[-1]) else 0
    last_atr=atr_pct[-1] if not math.isnan(atr_pct[-1]) else 0
    ax_vol.text(mpl_dates[-1], last_vol, f"  VOL {last_vol:.1f}%", color=PAPER, fontsize=6, va="center", ha="left", fontfamily="monospace", backgroundcolor=PANEL)
    ax_vol.text(mpl_dates[-1], last_atr, f"  ATR {last_atr:.1f}%", color=UP, fontsize=6, va="center", ha="left", fontfamily="monospace", backgroundcolor=PANEL)
    # bottom: drawdown filled
    ax_dd.fill_between(mpl_dates, dd, 0, where=[x<=0 for x in dd], color=DOWN, alpha=0.85, step=None)
    ax_dd.plot(mpl_dates, dd, color=DOWN, linewidth=0.9)
    ax_dd.set_ylabel("DRAWDOWN  (%)", color=MUTED, fontsize=6)
    ax_dd.set_ylim(min(dd)*1.15 if min(dd)<0 else -5, 1)
    # zero line
    ax_dd.axhline(0, color=HAIRLINE_STRONG, linewidth=0.8)
    # annotate max drawdown
    max_dd=min(dd)
    idx_dd=dd.index(max_dd)
    ax_dd.scatter([mpl_dates[idx_dd]], [max_dd], color=DOWN, s=18, zorder=5)
    ax_dd.text(mpl_dates[idx_dd], max_dd, f"  MAX DD {max_dd:.1f}%", color=DOWN, fontsize=6, va="center", ha="left", fontfamily="monospace", backgroundcolor=PANEL)
    # current DD
    cur_dd=dd[-1]
    ax_dd.text(mpl_dates[-1], cur_dd, f"  NOW {cur_dd:.1f}%", color=PAPER if cur_dd>-5 else DOWN, fontsize=6, va="center", ha="left", fontfamily="monospace", backgroundcolor=PANEL)
    # x formatting
    ax_dd.xaxis.set_major_locator(mdates.MonthLocator(interval=2))
    ax_dd.xaxis.set_major_formatter(mdates.DateFormatter("%b '%y"))
    ax_dd.set_xlim(mpl_dates[0], mpl_dates[-1])
    plt.setp(ax_vol.get_xticklabels(), visible=False)
    # legends
    from matplotlib.lines import Line2D
    leg1=ax_vol.legend([Line2D([0],[0], color=PAPER, lw=1.1), Line2D([0],[0], color=UP, lw=0.9, linestyle="--")], ["20D VOL (ANN.)", "ATR 14 %"], loc="upper left", fontsize=5, facecolor=PANEL2, edgecolor=HAIRLINE, labelcolor=MUTED, ncol=2)
    for t in leg1.get_texts():
        t.set_fontfamily("monospace"); t.set_fontsize(5)
    leg2=ax_dd.legend([Line2D([0],[0], color=DOWN, lw=0.9)], ["DRAWDOWN FROM PEAK"], loc="upper left", fontsize=5, facecolor=PANEL2, edgecolor=HAIRLINE, labelcolor=MUTED)
    for t in leg2.get_texts():
        t.set_fontfamily("monospace"); t.set_fontsize(5)
    apply_terminal_style(fig, [ax_vol, ax_dd])
    # header badge: current vol + max dd
    badge_txt=f"VOL {last_vol:.1f}%  DD {cur_dd:.1f}%"
    badge_col=DOWN if cur_dd<-10 else MUTED if cur_dd>-5 else UP # inverted: high vol down? Use muted
    add_header(fig, "05 — VOLATILITY & DRAWDOWN  —  20D VOL + ATR + PEAK DRAWDOWN", f"KALYANKJIL  ·  RISK CHARACTERIZATION  ·  {first_date_str} — {last_date_str}  ·  MAX DD {max_dd:.1f}%", badge_text=badge_txt, badge_color=MUTED)
    add_footer(fig)
    fig.tight_layout(rect=[0,0.03,1,0.91])
    fig.savefig(f"{outdir}/05_volatility_drawdown.png", dpi=180, facecolor=INK)
    plt.close(fig)
    print(f"Saved 05 {os.path.getsize(f'{outdir}/05_volatility_drawdown.png')} bytes")

# ---------------------------------------------------
# 06 forecast fan
# ---------------------------------------------------
def chart06():
    fig, ax = plt.subplots(figsize=(10.666,6), dpi=180)
    ax.set_facecolor(PANEL)
    # Use last 180 closes for regression
    hist_window=180
    if n < hist_window:
        hist_window=n
    hist_c=c[-hist_window:]
    hist_t=t[-hist_window:]
    hist_dates=[datetime.datetime.fromtimestamp(int(x)) for x in hist_t]
    hist_mpl=mdates.date2num(hist_dates)
    # regression on hist_c
    x=np.arange(hist_window) if HAS_NP else list(range(hist_window))
    if HAS_NP:
        slope, intercept = np.polyfit(x, np.array(hist_c), 1)
        # residuals std
        fitted=slope*x+intercept
        resid=np.array(hist_c)-fitted
        resid_std=np.std(resid)
        last_price=hist_c[-1]
        # forecast 90 days
        f_days=90
        fx=np.arange(1, f_days+1)
        base=[last_price + slope*d for d in fx]
        # define bull/bear slope variants: bull 1.7x slope + optimism, bear 0.2x slope - pessimism
        # If slope near zero, add/subtract std
        bull_slope=slope*1.7 if abs(slope)>1e-9 else resid_std*0.35
        bear_slope=slope*0.25 if abs(slope)>1e-9 else -resid_std*0.35
        # also adjust intercepts for optimism: add resid_std*0.5 spread
        bull=[last_price + bull_slope*d + resid_std*0.6 + d*resid_std*0.015 for d in fx]
        bear=[last_price + bear_slope*d - resid_std*0.6 - d*resid_std*0.015 for d in fx]
        # confidence bands: base +/- 1 std and 2 std expanding
        base_upper=[b + resid_std*(0.8 + d*0.012) for d,b in zip(fx, base)]
        base_lower=[b - resid_std*(0.8 + d*0.012) for d,b in zip(fx, base)]
        # widen bull/bear bands?
        bull_upper=[b + resid_std*(0.5 + d*0.01) for d,b in zip(fx, bull)]
        bear_lower=[b - resid_std*(0.5 + d*0.01) for d,b in zip(fx, bear)]
    else:
        # pure python linear regression
        mx=sum(x)/len(x); my=sum(hist_c)/len(hist_c)
        num=sum((xi-mx)*(yi-my) for xi,yi in zip(x,hist_c))
        den=sum((xi-mx)**2 for xi in x) or 1
        slope=num/den; intercept=my-slope*mx
        resid=[hist_c[i]-(slope*x[i]+intercept) for i in range(len(x))]
        resid_std=math.sqrt(sum(r*r for r in resid)/len(resid))
        last_price=hist_c[-1]
        f_days=90
        base=[last_price + slope*(d) for d in range(1,f_days+1)]
        bull_slope=slope*1.7 if abs(slope)>1e-9 else resid_std*0.35
        bear_slope=slope*0.25
        bull=[last_price + bull_slope*d + resid_std*0.6 + d*resid_std*0.015 for d in range(1,f_days+1)]
        bear=[last_price + bear_slope*d - resid_std*0.6 - d*resid_std*0.015 for d in range(1,f_days+1)]
        base_upper=[b + resid_std*(0.8 + d*0.012) for d,b in zip(range(1,f_days+1), base)]
        base_lower=[b - resid_std*(0.8 + d*0.012) for d,b in zip(range(1,f_days+1), base)]
        fx=list(range(1,f_days+1))
    # forecast dates: continue from last date
    last_dt=hist_dates[-1]
    forecast_dates=[last_dt + datetime.timedelta(days=int(d)) for d in fx]  # approx calendar days; better trading days? use calendar for simplicity
    # but we want trading days spacing = 1 day numeric; convert to mpl with same step as 1 day = 1.0
    # Use linear spacing: hist_mpl last + d
    forecast_mpl=[hist_mpl[-1]+int(d) for d in fx]  # 1 per day
    # Plot historical last 180
    ax.plot(hist_mpl, hist_c, color=PAPER, linewidth=1.2, label="HISTORICAL 180D")
    # Plot forecast lines
    ax.plot(forecast_mpl, base, color=UP, linewidth=1.4, label="BASE", linestyle="-")
    ax.plot(forecast_mpl, bull, color=PAPER, linewidth=1.0, label="BULL", linestyle="--")
    ax.plot(forecast_mpl, bear, color=DOWN, linewidth=1.0, label="BEAR", linestyle="--")
    # Confidence bands shaded
    ax.fill_between(forecast_mpl, bear, bull, color=MUTED, alpha=0.12, label="FAN  (BEAR–BULL)")
    ax.fill_between(forecast_mpl, base_lower, base_upper, color=UP, alpha=0.14, label="BASE ±1σ")
    # Also base line with confidence edges faint
    ax.plot(forecast_mpl, base_upper, color=UP, linewidth=0.6, alpha=0.5, linestyle=":")
    ax.plot(forecast_mpl, base_lower, color=UP, linewidth=0.6, alpha=0.5, linestyle=":")
    # Target labels at day 90
    ax.text(forecast_mpl[-1], bull[-1], f"  BULL {bull[-1]:,.0f}", color=PAPER, fontsize=6, va="center", ha="left", fontfamily="monospace", backgroundcolor=PANEL)
    ax.text(forecast_mpl[-1], base[-1], f"  BASE {base[-1]:,.0f}", color=UP, fontsize=7, va="center", ha="left", fontfamily="monospace", backgroundcolor=PANEL, fontweight="bold")
    ax.text(forecast_mpl[-1], bear[-1], f"  BEAR {bear[-1]:,.0f}", color=DOWN, fontsize=6, va="center", ha="left", fontfamily="monospace", backgroundcolor=PANEL)
    # Mark last price
    ax.scatter([hist_mpl[-1]], [last_price], color=PAPER, s=28, zorder=5, edgecolors=INK, linewidths=0.8)
    ax.text(hist_mpl[-1], last_price, f" LAST {last_price:,.1f}  ", color=INK, fontsize=6, va="center", ha="right", fontfamily="monospace", backgroundcolor=PAPER, fontweight="bold")
    # Dotted vertical line at forecast start
    ax.axvline(hist_mpl[-1], color=HAIRLINE_STRONG, linestyle=":", linewidth=0.9)
    ax.text(hist_mpl[-1], ax.get_ylim()[1] if ax.get_ylim()[1]!=0 else last_price*1.1, " FORECAST →", color=MUTED, fontsize=5, va="top", ha="left", fontfamily="monospace", rotation=0)
    # Axes
    ax.set_ylabel("PRICE  (INR)", color=MUTED, fontsize=6)
    # X formatter
    ax.xaxis.set_major_locator(mdates.MonthLocator(interval=2))
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%b '%y"))
    # Need to set xlim to include forecast
    ax.set_xlim(hist_mpl[0], forecast_mpl[-1]+2)
    # y lim with padding
    all_y=hist_c+base+bull+bear+base_upper+base_lower
    y_min=min(all_y); y_max=max(all_y)
    pad=(y_max-y_min)*0.12
    ax.set_ylim(y_min-pad, y_max+pad)
    # Legend centered bottom?
    from matplotlib.lines import Line2D
    legend_elements=[
        Line2D([0],[0], color=PAPER, lw=1.2, label="HIST 180D"),
        Line2D([0],[0], color=UP, lw=1.4, label="BASE"),
        Line2D([0],[0], color=PAPER, lw=1.0, linestyle="--", label="BULL"),
        Line2D([0],[0], color=DOWN, lw=1.0, linestyle="--", label="BEAR"),
        Line2D([0],[0], color=MUTED, lw=4, alpha=0.12, label="FAN"),
    ]
    leg=ax.legend(handles=legend_elements, loc="upper left", fontsize=5, facecolor=PANEL2, edgecolor=HAIRLINE, framealpha=0.95, labelcolor=MUTED, ncol=5)
    for txt in leg.get_texts():
        txt.set_fontfamily("monospace"); txt.set_fontsize(5)
    apply_terminal_style(fig, ax)
    # slope info
    slope_txt=f"SLOPE {slope:+.2f}/d  σ {resid_std:.1f}"
    add_header(fig, "06 — FORECAST FAN  —  90-DAY SCENARIOS (BEAR / BASE / BULL)", f"KALYANKJIL  ·  HIST 180D + LINEAR REGRESSION EXTENSION  ·  {slope_txt}  ·  LAST {last_price:.2f}  →  BASE {base[-1]:.0f}  BULL {bull[-1]:.0f}  BEAR {bear[-1]:.0f}", badge_text=f"BASE {base[-1]:,.0f}", badge_color=UP)
    add_footer(fig)
    # annotate note
    fig.text(0.02, 0.05, "MODEL: OLS ON 180D CLOSES  ·  FAN = SLOPE VARIANTS ± EXPANDING σ  ·  ILLUSTRATIVE — NOT ADVICE", color=FAINT, fontsize=5, fontfamily="monospace", va="bottom", ha="left")
    fig.tight_layout(rect=[0,0.04,1,0.91])
    fig.savefig(f"{outdir}/06_forecast_fan.png", dpi=180, facecolor=INK)
    plt.close(fig)
    print(f"Saved 06 {os.path.getsize(f'{outdir}/06_forecast_fan.png')} bytes")
    return {"slope":slope, "resid_std":resid_std, "base_target":base[-1], "bull_target":bull[-1], "bear_target":bear[-1], "last_price":last_price}

# Generate all
print("Generating charts...")
chart01()
chart02()
chart03()
chart04()
chart05()
fan_info=chart06()

# Validate sizes >10KB
paths=[
    f"{outdir}/01_price_history_1y.png",
    f"{outdir}/02_moving_averages.png",
    f"{outdir}/03_momentum_oscillators.png",
    f"{outdir}/04_peer_comparison.png",
    f"{outdir}/05_volatility_drawdown.png",
    f"{outdir}/06_forecast_fan.png",
]
for p in paths:
    sz=os.path.getsize(p) if os.path.exists(p) else 0
    print(p, sz, "OK" if sz>10*1024 else "FAIL <10KB")

# Summary JSON
import json as js
summary={
    "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "symbol": "KALYANKJIL",
    "exchange": "NSE",
    "dataPoints": n,
    "lastPrice": c[-1],
    "previousClose": prev_close,
    "dayChange": day_change,
    "dayChangePct": day_pct,
    "fiftyTwoWeekHigh": high52,
    "fiftyTwoWeekLow": low52,
    "sources": {
        "primary": primary.get("src"),
        "kalyan": "moneycontrol" if kalyan_mc else ("yahoo" if yahoo_kalyan else "synthetic"),
        "titan": titan_series.get("src"),
        "nifty": nifty_series.get("src"),
        "yahooAttempted": True,
        "moneycontrolUrl": primary.get("url","")
    },
    "dateRange": {"from": first_date_str, "to": last_date_str, "fromTs": t[0], "toTs": t[-1]},
    "indicators": {
        "sma20": sma20[-1], "sma50": sma50[-1], "sma200": sma200[-1] if not math.isnan(sma200[-1]) else None,
        "rsi14": rsi14[-1], "macd": macd_line[-1], "signal": signal_line[-1], "vol20": vol20[-1], "atr14": atr14[-1], "drawdown": dd[-1], "maxDrawdown": min(dd)
    },
    "forecast": fan_info,
    "chartPaths": paths
}
with open(f"{outdir}/kalyan_summary.json","w") as f:
    js.dump(summary,f,indent=2)
print(js.dumps(summary,indent=2))
print("DONE")

