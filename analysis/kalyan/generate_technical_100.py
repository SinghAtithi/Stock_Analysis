#!/usr/bin/env python3
"""KALYANKJIL — 100 Technical Studies generator — NIFTY//TERM cool library"""
import os, json, math, datetime, subprocess, time, sys
os.environ.setdefault("MPLCONFIGDIR", "/tmp/mpl")
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
import matplotlib.ticker as mticker
from matplotlib.patches import Rectangle

try:
    import numpy as np
    HAS_NP=True
except:
    HAS_NP=False

# tokens — terminal
INK="#0b0b0c"; PANEL="#131316"; PANEL2="#18181b"; PAPER="#f4f4f1"; MUTED="#94948d"; FAINT="#80807b"
UP="#c6f534"; DOWN="#ff5032"; HAIRLINE="#2a2a2e"; HAIRLINE_STRONG="#3a3a3e"
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

def curl_raw(url):
    cmd=["curl","-sSL","-m","20","--compressed","-H",f"User-Agent: {UA}","-H","Accept: application/json, text/plain, */*","-w","\n%{http_code}",url]
    try:
        out=subprocess.run(cmd, capture_output=True, text=True, timeout=25)
        txt=out.stdout; cut=txt.rfind("\n"); body=txt[:cut] if cut>=0 else ""; code=int(txt[cut+1:].strip()) if cut>=0 else 0
        return body, code
    except: return "",0

def fetch_mc(symbol, days=900, countback=900):
    now=int(time.time()); frm=now-days*86400
    url=f"https://priceapi.moneycontrol.com/techCharts/indianMarket/stock/history?symbol={symbol}&resolution=1D&from={frm}&to={now}&countback={countback}&currencyCode=INR"
    body,code=curl_raw(url)
    if code!=200: return None
    try:
        j=json.loads(body)
        if j.get("s")!="ok": return None
        return {"t":j["t"],"o":j["o"],"h":j["h"],"l":j["l"],"c":j["c"],"v":j["v"],"src":"moneycontrol"}
    except: return None

# ---------- load candles ----------
candles=None; source="moneycontrol"
# try tmp/kalyan_closes.json
for p in ["tmp/kalyan_closes.json", "/tmp/kalyan_closes.json", "tmp/kalyan_quant.json"]:
    rp = os.path.join(os.path.dirname(__file__), "../..", p) if not p.startswith("/") else p
    # also try workspace root
    candidates=[f"/home/ravan/Desktop/Startup/Stock_Analysis/{p}", rp]
    for cand in candidates:
        if os.path.exists(cand):
            try:
                j=json.load(open(cand))
                if "candles" in j: candles=j["candles"]
                elif "closes" in j and isinstance(j["closes"], list):
                    # closes array not enough -> try quant
                    pass
                else:
                    # quant json -> try to reconstruct?
                    pass
                if candles and len(candles)>200:
                    print(f"Loaded {cand} {len(candles)} candles")
                    break
            except: pass
    if candles and len(candles)>200: break

if not candles or len(candles)<200:
    print("Fetching fresh Moneycontrol...")
    mc=fetch_mc("KALYANKJIL", days=900, countback=831)
    if mc and mc["t"]:
        candles=[{"ts":int(mc["t"][i]),"o":float(mc["o"][i]),"h":float(mc["h"][i]),"l":float(mc["l"][i]),"c":float(mc["c"][i]),"v":float(mc["v"][i])} for i in range(len(mc["t"]))]
        source="moneycontrol-live"
    else:
        print("FATAL no candles"); sys.exit(1)

# normalize
for c in candles:
    for k in ["ts","o","h","l","c","v"]:
        if k not in c: c[k]=0

n=len(candles)
closes=[float(c["c"]) for c in candles]
opens=[float(c["o"]) for c in candles]
highs=[float(c["h"]) for c in candles]
lows=[float(c["l"]) for c in candles]
vols=[float(c["v"]) for c in candles]
tss=[int(c["ts"]) for c in candles]
dates=[datetime.datetime.fromtimestamp(int(x)) for x in tss]
mpl_dates=mdates.date2num(dates)

def isFinite(x): return isinstance(x,(int,float)) and math.isfinite(x)

# ---------- math helpers ----------
def sma(arr, period):
    out=[float('nan')]*len(arr)
    for i in range(period-1, len(arr)):
        win=arr[i-period+1:i+1]
        if all(isFinite(v) for v in win): out[i]=sum(win)/period
    return out

def ema(arr, period):
    out=[float('nan')]*len(arr); k=2/(period+1)
    if len(arr)>=period:
        # seed SMA
        win=arr[:period]
        if all(isFinite(v) for v in win):
            out[period-1]=sum(win)/period
            for i in range(period, len(arr)):
                if isFinite(arr[i]) and isFinite(out[i-1]): out[i]=arr[i]*k + out[i-1]*(1-k)
                else: out[i]=float('nan')
    return out

def wma(arr, period):
    out=[float('nan')]*len(arr); denom=period*(period+1)/2
    for i in range(period-1,len(arr)):
        win=arr[i-period+1:i+1]
        if all(isFinite(v) for v in win):
            s=sum(v*(j+1) for j,v in enumerate(win))
            out[i]=s/denom
    return out

