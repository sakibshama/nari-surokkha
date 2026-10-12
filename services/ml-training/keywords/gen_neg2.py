"""Extra negatives for lexical diversity: random English word strings (common-ish words),
Bengali / Hindi / Nepali pseudo-words built from real syllables, and hard negatives that
sound close to the keywords. Same held-out speakers as gen.py."""
import numpy as np, random, sys, os
from gen import VOICES, load, rs, trim, OUT
from english_words import get_english_words_set
random.seed(7)
EN=[w for w in get_english_words_set(['gcide'],lower=True) if w.isalpha() and 2<=len(w)<=9 and not w.startswith('help')]
CONS_BN=list('কখগঘচছজঝটঠডঢতথদধনপফবভমযরলশসহ')+['ড়','য়']
VOW_BN=['','া','ি','ী','ু','ূ','ে','ো','ৈ','ৌ']
CONS_HI=list('कखगघचछजझटठडढतथदधनपफबभमयरलवशसह')
VOW_HI=['','ा','ि','ी','ु','ू','े','ो','ै','ौ']
HARD={'en':['Hell, no!','Yelp!','Held it!','Kelp.','Whelp.','Hello!','Hey, hep!','Bach!','Batch now!','Ciao!','Chow time!','Bad cow!','Butch, ow!','Pasta!','Hell yeah!','Shelf'],
      'bn':['বাজাও','বাচ্চা','বাঁচা','বাঁচবো','চাও','বাসা','পাঁচ','বাবা','বাজনা','বাঁকা','ব্যাচ','বাঁধো','বাছাই','বাচাল','যাও','খাও','দাও','নাচাও','হেলো','হ্যালো','বাঁশি'],
      'hi':['बजाओ','बच्चा','बचपन','बचत','चाओ','बाबा','नचाओ','जाओ','खाओ','हेलो','बच गया'],
      'ne':['बजाऊ','बच्चा','बचत','जाऊ','खाऊ','नाचौं']}
def pseudo(cons,vows,n):
    return ' '.join(''.join(random.choice(cons)+random.choice(vows) for _ in range(random.randint(2,4))) for _ in range(n))
def text(lang):
    r=random.random()
    if r<0.35: return random.choice(HARD[lang])
    if lang=='en': return ' '.join(random.choice(EN) for _ in range(random.randint(2,7)))
    if lang=='bn': return pseudo(CONS_BN,VOW_BN,random.randint(1,5))
    return pseudo(CONS_HI,VOW_HI,random.randint(1,5))
store={}
for d,lang,held,nspk in VOICES:
    big=nspk>100
    t=load(d,0.667,1.0)
    spks=list(range(max(1,t.num_speakers)))
    if big: spks=[s for s in spks if (s in held) or random.random()<0.35]
    per = 3 if big else (12 if nspk>1 else 40)
    for sid in spks:
        split='test' if sid in held else 'train'
        for _ in range(per):
            a=t.generate(text(lang),sid=sid,speed=random.uniform(0.85,1.2))
            x=trim(rs(np.array(a.samples,np.float32),a.sample_rate))
            if len(x)>1600: store.setdefault(split,[]).append(x)
    print(d,{k:len(v) for k,v in store.items()},flush=True)
for k,v in store.items(): np.save(f'{OUT}/neg2_{k}.npy',np.array(v,dtype=object),allow_pickle=True)
print('done')
