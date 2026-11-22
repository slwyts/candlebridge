import { CandleBridgeError, type Candle, type ExecutionPath, type ExecutionPoint } from './types';

export interface ParseCandlesOptions {
  /** Default interval in seconds when omitted from JSON (default: 60). */
  defaultIntervalSeconds?: number;
  /** Default start timestamp in Unix ms when omitted (default: next minute boundary). */
  defaultStartTime?: number;
  /** Decimal precision for normalized prices (default: 8). */
  priceDecimals?: number;
  /** Maximum candles allowed in a single import (default: 300,000). */
  maxCount?: number;
  /** Maximum stored points per imported candle (default: 8,192). */
  maxPoints?: number;
  /** Maximum ratio vs first candle open price (default: 25; set Infinity to disable). */
  maxPriceMultiplier?: number;
}

export interface ParsedCandleSet {
  candles: Candle[];
  intervalSeconds: number;
  symbol?: string;
}

function parseTimestamp(value: unknown, milliseconds = false): number | null {
  if (value === undefined || value === null || value === '') return null;
  const numeric = Number(value);
  const parsed = Number.isFinite(numeric)
    ? !milliseconds && Math.abs(numeric) < 10_000_000_000
      ? numeric * 1000
      : numeric
    : Date.parse(String(value));
  if (!Number.isSafeInteger(parsed) || Math.abs(parsed) > 8.64e15)
    throw new CandleBridgeError('INVALID_CANDLE', 'Invalid timestamp.');
  return parsed;
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Validates a candle's `execution` trajectory against its OHLC bounds and duration.
 */
export function validateExecutionPath(candle: Candle, options?: { maxPoints?: number }): void {
  const execution = candle.execution;
  if (!execution) return;
  const maxPoints = options?.maxPoints ?? 8_192;
  const duration = candle.closeTime - candle.openTime;

  if (
    execution.version !== 1 ||
    !Array.isArray(execution.points) ||
    execution.points.length < 2 ||
    execution.points.length > maxPoints ||
    !Number.isFinite(execution.minimumPrice) ||
    !Number.isFinite(execution.maximumPrice) ||
    execution.minimumPrice <= 0 ||
    execution.minimumPrice >= execution.maximumPrice
  ) {
    throw new CandleBridgeError(
      'INVALID_EXECUTION_PATH',
      'Execution path metadata or point count is invalid.'
    );
  }

  let prevOffset = -1;
  let high = -Infinity;
  let low = Infinity;

  for (const point of execution.points) {
    if (
      !Array.isArray(point) ||
      point.length !== 2 ||
      !Number.isInteger(point[0]) ||
      point[0] <= prevOffset ||
      point[0] > duration ||
      !Number.isFinite(point[1]) ||
      point[1] < execution.minimumPrice ||
      point[1] > execution.maximumPrice
    ) {
      throw new CandleBridgeError(
        'INVALID_EXECUTION_PATH',
        'Execution path point is out of time or price bounds.'
      );
    }
    prevOffset = point[0];
    if (point[1] > high) high = point[1];
    if (point[1] < low) low = point[1];
  }

  const first = execution.points[0];
  const last = execution.points[execution.points.length - 1];
  if (
    first[0] !== 0 ||
    first[1] !== candle.open ||
    last[0] !== duration ||
    last[1] !== candle.close ||
    high !== candle.high ||
    low !== candle.low
  ) {
    throw new CandleBridgeError(
      'INVALID_EXECUTION_PATH',
      'Execution path endpoints and extrema must match candle OHLC values.'
    );
  }
}

/**
 * Validates continuity, OHLC integrity, price bounds, and optional execution paths for a series.
 */
export function validateCandles(
  candles: readonly Candle[],
  options?: { maxPriceMultiplier?: number; maxPoints?: number }
): void {
  if (!candles.length) {
    throw new CandleBridgeError('INVALID_CANDLE', 'At least one candle is required.');
  }
  const maxMult = options?.maxPriceMultiplier ?? 25;
  const maxPrice = Number.isFinite(maxMult) ? candles[0].open * maxMult + 1e-8 : Infinity;
  let previousClose: number | undefined;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (
      !Number.isSafeInteger(c.openTime) ||
      !Number.isSafeInteger(c.closeTime) ||
      Math.abs(c.openTime) > 8.64e15 ||
      Math.abs(c.closeTime) > 8.64e15 ||
      c.closeTime <= c.openTime
    ) {
      throw new CandleBridgeError('INVALID_CANDLE', `Candle #${i + 1} has an invalid time range.`);
    }
    if (previousClose !== undefined && previousClose !== c.openTime) {
      throw new CandleBridgeError(
        'INVALID_CANDLE',
        `Candle #${i + 1} must start at the previous time boundary.`
      );
    }
    if (![c.open, c.high, c.low, c.close].every((p) => Number.isFinite(p) && p > 0)) {
      throw new CandleBridgeError(
        'INVALID_CANDLE',
        `Candle #${i + 1} OHLC prices must be positive finite numbers.`
      );
    }
    if (c.high < Math.max(c.open, c.close) || c.low > Math.min(c.open, c.close) || c.high < c.low) {
      throw new CandleBridgeError(
        'INVALID_CANDLE',
        `Candle #${i + 1} high/low does not contain open and close.`
      );
    }
    if (Math.max(c.open, c.high, c.low, c.close) > maxPrice) {
      throw new CandleBridgeError(
        'INVALID_PRICE_RANGE',
        `Candle #${i + 1} exceeds ${maxMult}x the initial open price.`
      );
    }
    validateExecutionPath(c, { maxPoints: options?.maxPoints });
    previousClose = c.closeTime;
  }
}

