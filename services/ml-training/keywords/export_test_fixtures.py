"""Fixtures for apps/mobile/__tests__/detector.models.test.ts:
ONNX copies of the four shipped .tflite models, test WAVs (held-out speakers) with expected
detections, and Python reference keyword scores for the TS parity test."""
from paths import WORK, MODELS, APP_MODELS  # noqa: E402,F401
import numpy as np, json, os, sys, subprocess, soundfile as sf, glob
import feats
from augment import mix, level, rng
OUT=os.environ.get('FIXTURES',f'{WORK}/fixtures'); os.makedirs(OUT,exist_ok=True)
APP=APP_MODELS
for name in ('yamnet','kws_mel','kws_embedding','kws_head'):
    subprocess.run([sys.executable,'-m','tf2onnx.convert','--tflite',f'{APP}/{name}.tflite','--output',f'{OUT}/{name}.onnx','--opset','17'],check=True,capture_output=True)
L=lambda k: list(np.load(f'{WORK}/clips/{k}.npy',allow_pickle=True))
neg=L('neg_test')+L('neg2_test'); babble=[level(c,-25) for c in neg[:100]]
cases=[]
def save(name,x): sf.write(f'{OUT}/{name}',np.clip(x,-1,1),16000,subtype='PCM_16'); return name
for kw in ('help','bachao'):
    clips=L(f'{kw}_test'); idx=rng.choice(len(clips),40,replace=False)
    for j,i in enumerate(idx):
        c=clips[i]; snr=[None,20,10,5][j%4]
        total=1280*int(np.ceil((len(c)+16000*3)/1280))
        x=mix(c,total,12000,snr,babble,sig_db=-20)
        cases.append(dict(file=save(f'{kw}_{j}.wav',x),expect=kw,group=f'{kw} (held-out voices)'))
# negatives: 3 utterances back to back, low noise
for j in range(40):
    parts=[]
    for i in rng.choice(len(neg),3,replace=False): parts+=[level(neg[i],rng.uniform(-30,-12)),np.zeros(6000,np.float32)]
    x=np.concatenate([np.zeros(16000,np.float32)]+parts); x=x+level(rng.standard_normal(len(x)).astype(np.float32),-55)
    cases.append(dict(file=save(f'neg_{j}.wav',x),expect=None,group='normal speech (no alert)'))
# real recordings (sherpa-onnx audio-tagging test set)
D=f'{MODELS}/sherpa-onnx-zipformer-small-audio-tagging-2024-04-15/test_wavs'
def rs(x,sr): return x if sr==16000 else np.interp(np.linspace(0,len(x)-1,int(len(x)*16000/sr)),np.arange(len(x)),x).astype(np.float32)
for f,exp in [('6.wav','cry')]+[(f'{i}.wav',None) for i in (1,2,3,4,5,7,8,9,10,11,12,13)]:
    x,sr=sf.read(f'{D}/{f}',dtype='float32'); x=x if x.ndim==1 else x.mean(1); x=rs(x,sr)
    x=np.concatenate([x,x,x])
    cases.append(dict(file=save(f'real_{f}',x),expect=exp,group='real crying' if exp else 'real non-emergency sounds'))
json.dump(cases,open(f'{OUT}/cases.json','w'),indent=0)
json.dump({'help (held-out voices)':0.75,'bachao (held-out voices)':0.85,'normal speech (no alert)':0.95,'real crying':1.0,'real non-emergency sounds':0.9},open(f'{OUT}/bars.json','w'),indent=1)
# Python reference scores (TFLite head) for the parity test
from ai_edge_litert.interpreter import Interpreter
it=Interpreter(model_path=f'{APP}/kws_head.tflite'); it.allocate_tensors()
ref=[]
for c in cases[:6]+cases[80:82]:
    x,_=sf.read(f"{OUT}/{c['file']}",dtype='float32')
    W,_=feats.windows(feats.embeddings(x)); sc=[]
    for w in W: it.set_tensor(it.get_input_details()[0]['index'],w[None]); it.invoke(); sc.append(it.get_tensor(it.get_output_details()[0]['index'])[0].tolist())
    ref.append(dict(file=c['file'],scores=sc))
json.dump(ref,open(f'{OUT}/kws_reference.json','w'))
print('fixtures',len(cases),'->',OUT)
