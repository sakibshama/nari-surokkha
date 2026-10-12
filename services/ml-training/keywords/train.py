from paths import WORK, MODELS, APP_MODELS  # noqa: E402,F401
import numpy as np, tensorflow as tf, sys, json, os
tf.random.set_seed(0); np.random.seed(0)
parts=[np.load(f'{WORK}/feats/train_{k}.npz') for k in ('help','bachao','neg','neg2','negiso')]
X=np.concatenate([p['X'] for p in parts]); Y=np.concatenate([p['Y'] for p in parts])
print('train',X.shape,Y.sum(0),'neg',(Y.sum(1)==0).sum())
idx=np.random.permutation(len(X)); X,Y=X[idx],Y[idx]
nval=int(0.08*len(X)); Xv,Yv=X[:nval],Y[:nval]; Xt,Yt=X[nval:],Y[nval:]
inp=tf.keras.Input((16,96),batch_size=None,name='embeddings')
x=tf.keras.layers.Flatten()(inp)
x=tf.keras.layers.Dense(128)(x); x=tf.keras.layers.LayerNormalization()(x); x=tf.keras.layers.ReLU()(x); x=tf.keras.layers.Dropout(0.3)(x)
x=tf.keras.layers.Dense(64)(x); x=tf.keras.layers.LayerNormalization()(x); x=tf.keras.layers.ReLU()(x); x=tf.keras.layers.Dropout(0.2)(x)
out=tf.keras.layers.Dense(2,activation='sigmoid',name='scores')(x)
model=tf.keras.Model(inp,out)
# negatives are far more numerous and false alarms matter: weight per sample
w_pos=float(sys.argv[1]) if len(sys.argv)>1 else 1.0
sw=np.where(Yt.sum(1)>0, w_pos, 1.0).astype(np.float32)
model.compile(optimizer=tf.keras.optimizers.Adam(1e-3),loss='binary_crossentropy',metrics=[tf.keras.metrics.AUC(multi_label=True)])
model.fit(Xt,Yt,sample_weight=sw,validation_data=(Xv,Yv),epochs=int(os.environ.get('EPOCHS',30)),batch_size=512,verbose=2,
          callbacks=[tf.keras.callbacks.ReduceLROnPlateau(patience=3,factor=0.5),tf.keras.callbacks.EarlyStopping(patience=6,restore_best_weights=True)])
model.save(f'{WORK}/head.keras')
# fixed-shape TFLite [1,16,96] -> [1,2]
@tf.function(input_signature=[tf.TensorSpec([1,16,96],tf.float32)])
def serve(e): return model(e,training=False)
conv=tf.lite.TFLiteConverter.from_concrete_functions([serve.get_concrete_function()],model)
conv.target_spec.supported_ops=[tf.lite.OpsSet.TFLITE_BUILTINS]
open(f'{WORK}/kws_head.tflite','wb').write(conv.convert())
print('saved', os.path.getsize(f'{WORK}/kws_head.tflite'))
