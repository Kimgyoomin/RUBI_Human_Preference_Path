# Gazebo terrain policy mapping

Source: Kimgyoomin/RUBI_Nav_simulation_package @ 59b761712a4cd280d545cfd29b3509a988671fdf

```
ros2 launch rubi_gazebo_sim rubi_gazebo_terrain_lidar.launch.py
```

The launch selects controller_variant=terrain and forwards encoder/policy to terrain_encoder/terrain_policy. It uses GazeboTerrainPolicyRunner, NOT the canonical 300/36 manifest.

| File | Input | Output | SHA256 |
|---|---|---|---|
| encoder.onnx | float32 mlp_input [330] | float32 mlp_output [32] | 8d04fa39832111a7c52dc012cc919afb387e17301799a863830c4fa83ab9d1ed |
| policy.onnx | float32 mlp_input [65] | float32 mlp_output [6] | bb7c45952e7471975c024127f8c8814f997ef1194e56f6c271f3834343939732 |

Uploaded legacy: [batch_size,320]->[batch_size,7]. RUBI-W: encoder [340]->[3], policy [40]->[8]. These are not interchangeable with terrain.

These hashes/shapes were read from uploaded binary files. A matching filename/shape does not prove which binary is installed on the ROS machine: compare its SHA256 or pass explicit launch paths.

Physics dt=0.002, inference decimation=5, policy dt=0.01. The golden fixture checks ported controller calculations using mock network outputs, not closed-loop locomotion.

References:
- https://github.com/Kimgyoomin/RUBI_Nav_simulation_package/blob/59b761712a4cd280d545cfd29b3509a988671fdf/rubi_gazebo_sim/launch/rubi_gazebo_terrain_lidar.launch.py
- https://github.com/Kimgyoomin/RUBI_Nav_simulation_package/blob/59b761712a4cd280d545cfd29b3509a988671fdf/rubi_control_core/include/rubi_control_core/gazebo_terrain_policy_runner.hpp
