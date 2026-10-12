/**
 * The only thing the detection pipeline needs from an inference runtime:
 * float32 tensors in, float32 tensors out. On the phone this is
 * react-native-fast-tflite (see tfliteModels.ts); the tests run the same
 * pipeline against ONNX copies of the same graphs.
 */
export interface TensorModel {
  run(inputs: Float32Array[]): Promise<Float32Array[]>;
}
