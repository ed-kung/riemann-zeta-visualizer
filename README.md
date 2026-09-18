# Riemann Zeta Visualizer

Draw a curve on the input plane *s = σ + it* and watch it mapped through the
Riemann zeta function onto the output plane *ζ(s)* in real time. Also
includes a one-click animation of the critical line *σ = 1/2*, tracing the
famous spiral through the origin at each of the first six nontrivial zeros
(t ≈ 14.13, 21.02, 25.01, 30.42, 32.94, 37.59).

Static site, no build step, no dependencies.

## Run locally

Serve the folder with any static file server, e.g.:

```
python -m http.server 8000
```

then open `http://localhost:8000`.

## Deploy to GitHub Pages

Pages is configured to deploy from the `main` branch (**Settings → Pages →
Source: Deploy from a branch**), so pushing to `main` is enough — no build
step or workflow required.

## How it works

- `src/zeta.js` — complex arithmetic and ζ(s) via Borwein's globally
  convergent series for the Dirichlet eta function (analytic continuation
  of ζ across the whole plane except the pole at s=1).
- `src/app.js` — canvas rendering, pointer-driven drawing, and the critical
  line animation. The input/output coordinate ranges are fixed constants
  (not auto-fit to content), sized so the critical line animation shows six
  zeros comfortably.
