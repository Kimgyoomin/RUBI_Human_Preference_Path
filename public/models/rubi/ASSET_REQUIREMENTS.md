# Hosted RUBI assets

XML and bundle.json are already in this repository. Upload the terrain policy pair here and actual STL files to meshes/. Do not overwrite XML with a differently formatted copy without updating its fingerprint in bundle.json.

- encoder.onnx: float32 mlp_input [330] -> mlp_output [32]
- policy.onnx: float32 mlp_input [65] -> mlp_output [6]
- meshes/BODY.STL
- meshes/L_HIP.STL
- meshes/L_THIGH.STL
- meshes/L_CALF.STL
- meshes/L_TIP.STL
- meshes/R_HIP.STL
- meshes/R_THIGH.STL
- meshes/R_CALF.STL
- meshes/R_TIP.STL

Upload actual files, not ZIP archives or Git LFS pointer text. Files served by the website are downloadable independently of source repository privacy.
