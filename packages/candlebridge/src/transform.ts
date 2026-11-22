import { createMulberry32 } from './prng';
import {
  CandleBridgeError,
  type Candle,
  type CandleStats,
  type ExecutionPath,
  type ExecutionPoint
} from './types';

function roundDecimals(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Returns the intra-candle execution trajectory, or synthesizes a standard
 * 4-point OHLC fallback path when `candle.execution` is absent.
 */
export function candlePoints(candle: Candle): ExecutionPoint[] {
  if (candle.execution) return candle.execution.points;
  const duration = candle.closeTime - candle.openTime;
  const bullish = candle.close >= candle.open;
  return [
    [0, candle.open],
    [Math.round(duration * 0.3), bullish ? candle.low : candle.high],
    [Math.round(duration * 0.7), bullish ? candle.high : candle.low],
    [duration, candle.close]
  ];
}

/**
 * Downsamples an execution point array to at most `maxPoints` while strictly
 * preserving minute OHLC, including the segments that straddle minute boundaries.
 */
export function compactPoints(points: readonly ExecutionPoint[], maxPoints = 8_192): ExecutionPoint[] {
  if (!Number.isSafeInteger(maxPoints) || maxPoints < 4)
    throw new CandleBridgeError('INVALID_PARAMETERS', 'Point budget must be at least four.');
  if (points.length <= maxPoints) return points.map(([t, p]) => [t, p]);
  const selected = new Set<number>();
  for (let i = 0; i < points.length;) {
    const first = i,
      minute = Math.floor(points[i][0] / 60_000);
    let hi = i,
      lo = i;
    while (i < points.length && Math.floor(points[i][0] / 60_000) === minute) {
      if (points[i][1] > points[hi][1]) hi = i;
      if (points[i][1] < points[lo][1]) lo = i;
      i++;
    }
    for (const idx of [first, lo, hi, i - 1]) selected.add(idx);
  }
  if (selected.size > maxPoints)
    throw new CandleBridgeError('INVALID_PARAMETERS', 'Point budget cannot retain minute OHLC.');
  const budget = maxPoints - selected.size;
  for (let i = 1; i <= budget; i++) selected.add(Math.floor((i * points.length) / (budget + 1)));
  return [...selected].sort((a, b) => a - b).map((idx) => [points[idx][0], points[idx][1]]);
}

/**
 * Aggregates a candle series into coarser `intervalSeconds` bars while merging
 * and compacting intra-candle execution trajectories.
 */
export function aggregateCandles(
  source: readonly Candle[],
  intervalSeconds: number,
  maxPoints = 8_192
): Candle[] {
  return reframe(source, intervalSeconds, true, 8, maxPoints);
}

function pointIndex(points: ExecutionPoint[], ms: number) {
  let lo = 0,
    hi = points.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (points[mid][0] < ms) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function priceAtOffset(points: ExecutionPoint[], ms: number, decimals?: number) {
  const i = pointIndex(points, ms),
    b = points[i];
  if (i === 0 || b[0] === ms) return b[1];
  const a = points[i - 1],
    value = a[1] + (b[1] - a[1]) * ((ms - a[0]) / (b[0] - a[0]));
  return decimals === undefined ? value : roundDecimals(value, decimals);
}

function sliceCandle(c: Candle, from: number, until: number, keep: boolean, decimals: number): Candle {
  if (from === c.openTime && until === c.closeTime) return c;
  const original = candlePoints(c),
    start = from - c.openTime,
    end = until - c.openTime;
  const open = priceAtOffset(original, start, decimals),
    close = priceAtOffset(original, end, decimals);
  let low = Math.min(open, close),
    high = Math.max(open, close);
  const points: ExecutionPoint[] = [[0, open]];
  for (let i = pointIndex(original, start); i < original.length && original[i][0] < end; i++) {
    const [at, p] = original[i];
    if (at <= start) continue;
    low = Math.min(low, p);
    high = Math.max(high, p);
    if (keep && c.execution) points.push([at - start, p]);
  }
  points.push([end - start, close]);
  return {
    openTime: from,
    closeTime: until,
    open,
    high,
    low,
    close,
    ...(keep && c.execution ? { execution: { ...c.execution, points } } : {})
  };
}

function reframe(
  source: readonly Candle[],
  intervalSeconds: number,
  keep: boolean,
  decimals: number,
  maxPoints = 8192,
  window?: { offset: number; count: number }
): Candle[] {
  if (
    !Number.isInteger(intervalSeconds) ||
    intervalSeconds < 60 ||
    intervalSeconds > 86400 ||
    intervalSeconds % 60 !== 0
  )
    throw new CandleBridgeError(
      'INVALID_INTERVAL',
      'Timeframe must be a whole minute from 1 minute to 1 day.'
    );
  if (!source.length) return [];
  const result: Candle[] = [];
  const widthMs = intervalSeconds * 1000;
  const origin = source[0].openTime,
    end = source[source.length - 1].closeTime;
  const from = window ? origin + window.offset * widthMs : origin;
  const to = window ? Math.min(end, from + window.count * widthMs) : end;
  if (from >= to) return [];
  let group: Candle[] = [];
  let until = from + widthMs;

  const emit = () => {
    const first = group[0];
    const last = group[group.length - 1];
    const mergedPoints: ExecutionPoint[] = [];
    let high = first.high;
    let low = first.low;
    let minBound = first.execution?.minimumPrice ?? Number.POSITIVE_INFINITY;
    let maxBound = first.execution?.maximumPrice ?? 0;
    const hasExecution =
      keep && group.every((c, i) => c.execution && (i === 0 || c.open === group[i - 1].close));

    for (const candle of group) {
      if (candle.high > high) high = candle.high;
      if (candle.low < low) low = candle.low;
      if (!hasExecution) continue;
      if (candle.execution) {
        minBound = Math.min(minBound, candle.execution.minimumPrice);
        maxBound = Math.max(maxBound, candle.execution.maximumPrice);
      }
      for (const [offset, price] of candlePoints(candle)) {
        const at = candle.openTime - first.openTime + offset;
        if (mergedPoints.length && mergedPoints[mergedPoints.length - 1][0] === at) {
          mergedPoints[mergedPoints.length - 1] = [at, price];
        } else {
          mergedPoints.push([at, price]);
        }
      }
    }

    result.push({
      openTime: first.openTime,
      closeTime: last.closeTime,
      open: first.open,
      high,
      low,
      close: last.close,
      ...(hasExecution
        ? {
            execution: {
              ...(first.execution ?? {
                version: 1 as const,
                minimumPrice: minBound,
                maximumPrice: maxBound,
                points: []
              }),
              minimumPrice: minBound,
              maximumPrice: maxBound,
              points: compactPoints(mergedPoints, maxPoints)
            }
          }
        : {})
    });
    group = [];
  };

  let start = 0,
    right = source.length - 1;
  while (start < right) {
    const mid = Math.floor((start + right) / 2);
    if (source[mid].closeTime <= from) start = mid + 1;
    else right = mid;
  }
  let previous = source[start].openTime;
  for (let i = start; i < source.length && previous < to; i++) {
    const candle = source[i];
    if (
      candle.openTime !== previous ||
      !Number.isSafeInteger(candle.closeTime) ||
      candle.closeTime <= candle.openTime
    )
      throw new CandleBridgeError(
        'INVALID_CANDLE',
        'Resampling requires consecutive positive-duration bars.'
      );
    const finish = Math.min(to, candle.closeTime);
    for (let cursor = Math.max(previous, from); cursor < finish;) {
      const stop = Math.min(until, finish);
      group.push(sliceCandle(candle, cursor, stop, keep, decimals));
      if (stop === until) {
        emit();
        until += widthMs;
      }
      cursor = stop;
    }
    previous = candle.closeTime;
  }
  if (group.length) emit();
  return result;
}

/**
 * Splits coarse candles into exact 1-minute OHLC bars using their intra-candle
 * execution trajectories. Matches direct 1-minute generation when produced by `generateCandles`.
 */
export function splitMinutes(source: readonly Candle[], priceDecimals = 8): Candle[] {
  return reframe(source, 60, false, priceDecimals);
}

/** Read a page of OHLC on the original timeframe grid without materializing the whole finer series. */
export function readOhlcWindow(
  source: readonly Candle[],
  intervalSeconds: number,
  offset: number,
  count: number
) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(count) || count < 0)
    throw new CandleBridgeError(
      'INVALID_PARAMETERS',
      'Window offset and count must be non-negative integers.'
    );
  return reframe(source, intervalSeconds, false, 8, 8192, { offset, count });
}

