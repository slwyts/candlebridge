import { generateCandles } from './generator';
import {
  CandleBridgeError,
  type GenerateOptions,
  type WorkerGenerateRequest,
  type WorkerGenerateResponse
} from './types';

type WorkerPayload = WorkerGenerateRequest | GenerateOptions;

function isEnvelope(data: WorkerPayload): data is WorkerGenerateRequest {
  return typeof data === 'object' && data !== null && 'options' in data;
}

const scope = self as unknown as {
  addEventListener: (type: 'message', listener: (event: MessageEvent<WorkerPayload>) => void) => void;
  postMessage: (message: WorkerGenerateResponse) => void;
};

scope.addEventListener('message', (event) => {
  const payload = event.data;
  const id = isEnvelope(payload) ? payload.id : undefined;
  const options = isEnvelope(payload) ? payload.options : payload;
  const started = typeof performance !== 'undefined' ? performance.now() : Date.now();

  try {
    const candles = generateCandles(options);
    const finished = typeof performance !== 'undefined' ? performance.now() : Date.now();
    scope.postMessage({
      id,
      candles,
      durationMs: Math.max(0, Math.round((finished - started) * 100) / 100)
    });
  } catch (error) {
    scope.postMessage({
      id,
      error: error instanceof Error ? error.message : 'Generation failed.',
      code: error instanceof CandleBridgeError ? error.code : undefined
    });
  }
});
