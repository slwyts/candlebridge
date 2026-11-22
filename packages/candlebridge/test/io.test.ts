import { describe, expect, it } from 'vitest';
import {
  CandleBridgeError,
  generateCandles,
  parseCandlesJson,
  serializeCandlesCsv,
  serializeCandlesJson
} from '../src/index';

describe('JSON / CSV serialization and parsing', () => {
  it('round-trips CandleBridge JSON including execution trajectories', () => {
    const generated = generateCandles({
      startPrice: 10,
      endPrice: 10.5,
      count: 10,
      intervalSeconds: 300,
      startTime: 1_800_000_000_000,
      minimumPrice: 9,
      maximumPrice: 12,
      seed: 1234
    });
    const json = serializeCandlesJson(generated, { symbol: 'ETH/USDT', intervalSeconds: 300 });
    const parsed = parseCandlesJson(json);

    expect(parsed.symbol).toBe('ETH/USDT');
    expect(parsed.intervalSeconds).toBe(300);
    expect(parsed.candles).toEqual(generated);
  });

  it('parses [O,H,L,C] tuples, flat numeric arrays, and legacy openPrice/klines objects', () => {
    const tupleSet = parseCandlesJson(
      [
        [100, 105, 98, 102],
        [102, 106, 101, 104]
      ],
      { defaultStartTime: 1_800_000_000_000 }
    );
    expect(tupleSet.candles).toHaveLength(2);
    expect(tupleSet.candles[1].close).toBe(104);

    const flatSet = parseCandlesJson([10, 11, 9, 10.5, 10.5, 12, 10, 11.5], {
      defaultStartTime: 1_800_000_000_000
    });
    expect(flatSet.candles).toHaveLength(2);
    expect(flatSet.candles[0].low).toBe(9);

    const legacySet = parseCandlesJson({
      klineIntervalSeconds: 300,
      startTime: 1_800_000_000_000,
      klines: [{ openPrice: 2, highPrice: 2.2, lowPrice: 1.9, closePrice: 2.1 }]
    });
    expect(legacySet.intervalSeconds).toBe(300);
    expect(legacySet.candles[0].open).toBe(2);
  });

  it('rejects inconsistent OHLC and invalid JSON with typed errors', () => {
    expect(() => parseCandlesJson('{bad json')).toThrow(CandleBridgeError);
    expect(() => parseCandlesJson([[100, 90, 95, 98]])).toThrow(CandleBridgeError);
    expect(() => parseCandlesJson([1, 2, 3])).toThrow(CandleBridgeError);
  });

  it('exports standard CSV rows', () => {
    const csv = serializeCandlesCsv([
      { openTime: 1_800_000_000_000, closeTime: 1_800_000_060_000, open: 1, high: 1.2, low: 0.9, close: 1.1 }
    ]);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('openTime,closeTime,isoTime,open,high,low,close');
    expect(lines[1]).toContain(',1,1.2,0.9,1.1');
  });
});