/**
 * Resamples candles to any whole-minute target timeframe (`intervalSeconds`),
 * aggregating upward or splitting downward via 1-minute execution trajectories.
 */
export function resampleCandles(
  source: readonly Candle[],
  intervalSeconds: number,
  priceDecimals = 8
): Candle[] {
  return reframe(source, intervalSeconds, true, priceDecimals);
}

/**
 * Creates a deterministic 4-point intra-candle execution trajectory for manually
 * drawn or edited candles, randomizing high-first vs low-first order and wick timing.
 */
export function createManualExecution(
  candle: Candle,
  minimumPrice: number,
  maximumPrice: number,
  priceDecimals = 8
): ExecutionPath {
  const minStep = 10 ** -priceDecimals;
  const rng = createMulberry32((candle.openTime ^ Math.round(candle.close * 1e8)) >>> 0);
  const duration = candle.closeTime - candle.openTime;
  if (
    duration < 3 ||
    !Number.isSafeInteger(duration) ||
    !(minimumPrice > 0) ||
    minimumPrice > candle.low ||
    maximumPrice < candle.high ||
    !(roundDecimals(maximumPrice, priceDecimals) > roundDecimals(minimumPrice, priceDecimals)) ||
    candle.high < Math.max(candle.open, candle.close) ||
    candle.low > Math.min(candle.open, candle.close)
  )
    throw new CandleBridgeError(
      'INVALID_EXECUTION_PATH',
      'Manual path requires valid OHLC, at least three milliseconds and enclosing bounds.'
    );
  const highFirst = rng() < 0.5;
  const t1 = Math.max(1, Math.round(duration * (0.18 + rng() * 0.25)));
  const t2 = Math.min(duration - 1, Math.max(t1 + 1, Math.round(duration * (0.58 + rng() * 0.26))));
  return {
    version: 1,
    minimumPrice: Math.max(minStep, roundDecimals(minimumPrice, priceDecimals)),
    maximumPrice: roundDecimals(maximumPrice, priceDecimals),
    points: [
      [0, candle.open],
      [t1, highFirst ? candle.high : candle.low],
      [t2, highFirst ? candle.low : candle.high],
      [duration, candle.close]
    ]
  };
}

