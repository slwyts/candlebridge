/** Volatility intensity preset scaling the base volatility level. */
export type Intensity = 'low' | 'medium' | 'high';

/** Underlying fine simulation step size in seconds. */
export type FineResolutionSeconds = 1 | 5;

/** Intra-candle price waypoint: [offsetMillisecondsFromOpen, price]. */
export type ExecutionPoint = [offsetMs: number, price: number];

/** Full statistical parameter set controlling the stochastic path generator. */
export interface ModelParameters {
  /** Unsigned 32-bit integer PRNG seed (0 .. 4294967295). */
  seed: number;
  /** Fine simulation resolution in seconds (1 or 5). */
  fineSeconds: FineResolutionSeconds;
  /** Student-t degrees of freedom controlling tail heaviness (integer 3 .. 30). */
  df: number;
  /** EWMA volatility persistence coefficient (0 <= decay < 1). */
  decay: number;
  /** Base per-minute volatility expressed in percent (> 0 .. 5). */
  baseVolatility: number;
  /** Per-minute probability of a jump event in percent (0 .. 1). */
  jumpProbability: number;
  /** Minimum jump amplitude in percent (0 .. jumpMaximum). */
  jumpMinimum: number;
  /** Maximum jump amplitude in percent (jumpMinimum .. 30). */
  jumpMaximum: number;
  /** Lognormal volatility-of-volatility shock intensity (0 .. 2). */
  shock: number;
  /** Volatility multiplier during low-volatility regime (> 0 .. 10). */
  lowMultiplier: number;
  /** Volatility multiplier during high-volatility regime (> 0 .. 10). */
  highMultiplier: number;
  /** Volatility multiplier during directional trend regime (> 0 .. 10). */
  trendMultiplier: number;
  /** Minimum duration of a single market regime in minutes (> 0). */
  stateMinimum: number;
  /** Maximum duration of a single market regime in minutes (stateMinimum .. 43200). */
  stateMaximum: number;
  /** Per-minute directional drift magnitude during trend regime in percent (0 .. 1). */
  trendStrength: number;
  /** Coarse volatility scaling preset. */
  intensity: Intensity;
  /** Applies an equal correction to log returns to land on the rounded endPrice. */
  lockTarget: boolean;
  /** Enables standardized Student-t innovations instead of Gaussian noise. */
  fatTail: boolean;
  /** Enables EWMA volatility clustering across fine steps. */
  memory: boolean;
  /** Enables sparse random jump shocks. */
  jumps: boolean;
  /** Enables 3-state (low-vol / high-vol / trend) regime switching. */
  regimes: boolean;
}

/** Compressed intra-candle trajectory preserving minute boundaries and local extrema. */
export interface ExecutionPath {
  version: 1;
  minimumPrice: number;
  maximumPrice: number;
  points: ExecutionPoint[];
  parameters?: ModelParameters;
}

/** Standard OHLC candlestick with optional sub-candle execution trajectory. */
export interface Candle {
  /** Candle open timestamp in Unix milliseconds. */
  openTime: number;
  /** Candle close timestamp in Unix milliseconds (exclusive boundary). */
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  execution?: ExecutionPath;
}

/** Configurable safety guardrails for generation and validation. */
export interface GeneratorLimits {
  /** Maximum number of generated candles (default: 24,000). */
  maxCount?: number;
  /** Maximum number of underlying fine simulation steps (default: 8,000,000). */
  maxFineSteps?: number;
  /** Maximum rejection-sampling attempts before throwing (default: 80). */
  maxAttempts?: number;
  /** Maximum allowed ratio ceiling / startPrice (default: 25; set Infinity to disable). */
  maxPriceMultiplier?: number;
  /** Decimal precision for rounded prices (integer 0 .. 12, default: 8). */
  priceDecimals?: number;
  /** Maximum compressed execution waypoints stored per candle (default: 8,192). */
  maxPointsPerCandle?: number;
}

/** Input options for `generateCandles`. */
export interface GenerateOptions {
  startPrice: number;
  endPrice: number;
  count: number;
  /** Candle interval in whole minutes (60 .. 86400, divisible by 60). */
  intervalSeconds: number;
  /** First candle open timestamp in Unix milliseconds. */
  startTime: number;
  minimumPrice: number;
  maximumPrice: number;
  intensity?: Intensity;
  seed?: number;
  model?: Partial<ModelParameters>;
  limits?: GeneratorLimits;
}

/** Standard EMA (7/25/99) and MACD (12/26/9) series aligned to input candles. */
export interface IndicatorSeries {
  ema7: number[];
  ema25: number[];
  ema99: number[];
  dif: number[];
  dea: number[];
  histogram: number[];
}

/** Summary metrics for a candle series. */
export interface CandleStats {
  startPrice: number;
  endPrice: number;
  returnPct: number;
  high: number;
  low: number;
  maxDrawdownPct: number;
  bullishCount: number;
  bearishCount: number;
  flatCount: number;
  totalExecutionPoints: number;
  durationMs: number;
}

export type CandleBridgeErrorCode =
  | 'INVALID_PRICE_RANGE'
  | 'INVALID_INTERVAL'
  | 'INVALID_PARAMETERS'
  | 'PATH_TOO_LONG'
  | 'GENERATION_FAILED'
  | 'INVALID_CANDLE'
  | 'INVALID_EXECUTION_PATH'
  | 'INVALID_JSON';

/** Structured error thrown by CandleBridge validation and generation APIs. */
export class CandleBridgeError extends Error {
  readonly code: CandleBridgeErrorCode;

  constructor(code: CandleBridgeErrorCode, message: string) {
    super(message);
    this.name = 'CandleBridgeError';
    this.code = code;
  }
}

export interface WorkerGenerateRequest {
  id?: string | number;
  options: GenerateOptions;
}

export interface WorkerGenerateSuccess {
  id?: string | number;
  candles: Candle[];
  durationMs: number;
}

export interface WorkerGenerateFailure {
  id?: string | number;
  error: string;
  code?: CandleBridgeErrorCode;
}

export type WorkerGenerateResponse = WorkerGenerateSuccess | WorkerGenerateFailure;
