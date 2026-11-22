export { DEFAULT_LIMITS, DEFAULT_MODEL, generateCandles } from './generator';
export { computeIndicators, ema } from './indicators';
export {
  parseCandlesJson,
  serializeCandlesCsv,
  serializeCandlesJson,
  validateCandles,
  validateExecutionPath,
  type ParseCandlesOptions,
  type ParsedCandleSet
} from './io';
export { createMulberry32, createStandardNormal, randomSeed, sampleStudentT } from './prng';
export {
  aggregateCandles,
  candlePoints,
  compactPoints,
  computeStats,
  connectSeries,
  createManualExecution,
  interpolatePriceAt,
  readOhlcWindow,
  resampleCandles,
  splitMinutes
} from './transform';
export {
  CandleBridgeError,
  type Candle,
  type CandleBridgeErrorCode,
  type CandleStats,
  type ExecutionPath,
  type ExecutionPoint,
  type FineResolutionSeconds,
  type GenerateOptions,
  type GeneratorLimits,
  type IndicatorSeries,
  type Intensity,
  type ModelParameters,
  type WorkerGenerateFailure,
  type WorkerGenerateRequest,
  type WorkerGenerateResponse,
  type WorkerGenerateSuccess
} from './types';
