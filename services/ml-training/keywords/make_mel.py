from paths import WORK, MODELS, APP_MODELS  # noqa: E402,F401
import os
import onnx, numpy as np, tensorflow as tf, onnxruntime as ort
from onnx import numpy_helper
m=onnx.load(f'{MODELS}/oww/melspectrogram.onnx'); W={i.name:numpy_helper.to_array(i) for i in m.graph.initializer}
wr=W['0.stft.conv_real.weight'][:,0,:].T.astype(np.float32)  # [512,257]
wi=W['0.stft.conv_imag.weight'][:,0,:].T.astype(np.float32)
melW=W['1.melW'].astype(np.float32) # [257,32]
N=1760
kr=tf.constant(wr[:,None,:]); ki=tf.constant(wi[:,None,:]); mw=tf.constant(melW)
@tf.function(input_signature=[tf.TensorSpec([N],tf.float32)])
def mel(x):
    x3=tf.reshape(x,[1,N,1])
    re=tf.nn.conv1d(x3,kr,stride=160,padding='VALID')[0]  # [8,257]
    im=tf.nn.conv1d(x3,ki,stride=160,padding='VALID')[0]
    p=re*re+im*im
    ms=tf.matmul(p,mw)
    db=10.0*tf.math.log(tf.maximum(ms,1e-10))/2.3025851249694824
    db=tf.maximum(db, tf.reduce_max(db)-80.0)
    return db/10.0+2.0   # openWakeWord melspec_transform baked in
conv=tf.lite.TFLiteConverter.from_concrete_functions([mel.get_concrete_function()],mel)
conv.target_spec.supported_ops=[tf.lite.OpsSet.TFLITE_BUILTINS]
open(f'{WORK}/oww_mel_1760.tflite','wb').write(conv.convert())
# parity
from ai_edge_litert.interpreter import Interpreter
it=Interpreter(model_path=f'{WORK}/oww_mel_1760.tflite'); it.allocate_tensors()
s=ort.InferenceSession(f'{MODELS}/oww/melspectrogram.onnx')
import soundfile as sf, glob
mx=0
clips=list(np.load(f'{WORK}/clips/help_train.npy',allow_pickle=True))[:40] if os.path.exists(f'{WORK}/clips/help_train.npy') else [np.random.randn(16000).astype(np.float32)*0.1 for _ in range(10)]
for a in clips:
    a=(a*32767).astype(np.float32)  # oww feeds int16-scale floats
    a=np.pad(a,(0,max(0,N-len(a))))[:N]
    ref=s.run(None,{'input':a[None]})[0].squeeze()/10+2
    it.set_tensor(it.get_input_details()[0]['index'],a); it.invoke(); out=it.get_tensor(it.get_output_details()[0]['index'])
    mx=max(mx,np.abs(out-ref).max())
print('mel shape',out.shape,'max abs diff',mx)
it2=Interpreter(model_path=f'{MODELS}/oww/embedding_model.tflite'); it2.allocate_tensors()
s2=ort.InferenceSession(f'{MODELS}/oww/embedding_model.onnx')
x=np.random.rand(1,76,32,1).astype(np.float32)*3
it2.set_tensor(it2.get_input_details()[0]['index'],x); it2.invoke(); e1=it2.get_tensor(it2.get_output_details()[0]['index'])
e2=s2.run(None,{'input_1':x})[0]; print('embed diff',np.abs(e1-e2).max(), e1.shape)
