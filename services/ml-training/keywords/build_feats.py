from paths import WORK, MODELS, APP_MODELS  # noqa: E402,F401
import numpy as np, sys, os
import feats
from feats import HOP, MELWIN, NEMB
from augment import mix, voice_fx, noise, rng, level
C=f'{WORK}/clips'; OUT=f'{WORK}/feats'; os.makedirs(OUT,exist_ok=True)
L=lambda k: list(np.load(f'{C}/{k}.npy',allow_pickle=True))
split=sys.argv[1]; part=sys.argv[2]   # part: help|bachao|neg
neg_c=L(f'neg2_{split}') if part=='neg2' else (L(f'neg_{split}')+L(f'neg2_{split}') if part=='negiso' else L(f'neg_{split}'))
babble=[level(c,-25) for c in neg_c[:300]]
def last_windows(x, k):
    """Embeddings only for the last NEMB+k-1 hops (what the last k windows need)."""
    M=feats.mel_chunks(x); frames=M.reshape(-1,32); n=len(M)
    need=list(range(max(n-(NEMB+k-1),0),n)); need=[i for i in need if (i+1)*8>=MELWIN]
    if len(need)<NEMB: return []
    W=np.stack([frames[(i+1)*8-MELWIN:(i+1)*8] for i in need])[...,None].astype(np.float32)
    E=feats._emb.run(None,{'input_1':W})[0].reshape(-1,96)
    return [E[j-NEMB+1:j+1] for j in range(len(E)-1,NEMB-2,-1)][:k]
if part in ('help','bachao'):
    clips=L(f'{part}_{split}'); label=[1,0] if part=='help' else [0,1]
    AUG = 3 if split=='train' else 3
    X=[]
    for ci,c in enumerate(clips):
        for a in range(AUG):
            v=voice_fx(c) if split=='train' else c
            total=HOP*max(27,int(np.ceil((len(v)+rng.integers(9000,14000))/HOP)))
            snr=None if rng.random()<0.15 else (rng.uniform(0,25) if split=='train' else [20,10,5][a%3])
            x=mix(v,total,int(rng.uniform(0.05,0.3)*16000),snr,babble)
            X += last_windows(x, 2 if split=='train' else 1)
        if ci%500==0: print(part,ci,len(X),flush=True)
    X=np.array(X,np.float32); Y=np.tile(np.array(label,np.float32),(len(X),1))
    np.savez(f'{OUT}/{split}_{part}.npz',X=X,Y=Y); print(part,X.shape,flush=True)
elif part=='negiso':
    # Negatives built EXACTLY like the positives (one utterance in a quiet or noisy
    # canvas), so "speech starting after quiet" is not a cue for the keyword.
    X=[]
    for ci,c in enumerate(neg_c):
        v=voice_fx(c) if split=='train' else c
        total=HOP*max(27,int(np.ceil((len(v)+rng.integers(9000,30000))/HOP)))
        snr=None if rng.random()<0.3 else rng.uniform(0,25)
        x=mix(v,total,int(rng.uniform(0.0,1.0)*16000),snr,babble)
        W,_=feats.windows(feats.embeddings(x)); X+=list(W)
        if ci%1000==0: print('negiso',ci,len(X),flush=True)
    X=np.array(X,np.float32); np.savez(f'{OUT}/{split}_negiso.npz',X=X,Y=np.zeros((len(X),2),np.float32)); print('negiso',X.shape,flush=True)
else:
    order=rng.permutation(len(neg_c)); stream=[]
    for i in order:
        c=neg_c[i]; v=voice_fx(c) if split=='train' else c
        stream.append(level(v,rng.uniform(-35,-8))); stream.append(np.zeros(int(rng.uniform(0.1,1.0)*16000),np.float32))
    S=np.concatenate(stream); del stream
    reps = (2 if split=='train' else 1) if part=='neg' else 1
    negX=[]; B=16000*120
    for r in range(reps):
        for b in range(0,len(S),B):
            seg=S[b:b+B]; x=np.clip(seg+level(noise(len(seg),babble),-35-rng.uniform(5,25) if rng.random()<0.75 else rng.uniform(-85,-60)),-1,1)
            W,_=feats.windows(feats.embeddings(x),stride=2 if split=='train' else 1); negX.append(W)
        print('neg speech pass',r,sum(len(w) for w in negX),flush=True)
    for k in range((30 if split=='train' else 10) if part=='neg' else 0):
        n=16000*30; x=level(noise(n,babble),rng.uniform(-60,-15)) if k%5 else (rng.standard_normal(n)*1e-4).astype(np.float32)
        W,_=feats.windows(feats.embeddings(x),stride=3); negX.append(W)
    X=np.concatenate(negX); np.savez(f'{OUT}/{split}_{part}.npz',X=X,Y=np.zeros((len(X),2),np.float32),seconds=len(S)/16000*reps)
    print('neg',X.shape,'speech sec',len(S)/16000*reps,flush=True)
