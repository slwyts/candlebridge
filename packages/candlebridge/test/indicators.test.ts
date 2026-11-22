import { describe, expect, it } from 'vitest';
import { computeIndicators, ema, type Candle } from '../src/index';

describe('indicators', () => {
  it('keeps EMA constant and MACD zero on a flat price series', () => {
    const flat: Candle[] = Array.from({ length: 120 }, (_, i) => ({
      openTime: i * 60_000,
      closeTime: (i + 1) * 60_000,
      open: 2,
      high: 2,
      low: 2,
      close: 2
    }));
    const out = computeIndicators(flat);
    expect(out.ema7.every((v) => v === 2)).toBe(true);
    expect(out.ema25.every((v) => v === 2)).toBe(true);
    expect(out.ema99.every((v) => v === 2)).toBe(true);
    expect(out.dif.every((v) => v === 0)).toBe(true);
    expect(out.dea.every((v) => v === 0)).toBe(true);
    expect(out.histogram.every((v) => v === 0)).toBe(true);
  });

  it('produces positive MACD DIF on a strictly rising series', () => {
    const rising = Array.from({ length: 60 }, (_, i) => ({
      openTime: i * 60_000,
      closeTime: (i + 1) * 60_000,
      open: 100 + i,
      high: 101 + i,
      low: 99 + i,
      close: 100 + i
    }));
    const out = computeIndicators(rising);
    expect(out.dif.at(-1)!).toBeGreaterThan(0);
    expect(out.ema7.at(-1)!).toBeGreaterThan(out.ema25.at(-1)!);
    expect(ema([], 7)).toEqual([]);
  });
});
