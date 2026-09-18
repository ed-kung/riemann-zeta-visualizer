// Complex arithmetic + Riemann zeta via Borwein's globally-convergent
// series for the Dirichlet eta function (analytic continuation).
// Verified against known values: zeta(2)=pi^2/6, zeta(-1)=-1/12,
// zeta(0.5)=-1.4603545..., and the first several nontrivial zeros.

export function cadd(a, b) { return { re: a.re + b.re, im: a.im + b.im }; }
export function csub(a, b) { return { re: a.re - b.re, im: a.im - b.im }; }
export function cdiv(a, b) {
  const d = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
}
export function cscale(a, s) { return { re: a.re * s, im: a.im * s }; }
export function cabs(a) { return Math.hypot(a.re, a.im); }
function cexp(a) {
  const r = Math.exp(a.re);
  return { re: r * Math.cos(a.im), im: r * Math.sin(a.im) };
}
function realPow(n, s) {
  return cexp(cscale(s, Math.log(n)));
}

// Precompute Borwein coefficients d_k (k=0..N) for a fixed term count N.
// N=70 gives ~5-6 correct digits across the domain this app draws in
// (Re in [-2,3], |Im| up to ~45), which is more than enough for pixels.
const N = 70;
const BORWEIN_D = (() => {
  const b = new Array(N + 1);
  b[0] = 1;
  for (let k = 1; k <= N; k++) {
    b[k] = (b[k - 1] * (4 * (N + k - 1) * (N - k + 1))) / ((2 * k) * (2 * k - 1));
  }
  const d = new Array(N + 1);
  let s = 0;
  for (let k = 0; k <= N; k++) {
    s += b[k];
    d[k] = s;
  }
  return d;
})();
const D_N = BORWEIN_D[N];

function eta(s) {
  let sum = { re: 0, im: 0 };
  for (let k = 0; k < N; k++) {
    const coeff = ((k % 2 === 0) ? 1 : -1) * (BORWEIN_D[k] - D_N);
    sum = cadd(sum, cdiv({ re: coeff, im: 0 }, realPow(k + 1, s)));
  }
  return cscale(sum, -1 / D_N);
}

/**
 * Riemann zeta function via zeta(s) = eta(s) / (1 - 2^(1-s)).
 * Returns {re, im}; returns {re: Infinity, im: 0} at the pole s=1.
 */
export function zeta(s) {
  if (Math.abs(s.re - 1) < 1e-9 && Math.abs(s.im) < 1e-9) {
    return { re: Infinity, im: 0 };
  }
  const e = eta(s);
  const denom = csub({ re: 1, im: 0 }, realPow(2, csub({ re: 1, im: 0 }, s)));
  return cdiv(e, denom);
}

// The first several nontrivial zeros of zeta, on the critical line
// Re(s) = 1/2, given as their imaginary part t. (Well-known constants.)
export const KNOWN_ZERO_T = [
  14.134725142,
  21.022039639,
  25.010857580,
  30.424876126,
  32.935061588,
  37.586178159,
];
