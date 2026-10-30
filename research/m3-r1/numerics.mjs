// Research discretization matching the unchanged M3 reference equations.
// One shared flux per face; each update reads the OLD state only.
export const G = 9.81;
export function speed(h, q) { const hh = Math.max(h, .00001); return Math.abs(q / hh) + Math.sqrt(G * hh); }
function flux(h, q) { const hh = Math.max(h, .00001); return [q, q * q / hh + .5 * G * hh * hh]; }
export function rusanov(ah, aq, bh, bq) {
  const a = flux(ah, aq), b = flux(bh, bq), wave = Math.max(speed(ah, aq), speed(bh, bq));
  return [.5 * (a[0] + b[0]) - .5 * wave * (bh - ah), .5 * (a[1] + b[1]) - .5 * wave * (bq - aq)];
}
export function updateRange(h, q, fh, fq, nh, nq, start, end, dt, dx, roughness, brokenSeams = []) {
  for (let i = start; i < end; i++) {
    const hi = h[i], qi = q[i];
    const left = brokenSeams.includes(i) ? fh[i] * 1.01 : fh[i];
    const hh = hi - dt / dx * (fh[i + 1] - left);
    const qq = qi - dt / dx * (fq[i + 1] - fq[i])
      + dt * (G * hi * (.72 / 96) - G * roughness * roughness * qi * Math.abs(qi) / Math.pow(Math.max(hi, .08), 7 / 3));
    if (!(hh >= .02) || !Number.isFinite(hh) || !Number.isFinite(qq)) return i;
    nh[i] = hh; nq[i] = qq;
  }
  return -1;
}
