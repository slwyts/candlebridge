/**
 * Generates a cryptographically random unsigned 32-bit integer seed.
 * Falls back to Math.random if Web Crypto is unavailable.
 */
export function randomSeed(): number {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.getRandomValues === 'function') {
    return globalThis.crypto.getRandomValues(new Uint32Array(1))[0];
  }
  return Math.floor(Math.random() * 4294967296) >>> 0;
}

/**
 * Mulberry32 deterministic 32-bit PRNG returning floats in [0, 1).
 */
export function createMulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let n = state;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Creates a Box-Muller standard normal sampler N(0, 1) driven by `rng`.
 */
export function createStandardNormal(rng: () => number): () => number {
  const uniformPositive = () => Math.max(1e-12, rng());
  return () => Math.sqrt(-2 * Math.log(uniformPositive())) * Math.cos(2 * Math.PI * uniformPositive());
}

/**
 * Draws a unit-variance standardized Student-t sample with `df` degrees of freedom (df > 2).
 */
export function sampleStudentT(normal: () => number, df: number, heavyTails = true): number {
  const z = normal();
  let chiSquare = 0;
  for (let i = 0; i < df; i++) {
    const g = normal();
    chiSquare += g * g;
  }
  // Keep the stream position fixed when comparing t and Gaussian scenarios.
  return heavyTails ? (z / Math.sqrt(chiSquare / df)) * Math.sqrt((df - 2) / df) : z;
}
