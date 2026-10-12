from paths import WORK, MODELS, APP_MODELS  # noqa: E402,F401
import sherpa_onnx, numpy as np, os, random, sys, json, itertools
from texts import POS, NEG
M=f'{MODELS}'; OUT=f'{WORK}/clips'; os.makedirs(OUT,exist_ok=True)
VOICES = [ # dir, lang, heldout-speakers, max speakers to use
 ('vits-piper-en_US-libritts_r-medium','en',set(range(800,904)),904),
 ('vits-piper-en_GB-vctk-medium','en',set(range(100,109)),109),
 ('vits-piper-en_US-arctic-medium','en',{17},18),
 ('vits-piper-en_GB-southern_english_female-medium','en',{5},6),
 ('vits-piper-en_US-hfc_female-medium','en',set(),1),('vits-piper-en_US-hfc_male-medium','en',set(),1),
 ('vits-piper-en_US-lessac-medium','en',set(),1),('vits-piper-en_US-ryan-high','en',{0},1),
 ('vits-piper-en_GB-alan-medium','en',set(),1),('vits-piper-en_US-amy-low','en',{0},1),
 ('vits-mimic3-bn-multi_low','bn',{14,15},16),('vits-coqui-bn-custom_female','bn',set(),1),
 ('vits-piper-hi_IN-pratham-medium','hi',set(),1),('vits-piper-hi_IN-priyamvada-medium','hi',{0},1),
 ('vits-piper-ne_NP-google-medium','ne',{16,17},18),('vits-piper-ne_NP-chitwan-medium','ne',set(),1),
]
def load(d, ns, ls):
    onnx=[f for f in os.listdir(f'{M}/{d}') if f.endswith('.onnx')][0]
    kw=dict(model=f'{M}/{d}/{onnx}',tokens=f'{M}/{d}/tokens.txt',noise_scale=ns,length_scale=ls)
    if os.path.exists(f'{M}/{d}/espeak-ng-data'): kw['data_dir']=f'{M}/{d}/espeak-ng-data'
    return sherpa_onnx.OfflineTts(sherpa_onnx.OfflineTtsConfig(model=sherpa_onnx.OfflineTtsModelConfig(vits=sherpa_onnx.OfflineTtsVitsModelConfig(**kw),num_threads=2)))
def rs(x,sr):
    if sr==16000: return x
    n=int(len(x)*16000/sr); return np.interp(np.linspace(0,len(x)-1,n),np.arange(len(x)),x).astype(np.float32)
def trim(x,thr=0.02):
    a=np.abs(x); idx=np.where(a>thr*a.max())[0]
    return x[max(0,idx[0]-400):idx[-1]+400] if len(idx) else x
def main():
    random.seed(int(sys.argv[1]) if len(sys.argv)>1 else 0)
    store={}
    def add(key,x): store.setdefault(key,[]).append(x)
    for d,lang,held,nspk in VOICES:
        big = nspk>100
        for ns,ls in ([(0.667,1.0),(0.9,0.85),(0.5,1.25)] if not big else [(0.667,1.0),(0.8,0.9)]):
            t=load(d,ns,ls)
            spks = list(range(max(1,t.num_speakers)))
            if big: spks=[s for s in spks if (s in held) or random.random()<0.6]
            for sid in spks:
                split='test' if sid in held else 'train'
                reps = 1 if big else 3
                for kw in ('help','bachao'):
                    texts=POS[kw].get(lang,[])
                    for _ in range(reps if texts else 0):
                        a=t.generate(random.choice(texts),sid=sid,speed=random.uniform(0.85,1.2))
                        add(f'{kw}_{split}',trim(rs(np.array(a.samples,np.float32),a.sample_rate)))
                for txt in random.sample(NEG[lang], 2 if big else 6):
                    a=t.generate(txt,sid=sid,speed=random.uniform(0.85,1.15))
                    add(f'neg_{split}',trim(rs(np.array(a.samples,np.float32),a.sample_rate)))
            print(d,ns,{k:len(v) for k,v in store.items()},flush=True)
    for k,v in store.items():
        np.save(f'{OUT}/{k}.npy',np.array(v,dtype=object),allow_pickle=True)
    print('done',{k:len(v) for k,v in store.items()})

if __name__=='__main__':
    main()
