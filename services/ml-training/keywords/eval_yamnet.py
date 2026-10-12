from paths import WORK, MODELS, APP_MODELS  # noqa: E402,F401
import numpy as np, sys, glob, json, soundfile as sf
from augment import level, rng
from ai_edge_litert.interpreter import Interpreter
it=Interpreter(model_path=f'{MODELS}/yamnet.tflite',num_threads=1); it.allocate_tensors()
ii=it.get_input_details()[0]['index']; oi=it.get_output_details()[0]['index']
SH=[6,7,9,11]; CR=[19,21,22]
def seq(x):
    out=[]
    for e in range(15600, len(x)+1, 8000):
        # device: window ends every 8000 samples once 15600 are filled
        pass
    # replicate SoundEventClassifier: classify at multiples of 8000 samples, window = last 15600
    for end in range(8000, len(x)+1, 8000):
        if end<15600: continue
        w=x[end-15600:end].astype(np.float32); it.set_tensor(ii,w); it.invoke(); s=it.get_tensor(oi)[0]
        out.append((max(s[c] for c in SH), max(s[c] for c in CR)))
    return np.array(out) if out else np.zeros((0,2))
def fires(v,thr,h,w):
    buf=[];n=0;last=-99
    for i,s in enumerate(v):
        buf.append(s); buf=buf[-w:]
        if i-last<16: continue
        if sum(b>=thr for b in buf)>=h: n+=1; last=i; buf=[]
    return n
RULES={'shout':{'low':(0.6,2,3),'medium':(0.4,2,3),'high':(0.3,1,1)},'cry':{'low':(0.6,4,5),'medium':(0.45,3,5),'high':(0.3,2,4)}}
res={}
D=f'{MODELS}/sherpa-onnx-zipformer-small-audio-tagging-2024-04-15/test_wavs'
def rs(x,sr): return x if sr==16000 else np.interp(np.linspace(0,len(x)-1,int(len(x)*16000/sr)),np.arange(len(x)),x).astype(np.float32)
for f in sorted(glob.glob(D+'/*.wav'),key=lambda p:int(p.split('/')[-1][:-4])):
    x,sr=sf.read(f,dtype='float32'); x=x if x.ndim==1 else x.mean(1); x=rs(x,sr)
    x=np.concatenate([x,x,x])  # ~longer exposure
    v=seq(x); r={k:{s:fires(v[:,0 if k=='shout' else 1],*RULES[k][s]) for s in RULES[k]} for k in RULES}
    res[f.split('/')[-1]]=r; print(f.split('/')[-1], 'maxshout',v[:,0].max().round(2),'maxcry',v[:,1].max().round(2), r)
# negative TTS speech stream (held-out), loud and normal levels
neg=list(np.load(f'{WORK}/clips/neg_test.npy',allow_pickle=True))
for lvl in (-25,-10):
    S=np.concatenate([np.concatenate([level(c,lvl+rng.uniform(-3,3)),np.zeros(4000,np.float32)]) for c in neg]); hours=len(S)/16000/3600
    v=seq(np.clip(S,-1,1))
    r={k:{s:round(fires(v[:,0 if k=='shout' else 1],*RULES[k][s])/hours,2) for s in RULES[k]} for k in RULES}
    res[f'speech_{lvl}dB_per_hour']=r; print('speech',lvl,'dBFS per hour',r,'hours',round(hours,2))
json.dump(res,open(f'{WORK}/eval_yamnet.json','w'),indent=1)
