import type { Candle, IndicatorSeries } from './types';

/**
 * Computes an Exponential Moving Average (EMA) initialized at `values[0]`.
 */
export function ema(values: readonly number[], period: number): number[] {
  if (!values.length) return [];
  let previous = values[0];
  const alpha = 2 / (period + 1);
  return values.map((value) => {
    previous += alpha * (value - previous);
    return previous;
  });
}

/**
 * Computes EMA(7), EMA(25), EMA(99), and MACD(12, 26, 9) over candle close prices.
 */
export function computeIndicators(candles: readonly Candle[]): IndicatorSeries {
  const close = candles.map((c) => c.close);
  const fast = ema(close, 12);
  const slow = ema(close, 26);
  const dif = fast.map((value, i) => value - slow[i]);
  const dea = ema(dif, 9);
  return {
    ema7: ema(close, 7),
    ema25: ema(close, 25),
    ema99: ema(close, 99),
    dif,
    dea,
    histogram: dif.map((value, i) => value - dea[i])
  };
}
