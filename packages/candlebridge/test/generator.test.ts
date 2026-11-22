import { describe, expect, it } from 'vitest';
import {
  CandleBridgeError,
  DEFAULT_MODEL,
  generateCandles,
  randomSeed,
  validateCandles,
  type GenerateOptions
} from '../src/index';

const BASE: GenerateOptions = {
  startPrice: 1,
  endPrice: 1.4,
  count: 7200,
  intervalSeconds: 300,
  startTime: 1_800_000_000_000,
  minimumPrice: 0.9,
  maximumPrice: 1.45,
  intensity: 'medium',
  seed: 101
};

describe('generateCandles', () => {
  it('generates a 25-day bounded trajectory hitting the locked target with realistic up/down candles', () => {
    const candles = generateCandles(BASE);
    expect(candles).toHaveLength(7200);
    expect(candles[0].open).toBe(1);
    expect(candles.at(-1)?.close).toBe(1.4);
    expect(() => validateCandles(candles)).not.toThrow();

    let bullish = 0;
    let bearish = 0;
    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      expect(c.closeTime - c.openTime).toBe(300_000);
      if (i > 0) {
        expect(c.openTime).toBe(candles[i - 1].closeTime);
        expect(c.open).toBe(candles[i - 1].close);
      }
      expect(c.high).toBeLessThanOrEqual(1.45);
      expect(c.low).toBeGreaterThanOrEqual(0.9);
      expect(c.high).toBeGreaterThanOrEqual(Math.max(c.open, c.close));
      expect(c.low).toBeLessThanOrEqual(Math.min(c.open, c.close));

      const points = c.execution!.points;
      expect(points.length).toBeLessThanOrEqual(8192);
      expect(points[0]).toEqual([0, c.open]);
      expect(points.at(-1)).toEqual([300_000, c.close]);
      expect(Math.max(...points.map((p) => p[1]))).toBe(c.high);
      expect(Math.min(...points.map((p) => p[1]))).toBe(c.low);

      if (c.close > c.open) bullish++;
      if (c.close < c.open) bearish++;
    }
    expect(bullish).toBeGreaterThan(1000);
    expect(bearish).toBeGreaterThan(1000);
  });

  it('is strictly deterministic for identical seeds and varies extrema timings across seeds', () => {
    const opts: GenerateOptions = { ...BASE, count: 96, endPrice: 1.01 };
    const a = generateCandles(opts);
    const b = generateCandles(opts);
    const c = generateCandles({ ...opts, seed: 102 });

    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    const peakOffsets = new Set(a.map((bar) => bar.execution!.points.find((pt) => pt[1] === bar.high)?.[0]));
    expect(peakOffsets.size).toBeGreaterThan(5);
  });

  it('keeps horizontal and descending plans strictly bounded and target-locked', () => {
    for (const endPrice of [1, 0.95]) {
      const bars = generateCandles({ ...BASE, count: 72, endPrice, seed: 203 });
      expect(bars.at(-1)?.close).toBe(endPrice);
      expect(bars.every((bar) => bar.low >= 0.9 && bar.high <= 1.45)).toBe(true);
    }
  });

  it('persists model parameters and reacts to stochastic feature toggles', () => {
    const opts: GenerateOptions = { ...BASE, count: 96, endPrice: 1.01, seed: 401 };
    const full = generateCandles(opts);
    const plainGbm = generateCandles({
      ...opts,
      model: { fatTail: false, memory: false, jumps: false, regimes: false }
    });

    expect(full[0].execution?.parameters?.df).toBe(DEFAULT_MODEL.df);
    expect(full[0].execution?.parameters?.seed).toBe(401);
    expect(plainGbm[0].execution?.parameters?.regimes).toBe(false);
    expect(full).not.toEqual(plainGbm);
  });

  it('supports unlocked random walks that stay bounded without forcing endPrice', () => {
    const bars = generateCandles({ ...BASE, count: 288, seed: 402, model: { lockTarget: false } });
    expect(bars.at(-1)?.close).not.toBe(1.4);
    expect(bars.every((bar) => bar.low >= 0.9 && bar.high <= 1.45)).toBe(true);
  });

  it('does not converge across adjacent seeds on long horizons', () => {
    const a = generateCandles({ ...BASE, seed: 20261007 });
    const b = generateCandles({ ...BASE, seed: 20261009 });
    expect(a.slice(-100)).not.toEqual(b.slice(-100));
  });

  it('rejects invalid price bounds, intervals, and model parameters with typed error codes', () => {
    const invalidCases: Array<[GenerateOptions, string]> = [
      [{ ...BASE, maximumPrice: 1.3 }, 'INVALID_PRICE_RANGE'],
      [{ ...BASE, minimumPrice: 1.01 }, 'INVALID_PRICE_RANGE'],
      [{ ...BASE, startPrice: 0 }, 'INVALID_PRICE_RANGE'],
      [{ ...BASE, count: 24_001 }, 'INVALID_INTERVAL'],
      [{ ...BASE, intervalSeconds: 45 }, 'INVALID_INTERVAL'],
      [{ ...BASE, model: { df: 2 } }, 'INVALID_PARAMETERS'],
      [{ ...BASE, model: { decay: 1 } }, 'INVALID_PARAMETERS'],
      [{ ...BASE, model: { jumpMinimum: 2, jumpMaximum: 1 } }, 'INVALID_PARAMETERS'],
      [{ ...BASE, model: { baseVolatility: 0 } }, 'INVALID_PARAMETERS']
    ];

    for (const [opts, code] of invalidCases) {
      expect(() => generateCandles(opts)).toThrow(CandleBridgeError);
      try {
        generateCandles(opts);
      } catch (err) {
        expect((err as CandleBridgeError).code).toBe(code);
      }
    }
  });

  it('supports custom precision and relaxed price multiplier limits', () => {
    const bars = generateCandles({
      startPrice: 100,
      endPrice: 112.5,
      count: 24,
      intervalSeconds: 3600,
      startTime: 1_800_000_000_000,
      minimumPrice: 80,
      maximumPrice: 4000,
      seed: 777,
      limits: { priceDecimals: 2, maxPriceMultiplier: 50 }
    });
    expect(bars.at(-1)?.close).toBe(112.5);
    for (const bar of bars) {
      expect(Number(bar.close.toFixed(2))).toBe(bar.close);
    }
  });

  it('produces valid uint32 random seeds', () => {
    const seed = randomSeed();
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThanOrEqual(4_294_967_295);
  });
});