/**
 * Queries the piecewise-linear interpolated price at an arbitrary millisecond timestamp
 * within a candle using binary search over its execution trajectory.
 */
export function interpolatePriceAt(
  candle: Candle,
  timestampMs: number,
  options?: { priceDecimals?: number; clampToBounds?: boolean }
): number {
  const duration = candle.closeTime - candle.openTime;
  const elapsed = Math.max(0, Math.min(duration, timestampMs - candle.openTime));
  const points = candlePoints(candle);

  let price = priceAtOffset(points, elapsed);

  if (options?.clampToBounds !== false) {
    const lowBound = candle.execution ? Math.max(candle.low, candle.execution.minimumPrice) : candle.low;
    const highBound = candle.execution ? Math.min(candle.high, candle.execution.maximumPrice) : candle.high;
    price = Math.min(highBound, Math.max(lowBound, price));
  }

  return options?.priceDecimals !== undefined ? roundDecimals(price, options.priceDecimals) : price;
}

/**
 * Proportionally rescales and shifts a candle series so it continues seamlessly
 * from a given anchor timestamp and price.
 */
export function connectSeries(
  candles: readonly Candle[],
  anchor: { startTime: number; startPrice: number; intervalSeconds?: number },
  priceDecimals = 8
): Candle[] {
  if (!candles.length) return [];
  const ratio = anchor.startPrice / candles[0].open;
  if (
    !(anchor.startPrice > 0) ||
    !Number.isFinite(ratio) ||
    !Number.isSafeInteger(anchor.startTime) ||
    candles.some(
      (c) =>
        anchor.intervalSeconds !== undefined && c.closeTime - c.openTime !== anchor.intervalSeconds * 1000
    )
  )
    throw new CandleBridgeError(
      'INVALID_PARAMETERS',
      'Use a positive anchor and the original interval; resample before connecting different intervals.'
    );
  let cursor = anchor.startTime;
  let open = roundDecimals(anchor.startPrice, priceDecimals);

  return candles.map((c) => {
    const close = roundDecimals(c.close * ratio, priceDecimals);
    const high = Math.max(open, close, roundDecimals(c.high * ratio, priceDecimals));
    const low = Math.min(open, close, roundDecimals(c.low * ratio, priceDecimals));
    const next: Candle = {
      openTime: cursor,
      closeTime: cursor + (c.closeTime - c.openTime),
      open,
      high,
      low,
      close
    };
    if (c.execution) {
      const scaledPoints: ExecutionPoint[] = c.execution.points.map(([offset, p]) => [
        offset,
        roundDecimals(p * ratio, priceDecimals)
      ]);
      scaledPoints[0][1] = open;
      scaledPoints[scaledPoints.length - 1][1] = close;
      next.execution = {
        ...c.execution,
        minimumPrice: Math.min(low, roundDecimals(c.execution.minimumPrice * ratio, priceDecimals)),
        maximumPrice: Math.max(high, roundDecimals(c.execution.maximumPrice * ratio, priceDecimals)),
        points: scaledPoints
      };
    }
    cursor = next.closeTime;
    open = close;
    return next;
  });
}