/**
 * Parses CandleBridge JSON, object arrays (`open` or `openPrice`), `[O, H, L, C]` tuples,
 * or flat numeric arrays `[o1, h1, l1, c1, ...]` into validated `Candle[]`.
 */
export function parseCandlesJson(input: string | unknown, options?: ParseCandlesOptions): ParsedCandleSet {
  let parsed: unknown;
  if (typeof input === 'string') {
    try {
      parsed = JSON.parse(input);
    } catch {
      throw new CandleBridgeError('INVALID_JSON', 'Input is not valid JSON.');
    }
  } else {
    parsed = input;
  }

  const defaultInterval = options?.defaultIntervalSeconds ?? 60;
  const root: Record<string, unknown> = Array.isArray(parsed)
    ? { intervalSeconds: defaultInterval, candles: parsed }
    : (parsed as Record<string, unknown>);

  const rawList = root && typeof root === 'object' ? (root.candles ?? root.klines) : undefined;
  if (!root || typeof root !== 'object' || !Array.isArray(rawList)) {
    throw new CandleBridgeError(
      'INVALID_JSON',
      'JSON must be a candle array or an object containing a "candles" (or "klines") array.'
    );
  }

  const intervalSeconds = Number(
    root.intervalSeconds ?? root.klineIntervalSeconds ?? root.interval ?? defaultInterval
  );
  if (
    !Number.isInteger(intervalSeconds) ||
    intervalSeconds < 60 ||
    intervalSeconds > 86_400 ||
    intervalSeconds % 60 !== 0
  ) {
    throw new CandleBridgeError(
      'INVALID_INTERVAL',
      'intervalSeconds must be a whole-minute value in [60, 86400].'
    );
  }

  const isFlat =
    rawList.length > 0 &&
    !Array.isArray(rawList[0]) &&
    (typeof rawList[0] === 'number' || typeof rawList[0] === 'string');
  if (isFlat && rawList.length % 4 !== 0) {
    throw new CandleBridgeError('INVALID_JSON', 'Flat OHLC array length must be a multiple of 4.');
  }

  const total = isFlat ? rawList.length / 4 : rawList.length;
  const maxCount = options?.maxCount ?? 300_000;
  if (total < 1 || total > maxCount) {
    throw new CandleBridgeError('INVALID_CANDLE', `Candle count must be between 1 and ${maxCount}.`);
  }

  const intervalMs = intervalSeconds * 1000;
  const fallbackStart = options?.defaultStartTime ?? Math.ceil(Date.now() / intervalMs) * intervalMs;
  const millis = root.timeUnit === 'ms';
  const startTime = parseTimestamp(root.startTime, millis) ?? fallbackStart;
  const decimals = options?.priceDecimals ?? 8;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 12)
    throw new CandleBridgeError('INVALID_PARAMETERS', 'priceDecimals must be an integer from 0 to 12.');
  const normalize = (n: number) =>
    millis && options?.priceDecimals === undefined ? n : roundTo(n, decimals);

  const candles: Candle[] = [];
  let prevClose = -1;

  for (let i = 0; i < total; i++) {
    const raw = isFlat ? rawList.slice(i * 4, i * 4 + 4) : rawList[i];
    if (!raw || typeof raw !== 'object') {
      throw new CandleBridgeError('INVALID_CANDLE', `Candle #${i + 1} has an invalid format.`);
    }
    const tuple = Array.isArray(raw) ? raw : null;
    if (tuple && tuple.length !== 4) {
      throw new CandleBridgeError(
        'INVALID_CANDLE',
        `Candle #${i + 1} tuple must contain exactly [open, high, low, close].`
      );
    }
    const record = tuple ? {} : (raw as Record<string, unknown>);
    const openTime =
      parseTimestamp(record.openTime ?? record.time ?? record.timestamp, millis) ??
      (i === 0 ? startTime : prevClose);
    const closeTime = parseTimestamp(record.closeTime, millis) ?? openTime + intervalMs;

    const duration = closeTime - openTime;
    const partial =
      millis &&
      root.partialLast === true &&
      i === total - 1 &&
      duration > 0 &&
      duration < intervalMs &&
      duration % 60000 === 0;
    if (duration !== intervalMs && !partial) {
      throw new CandleBridgeError(
        'INVALID_INTERVAL',
        `Candle #${i + 1} duration does not match intervalSeconds (${intervalSeconds}s).`
      );
    }
    if (i > 0 && openTime !== prevClose) {
      throw new CandleBridgeError(
        'INVALID_CANDLE',
        `Candle #${i + 1} openTime is not continuous with previous closeTime.`
      );
    }

    const open = Number(tuple ? tuple[0] : (record.open ?? record.openPrice));
    const high = Number(tuple ? tuple[1] : (record.high ?? record.highPrice));
    const low = Number(tuple ? tuple[2] : (record.low ?? record.lowPrice));
    const close = Number(tuple ? tuple[3] : (record.close ?? record.closePrice));

    const candle: Candle = {
      openTime,
      closeTime,
      open: normalize(open),
      high: normalize(high),
      low: normalize(low),
      close: normalize(close)
    };

    if (record.execution !== undefined && record.execution !== null) {
      if (typeof record.execution !== 'object' || Array.isArray(record.execution))
        throw new CandleBridgeError('INVALID_EXECUTION_PATH', 'Expected execution path object.');
      const exec = record.execution as ExecutionPath;
      validateExecutionPath({ ...candle, execution: exec }, { maxPoints: options?.maxPoints });
      candle.execution = { ...exec, points: exec.points.map(([ms, p]): ExecutionPoint => [ms, p]) };
    }

    candles.push(candle);
    prevClose = closeTime;
  }

  validateCandles(candles, {
    maxPriceMultiplier: options?.maxPriceMultiplier,
    maxPoints: options?.maxPoints
  });
  return {
    candles,
    intervalSeconds,
    symbol: typeof root.symbol === 'string' ? root.symbol : undefined
  };
}

