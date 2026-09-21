# Browser performance — web-v1

## Preserved scientific conditions
The original bundle in `public/models/rubi/` is unchanged. A separate `rubi-web/` bundle uses QEM derivatives for seven visual-only meshes; the XML, both policy files, and both contact foot meshes are byte-identical. Source hashes and bounds are in `web-assets-report.json`. AABB error is not a surface-error guarantee: visually review the derivatives before recruiting participants. Physics timestep, policy cadence, awaited inference, gains, reset, collision, and survey viewing rules are unchanged.

## Pipeline
Hosted assets go directly to a verified byte map. SHA-256 is checked once per successful load. Versioned URLs use HTTP force-cache; corrupt/stale bytes trigger one reload and still must pass the hash. `no-cache` on the small manifest means revalidation, not “never store”. No File-object roundtrip is used for hosted loading. Local file selection remains available.

Visual mesh normals reuse MuJoCo data using the actual face-to-normal indices; matching array lengths alone is not sufficient. The renderer defaults to DPR=1 with shadows off, inspired by the PongBot R2 demo. No PongBot controller/gains are transplanted into RUBI.

Successful rollouts have a bounded same-tab LRU cache. The key includes all model fingerprints, controller profile, physical terrain dimensions, speed, route vertices, route type and a contract version. Direct routes can be reused across detour-distance questions only when their actual simulation inputs are identical. Cache hits retain the source rollout ID and original compute time. Viewing coverage/consent and both-route success are still required. Nothing is reused across participants/devices.

## Reproduction
The reduced bundle is committed, so ordinary npm users do not need Python packages. To regenerate: `python -m pip install numpy==2.2.6 fast-simplification==0.1.13`, then `python tools/optimize_web_assets.py --apply`. This writes a derivative only. Run `npm test`, `npm run build`, and `node tools/performance-check.mjs` (Playwright Chromium required).

Benchmark stage timings are from the stated GitHub runner/browser and localhost asset serving. They are not predictions of the participant’s network speed. See performance JSON/logs for model compilation, real rollouts, and cached repeat timings separately.

## Reference
Implementation reference (not a drop-in controller): https://github.com/TAEM1N2/mujoco_wasm_Pongbot_R2 at e4c6ecf7e072f652960aa2723694cb7007068123, `src/main.js` and `src/mujocoUtils.js`. Our implementation is independent and preserves RUBI’s existing policy contract.
