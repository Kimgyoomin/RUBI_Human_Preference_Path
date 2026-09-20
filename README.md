# RUBI Human Preference Path

Standalone browser-based route preference study for the RUBI bipedal robot.

The application runs MuJoCo WASM and ONNX Runtime Web in the participant's browser. This repository is independent from RUBI_Nav_simulation_package.

## Asset disclosure

Model files served by a public website can be downloaded by participants even when the source repository is private. Only use robot XML, meshes, and policy files approved for distribution.

## Development status

Initial project setup. The RUBI terrain policy uses encoder.onnx (330 -> 32) and policy.onnx (65 -> 6). Real robot locomotion validation also requires the XML's referenced STL meshes.
