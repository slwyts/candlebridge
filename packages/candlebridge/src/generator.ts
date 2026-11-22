import { createMulberry32, createStandardNormal, sampleStudentT } from './prng';
import {
  CandleBridgeError,
  type Candle,
  type ExecutionPoint,
  type GenerateOptions,
  type GeneratorLimits,
  type Intensity,
  type ModelParameters
} from './types';

/** Baseline scenario settings; no fit to a particular real instrument is assumed. */
export const DEFAULT_MODEL: Readonly<ModelParameters> = Object.freeze({
  seed: 20261007,
  fineSeconds: 5,
  df: 6,
  decay: 0.9,
  baseVolatility: 0.09,
  jumpProbability: 0.02,
  jumpMinimum: 0.4,
  jumpMaximum: 1.8,
  shock: 0.38,
  lowMultiplier: 0.5,
  highMultiplier: 2.1,
  trendMultiplier: 1.05,
  stateMinimum: 30,
  stateMaximum: 360,
  trendStrength: 0.0075,
  intensity: 'medium',
  lockTarget: true,
  fatTail: true,
  memory: true,
  jumps: true,
  regimes: true
});

/** Default operational safety guardrails. */
export const DEFAULT_LIMITS: Readonly<Required<GeneratorLimits>> = Object.freeze({
  maxCount: 24_000,
  maxFineSteps: 8_000_000,
  maxAttempts: 80,
  maxPriceMultiplier: 25,
  priceDecimals: 8,
  maxPointsPerCandle: 8_192
});

const INTENSITY_SCALE: Record<Intensity, number> = {
  low: 0.00055 / 0.0009,
  medium: 1,
  high: 0.0013 / 0.0009
};

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function resolveLimits(limits?: GeneratorLimits): Required<GeneratorLimits> {
  const merged: Required<GeneratorLimits> = { ...DEFAULT_LIMITS, ...limits };
  if (
    !Number.isInteger(merged.maxCount) ||
    merged.maxCount < 1 ||
    !Number.isInteger(merged.maxFineSteps) ||
    merged.maxFineSteps < 1 ||
    !Number.isInteger(merged.maxAttempts) ||
    merged.maxAttempts < 1 ||
    !Number.isInteger(merged.priceDecimals) ||
    merged.priceDecimals < 0 ||
    merged.priceDecimals > 12 ||
    !Number.isInteger(merged.maxPointsPerCandle) ||
    merged.maxPointsPerCandle < 4 ||
    !(merged.maxPriceMultiplier > 1)
  ) {
    throw new CandleBridgeError('INVALID_PARAMETERS', 'Invalid generator limit configuration.');
  }
  return merged;
}

/**
 * Samples one deterministic, bounded stochastic price path at fine resolution (`fineSeconds`),
 * optionally locks the final price to `endPrice` via log-return bridge correction, and aggregates
 * the trajectory into OHLC candles with compressed minute-consistent execution paths.
 */
