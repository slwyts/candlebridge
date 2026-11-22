import { describe, expect, it } from 'vitest';
import {
  aggregateCandles,
  computeStats,
  connectSeries,
  createManualExecution,
  generateCandles,
  interpolatePriceAt,
  resampleCandles,
  splitMinutes,
  validateExecutionPath,
  type GenerateOptions
} from '../src/index';

const BASE: GenerateOptions = {
  startPrice: 1,
  endPrice: 1.03,
  count: 288,
  intervalSeconds: 300,
  startTime: 1_800_000_000_000,
  minimumPrice: 0.9,
  maximumPrice: 1.45,
  intensity: 'medium',
  seed: 202
};

describe('cross-timeframe consistency and path utilities', () => {
  it('splits 5-minute and 30-minute candles to match direct 1-minute generation bit-for-bit', () => {
    const fiveMin = generateCandles(BASE);
    const oneMin = generateCandles({ ...BASE, count: 1440, intervalSeconds: 60 });
    const strippedOneMin = oneMin.map(({ execution: _e, ...bar }) => bar);

    expect(splitMinutes(fiveMin)).toEqual(strippedOneMin);

    const thirtyMin = generateCandles({
      ...BASE,
      count: 48,
      intervalSeconds: 1800,
      endPrice: 1.02,
      seed: 302
    });
    const thirtyMinRef = generateCandles({
      ...BASE,
      count: 1440,
      intervalSeconds: 60,
      endPrice: 1.02,
      seed: 302
    });
    expect(splitMinutes(thirtyMin)).toEqual(thirtyMinRef.map(({ execution: _e, ...bar }) => bar));
  });

  it('aggregates and resamples cleanly across intervals', () => {
    const oneMin = generateCandles({ ...BASE, count: 1440, intervalSeconds: 60 });
    const daily = aggregateCandles(oneMin, 86_400);
    expect(daily).toHaveLength(1);
    expect(daily[0].open).toBe(oneMin[0].open);
    expect(daily[0].close).toBe(1.03);
    expect(daily[0].high).toBe(Math.max(...oneMin.map((c) => c.high)));
    expect(daily[0].low).toBe(Math.min(...oneMin.map((c) => c.low)));

    const hourly = resampleCandles(daily, 3600);
    expect(hourly).toHaveLength(24);
    expect(hourly[0].open).toBe(daily[0].open);
    expect(hourly.at(-1)?.close).toBe(daily[0].close);
  });

  it('interpolates intra-candle prices accurately at endpoints and intermediate timestamps', () => {
    const [candle] = generateCandles({ ...BASE, count: 1, intervalSeconds: 300, endPrice: 1.005, seed: 55 });
    expect(interpolatePriceAt(candle, candle.openTime)).toBe(candle.open);
    expect(interpolatePriceAt(candle, candle.closeTime)).toBe(candle.close);

    const mid = interpolatePriceAt(candle, candle.openTime + 150_000);
    expect(mid).toBeGreaterThanOrEqual(candle.low);
    expect(mid).toBeLessThanOrEqual(candle.high);
  });

  it('creates valid deterministic manual execution trajectories', () => {
    const candle = {
      openTime: 1_800_000_000_000,
      closeTime: 1_800_000_300_000,
      open: 100,
      high: 105,
      low: 97,
      close: 103
    };
    const exec = createManualExecution(candle, 90, 120);
    expect(() => validateExecutionPath({ ...candle, execution: exec })).not.toThrow();
    expect(exec).toEqual(createManualExecution(candle, 90, 120));
  });

  it('connects and rescales a candle sequence to a new anchor cleanly', () => {
    const raw = generateCandles({ ...BASE, count: 12, intervalSeconds: 300, endPrice: 1.05, seed: 88 });
    const shifted = connectSeries(raw, { startTime: 1_900_000_000_000, startPrice: 200 });
    expect(shifted[0].openTime).toBe(1_900_000_000_000);
    expect(shifted[0].open).toBe(200);
    expect(shifted.at(-1)?.close).toBeCloseTo(210, 4);
    expect(shifted[1].open).toBe(shifted[0].close);
  });

  it('computes accurate summary stats', () => {
    const bars = generateCandles({ ...BASE, count: 48, endPrice: 1.1, seed: 99 });
    const stats = computeStats(bars);
    expect(stats.startPrice).toBe(1);
    expect(stats.endPrice).toBe(1.1);
    expect(stats.returnPct).toBeCloseTo(10, 5);
    expect(stats.maxDrawdownPct).toBeGreaterThanOrEqual(0);
    expect(stats.bullishCount + stats.bearishCount + stats.flatCount).toBe(48);
    expect(stats.totalExecutionPoints).toBeGreaterThan(48 * 2);
  });
});
