# Standalone layout

Application entry points are package.json and src/ at repository root. Models belong in public/models/rubi/, not web/.

Hosted models are downloaded by the browser, validated against bundle.json, then executed locally with fixed simulation time steps. computeMs records wall-clock computation time separately from simulation duration.

This consolidation did not modify RUBI_Nav_simulation_package. Original model parameters in the root MJCF were preserved.