export function generateCandles(options: GenerateOptions): Candle[] {
  const limits = resolveLimits(options.limits);
  const scaleFactor = 10 ** limits.priceDecimals;
  const round = (n: number) => Math.round(n * scaleFactor) / scaleFactor;

  const intensity: Intensity = options.intensity ?? options.model?.intensity ?? DEFAULT_MODEL.intensity;
  const seed = options.seed ?? options.model?.seed ?? DEFAULT_MODEL.seed;
  const m: ModelParameters = {
    ...DEFAULT_MODEL,
    ...options.model,
    seed,
    intensity
  };

  const start = round(options.startPrice);
  const end = round(options.endPrice);
  const floor = Math.ceil(options.minimumPrice * scaleFactor - 1e-6) / scaleFactor;
  const ceiling = Math.floor(options.maximumPrice * scaleFactor + 1e-6) / scaleFactor;

  if (
    ![start, end, floor, ceiling, options.startTime, options.count, options.intervalSeconds].every(
      Number.isFinite
    ) ||
    start <= 0 ||
    floor <= 0 ||
    floor >= ceiling ||
    start < floor ||
    start > ceiling ||
    (m.lockTarget && (end < floor || end > ceiling))
  ) {
    throw new CandleBridgeError(
      'INVALID_PRICE_RANGE',
      'Start price (and locked target price) must be positive and lie within [minimumPrice, maximumPrice].'
    );
  }

  if (
    !Number.isSafeInteger(options.startTime) ||
    !Number.isSafeInteger(options.startTime + options.count * options.intervalSeconds * 1000) ||
    Math.abs(options.startTime) > 8.64e15 ||
    Math.abs(options.startTime + options.count * options.intervalSeconds * 1000) > 8.64e15 ||
    !Number.isInteger(options.count) ||
    options.count < 1 ||
    options.count > limits.maxCount ||
    !Number.isInteger(options.intervalSeconds) ||
    options.intervalSeconds < 60 ||
    options.intervalSeconds > 86_400 ||
    options.intervalSeconds % 60 !== 0
  ) {
    throw new CandleBridgeError(
      'INVALID_INTERVAL',
      `Interval must be a whole-minute value in [60, 86400] seconds, and count must be in [1, ${limits.maxCount}].`
    );
  }

  if (Number.isFinite(limits.maxPriceMultiplier) && ceiling > start * limits.maxPriceMultiplier + 1e-8) {
    throw new CandleBridgeError(
      'INVALID_PRICE_RANGE',
      `Maximum price cannot exceed ${limits.maxPriceMultiplier}x the starting price.`
    );
  }

  const numericParams = [
    m.seed,
    m.fineSeconds,
    m.df,
    m.decay,
    m.baseVolatility,
    m.jumpProbability,
    m.jumpMinimum,
    m.jumpMaximum,
    m.shock,
    m.lowMultiplier,
    m.highMultiplier,
    m.trendMultiplier,
    m.stateMinimum,
    m.stateMaximum,
    m.trendStrength
  ];

  if (
    !Object.hasOwn(INTENSITY_SCALE, intensity) ||
    ![m.fatTail, m.memory, m.jumps, m.regimes, m.lockTarget].every((v) => typeof v === 'boolean') ||
    !numericParams.every(Number.isFinite) ||
    !Number.isInteger(m.seed) ||
    m.seed < 0 ||
    m.seed > 4_294_967_295 ||
    !(m.fineSeconds === 1 || m.fineSeconds === 5) ||
    !Number.isInteger(m.df) ||
    m.df <= 2 ||
    m.df > 30 ||
    m.decay < 0 ||
    m.decay >= 1 ||
    m.baseVolatility <= 0 ||
    m.baseVolatility > 5 ||
    m.jumpProbability < 0 ||
    m.jumpProbability > 1 ||
    m.jumpMinimum < 0 ||
    m.jumpMaximum < m.jumpMinimum ||
    m.jumpMaximum > 30 ||
    m.shock < 0 ||
    m.shock > 2 ||
    Math.min(m.lowMultiplier, m.highMultiplier, m.trendMultiplier) <= 0 ||
    Math.max(m.lowMultiplier, m.highMultiplier, m.trendMultiplier) > 10 ||
    m.stateMinimum <= 0 ||
    m.stateMaximum < m.stateMinimum ||
    m.stateMaximum > 43_200 ||
    m.trendStrength < 0 ||
    m.trendStrength > 1
  ) {
    throw new CandleBridgeError(
      'INVALID_PARAMETERS',
      'One or more stochastic model parameters are out of range.'
    );
  }

  const durationSeconds = options.count * options.intervalSeconds;
  const steps = durationSeconds / m.fineSeconds;
  if (steps > limits.maxFineSteps) {
    throw new CandleBridgeError(
      'PATH_TOO_LONG',
      `Fine path length (${steps} steps) exceeds limit (${limits.maxFineSteps}). Use fineSeconds=5 or shorter duration.`
    );
  }

  const rng = createMulberry32(m.seed);
  const normal = createStandardNormal(rng);
  const level = INTENSITY_SCALE[intensity];
  const baseVol = (m.baseVolatility / 100) * level * Math.sqrt(m.fineSeconds / 60);
  const targetLog = Math.log(end / start);
  const lowLog = Math.log(floor / start);
  const highLog = Math.log(ceiling / start);
  const regimeMultipliers = [m.lowMultiplier, m.highMultiplier, m.trendMultiplier];
  const jumpThreshold = ((m.jumpProbability / 100) * m.fineSeconds) / 60;
  const trendDriftStep = ((m.trendStrength / 100) * m.fineSeconds) / 60;
  const returns = new Float64Array(steps);
  const prices = new Float64Array(steps + 1);

  for (let attempt = 0; attempt < limits.maxAttempts; attempt++) {
    let volatility = baseVol;
    let regime = 0;
    let remaining = 0;
    let direction = 1;
    let returnSum = 0;

    for (let i = 0; i < steps; i++) {
      if (remaining <= 0) {
        const pick = rng();
        regime = pick < 0.52 ? 0 : pick < 0.8 ? 1 : 2;
        remaining = Math.round(
          ((m.stateMinimum + rng() * (m.stateMaximum - m.stateMinimum)) * 60) / m.fineSeconds
        );
        direction = rng() < 0.5 ? -1 : 1;
      }
      remaining--;

      const multiplier = m.regimes ? regimeMultipliers[regime] : 1;
      const volShock = baseVol * multiplier * Math.exp(m.shock * normal() - (m.shock * m.shock) / 2);
      volatility = m.memory ? m.decay * volatility + (1 - m.decay) * volShock : volShock;

      const epsilon = sampleStudentT(normal, m.df, m.fatTail);

      const jumpCoin = rng();
      const jumpSign = rng() < 0.5 ? -1 : 1;
      const jumpSize = (m.jumpMinimum + rng() * (m.jumpMaximum - m.jumpMinimum)) / 100;
      const jump = m.jumps && jumpCoin < jumpThreshold ? jumpSign * jumpSize : 0;

      const drift = m.regimes && regime === 2 ? direction * trendDriftStep : 0;
      const stepReturn = volatility * epsilon + jump + drift;
      returns[i] = stepReturn;
      returnSum += stepReturn;
    }

    const bridgeCorrection = m.lockTarget ? (targetLog - returnSum) / steps : 0;
    prices[0] = start;
    let cumulativeLog = 0;
    let withinBounds = true;

    for (let i = 0; i < steps; i++) {
      cumulativeLog += returns[i] + bridgeCorrection;
      if (i === steps - 1 && m.lockTarget) {
        cumulativeLog = targetLog;
      }
      if (
        !Number.isFinite(cumulativeLog) ||
        cumulativeLog < lowLog - 1e-12 ||
        cumulativeLog > highLog + 1e-12
      ) {
        withinBounds = false;
        break;
      }
      prices[i + 1] = clamp(round(start * Math.exp(cumulativeLog)), floor, ceiling);
    }

    if (!withinBounds) continue;
    if (m.lockTarget) {
      prices[steps] = end;
    }

    const candles: Candle[] = [];
    const stepsPerCandle = options.intervalSeconds / m.fineSeconds;
    const maximumPoints = Math.min(
      limits.maxPointsPerCandle,
      Math.max(Math.ceil(options.intervalSeconds / 60) * 3 + 2, Math.floor(1_000_000 / options.count))
    );
    const stepsPerMinute = 60 / m.fineSeconds;

    for (let index = 0; index < options.count; index++) {
      const from = index * stepsPerCandle;
      const until = from + stepsPerCandle;
      const selected = new Set<number>([from, until]);
      let maximum = prices[from];
      let minimum = prices[from];

      for (let at = from; at < until; at += stepsPerMinute) {
        const stop = Math.min(until, at + stepsPerMinute);
        let highestIdx = at;
        let lowestIdx = at;
        for (let j = at; j <= stop; j++) {
          if (prices[j] > prices[highestIdx]) highestIdx = j;
          if (prices[j] < prices[lowestIdx]) lowestIdx = j;
        }
        selected.add(at);
        selected.add(highestIdx);
        selected.add(lowestIdx);
        selected.add(stop);
        maximum = Math.max(maximum, prices[highestIdx]);
        minimum = Math.min(minimum, prices[lowestIdx]);
      }

      if (selected.size > limits.maxPointsPerCandle) {
        throw new CandleBridgeError(
          'INVALID_PARAMETERS',
          'Point budget is too small to retain minute OHLC. Increase maxPointsPerCandle.'
        );
      }
      const remainingBudget = Math.max(1, maximumPoints - selected.size - 1);
      const stride = Math.max(1, Math.ceil(stepsPerCandle / remainingBudget));
      for (let j = from; j < until; j += stride) {
        selected.add(j);
      }

      const points: ExecutionPoint[] = [...selected]
        .sort((a, b) => a - b)
        .map((j) => [(j - from) * m.fineSeconds * 1000, prices[j]]);

      candles.push({
        openTime: options.startTime + index * options.intervalSeconds * 1000,
        closeTime: options.startTime + (index + 1) * options.intervalSeconds * 1000,
        open: prices[from],
        high: maximum,
        low: minimum,
        close: prices[until],
        execution: {
          version: 1,
          minimumPrice: floor,
          maximumPrice: ceiling,
          points,
          parameters: { ...m }
        }
      });
    }

    return candles;
  }

  throw new CandleBridgeError(
    'GENERATION_FAILED',
    `Unable to sample a path staying within [${floor}, ${ceiling}] after ${limits.maxAttempts} attempts. Widen the price bounds or lower volatility.`
  );
}
