"""Reference streaming front-end. The TypeScript KeywordSpotter mirrors this exactly.
Audio: 16 kHz float in [-1,1], scaled to int16 range (x*32767) as openWakeWord expects.
Every HOP=1280 new samples: mel(last 1760 samples) -> 8 frames x 32 (already /10+2), with the
-80 dB floor computed per 1760-sample segment (as the device's fixed-shape model does).
Mel ring keeps the newest 76 frames; once 76 frames exist, one 96-d embedding per hop.
The head sees the newest 16 embeddings (1.28 s)."""
from paths import WORK, MODELS, APP_MODELS  # noqa: E402,F401
import numpy as np, onnx, onnxruntime as ort
from onnx import numpy_helper
HOP=1280; CTX=480; MELWIN=76; NEMB=16; SEG=HOP+CTX
_W={i.name:numpy_helper.to_array(i) for i in onnx.load(f'{MODELS}/oww/melspectrogram.onnx').graph.initializer}
_WR=_W['0.stft.conv_real.weight'][:,0,:].T.astype(np.float32); _WI=_W['0.stft.conv_imag.weight'][:,0,:].T.astype(np.float32)
_MEL=_W['1.melW'].astype(np.float32)
_so=ort.SessionOptions(); _so.intra_op_num_threads=1; _so.inter_op_num_threads=1
_emb=ort.InferenceSession(f'{MODELS}/oww/embedding_model.onnx',_so,providers=['CPUExecutionProvider'])
_FIDX=(np.arange(8)[:,None]*160+np.arange(512)[None,:])  # 8 frames of 512 within a 1760 segment
def mel_segments(segs):
    """segs [n,1760] int16-scale -> [n,8,32] (transform /10+2 applied)."""
    fr=segs[:,_FIDX]                                  # n,8,512
    re=fr@_WR; im=fr@_WI; p=re*re+im*im               # n,8,257
    db=10*np.log10(np.maximum(p@_MEL,1e-10))          # n,8,32
    mx=db.reshape(len(db),-1).max(1)[:,None,None]
    db=np.maximum(db,mx-80.0)
    return (db/10+2).astype(np.float32)
def mel_chunks(x):
    s=(x*32767.0).astype(np.float32); n=len(s)//HOP
    pad=np.concatenate([np.zeros(CTX,np.float32),s])
    if n==0: return np.zeros((0,8,32),np.float32)
    idx=(np.arange(n)[:,None]*HOP+np.arange(SEG)[None,:])
    out=[]
    for b in range(0,n,512): out.append(mel_segments(pad[idx[b:b+512]]))
    return np.concatenate(out)
def embeddings(x):
    M=mel_chunks(x); frames=M.reshape(-1,32); n=len(M)
    E=np.full((n,96),np.nan,np.float32); idx=[i for i in range(n) if (i+1)*8>=MELWIN]
    if idx:
        W=np.stack([frames[(i+1)*8-MELWIN:(i+1)*8] for i in idx])[...,None].astype(np.float32)
        out=[_emb.run(None,{'input_1':W[b:b+512]})[0].reshape(-1,96) for b in range(0,len(W),512)]
        E[idx]=np.concatenate(out)
    return E
def windows(E, stride=1):
    valid=~np.isnan(E[:,0]); res=[];ends=[]
    for i in range(NEMB-1,len(E)):
        if (i%stride==0) and valid[i-NEMB+1]: res.append(E[i-NEMB+1:i+1]); ends.append(i)
    return (np.array(res,np.float32) if res else np.zeros((0,NEMB,96),np.float32)), ends
