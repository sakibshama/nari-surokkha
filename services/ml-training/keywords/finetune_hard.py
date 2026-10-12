from paths import WORK, MODELS, APP_MODELS  # noqa: E402,F401
import numpy as np, tensorflow as tf
m=tf.keras.models.load_model(f'{WORK}/head.keras')
parts=[np.load(f'{WORK}/feats/train_{k}.npz') for k in ('help','bachao','neg','neg2','negiso')]
X=np.concatenate([p['X'] for p in parts]); Y=np.concatenate([p['Y'] for p in parts])
p=m.predict(X,batch_size=4096,verbose=0)
neg=Y.sum(1)==0; hard=neg&(p.max(1)>0.2)
print('hard negatives',hard.sum(),'of',neg.sum())
w=np.ones(len(X),np.float32); w[~neg]=3.0; w[hard]=8.0
idx=np.random.default_rng(1).permutation(len(X))
m.compile(optimizer=tf.keras.optimizers.Adam(2e-4),loss='binary_crossentropy')
m.fit(X[idx],Y[idx],sample_weight=w[idx],epochs=6,batch_size=512,verbose=2)
m.save(f'{WORK}/head.keras')
