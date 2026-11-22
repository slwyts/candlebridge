import { generateCandles, type GenerateOptions, type WorkerGenerateResponse } from 'candlebridge';
const scenario: GenerateOptions = {
  startTime: 0,
  startPrice: 100,
  endPrice: 108,
  minimumPrice: 80,
  maximumPrice: 120,
  count: 24,
  intervalSeconds: 300,
  seed: 17
};
const bars = generateCandles(scenario);
if (bars.length !== 24 || bars.at(-1)?.close !== 108) throw new Error('Invalid sample from packaged library');
const message: WorkerGenerateResponse = { id: 1, candles: bars, durationMs: 0 };
if (message.candles[0].open !== 100) throw new Error('Worker protocol type mismatch');
