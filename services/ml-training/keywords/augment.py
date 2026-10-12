from paths import WORK, MODELS, APP_MODELS  # noqa: E402,F401
from scipy.signal import fftconvolve
import numpy as np, soundfile as sf, glob
rng=np.random.default_rng(1234)
def _rs(x,sr): return x if sr==16000 else np.interp(np.linspace(0,len(x)-1,int(len(x)*16000/sr)),np.arange(len(x)),x).astype(np.float32)
NOISE=[]
for f in glob.glob(f'{MODELS}/sherpa-onnx-zipformer-small-audio-tagging-2024-04-15/test_wavs/*.wav'):
    x,sr=sf.read(f,dtype='float32'); x=x if x.ndim==1 else x.mean(1); NOISE.append(_rs(x,sr))
def colored(n, kind):
    w=rng.standard_normal(n).astype(np.float32)
    if kind=='white': return w
    X=np.fft.rfft(w); f=np.arange(len(X))+1.0
    X=X/(np.sqrt(f) if kind=='pink' else f)
    y=np.fft.irfft(X,n).astype(np.float32); return y/ (np.std(y)+1e-9)
def hum(n):
    t=np.arange(n)/16000; f0=rng.choice([50,60,100,120]); return (np.sin(2*np.pi*f0*t)+0.3*np.sin(4*np.pi*f0*t)).astype(np.float32)
def noise(n, babble_pool=None):
    k=rng.integers(0,6)
    if k==0: y=colored(n,'white')
    elif k==1: y=colored(n,'pink')
    elif k==2: y=colored(n,'brown')
    elif k==3: y=hum(n)+0.3*colored(n,'pink')
    elif k==4 and NOISE:
        src=NOISE[rng.integers(len(NOISE))]; reps=int(np.ceil(n/len(src)))+1; y=np.tile(src,reps); o=rng.integers(0,len(src)); y=y[o:o+n]
    else:
        if babble_pool is not None and len(babble_pool):
            y=np.zeros(n,np.float32)
            for _ in range(rng.integers(2,5)):
                c=babble_pool[rng.integers(len(babble_pool))]; c=np.tile(c,int(np.ceil(n/len(c)))+1)[:n]; y+=c*rng.uniform(0.3,1)
        else: y=colored(n,'pink')
    return (y/(np.sqrt(np.mean(y**2))+1e-9)).astype(np.float32)
def rir():
    rt=rng.uniform(0.1,0.7); n=int(rt*16000); t=np.arange(n)/16000
    h=rng.standard_normal(n)*np.exp(-6.9*t/rt); h[0]=1.0; return (h/np.sqrt(np.sum(h**2))).astype(np.float32)
def lowpass(x, fc):
    X=np.fft.rfft(x); f=np.fft.rfftfreq(len(x),1/16000); X[f>fc]*=0.02; return np.fft.irfft(X,len(x)).astype(np.float32)
def highpass(x, fc):
    X=np.fft.rfft(x); f=np.fft.rfftfreq(len(x),1/16000); X[f<fc]*=0.05; return np.fft.irfft(X,len(x)).astype(np.float32)
def pitch(x, semis):
    r=2**(semis/12); n=int(len(x)/r); return np.interp(np.linspace(0,len(x)-1,n),np.arange(len(x)),x).astype(np.float32)
def voice_fx(x):
    """Speaker/channel variation applied to the clean utterance."""
    if rng.random()<0.5: x=pitch(x,rng.uniform(-3,3))
    if rng.random()<0.4: x=fftconvolve(x,rir())[:len(x)+1600].astype(np.float32)
    if rng.random()<0.3: x=lowpass(x,rng.uniform(3400,7000))
    if rng.random()<0.3: x=highpass(x,rng.uniform(100,400))
    return x
def level(x, dbfs):
    r=np.sqrt(np.mean(x**2))+1e-9; return (x*(10**(dbfs/20)/r)).astype(np.float32)
def mix(sig, n_total, end_pad, snr, babble_pool=None, sig_db=None):
    """Place sig so it ends end_pad samples before the end of an n_total canvas of background noise."""
    sig_db = sig_db if sig_db is not None else rng.uniform(-35,-8)
    s=level(sig,sig_db)
    canvas=np.zeros(n_total,np.float32)
    st=max(0,n_total-end_pad-len(s)); seg=s[-(n_total-end_pad-st):] if len(s)>n_total-end_pad else s
    canvas[st:st+len(seg)]+=seg
    if snr is not None:
        nz=noise(n_total,babble_pool); canvas+=level(nz,sig_db-snr)
    else:
        # A real microphone is never digitally silent: always add a floor.
        canvas+=level(colored(n_total,'pink'),rng.uniform(-85,-55))
    if rng.random()<0.15:  # shouting into the mic: saturation
        g=rng.uniform(2,8); canvas=np.tanh(canvas*g)/np.tanh(g)*np.max(np.abs(canvas))
    return np.clip(canvas,-1,1).astype(np.float32)