/**
 * Computes summary statistics (return, range, max drawdown, candle balance, execution density).
 */
export function computeStats(candles: readonly Candle[]): CandleStats {
  if (!candles.length) {
    return {
      startPrice: 0,
      endPrice: 0,
      returnPct: 0,
      high: 0,
      low: 0,
      maxDrawdownPct: 0,
      bullishCount: 0,
      bearishCount: 0,
      flatCount: 0,
      totalExecutionPoints: 0,
      durationMs: 0
    };
  }
  const first = candles[0];
  const last = candles[candles.length - 1];
  let high = first.high;
  let low = first.low;
  let peak = first.open;
  let maxDrawdown = 0;
  let bullishCount = 0;
  let bearishCount = 0;
  let flatCount = 0;
  let totalExecutionPoints = 0;

  for (const c of candles) {
    if (c.high > high) high = c.high;
    if (c.low < low) low = c.low;
    for (const [, p] of candlePoints(c)) {
      peak = Math.max(peak, p);
      if (peak > 0) maxDrawdown = Math.max(maxDrawdown, (peak - p) / peak);
    }
    if (c.close > c.open) bullishCount++;
    else if (c.close < c.open) bearishCount++;
    else flatCount++;
    totalExecutionPoints += c.execution ? c.execution.points.length : 0;
  }

  return {
    startPrice: first.open,
    endPrice: last.close,
    returnPct: first.open > 0 ? ((last.close - first.open) / first.open) * 100 : 0,
    high,
    low,
    maxDrawdownPct: maxDrawdown * 100,
    bullishCount,
    bearishCount,
    flatCount,
    totalExecutionPoints,
    durationMs: last.closeTime - first.openTime
  };
}