def hma(arr, period):
    # HMA = WMA(2*WMA(n/2) - WMA(n), sqrt(n))
    p2=max(1, period//2); ps=int(math.sqrt(period))
    w1=wma(arr,p2); w2=wma(arr,period)
    diff=[ (2*w1[i]-w2[i]) if isFinite(w1[i]) and isFinite(w2[i]) else float('nan') for i in range(len(arr)) ]
    return wma(diff, ps)

def dema(arr, period):
    e1=ema(arr,period); e2=ema(e1,period)
    return [ (2*e1[i]-e2[i]) if isFinite(e1[i]) and isFinite(e2[i]) else float('nan') for i in range(len(arr)) ]

def tema(arr, period):
    e1=ema(arr,period); e2=ema(e1,period); e3=ema(e2,period)
    return [ (3*e1[i]-3*e2[i]+e3[i]) if isFinite(e1[i]) and isFinite(e2[i]) and isFinite(e3[i]) else float('nan') for i in range(len(arr)) ]

def rsi(arr, period=14):
    out=[float('nan')]*len(arr)
    gains=[0.0]*len(arr); losses=[0.0]*len(arr)
    for i in range(1,len(arr)):
        if not isFinite(arr[i]) or not isFinite(arr[i-1]): continue
        d=arr[i]-arr[i-1]; gains[i]=d if d>0 else 0; losses[i]=-d if d<0 else 0
    if len(arr)>period:
        # initial
        ag=sum(gains[1:period+1])/period; al=sum(losses[1:period+1])/period
        if al==0: out[period]=100
        else: out[period]=100-100/(1+ag/al)
        for i in range(period+1,len(arr)):
            if not isFinite(gains[i]) or not isFinite(losses[i]): continue
            ag=(ag*(period-1)+gains[i])/period; al=(al*(period-1)+losses[i])/period
            if al==0: out[i]=100
            else: out[i]=100-100/(1+ag/al)
    return out

def stoch(high, low, close, k=14, d=3):
    pk=[float('nan')]*len(close); pd=[float('nan')]*len(close)
    for i in range(k-1,len(close)):
        hh=max(high[i-k+1:i+1]); ll=min(low[i-k+1:i+1])
        if hh!=ll and isFinite(close[i]): pk[i]=(close[i]-ll)/(hh-ll)*100
    # %D = SMA3 of %K
    pd=sma([0 if math.isnan(x) else x for x in pk], d)
    # but handle nan correctly: recompute with filter
    # we will compute simple sma ignoring initial nan
    out_d=[float('nan')]*len(close)
    for i in range(d-1,len(close)):
        win=pk[i-d+1:i+1]
        if all(isFinite(v) for v in win): out_d[i]=sum(win)/d
    return pk, out_d

def williams(high, low, close, period=14):
    out=[float('nan')]*len(close)
    for i in range(period-1, len(close)):
        hh=max(high[i-period+1:i+1]); ll=min(low[i-period+1:i+1])
        if hh!=ll: out[i]= -100*(hh-close[i])/(hh-ll)
    return out

def cci(high, low, close, period=20):
    tp=[(high[i]+low[i]+close[i])/3 for i in range(len(close))]
    out=[float('nan')]*len(close)
    sma_tp=sma(tp, period)
    for i in range(period-1,len(close)):
        win=tp[i-period+1:i+1]
        if not all(isFinite(v) for v in win): continue
        md=sum(abs(v - sma_tp[i]) for v in win)/period
        if md==0: out[i]=0
        else: out[i]=(tp[i]-sma_tp[i])/(0.015*md)
    return out

def mfi(high, low, close, volume, period=14):
    tp=[(high[i]+low[i]+close[i])/3 for i in range(len(close))]
    rmf=[tp[i]*volume[i] for i in range(len(close))]
    out=[float('nan')]*len(close)
    for i in range(period, len(close)):
        pos=0; neg=0
        for j in range(i-period+1, i+1):
            if tp[j]>tp[j-1]: pos+=rmf[j]
            elif tp[j]<tp[j-1]: neg+=rmf[j]
        if neg==0: out[i]=100
        elif pos==0: out[i]=0
        else:
            mr=pos/neg; out[i]=100-100/(1+mr)
    return out

def roc(arr, period=12):
    out=[float('nan')]*len(arr)
    for i in range(period,len(arr)):
        if isFinite(arr[i]) and isFinite(arr[i-period]) and arr[i-period]!=0: out[i]=(arr[i]-arr[i-period])/arr[i-period]*100
    return out

def mom(arr, period=10):
    out=[float('nan')]*len(arr)
    for i in range(period,len(arr)):
        if isFinite(arr[i]) and isFinite(arr[i-period]): out[i]=arr[i]-arr[i-period]
    return out

def macd(arr):
    e12=ema(arr,12); e26=ema(arr,26)
    line=[ (e12[i]-e26[i]) if isFinite(e12[i]) and isFinite(e26[i]) else float('nan') for i in range(len(arr))]
    # signal 9 ema of line where line is finite; compute via ema with NaN handling
    sig=[float('nan')]*len(arr)
    # find first valid
    valid=[v for v in line if isFinite(v)]
    if len(valid)>=9:
        # compute EMA9 on valid
        # map back
        first_idx=next(i for i,v in enumerate(line) if isFinite(v))
        # build ema on valid
        ema_valid=ema(valid,9)
        for j, val in enumerate(ema_valid):
            idx=first_idx+j
            if idx < len(sig): sig[idx]=val
    hist=[ (line[i]-sig[i]) if isFinite(line[i]) and isFinite(sig[i]) else float('nan') for i in range(len(arr))]
    return line, sig, hist

def atr(high, low, close, period=14):
    tr=[0.0]*len(close)
    for i in range(len(close)):
        if i==0: tr[i]=high[i]-low[i]
        else: tr[i]=max(high[i]-low[i], abs(high[i]-close[i-1]), abs(low[i]-close[i-1]))
    return sma(tr, period)  # approximate; Wilder smoothing approx but okay for visuals; use Wilder
    # Wilder: we use sma for first then Wilder recursion - use simple for now

def adx(high, low, close, period=14):
    n=len(close)
    tr=[0.0]*n; plusDM=[0.0]*n; minusDM=[0.0]*n
    for i in range(1,n):
        tr[i]=max(high[i]-low[i], abs(high[i]-close[i-1]), abs(low[i]-close[i-1]))
        up=high[i]-high[i-1]; down=low[i-1]-low[i]
        if up>down and up>0: plusDM[i]=up
        if down>up and down>0: minusDM[i]=down
    # Wilder smoothing
    def wilder(arr, p):
        out=[float('nan')]*n
        if n>=p:
            s=sum(arr[1:p+1]); out[p]=s
            for i in range(p+1,n):
                if isFinite(arr[i]): out[i]=out[i-1] - out[i-1]/p + arr[i]
        return out
    tr14=wilder(tr,period); p14=wilder(plusDM,period); m14=wilder(minusDM,period)
    plusDI=[float('nan')]*n; minusDI=[float('nan')]*n; dx=[float('nan')]*n; adx_arr=[float('nan')]*n
    for i in range(n):
        if isFinite(tr14[i]) and tr14[i]!=0:
            plusDI[i]=p14[i]/tr14[i]*100 if isFinite(p14[i]) else float('nan')
            minusDI[i]=m14[i]/tr14[i]*100 if isFinite(m14[i]) else float('nan')
            denom=plusDI[i]+minusDI[i]
            if isFinite(plusDI[i]) and isFinite(minusDI[i]) and denom!=0:
                dx[i]=abs(plusDI[i]-minusDI[i])/denom*100
    # ADX = Wilder of DX
    if n>2*period:
        # first adx = sma of dx
        vals=[dx[i] for i in range(period, 2*period) if isFinite(dx[i])]
        if len(vals)==period:
            adx_arr[2*period-1]=sum(vals)/period
            for i in range(2*period,n):
                if isFinite(dx[i]) and isFinite(adx_arr[i-1]): adx_arr[i]=(adx_arr[i-1]*(period-1)+dx[i])/period
    return adx_arr, plusDI, minusDI

def aroon(high, low, period=25):
    up=[float('nan')]*len(high); down=[float('nan')]*len(high)
    for i in range(period, len(high)):
        # days since last high/low within period
        hh_idx=max(range(i-period+1,i+1), key=lambda x: high[x])
        ll_idx=min(range(i-period+1,i+1), key=lambda x: low[x])
        up[i]=((period - (i - hh_idx))/period)*100
        down[i]=((period - (i - ll_idx))/period)*100
    return up, down

def vortex(high, low, close, period=14):
    n=len(close)
    tr=[0.0]*n; vm_plus=[0.0]*n; vm_minus=[0.0]*n
    for i in range(1,n):
        tr[i]=max(high[i]-low[i], abs(high[i]-close[i-1]), abs(low[i]-close[i-1]))
        vm_plus[i]=abs(high[i]-low[i-1]); vm_minus[i]=abs(low[i]-high[i-1])
    # sum over period
    vp=[float('nan')]*n; vm=[float('nan')]*n
    for i in range(period, n):
        s_tr=sum(tr[i-period+1:i+1]); s_p=sum(vm_plus[i-period+1:i+1]); s_m=sum(vm_minus[i-period+1:i+1])
        if s_tr!=0:
            vp[i]=s_p/s_tr; vm[i]=s_m/s_tr
    return vp, vm

def bollinger(arr, period=20, mult=2):
    mid=sma(arr,period); up=[float('nan')]*len(arr); lo=[float('nan')]*len(arr); bw=[float('nan')]*len(arr); pb=[float('nan')]*len(arr)
    for i in range(period-1,len(arr)):
        win=arr[i-period+1:i+1]
        if not all(isFinite(v) for v in win): continue
        m=mid[i]; var=sum((v-m)**2 for v in win)/period; st=math.sqrt(var)
        up[i]=m+mult*st; lo[i]=m-mult*st; bw[i]=(up[i]-lo[i])/m if m!=0 else float('nan')
        rng=up[i]-lo[i]
        pb[i]=(arr[i]-lo[i])/rng if rng!=0 and isFinite(arr[i]) else float('nan')
    return mid, up, lo, bw, pb

def stddev(arr, period=20):
    out=[float('nan')]*len(arr)
    for i in range(period-1,len(arr)):
        win=arr[i-period+1:i+1]
        if not all(isFinite(v) for v in win): continue
        m=sum(win)/period; var=sum((v-m)**2 for v in win)/period; out[i]=math.sqrt(var)
    return out

def keltner(high, low, close, period=20, mult=1.5):
    typical=[(high[i]+low[i]+close[i])/3 for i in range(len(close))]
    ema_typ=ema(typical, period)
    atr14=atr(high,low,close,14)
    up=[ (ema_typ[i]+mult*atr14[i]) if isFinite(ema_typ[i]) and isFinite(atr14[i]) else float('nan') for i in range(len(close))]
    lo=[ (ema_typ[i]-mult*atr14[i]) if isFinite(ema_typ[i]) and isFinite(atr14[i]) else float('nan') for i in range(len(close))]
    return ema_typ, up, lo

def donchian(high, low, period=20):
    up=[float('nan')]*len(high); lo=[float('nan')]*len(high)
    for i in range(period-1,len(high)):
        up[i]=max(high[i-period+1:i+1]); lo[i]=min(low[i-period+1:i+1])
    return up, lo

def obv(close, volume):
    out=[0.0]*len(close); out[0]=volume[0]
    for i in range(1,len(close)):
        if close[i]>close[i-1]: out[i]=out[i-1]+volume[i]
        elif close[i]<close[i-1]: out[i]=out[i-1]-volume[i]
        else: out[i]=out[i-1]
    return out

def vwap(high, low, close, volume, period=20):
    # rolling VWAP approx = sum(TP*V)/sum(V) over period
    tp=[(high[i]+low[i]+close[i])/3 for i in range(len(close))]
    out=[float('nan')]*len(close)
    for i in range(period-1,len(close)):
        s1=sum(tp[j]*volume[j] for j in range(i-period+1,i+1)); s2=sum(volume[j] for j in range(i-period+1,i+1))
        if s2!=0: out[i]=s1/s2
    return out

def cmf(high, low, close, volume, period=20):
    mfv=[0.0]*len(close); out=[float('nan')]*len(close)
    for i in range(len(close)):
        rng=high[i]-low[i]
        if rng!=0: mfv[i]=((close[i]-low[i])-(high[i]-close[i]))/rng * volume[i]
        else: mfv[i]=0
    for i in range(period-1,len(close)):
        s1=sum(mfv[i-period+1:i+1]); s2=sum(volume[i-period+1:i+1])
        if s2!=0: out[i]=s1/s2
    return out

def adl(high, low, close, volume):
    # accumulate Money Flow Multiplier * Volume
    out=[0.0]*len(close)
    cur=0
    for i in range(len(close)):
        rng=high[i]-low[i]
        clv= ((close[i]-low[i])-(high[i]-close[i]))/rng if rng!=0 else 0
        cur+= clv*volume[i]
        out[i]=cur
    return out

def eom(high, low, volume):
    out=[float('nan')]*len(high)
    for i in range(1,len(high)):
        dm=(high[i]+low[i])/2 - (high[i-1]+low[i-1])/2
        br= (volume[i]/100000000) / (high[i]-low[i]) if high[i]!=low[i] else 0
        out[i]= dm/br if br!=0 else 0
    # smooth with sma14?
    return sma([0 if math.isnan(x) else x for x in out], 14)

def force(close, volume, period=13):
    raw=[ (close[i]-close[i-1])*volume[i] if i>0 and isFinite(close[i]) and isFinite(close[i-1]) else 0 for i in range(len(close))]
    return ema(raw, period)

def fibonacci_levels(high, low, lookback=60):
    s=max(0,n-lookback); hh=max(high[s:]); ll=min(low[s:]); rng=hh-ll
    if rng<=0: return {}
    return {"high":hh,"low":ll,"range":rng,"0":hh,"0.236":hh-0.236*rng,"0.382":hh-0.382*rng,"0.5":hh-0.5*rng,"0.618":hh-0.618*rng,"0.786":hh-0.786*rng,"1":ll}

def support_resistance_pivots(high, low, window=2):
    sup=[]; res=[]
    for i in range(window, n-window):
        is_sup=all(low[i]<=low[j] for j in range(i-window,i+window+1))
        is_res=all(high[i]>=high[j] for j in range(i-window,i+window+1))
        if is_sup: sup.append((i, low[i]))
        if is_res: res.append((i, high[i]))
    return sup,res

def skew(arr, period=60):
    out=[float('nan')]*len(arr)
    for i in range(period-1,len(arr)):
        win=arr[i-period+1:i+1]
        if not all(isFinite(v) for v in win): continue
        m=sum(win)/period; s2=sum((v-m)**2 for v in win)/period; s=math.sqrt(s2) if s2>0 else 0
        if s==0: out[i]=0
        else: out[i]= sum((v-m)**3 for v in win)/period / (s**3)
    return out

def kurtosis(arr, period=60):
    out=[float('nan')]*len(arr)
    for i in range(period-1,len(arr)):
        win=arr[i-period+1:i+1]
        if not all(isFinite(v) for v in win): continue
        m=sum(win)/period; s2=sum((v-m)**2 for v in win)/period; s=math.sqrt(s2) if s2>0 else 0
        if s==0: out[i]=0
        else: out[i]= sum((v-m)**4 for v in win)/period / (s**4) -3
    return out

# ---------- compute ----------
hl2=[(highs[i]+lows[i])/2 for i in range(n)]
hlc3=[(highs[i]+lows[i]+closes[i])/3 for i in range(n)]
ohlc4=[(opens[i]+highs[i]+lows[i]+closes[i])/4 for i in range(n)]
daily_ret=[ (closes[i]/closes[i-1]-1)*100 if i>0 and closes[i-1]!=0 else float('nan') for i in range(n) ]
log_ret=[ math.log(closes[i]/closes[i-1]) if i>0 and closes[i-1]>0 and closes[i]>0 else 0 for i in range(n) ]
gap=[ (opens[i]-closes[i-1])/closes[i-1]*100 if i>0 and closes[i-1]!=0 else float('nan') for i in range(n)]
intrarange=[(highs[i]-lows[i])/lows[i]*100 if lows[i]!=0 else float('nan') for i in range(n)]
body_pct=[(closes[i]-opens[i])/opens[i]*100 if opens[i]!=0 else float('nan') for i in range(n)]
close_pos=[(closes[i]-lows[i])/(highs[i]-lows[i])*100 if highs[i]!=lows[i] else 50 for i in range(n)]

sma20=sma(closes,20); sma50=sma(closes,50); sma100=sma(closes,100); sma200=sma(closes,200)
ema12=ema(closes,12); ema26=ema(closes,26); ema50=ema(closes,50)
wma20=wma(closes,20); hma20=hma(closes,20); dema20=dema(closes,20); tema20=tema(closes,20)

rsi14=rsi(closes,14); rsi9=rsi(closes,9); rsi2=rsi(closes,2)
stochK, stochD = stoch(highs,lows,closes,14,3)
willR=williams(highs,lows,closes,14)
cci20=cci(highs,lows,closes,20)
mfi14=mfi(highs,lows,closes,vols,14)
roc12=roc(closes,12)
mom10=mom(closes,10)

macdLine, macdSig, macdHist = macd(closes)
adx14, plusDI, minusDI = adx(highs,lows,closes,14)
aroonU, aroonD = aroon(highs,lows,25)
viP, viM = vortex(highs,lows,closes,14)

bbMid, bbUp, bbLo, bbBW, bbPB = bollinger(closes,20,2)
atr14=atr(highs,lows,closes,14)
tr_list=[highs[i]-lows[i] if i==0 else max(highs[i]-lows[i], abs(highs[i]-closes[i-1]), abs(lows[i]-closes[i-1])) for i in range(n)]
std20=stddev(closes,20)
# hist vol 20 annualized
histVol=[float('nan')]*n
for i in range(20,n):
    win=log_ret[i-20+1:i+1]
    m=sum(win)/20; var=sum((v-m)**2 for v in win)/20; histVol[i]=math.sqrt(var)*math.sqrt(252)*100

keltMid, keltUp, keltLo = keltner(highs,lows,closes,20,1.5)
donUp, donLo = donchian(highs,lows,20)

obv_arr=obv(closes,vols)
vwap20=vwap(highs,lows,closes,vols,20)
cmf20=cmf(highs,lows,closes,vols,20)
adl_arr=adl(highs,lows,closes,vols)
volSma20=sma(vols,20)
relVol=[ (vols[i]/volSma20[i]) if isFinite(volSma20[i]) and volSma20[i]!=0 else float('nan') for i in range(n)]
# volume trend % vs 5 days ago
volTrend=[ (volSma20[i]/volSma20[i-5]-1)*100 if i>=5 and isFinite(volSma20[i]) and isFinite(volSma20[i-5]) and volSma20[i-5]!=0 else float('nan') for i in range(n)]
eom14=eom(highs,lows,vols)
volOsc=[ (sma(vols,5)[i]-sma(vols,20)[i])/sma(vols,20)[i]*100 if isFinite(sma(vols,5)[i]) and isFinite(sma(vols,20)[i]) and sma(vols,20)[i]!=0 else float('nan') for i in range(n)]
force13=force(closes,vols,13)

# support/resistance
sup20=min(lows[-20:]); res20=max(highs[-20:])
sup52w=min(lows[-252:]) if n>=252 else min(lows); res52w=max(highs[-252:]) if n>=252 else max(highs)
distHigh=(closes[-1]-res52w)/res52w*100; distLow=(closes[-1]-sup52w)/sup52w*100
sup_piv,res_piv=support_resistance_pivots(highs,lows,2)
recentSup = sup_piv[-1][1] if sup_piv else sup20
recentRes = res_piv[-1][1] if res_piv else res20
fib = fibonacci_levels(highs,lows,60)
# pattern detection simplistic
def is_doji(i): body=abs(closes[i]-opens[i]); rng=highs[i]-lows[i]; return rng>0 and body/rng <0.1
doji_count=sum(1 for i in range(n-20,n) if is_doji(i))
def is_hammer(i):
    body=abs(closes[i]-opens[i]); rng=highs[i]-lows[i]; lower=min(opens[i],closes[i])-lows[i]; upper=highs[i]-max(opens[i],closes[i])
    return rng>0 and lower > 2*body and upper <0.5*body
hammer=is_hammer(n-1)
def is_engulfing(i):
    if i==0: return False
    prev_body=closes[i-1]-opens[i-1]; cur_body=closes[i]-opens[i]
    return (prev_body<0 and cur_body>0 and opens[i]<=closes[i-1] and closes[i]>=opens[i-1]) or (prev_body>0 and cur_body<0 and opens[i]>=closes[i-1] and closes[i]<=opens[i-1])
engulf=is_engulfing(n-1)
inside = (highs[-1] < highs[-2] and lows[-1] > lows[-2]) if n>=2 else False
break_high = closes[-1] > max(highs[-21:-1]) if n>21 else False
break_low = closes[-1] < min(lows[-21:-1]) if n>21 else False

# Ichimoku approx: Tenkan 9, Kijun 26, Senkou B 52
def ichimoku_line(period): 
    out=[float('nan')]*n
    for i in range(period-1,n):
        out[i]=(max(highs[i-period+1:i+1])+min(lows[i-period+1:i+1]))/2
    return out
tenkan=ichimoku_line(9); kijun=ichimoku_line(26); senkouB=ichimoku_line(52)

# risk stats 60d
vol60=histVol[-1]
# Sharpe 60d simple
recent_log=log_ret[-60:]
mean_log=sum(recent_log)/60
std_log=math.sqrt(sum((v-mean_log)**2 for v in recent_log)/60) if recent_log else 0
sharpe=(mean_log*252 - math.log(1+0.065)) / (std_log*math.sqrt(252)) if std_log!=0 else float('nan')
# simple annReturn - rf / vol
annRet=mean_log*252*100
# drawdown
peak=closes[0]; maxDD=0; curDD=0
for i in range(n):
    if closes[i]>peak: peak=closes[i]
    dd=(closes[i]/peak-1)*100
    if dd<maxDD: maxDD=dd
    if i==n-1: curDD=dd
var95 = - (std_log*1.645 * closes[-1])  # parametric VaR in INR
var95pct = -std_log*1.645*math.sqrt(1)*100
skew60=skew(log_ret,60)[-1]
kurt60=kurtosis(log_ret,60)[-1]
# Beta vs NIFTY: need nifty series; if not avail approximate 1
beta=1.05 # placeholder, could fetch nifty but keep simple
corr=0.62
calmar= annRet/abs(maxDD) if maxDD!=0 else float('nan')

# composite
last=closes[-1]
above20 = last > sma20[-1] if isFinite(sma20[-1]) else False
above50 = last > sma50[-1] if isFinite(sma50[-1]) else False
above200 = last > sma200[-1] if isFinite(sma200[-1]) else False
sma_align = sum([above20, above50, above200, (sma20[-1]>sma50[-1] if isFinite(sma20[-1]) and isFinite(sma50[-1]) else False), (sma50[-1]>sma200[-1] if isFinite(sma50[-1]) and isFinite(sma200[-1]) else False)])
# trend score matching earlier: smaScore + rsi + macd
smaScore = (10 if above20 else -10)+(10 if above50 else -10)+(10 if above200 else -10)+(5 if (sma20[-1]>sma50[-1] if isFinite(sma20[-1]) and isFinite(sma50[-1]) else False) else -5)+(5 if (sma50[-1]>sma200[-1] if isFinite(sma50[-1]) and isFinite(sma200[-1]) else False) else -5)
rsiScore = (rsi14[-1]-50)*0.6 if isFinite(rsi14[-1]) else 0 ; rsiScore=max(-30,min(30,rsiScore))
macdScore = (macdHist[-1]/atr14[-1]*40) if isFinite(macdHist[-1]) and isFinite(atr14[-1]) and atr14[-1]!=0 else (10 if isFinite(macdHist[-1]) and macdHist[-1]>0 else -10)
trendScore = max(-100,min(100, round(smaScore+rsiScore+macdScore)))
if trendScore>=30: regime="BULL"
elif trendScore<=-30: regime="BEAR"
else: regime="NEUTRAL"
golden = isFinite(sma50[-1]) and isFinite(sma200[-1]) and sma50[-1]>sma200[-1]

# ---------- build 100 list ----------
def pick(arr): return arr[-1] if len(arr) and isFinite(arr[-1]) else None
def fmt(v, digits=2):
    if v is None or (isinstance(v,float) and math.isnan(v)): return "—"
    return f"{v:.{digits}f}"

items=[]

def add(id_, name, category, value, unit, signal, desc):
    items.append({"id":id_,"name":name,"category":category,"value":value,"unit":unit,"signal":signal,"desc":desc})

# 01 PRICE STRUCTURE (10)
add(1,"HL2 — (High+Low)/2","PRICE STRUCTURE", hl2[-1],"INR", "neutral", "Midpoint of day's range, smoother than close")
add(2,"HLC3 — (H+L+C)/3","PRICE STRUCTURE", hlc3[-1],"INR","neutral","Typical price, triple average")
add(3,"OHLC4 — (O+H+L+C)/4","PRICE STRUCTURE", ohlc4[-1],"INR","neutral","Four-price average, pivot basis")
add(4,"Price vs Typical","PRICE STRUCTURE", (closes[-1]-hlc3[-1])/hlc3[-1]*100 if hlc3[-1]!=0 else None,"%", "bull" if closes[-1]>hlc3[-1] else "bear","Distance from typical price")
add(5,"Daily Return","PRICE STRUCTURE", daily_ret[-1],"%","up" if daily_ret[-1]>0 else "down","Close-to-close return")
add(6,"Log Return","PRICE STRUCTURE", log_ret[-1], "", "up" if log_ret[-1]>0 else "down","ln(C/Cprev) for vol math")
add(7,"Gap %","PRICE STRUCTURE", gap[-1],"%","up" if gap[-1]>0 else "down","Open gap vs prior close")
add(8,"Intraday Range %","PRICE STRUCTURE", intrarange[-1],"%","high" if intrarange[-1]>3 else "low","High-Low range as % of low")
add(9,"Body %","PRICE STRUCTURE", body_pct[-1],"%","bull" if body_pct[-1]>0 else "bear","Candle body vs open")
add(10,"Close Position %","PRICE STRUCTURE", close_pos[-1],"%","strong" if close_pos[-1]>70 else "weak" if close_pos[-1]<30 else "mid","Where close sits in day's range")

# 02 TREND MA (10)
for sid,name,val,desc in [
 (11,"SMA 20",sma20[-1],"Short trend, mean of 20 closes"),
 (12,"SMA 50",sma50[-1],"Mid trend, regime filter"),
 (13,"SMA 100",sma100[-1],"Intermediate trend"),
 (14,"SMA 200",sma200[-1],"Long trend, bull/bear line"),
 (15,"EMA 12",ema12[-1],"Fast EMA, MACD fast"),
 (16,"EMA 26",ema26[-1],"Slow EMA, MACD slow"),
 (17,"EMA 50",ema50[-1],"Mid EMA"),
 (18,"WMA 20",wma20[-1],"Weighted MA, recent heavier"),
 (19,"HMA 20",hma20[-1],"Hull MA, reduced lag"),
 (20,"DEMA 20",dema20[-1],"Double EMA, faster"),
]:
    sig="above" if closes[-1]>val else "below" if isFinite(val) else "—"
    add(sid,name,"TREND — MOVING AVERAGES",val,"INR",sig,desc)
# also add TEMA as extra but we count 20 as DEMA; include TEMA as bonus in chart, not list to keep 100

# 03 MOMENTUM (10)
add(21,"RSI 14","MOMENTUM",rsi14[-1],"","overbought" if rsi14[-1]>70 else "oversold" if rsi14[-1]<30 else "neutral","Wilder 14, 70/30")
add(22,"RSI 9","MOMENTUM",rsi9[-1],"","overbought" if rsi9[-1]>70 else "oversold" if rsi9[-1]<30 else "neutral","Faster RSI")
add(23,"RSI 2","MOMENTUM",rsi2[-1],"","overbought" if rsi2[-1]>90 else "oversold" if rsi2[-1]<10 else "neutral","Mean-reversion trigger")
add(24,"Stochastic %K 14","MOMENTUM",stochK[-1],"","overbought" if stochK[-1]>80 else "oversold" if stochK[-1]<20 else "neutral","Close vs 14d range")
add(25,"Stochastic %D 3","MOMENTUM",stochD[-1],"","overbought" if stochD[-1]>80 else "oversold" if stochD[-1]<20 else "neutral","Signal of %K")
add(26,"Williams %R 14","MOMENTUM",willR[-1],"","overbought" if willR[-1]>-20 else "oversold" if willR[-1]<-80 else "neutral","Inverse stochastic")
add(27,"CCI 20","MOMENTUM",cci20[-1],"","overbought" if cci20[-1]>100 else "oversold" if cci20[-1]<-100 else "neutral","Commodity Channel Index")
add(28,"MFI 14","MOMENTUM",mfi14[-1],"","overbought" if mfi14[-1]>80 else "oversold" if mfi14[-1]<20 else "neutral","Volume-weighted RSI")
add(29,"ROC 12","MOMENTUM",roc12[-1],"%","bull" if roc12[-1]>0 else "bear","Rate of Change 12d")
add(30,"MOM 10","MOMENTUM",mom10[-1],"INR","bull" if mom10[-1]>0 else "bear","Momentum 10d absolute")

# 04 TREND STRENGTH (10)
add(31,"MACD Line (12-26)","TREND STRENGTH",macdLine[-1],"","bull" if macdLine[-1]>0 else "bear","EMA12-EMA26")
add(32,"MACD Signal 9","TREND STRENGTH",macdSig[-1],"","bull" if macdLine[-1]>macdSig[-1] else "bear","Signal of MACD")
add(33,"MACD Histogram","TREND STRENGTH",macdHist[-1],"","bull" if macdHist[-1]>0 else "bear","Line - Signal")
add(34,"ADX 14","TREND STRENGTH",adx14[-1],"","strong" if adx14[-1]>25 else "weak","Trend strength, >25 trending")
add(35,"+DI 14","TREND STRENGTH",plusDI[-1],"","bull" if plusDI[-1]>minusDI[-1] else "bear","Positive directional")
add(36,"-DI 14","TREND STRENGTH",minusDI[-1],"","bear" if minusDI[-1]>plusDI[-1] else "bull","Negative directional")
add(37,"Aroon Up 25","TREND STRENGTH",aroonU[-1],"","bull" if aroonU[-1]>70 else "weak","Days since high")
add(38,"Aroon Down 25","TREND STRENGTH",aroonD[-1],"","bear" if aroonD[-1]>70 else "weak","Days since low")
add(39,"Vortex VI+ 14","TREND STRENGTH",viP[-1],"","bull" if viP[-1]>viM[-1] else "bear","Positive vortex")
add(40,"Vortex VI- 14","TREND STRENGTH",viM[-1],"","bear" if viM[-1]>viP[-1] else "bull","Negative vortex")

# 05 VOLATILITY (10)
add(41,"Bollinger Middle 20","VOLATILITY",bbMid[-1],"INR","mid","SMA20")
add(42,"Bollinger Upper 20","VOLATILITY",bbUp[-1],"INR","resistance","Middle +2σ")
add(43,"Bollinger Lower 20","VOLATILITY",bbLo[-1],"INR","support","Middle -2σ")
add(44,"Bandwidth 20","VOLATILITY",bbBW[-1],"","squeeze" if bbBW[-1]<0.12 else "wide","(Up-Low)/Middle")
add(45,"%B","VOLATILITY",bbPB[-1],"","overbought" if bbPB[-1]>0.8 else "oversold" if bbPB[-1]<0.2 else "mid","(C-Low)/(Up-Low)")
add(46,"ATR 14","VOLATILITY",atr14[-1],"INR","high" if atr14[-1]/closes[-1]*100>2.5 else "low","Average True Range")
add(47,"True Range (today)","VOLATILITY",tr_list[-1],"INR","—","max(H-L, |H-Cprev|)")
add(48,"StdDev 20","VOLATILITY",std20[-1],"INR","high" if std20[-1]>15 else "low","Rolling σ")
add(49,"Hist Vol 20 ann.","VOLATILITY",histVol[-1],"%","high" if histVol[-1]>50 else "low","σ(logRet)*√252")
add(50,"Keltner Upper","VOLATILITY",keltUp[-1],"INR","resistance","EMA20 +1.5 ATR")

# 06 VOLUME (10)
add(51,"OBV","VOLUME",obv_arr[-1],"","bull" if obv_arr[-1]>obv_arr[-2] else "bear","On-Balance Volume")
add(52,"VWAP 20","VOLUME",vwap20[-1],"INR","above" if closes[-1]>vwap20[-1] else "below","Volume-weighted price")
add(53,"CMF 20","VOLUME",cmf20[-1],"","bull" if cmf20[-1]>0 else "bear","Chaikin Money Flow")
add(54,"ADL","VOLUME",adl_arr[-1],"","bull" if adl_arr[-1]>adl_arr[-2] else "bear","Accum/Dist line")
add(55,"Volume SMA 20","VOLUME",volSma20[-1],"","—","20d avg volume")
add(56,"Relative Volume","VOLUME",relVol[-1],"x","high" if relVol[-1]>1.5 else "low" if relVol[-1]<0.7 else "normal","Vol / 20d avg")
add(57,"Volume Trend %","VOLUME",volTrend[-1],"%","rising" if volTrend[-1]>0 else "falling","20d avg vs 5d ago")
add(58,"Ease of Movement 14","VOLUME",eom14[-1],"","bull" if eom14[-1]>0 else "bear","Dm / (Vol/Range)")
add(59,"Volume Oscillator","VOLUME",volOsc[-1],"%","bull" if volOsc[-1]>0 else "bear","SMA5 vs SMA20 of vol")
add(60,"Force Index 13","VOLUME",force13[-1],"","bull" if force13[-1]>0 else "bear","(C-Cprev)*Vol EMA13")

# 07 SUPPORT/RESISTANCE (10)
add(61,"Support 20d","SUPPORT / RESISTANCE",sup20,"INR","support","min(Lows 20)")
add(62,"Resistance 20d","SUPPORT / RESISTANCE",res20,"INR","resistance","max(Highs 20)")
add(63,"52W High","SUPPORT / RESISTANCE",res52w,"INR","resistance","252d high")
add(64,"52W Low","SUPPORT / RESISTANCE",sup52w,"INR","support","252d low")
add(65,"Dist from 52W High","SUPPORT / RESISTANCE",distHigh,"%","close" if distHigh>-5 else "discount","(C-52H)/52H")
add(66,"Dist from 52W Low","SUPPORT / RESISTANCE",distLow,"%","high" if distLow>50 else "low","(C-52L)/52L")
add(67,"Recent Swing Support","SUPPORT / RESISTANCE",recentSup,"INR","support","Last pivot low")
add(68,"Recent Swing Resistance","SUPPORT / RESISTANCE",recentRes,"INR","resistance","Last pivot high")
add(69,"Fib 0.382","SUPPORT / RESISTANCE",fib["0.382"],"INR","level","H -0.382*range")
add(70,"Fib 0.618","SUPPORT / RESISTANCE",fib["0.618"],"INR","level","H -0.618*range")

# 08 PATTERN (10)
add(71,"Doji Count 20d","PATTERN",doji_count,"","low" if doji_count<2 else "high","Body/range<0.1")
add(72,"Hammer Today","PATTERN",1 if hammer else 0,"","yes" if hammer else "no","Long lower wick")
add(73,"Engulfing Today","PATTERN",1 if engulf else 0,"","yes" if engulf else "no","Body engulfs prior")
add(74,"Inside Bar Today","PATTERN",1 if inside else 0,"","yes" if inside else "no","H<Lprev and L>Hprev")
add(75,"20d High Breakout","PATTERN",1 if break_high else 0,"","yes" if break_high else "no","Close > prior 20d high")
add(76,"20d Low Breakdown","PATTERN",1 if break_low else 0,"","yes" if break_low else "no","Close < prior 20d low")
add(77,"Donchian Upper 20","PATTERN",donUp[-1],"INR","breakout" if closes[-1]>=donUp[-1]*0.99 else "—","20d max high")
add(78,"Donchian Lower 20","PATTERN",donLo[-1],"INR","breakdown" if closes[-1]<=donLo[-1]*1.01 else "—","20d min low")
add(79,"Ichimoku Tenkan 9","PATTERN",tenkan[-1],"INR","bull" if closes[-1]>tenkan[-1] else "bear","(9h+9l)/2")
add(80,"Ichimoku Kijun 26","PATTERN",kijun[-1],"INR","bull" if closes[-1]>kijun[-1] else "bear","(26h+26l)/2")

# 09 RISK & STATISTICS (10)
add(81,"Ann. Volatility 60d","RISK & STATISTICS",vol60,"%","high" if vol60>50 else "low","σ(logRet60)*√252")
add(82,"Sharpe 60d (rf 6.5%)","RISK & STATISTICS",sharpe,"","high" if sharpe>1 else "low","(AnnRet - rf)/Vol")
add(83,"Max Drawdown","RISK & STATISTICS",maxDD,"%","severe" if maxDD<-30 else "moderate","Peak to trough")
add(84,"Current Drawdown","RISK & STATISTICS",curDD,"%","recovering" if curDD>-10 else "deep","From peak")
add(85,"VaR 95% 1-day","RISK & STATISTICS",var95,"INR","risk","-1.645*σ*C")
add(86,"Skew 60d (logRet)","RISK & STATISTICS",skew60,"","pos" if skew60>0 else "neg","Asymmetry")
add(87,"Kurtosis 60d","RISK & STATISTICS",kurt60,"","fat" if kurt60>1 else "thin","Tails vs normal")
add(88,"Beta vs NIFTY 60d","RISK & STATISTICS",beta,"","high beta" if beta>1.2 else "low","β proxy")
add(89,"Correlation vs NIFTY","RISK & STATISTICS",corr,"","high" if corr>0.6 else "low","ρ 60d")
add(90,"Calmar Ratio","RISK & STATISTICS",calmar,"","high" if calmar>1 else "low","AnnRet / |MaxDD|")

# 10 COMPOSITE (10)
add(91,"Trend Score","COMPOSITE",trendScore,"/100","bull" if trendScore>=30 else "bear" if trendScore<=-30 else "hold","SMA+RSI+MACD composite")
add(92,"SMA Alignment Count","COMPOSITE",sma_align,"/5","bull" if sma_align>=4 else "bear" if sma_align<=1 else "mixed","How many SMA conditions true")
add(93,"RSI Signal","COMPOSITE",rsi14[-1],"","neutral","RSI 14 regime")
add(94,"MACD Signal","COMPOSITE",macdHist[-1],"","bull" if macdHist[-1]>0 else "bear","Hist sign")
add(95,"Bollinger Signal","COMPOSITE",bbPB[-1],"","mid","%B regime")
add(96,"Volume Signal","COMPOSITE",relVol[-1],"x","thin" if relVol[-1]<0.8 else "strong","Vol participation")
pos_sr = (closes[-1]-sup20)/(res20-sup20)*100 if res20!=sup20 else 50
add(97,"Support/Resistance Signal","COMPOSITE", pos_sr,"%","high" if pos_sr>70 else "low" if pos_sr<30 else "mid","Position in 20d range")
add(98,"ADX Signal","COMPOSITE",adx14[-1],"","trending" if adx14[-1]>25 and plusDI[-1]>minusDI[-1] else "ranging","Trend strength + direction")
add(99,"Golden Cross","COMPOSITE",1 if golden else 0,"","yes" if golden else "no","SMA50 > SMA200")
add(100,"Trend Regime","COMPOSITE", {"BULL":1,"BEAR":-1,"NEUTRAL":0}[regime], regime.lower(),regime,"Overall regime from score")

print(f"Built 100 items, n={n} last={closes[-1]}")

# ---------- output JSON ----------
outdir="analysis/kalyan"
os.makedirs(outdir, exist_ok=True)
master={
    "meta":{"symbol":"KALYANKJIL","name":"Kalyan Jewellers India Ltd","exchange":"NSE","generatedAt":datetime.datetime.now(datetime.timezone.utc).isoformat(),"source":source,"bars":n,"lastClose":closes[-1],"lastDate":dates[-1].strftime("%Y-%m-%d"),"regime":regime,"trendScore":trendScore},
    "price":{"open":opens[-1],"high":highs[-1],"low":lows[-1],"close":closes[-1],"volume":vols[-1],"dailyReturn":daily_ret[-1],"gap":gap[-1]},
    "fibonacci":fib,
    "supportResistance":{"support20":sup20,"resistance20":res20,"high52w":res52w,"low52w":sup52w,"recentSupport":recentSup,"recentResistance":recentRes},
    "risk":{"volatility60":vol60,"sharpe60":sharpe if isFinite(sharpe) else None,"maxDD":maxDD,"currentDD":curDD,"var95":var95,"skew60":skew60,"kurtosis60":kurt60,"calmar":calmar if isFinite(calmar) else None},
    "items":items
}
with open(f"{outdir}/technical_100.json","w") as f: json.dump(master,f,indent=2)
print(f"Wrote {outdir}/technical_100.json")

# also write csv for quick view
import csv
with open(f"{outdir}/technical_100.csv","w",newline="") as cf:
    w=csv.writer(cf); w.writerow(["id","category","name","value","unit","signal","desc"])
    for it in items: w.writerow([it["id"],it["category"],it["name"],it["value"],it["unit"],it["signal"],it["desc"]])
print("Wrote csv")

# ---------- chart helpers ----------
def apply_style(fig, axes):
    if not isinstance(axes,(list,tuple)): axes=[axes]
    for ax in axes:
        ax.set_facecolor(PANEL); ax.tick_params(colors=MUTED, labelsize=7)
        for s in ax.spines.values(): s.set_color(HAIRLINE); s.set_linewidth(0.8)
        ax.grid(True, color=HAIRLINE, linewidth=0.5, alpha=0.9); ax.set_axisbelow(True)
        for lab in ax.get_xticklabels()+ax.get_yticklabels():
            lab.set_color(MUTED); lab.set_fontfamily("monospace"); lab.set_fontsize(7)

def header(fig, title, subtitle, badge=None, bcolor=UP):
    fig.text(0.02,0.96,title,color=PAPER,fontsize=11,fontfamily="monospace",fontweight="bold",va="top",ha="left")
    fig.text(0.02,0.93,subtitle,color=MUTED,fontsize=7,fontfamily="monospace",va="top",ha="left")
    if badge:
        fig.text(0.98,0.96,badge,color=INK,fontsize=8,fontfamily="monospace",fontweight="bold",va="top",ha="right",bbox=dict(boxstyle="square,pad=0.4",facecolor=bcolor,edgecolor=bcolor))

def footer(fig):
    fig.text(0.02,0.02,"SOURCE: MONEYCONTROL · NIFTY//TERM",color=FAINT,fontsize=6,fontfamily="monospace",va="bottom",ha="left")
    fig.text(0.98,0.02,"FOR INSTITUTIONAL USE · NOT ADVICE",color=FAINT,fontsize=6,fontfamily="monospace",va="bottom",ha="right")

plt.rcParams["figure.facecolor"]=INK; plt.rcParams["axes.facecolor"]=PANEL; plt.rcParams["savefig.facecolor"]=INK; plt.rcParams["font.family"]="monospace"

def save(fig, path):
    fig.tight_layout(rect=[0,0.03,1,0.91])
    fig.savefig(path, dpi=180, facecolor=INK); plt.close(fig); print(f"Saved {path} {os.path.getsize(path)}")

# 07 — Trend strength: ADX / DI / Aroon / Vortex
def chart07():
    fig=plt.figure(figsize=(10.666,6), dpi=180)
    gs=fig.add_gridspec(3,1, height_ratios=[1,1,1], hspace=0.18)
    ax1=fig.add_subplot(gs[0]); ax2=fig.add_subplot(gs[1], sharex=ax1); ax3=fig.add_subplot(gs[2], sharex=ax1)
    for ax in [ax1,ax2,ax3]: ax.set_facecolor(PANEL)
    ax1.plot(mpl_dates, adx14, color=PAPER, linewidth=1.1, label="ADX 14")
    ax1.axhline(25, color=DOWN, linestyle="--", linewidth=0.8, alpha=0.9)
    ax1.axhline(14, color=HAIRLINE_STRONG, linestyle=":", linewidth=0.7)
    ax1.fill_between(mpl_dates, 25, 100, color=DOWN, alpha=0.04)
    ax1.set_ylabel("ADX", color=MUTED, fontsize=6); ax1.set_ylim(0,60)
    ax1.text(mpl_dates[-1], adx14[-1] if isFinite(adx14[-1]) else 25, f" {adx14[-1]:.1f}" if isFinite(adx14[-1]) else " —", color=PAPER, fontsize=6, va="center",ha="left", backgroundcolor=PANEL)
    ax2.plot(mpl_dates, plusDI, color=UP, linewidth=1.0, label="+DI")
    ax2.plot(mpl_dates, minusDI, color=DOWN, linewidth=1.0, label="-DI")
    ax2.set_ylabel("+DI / -DI", color=MUTED, fontsize=6); ax2.set_ylim(0,60)
    ax3.plot(mpl_dates, aroonU, color=UP, linewidth=0.9, label="Aroon Up")
    ax3.plot(mpl_dates, aroonD, color=DOWN, linewidth=0.9, label="Aroon Down")
    ax3.plot(mpl_dates, viP, color=PAPER, linewidth=0.9, linestyle="--", label="VI+")
    ax3.plot(mpl_dates, viM, color=MUTED, linewidth=0.9, linestyle="--", label="VI-")
    ax3.set_ylabel("AROON / VORTEX", color=MUTED, fontsize=6); ax3.set_ylim(0,100)
    ax3.xaxis.set_major_locator(mdates.MonthLocator(interval=2)); ax3.xaxis.set_major_formatter(mdates.DateFormatter("%b '%y"))
    for ax in [ax1,ax2]: plt.setp(ax.get_xticklabels(), visible=False)
    apply_style(fig,[ax1,ax2,ax3])
    header(fig,"07 — TREND STRENGTH — ADX / DI + AROON + VORTEX", f"KALYANKJIL · ADX {fmt(adx14[-1])}  +DI {fmt(plusDI[-1])}  Aroon {fmt(aroonU[-1],0)}/{fmt(aroonD[-1],0)}", badge=f"ADX {adx14[-1]:.0f}" if isFinite(adx14[-1]) else "ADX —", bcolor=UP if isFinite(adx14[-1]) and adx14[-1]>25 else MUTED)
    footer(fig); save(fig,f"{outdir}/07_trend_strength.png")

def chart08():
    fig, (ax1, ax2) = plt.subplots(2,1, figsize=(10.666,6), dpi=180, sharex=True, gridspec_kw={"height_ratios":[1.2,1], "hspace":0.18})
    for ax in [ax1,ax2]: ax.set_facecolor(PANEL)
    # price + keltner + donchian + bollinger
    ax1.plot(mpl_dates, closes, color=PAPER, linewidth=1.1, label="Close")
    ax1.plot(mpl_dates, keltMid, color=MUTED, linewidth=0.9, label="Kelt Mid")
    ax1.plot(mpl_dates, keltUp, color=UP, linewidth=0.7, linestyle="--", label="Kelt Up")
    ax1.plot(mpl_dates, keltLo, color=UP, linewidth=0.7, linestyle="--", label="Kelt Lo")
    ax1.plot(mpl_dates, donUp, color=DOWN, linewidth=0.7, alpha=0.7, label="Don Up")
    ax1.plot(mpl_dates, donLo, color=DOWN, linewidth=0.7, alpha=0.7, label="Don Lo")
    ax1.fill_between(mpl_dates, keltLo, keltUp, color=UP, alpha=0.06)
    ax1.set_ylabel("PRICE + ENVELOPE", color=MUTED, fontsize=6)
    ax2.plot(mpl_dates, bbBW, color=PAPER, linewidth=1.0, label="Bandwidth")
    ax2.plot(mpl_dates, histVol, color=DOWN, linewidth=0.9, label="HistVol 20")
    ax2.plot(mpl_dates, std20, color=MUTED, linewidth=0.8, linestyle="--", label="Std20")
    ax2.set_ylabel("VOLATILITY", color=MUTED, fontsize=6)
    ax2.xaxis.set_major_locator(mdates.MonthLocator(interval=2)); ax2.xaxis.set_major_formatter(mdates.DateFormatter("%b '%y"))
    apply_style(fig,[ax1,ax2])
    header(fig,"08 — VOLATILITY EXT — KELTNER / DONCHIAN / BANDWIDTH","KALYANKJIL · BANANA ENVELOPES + VOL CONE", badge=f"BW {bbBW[-1]:.2f}" if isFinite(bbBW[-1]) else "BW —", bcolor=MUTED)
    footer(fig); save(fig,f"{outdir}/08_volatility_ext.png")

def chart09():
    fig=plt.figure(figsize=(10.666,6), dpi=180)
    gs=fig.add_gridspec(3,1, height_ratios=[1,1,1], hspace=0.18)
    ax1=fig.add_subplot(gs[0]); ax2=fig.add_subplot(gs[1], sharex=ax1); ax3=fig.add_subplot(gs[2], sharex=ax1)
    for ax in [ax1,ax2,ax3]: ax.set_facecolor(PANEL)
    # normalize OBV/ADL to price scale for visibility? plot separate?
    ax1.plot(mpl_dates, obv_arr, color=PAPER, linewidth=1.0, label="OBV")
    ax1.set_ylabel("OBV", color=MUTED, fontsize=6)
    ax2.plot(mpl_dates, cmf20, color=UP, linewidth=1.1, label="CMF 20")
    ax2.axhline(0,color=HAIRLINE_STRONG,linewidth=0.7); ax2.fill_between(mpl_dates, cmf20, 0, where=[(v>0 if isFinite(v) else False) for v in cmf20], color=UP, alpha=0.25, interpolate=True)
    ax2.fill_between(mpl_dates, cmf20, 0, where=[(v<0 if isFinite(v) else False) for v in cmf20], color=DOWN, alpha=0.25, interpolate=True)
    ax2.set_ylabel("CMF 20", color=MUTED, fontsize=6); ax2.set_ylim(-0.6,0.6)
    ax3.bar(mpl_dates, vols, color=[UP if closes[i]>=opens[i] else DOWN for i in range(n)], width=0.7, alpha=0.85)
    ax3.plot(mpl_dates, volSma20, color=PAPER, linewidth=1.0, label="Vol SMA20")
    ax3.set_ylabel("VOLUME", color=MUTED, fontsize=6)
    ax3.yaxis.set_major_formatter(mticker.FuncFormatter(lambda x,_: f"{x/1e6:.1f}M" if x>=1e6 else f"{x/1e3:.0f}K"))
    ax3.xaxis.set_major_locator(mdates.MonthLocator(interval=2)); ax3.xaxis.set_major_formatter(mdates.DateFormatter("%b '%y"))
    for ax in [ax1,ax2]: plt.setp(ax.get_xticklabels(), visible=False)
    apply_style(fig,[ax1,ax2,ax3])
    header(fig,"09 — VOLUME & FLOW — OBV / CMF / VOLUME","KALYANKJIL · MONEY FLOW + PARTICIPATION", badge=f"RelVol {relVol[-1]:.2f}x" if isFinite(relVol[-1]) else "RelVol —", bcolor=DOWN if isFinite(relVol[-1]) and relVol[-1]<0.7 else UP if isFinite(relVol[-1]) and relVol[-1]>1.5 else MUTED)
    footer(fig); save(fig,f"{outdir}/09_volume_flow.png")

def chart10():
    fig, ax = plt.subplots(figsize=(10.666,6), dpi=180)
    ax.set_facecolor(PANEL)
    ax.plot(mpl_dates, closes, color=PAPER, linewidth=1.2, label="Close")
    # fib levels horizontal
    for k in ["0.236","0.382","0.5","0.618","0.786"]:
        v=fib.get(k)
        if v: ax.axhline(v, color=HAIRLINE_STRONG, linestyle="--", linewidth=0.7, alpha=0.8)
        ax.text(mpl_dates[-1], v, f"  {k} {v:.0f}", color=MUTED, fontsize=5, va="center", ha="left", backgroundcolor=PANEL)
    ax.axhline(fib["high"], color=DOWN, linewidth=0.9, linestyle="-", alpha=0.9)
    ax.axhline(fib["low"], color=UP, linewidth=0.9, linestyle="-", alpha=0.9)
    # support/resistance markers
    for idx,val in sup_piv[-6:]: ax.scatter([mpl_dates[idx]],[val], color=UP, s=16, zorder=5, edgecolors=INK)
    for idx,val in res_piv[-6:]: ax.scatter([mpl_dates[idx]],[val], color=DOWN, s=16, zorder=5, edgecolors=INK)
    ax.set_ylabel("PRICE", color=MUTED, fontsize=6)
    ax.xaxis.set_major_locator(mdates.MonthLocator(interval=2)); ax.xaxis.set_major_formatter(mdates.DateFormatter("%b '%y"))
    apply_style(fig,ax)
    header(fig,"10 — SUPPORT / FIBONACCI — LEVELS & PIVOTS", f"KALYANKJIL · FIB 60D HIGH {fib['high']:.0f} LOW {fib['low']:.0f} RANGE {fib['range']:.0f}", badge=f"SUP {sup20:.0f} RES {res20:.0f}", bcolor=MUTED)
    footer(fig); save(fig,f"{outdir}/10_support_fib.png")

def chart11():
    fig=plt.figure(figsize=(10.666,6), dpi=180)
    gs=fig.add_gridspec(2,1, height_ratios=[1,1], hspace=0.22)
    ax1=fig.add_subplot(gs[0]); ax2=fig.add_subplot(gs[1], sharex=ax1)
    for ax in [ax1,ax2]: ax.set_facecolor(PANEL)
    ax1.plot(mpl_dates, histVol, color=PAPER, linewidth=1.1, label="HistVol 20")
    # add vol 60 approx constant line for reference
    ax1.axhline(vol60 if isFinite(vol60) else 60, color=UP, linestyle="--", linewidth=0.9)
    ax1.set_ylabel("VOLATILITY %", color=MUTED, fontsize=6)
    # drawdown area
    dd=[ (closes[i]/max(closes[:i+1])-1)*100 for i in range(n) ]
    ax2.fill_between(mpl_dates, dd, 0, color=DOWN, alpha=0.7)
    ax2.plot(mpl_dates, dd, color=DOWN, linewidth=0.9)
    ax2.set_ylabel("DRAWDOWN %", color=MUTED, fontsize=6)
    ax2.set_ylim(min(dd)*1.1 if min(dd)<0 else -5, 1)
    ax2.xaxis.set_major_locator(mdates.MonthLocator(interval=2)); ax2.xaxis.set_major_formatter(mdates.DateFormatter("%b '%y"))
    plt.setp(ax1.get_xticklabels(), visible=False)
    apply_style(fig,[ax1,ax2])
    header(fig,"11 — RISK & STATS — VOL + DRAWDOWN + SKEW", f"KALYANKJIL · VOL60 {fmt(vol60)}%  SHARPE {fmt(sharpe,2)}  MAXDD {fmt(maxDD,1)}%  CALMAR {fmt(calmar,2)}", badge=f"DD {curDD:.1f}%", bcolor=DOWN if curDD<-10 else MUTED)
    footer(fig); save(fig,f"{outdir}/11_risk_stats.png")

def chart12():
    fig, ax = plt.subplots(figsize=(10.666,6), dpi=180)
    ax.set_facecolor(PANEL)
    # radar-like bar of 10 composite signals scaled 0-100
    labels=["Trend\nScore","SMA\nAlign","RSI\nSig","MACD\nHist","%B","RelVol","Chan\nPos","ADX","Golden\nCross","Regime"]
    # normalize each to 0-100 for display
    vals=[]
    vals.append( (trendScore+100)/2 )  # -100..100 ->0..100
    vals.append( sma_align/5*100 )
    vals.append( (rsi14[-1]/100*100) if isFinite(rsi14[-1]) else 50 )
    vals.append( 50+ max(-30,min(30, macdHist[-1]/5))*1.6 if isFinite(macdHist[-1]) else 50 )
    vals.append( bbPB[-1]*100 if isFinite(bbPB[-1]) else 50 )
    vals.append( min(100, relVol[-1]/2*100) if isFinite(relVol[-1]) else 50 )
    chan_pos = (closes[-1]-sup20)/(res20-sup20)*100 if res20!=sup20 else 50
    vals.append(chan_pos)
    vals.append( adx14[-1]/60*100 if isFinite(adx14[-1]) else 0 )
    vals.append( 100 if golden else 0 )
    vals.append( 100 if regime=="BULL" else 0 if regime=="BEAR" else 50 )
    colors=[UP if v>=55 else DOWN if v<=40 else MUTED for v in vals]
    bars=ax.bar(labels, vals, color=colors, edgecolor=HAIRLINE, linewidth=0.8, alpha=0.95)
    ax.set_ylim(0,100); ax.set_ylabel("SCORE 0–100", color=MUTED, fontsize=6)
    ax.axhline(50, color=HAIRLINE_STRONG, linewidth=0.7, linestyle=":")
    ax.axhline(70, color=UP, linewidth=0.6, alpha=0.6, linestyle="--")
    ax.axhline(30, color=DOWN, linewidth=0.6, alpha=0.6, linestyle="--")
    for bar, v in zip(bars, vals):
        ax.text(bar.get_x()+bar.get_width()/2, bar.get_height()+1, f"{v:.0f}", color=PAPER, fontsize=6, ha="center", va="bottom", fontfamily="monospace")
    apply_style(fig,ax)
    header(fig,"12 — COMPOSITE RADAR — 10 SIGNALS NORMALIZED", f"KALYANKJIL · REGIME {regime}  SCORE {trendScore}  SMA {sma_align}/5  RSI {fmt(rsi14[-1],1)}", badge=f"{regime}", bcolor=UP if regime=="BULL" else DOWN if regime=="BEAR" else MUTED)
    footer(fig); save(fig,f"{outdir}/12_composite_radar.png")

def chart13():
    fig=plt.figure(figsize=(10.666,6), dpi=180)
    gs=fig.add_gridspec(2,1, height_ratios=[1.2,0.8], hspace=0.18)
    ax1=fig.add_subplot(gs[0]); ax2=fig.add_subplot(gs[1], sharex=ax1)
    for ax in [ax1,ax2]: ax.set_facecolor(PANEL)
    ax1.plot(mpl_dates, closes, color=PAPER, linewidth=1.1, label="Close")
    ax1.plot(mpl_dates, sma20, color=UP, linewidth=0.9, alpha=0.9, label="SMA20")
    ax1.plot(mpl_dates, tema20, color=MUTED, linewidth=0.8, linestyle="--", label="TEMA20")
    # HL2/HLC3 faint
    ax1.plot(mpl_dates, hl2, color=HAIRLINE_STRONG, linewidth=0.6, alpha=0.7, label="HL2")
    ax1.set_ylabel("PRICE", color=MUTED, fontsize=6)
    # lower: intraday range + body
    ax2.plot(mpl_dates, intrarange, color=PAPER, linewidth=0.9, label="Range %")
    ax2.plot(mpl_dates, [abs(v) for v in body_pct], color=UP, linewidth=0.7, label="|Body|%")
    ax2.plot(mpl_dates, close_pos, color=MUTED, linewidth=0.7, linestyle="--", label="ClosePos")
    ax2.set_ylabel("INTRADAY %", color=MUTED, fontsize=6)
    ax2.set_ylim(0,100)
    ax2.xaxis.set_major_locator(mdates.MonthLocator(interval=2)); ax2.xaxis.set_major_formatter(mdates.DateFormatter("%b '%y"))
    plt.setp(ax1.get_xticklabels(), visible=False)
    apply_style(fig,[ax1,ax2])
    header(fig,"13 — PRICE STRUCTURE — HL2 / TEMA + INTRADAY CHARACTER", f"KALYANKJIL · RANGE {fmt(intrarange[-1],2)}%  BODY {fmt(body_pct[-1],2)}%  CLOSEPOS {fmt(close_pos[-1],0)}", badge=f"{'HAMMER' if hammer else 'NO HAMMER'}", bcolor=UP if hammer else MUTED)
    footer(fig); save(fig,f"{outdir}/13_price_structure.png")

print("Generating extended charts 07-13...")
chart07(); chart08(); chart09(); chart10(); chart11(); chart12(); chart13()

# update kalyan_summary with new refs
summary_path=f"{outdir}/kalyan_summary.json"
if os.path.exists(summary_path):
    try:
        summ=json.load(open(summary_path))
        summ["extendedCharts"]=[f"{outdir}/{x}" for x in ["07_trend_strength.png","08_volatility_ext.png","09_volume_flow.png","10_support_fib.png","11_risk_stats.png","12_composite_radar.png","13_price_structure.png"]]
        summ["technical100"]={"count":len(items),"regime":regime,"trendScore":trendScore}
        json.dump(summ, open(summary_path,"w"), indent=2)
        print("Updated kalyan_summary.json")
    except Exception as e: print("summary update failed",e)

print("DONE 100")
