from paths import WORK, MODELS, APP_MODELS  # noqa: E402,F401
import numpy as np, tensorflow as tf, os
from ai_edge_litert.interpreter import Interpreter
m=tf.keras.models.load_model(f'{WORK}/head.keras')
inp=tf.keras.Input((16,96),batch_size=1,name='embeddings'); fixed=tf.keras.Model(inp,m(inp,training=False))
fixed.export(f'{WORK}/head_savedmodel')
conv=tf.lite.TFLiteConverter.from_saved_model(f'{WORK}/head_savedmodel')
conv.target_spec.supported_ops=[tf.lite.OpsSet.TFLITE_BUILTINS]
open(f'{WORK}/kws_head.tflite','wb').write(conv.convert())
it=Interpreter(model_path=f'{WORK}/kws_head.tflite'); it.allocate_tensors()
d=np.load(f'{WORK}/feats/test_neg.npz'); x=np.concatenate([np.load(f'{WORK}/feats/test_help.npz')['X'][:200],np.load(f'{WORK}/feats/test_bachao.npz')['X'][:200],d['X'][:200]])
ref=m.predict(x,verbose=0); mx=0
for i in range(len(x)):
    it.set_tensor(it.get_input_details()[0]['index'],x[i:i+1]); it.invoke(); mx=max(mx,np.abs(it.get_tensor(it.get_output_details()[0]['index'])-ref[i]).max())
print('size',os.path.getsize(f'{WORK}/kws_head.tflite'),'max diff tflite vs keras',mx, it.get_input_details()[0]['shape'])
