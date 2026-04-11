
import sherpa_onnx
print('sherpa-onnx version:', getattr(sherpa_onnx, '__version__', 'unknown'))
print('CUDA support available?', 'cuda' in dir(sherpa_onnx) or hasattr(sherpa_onnx, 'CudaConfig'))
