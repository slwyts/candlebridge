import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CandleBridgeError,
  computeStats,
  connectSeries,
  generateCandles,
  parseCandlesJson,
  readOhlcWindow,
  resampleCandles,
  serializeCandlesJson,
  splitMinutes,
  validateCandles,
  type Candle,
  type GenerateOptions,
  type ModelParameters
} from '../src/index';

// SHA-256 of [openTime,closeTime,O,H,L,C,points] rows from the reference generator, not of metadata.
const base: GenerateOptions = {
  startPrice: 100,
  endPrice: 102.4,
  count: 35,
  intervalSeconds: 300,
  startTime: 1800000000000,
  minimumPrice: 75,
  maximumPrice: 135,
  intensity: 'medium',
  seed: 401
};
const cases: [string, Partial<ModelParameters>, string][] = [
  ['baseline', {}, 'dcfa394c1ceddfcc0165e4d7b5fcd7a3204cf9175c3374e7a88edaaeb3171518'],
  [
    'Gaussian / 1 second',
    { fineSeconds: 1, fatTail: false, memory: false, jumps: false, regimes: false },
    'ee63a7fb2a70bc0ae5dc402795463150cd4d02f99960e3acbb39a3e5a58e09a1'
  ],
  [
    'free endpoint with jumps and short regimes',
    { lockTarget: false, df: 4, jumpProbability: 1, stateMinimum: 1, stateMaximum: 3 },
    'c2e277f2cd7f9f429a61a6bfdbbe8b9bfb1e16baf281eae625b8cafac016e60c'
  ]
];
describe('reference path fixtures', () => {
  it.each(cases)('%s', (_, model, expected) => {
    const rows = generateCandles({ ...base, model }).map((c) => [
      c.openTime,
      c.closeTime,
      c.open,
      c.high,
      c.low,
      c.close,
      c.execution!.points
    ]);
    expect(createHash('sha256').update(JSON.stringify(rows)).digest('hex')).toBe(expected);
  });
});
const ohlc = ({ execution: _path, ...bar }: Candle) => bar;
describe('time, precision and compression boundaries', () => {
  it('reads a bounded chart page even when its edges cut through the original candles', () => {
    const coarse = generateCandles({ ...base, count: 5, intervalSeconds: 1800 });
    const all = resampleCandles(coarse, 420).map(ohlc);
    expect(readOhlcWindow(coarse, 420, 3, 6)).toEqual(all.slice(3, 9));
    expect(readOhlcWindow(coarse, 420, 19, 10)).toEqual(all.slice(19));
  });
  it('retains every minute OHLC after compacting a full day of one-second data', () => {
    const minute = generateCandles({ ...base, intervalSeconds: 60, count: 1440, model: { fineSeconds: 1 } });
    const daily = resampleCandles(minute, 86400);
    expect(daily[0].execution!.points.length).toBeLessThanOrEqual(8192);
    expect(splitMinutes(daily)).toEqual(minute.map(ohlc));
  });
  it('cuts inside base bars on non-divisible intervals and keeps the final partial bar', () => {
    const five = generateCandles({ ...base, count: 11 });
    const seven = resampleCandles(five, 420);
    expect(seven).toHaveLength(8);
    expect(seven.slice(0, -1).every((c) => c.closeTime - c.openTime === 420000)).toBe(true);
    expect(seven.at(-1)!.closeTime - seven.at(-1)!.openTime).toBe(360000);
    expect(splitMinutes(seven)).toEqual(splitMinutes(five));
    expect(parseCandlesJson(serializeCandlesJson(seven)).candles).toEqual(seven);
    expect(() => validateCandles(seven)).not.toThrow();
  });
  it('rejects a point budget that cannot represent minute OHLC', () => {
    expect(() => generateCandles({ ...base, limits: { maxPointsPerCandle: 4 } })).toThrow(CandleBridgeError);
  });
  it('round-trips early millisecond timestamps, 12 decimals and both JSON schemas', () => {
    const candles = generateCandles({ ...base, startTime: 0, limits: { priceDecimals: 12 } });
    for (const format of ['candlebridge', 'klines'] as const)
      expect(parseCandlesJson(serializeCandlesJson(candles, { format })).candles).toEqual(candles);
    expect(splitMinutes(candles).at(-1)!.close).toBe(candles.at(-1)!.close);
  });
  it('rejects explicitly invalid timestamps, malformed points and incompatible continuation intervals', () => {
    const candles = generateCandles(base),
      first = candles[0];
    expect(() => parseCandlesJson({ startTime: 'oops', candles: [[1, 1, 1, 1]] })).toThrow(CandleBridgeError);
    expect(() =>
      parseCandlesJson({
        intervalSeconds: 300,
        candles: [{ ...first, execution: { ...first.execution, points: [null, null] } }]
      })
    ).toThrow(CandleBridgeError);
    expect(() => connectSeries(candles, { startTime: 0, startPrice: 1, intervalSeconds: 60 })).toThrow(
      CandleBridgeError
    );
  });
  it('measures drawdown in trajectory order rather than assuming high before low', () => {
    const ascending: Candle = {
      openTime: 0,
      closeTime: 60000,
      open: 10,
      low: 9,
      high: 20,
      close: 19,
      execution: {
        version: 1,
        minimumPrice: 8,
        maximumPrice: 21,
        points: [
          [0, 10],
          [10000, 9],
          [40000, 20],
          [60000, 19]
        ]
      }
    };
    expect(computeStats([ascending]).maxDrawdownPct).toBe(10);
  });
});