/**
 * Serializes candles to CandleBridge JSON format.
 */
export function serializeCandlesJson(
  candles: readonly Candle[],
  options?: {
    symbol?: string;
    intervalSeconds?: number;
    includeExecution?: boolean;
    pretty?: boolean;
    format?: 'candlebridge' | 'klines';
  }
): string {
  const intervalSeconds =
    options?.intervalSeconds ??
    (candles.length ? Math.round((candles[0].closeTime - candles[0].openTime) / 1000) : 60);
  const width = intervalSeconds * 1000;
  let partialLast = false;
  for (const [index, c] of candles.entries()) {
    const duration = c.closeTime - c.openTime;
    if (duration === width) continue;
    if (
      options?.format !== 'klines' &&
      index === candles.length - 1 &&
      duration > 0 &&
      duration < width &&
      duration % 60000 === 0
    )
      partialLast = true;
    else
      throw new CandleBridgeError(
        'INVALID_INTERVAL',
        'JSON requires a uniform interval; only native JSON can carry a partial final bar.'
      );
  }
  const includeExecution = options?.includeExecution ?? true;
  const items = includeExecution ? candles : candles.map(({ execution: _ignored, ...rest }) => rest);

  const payload = {
    timeUnit: 'ms',
    ...(partialLast ? { partialLast } : {}),
    ...(options?.symbol ? { symbol: options.symbol } : {}),
    intervalSeconds,
    ...(options?.format === 'klines'
      ? {
          klines: items.map(({ open, high, low, close, ...rest }) => ({
            ...rest,
            openPrice: open,
            highPrice: high,
            lowPrice: low,
            closePrice: close
          }))
        }
      : { candles: items })
  };
  return JSON.stringify(payload, null, options?.pretty ? 2 : undefined);
}

/**
 * Serializes candles to standard CSV (`openTime,closeTime,isoTime,open,high,low,close`).
 */
export function serializeCandlesCsv(candles: readonly Candle[]): string {
  const lines = ['openTime,closeTime,isoTime,open,high,low,close'];
  for (const c of candles) {
    lines.push(
      `${c.openTime},${c.closeTime},${new Date(c.openTime).toISOString()},${c.open},${c.high},${c.low},${c.close}`
    );
  }
  return lines.join('\n');
}
