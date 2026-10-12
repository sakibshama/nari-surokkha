"""Streaming evaluation of the keyword heads with the app's decision rule.
Recall: held-out speakers, word placed in noise at SNR 20/10/5 dB (+clean).
False accepts: continuous held-out negative speech + noise, fires/hour."""
from paths import WORK, MODELS, APP_MODELS  # noqa: E402,F401
import numpy as np, sys, json, os
import feats
from augment import mix, rng, level, noise
import tensorflow as tf
head=tf.keras.models.load_model(f'{WORK}/head.keras')
C=f'{WORK}/clips'; L=lambda k: list(np.load(f'{C}/{k}.npy',allow_pickle=True))
def scores_for(x):
    W,_=feats.windows(feats.embeddings(x))
    return head.predict(W,verbose=0,batch_size=1024) if len(W) else np.zeros((0,2))
def fires(seq, thr, hits, win, refr_steps=100):
    out=[]; buf=[]; last=-10**9
    for i,s in enumerate(seq):
        buf.append(s); buf=buf[-win:]
        if i-last<refr_steps: continue
        if sum(v>=thr for v in buf)>=hits: out.append(i); last=i; buf=[]
    return out
RULES={'low':(0.9,2,4),'medium':(0.75,2,4),'high':(0.5,1,1)}
if len(sys.argv)>1: RULES=json.loads(sys.argv[1])
neg_c=L('neg_test'); babble=[level(c,-25) for c in neg_c[:100]]
res={}
for kw,col in (('help',0),('bachao',1)):
    clips=L(f'{kw}_test')
    for snr in (None,20,10,5):
        seqs=[]
        for c in clips:
            total=1280*int(np.ceil((len(c)+16000*3)/1280))
            x=mix(c,total,12000,snr,babble,sig_db=-20)
            seqs.append(scores_for(x))
        for name,(thr,h,w) in RULES.items():
            hit=sum(1 for s in seqs if fires(s[:,col],thr,h,w))
            other=sum(1 for s in seqs if fires(s[:,1-col],thr,h,w))
            res[f'{kw}/snr{snr}/{name}']=dict(recall=hit/len(seqs),cross=other/len(seqs),n=len(seqs))
        print(kw,snr,{k:round(v['recall'],3) for k,v in res.items() if k.startswith(f'{kw}/snr{snr}')},flush=True)
# false accepts: continuous negative speech in noise (held-out speakers), 3 noise levels
stream=[]
for c in neg_c+L('neg2_test'): stream+= [level(c,rng.uniform(-30,-10)), np.zeros(int(rng.uniform(0.2,1.0)*16000),np.float32)]
S=np.concatenate(stream); hours=len(S)/16000/3600
seqs=[]
for b in range(0,len(S),16000*120):
    seg=S[b:b+16000*120]; x=np.clip(seg+level(noise(len(seg),babble),-45),-1,1); seqs.append(scores_for(x))
allS=np.concatenate(seqs)
for name,(thr,h,w) in RULES.items():
    fh=len(fires(allS[:,0],thr,h,w)); fb=len(fires(allS[:,1],thr,h,w))
    res[f'fa/{name}']=dict(help_per_hour=fh/hours,bachao_per_hour=fb/hours,hours=hours)
    print('FA',name,round(fh/hours,2),round(fb/hours,2),'over',round(hours,2),'h',flush=True)
json.dump(res,open(f'{WORK}/eval.json','w'),indent=1)
