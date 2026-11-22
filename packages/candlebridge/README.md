# candlebridge

Deterministic synthetic OHLC and intrabar price paths. The library is independent of React, chart renderers, browsers and market feeds. It exports ESM, CommonJS and declarations for both. Browser workers are opt-in.

```js
import {
  generateCandles,
  interpolatePriceAt,
  splitMinutes,
  serializeCandlesJson,
  parseCandlesJson
} from 'candlebridge';

const options = {
  startTime: Date.UTC(2026, 0, 5),
  intervalSeconds: 300,
  count: 288,
  startPrice: 100,
  endPrice: 108,
  minimumPrice: 80,
  maximumPrice: 125,
  seed: 17
};
const bars = generateCandles(options);
const price = interpolatePriceAt(bars[0], bars[0].openTime + 2500);
const minuteBars = splitMinutes(bars);
const restored = parseCandlesJson(serializeCandlesJson(bars)).candles;
```

**Input:** the time is Unix milliseconds; the candle interval is seconds. `intensity` is `low`, `medium` (default) or `high`. `model` overrides individual `DEFAULT_MODEL` fields, e.g. `{ fineSeconds: 1, df: 4, lockTarget: false }`. `seed` and `intensity` at the top level take precedence. Seed defaults to `20261007`; call `randomSeed()` explicitly to reroll. Price bounds apply to the entire path. With target lock off, `endPrice` is still a required finite input but does not select the final close.

**Output:** `{ openTime, closeTime, open, high, low, close, execution }`. `closeTime` is the next opening boundary. `execution.version === 1`; points are sorted `[offsetMsFromOpen, price]` pairs including open, close and minute extrema. Adjacent points define a linear interpolation for replay. These are price samples, not trades.

| API                                                                 | Purpose                                                                                                                                             |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `generateCandles(options)`                                          | Sample one bounded path; return candles or throw `CandleBridgeError` with a stable `code`.                                                          |
| `resampleCandles(bars, seconds)` / `aggregateCandles`               | Build whole-minute intervals anchored at the first opening. A partial final bar is retained.                                                        |
| `splitMinutes(bars)`                                                | Return just one-minute OHLC. With generated paths the OHLC agrees with direct minute generation over the same horizon.                              |
| `candlePoints(bar)` / `interpolatePriceAt(bar, timestampMs)`        | Inspect stored points / query at a timestamp. Without a stored path use a four-point OHLC approximation, not reconstructed market ticks.            |
| `createManualExecution(bar, floor, ceiling)` / `connectSeries`      | Give an edited candle a deterministic wick order; shift an existing series to a new time and starting price. Resample before changing its interval. |
| `computeIndicators(bars)` / `computeStats(bars)`                    | EMA 7/25/99, MACD 12/26/9 (`DIF − DEA` histogram); return, chronological path drawdown, OHLC range and bar counts.                                  |
| `validateCandles` / `validateExecutionPath`                         | Check finite positive prices, OHLC envelope, consecutive candle times, ordered offsets and matching extrema.                                        |
| `parseCandlesJson` / `serializeCandlesJson` / `serializeCandlesCsv` | Import/export native JSON, legacy OHLC or CSV export.                                                                                               |

**JSON:** native files use `{ timeUnit: "ms", intervalSeconds, candles }`; a shorter tail is marked `partialLast`. `serializeCandlesJson(bars, { format: 'klines' })` emits a uniform-interval legacy envelope with `openPrice`/`highPrice`/`lowPrice`/`closePrice`. The reader also supports tuples and flat quadruples, defaulting to one minute per bar; for unstamped data use `defaultStartTime` (ms) to fix the anchor. Legacy timestamps accept ISO or Unix seconds/milliseconds. `includeExecution: false` omits the intrabar path; it cannot then be recovered from four prices. CSV columns: `openTime,closeTime,isoTime,open,high,low,close`.

**Limits:** defaults are 24,000 generated candles, 8 million fine steps, 80 path attempts, 8 decimal places, 25× starting price as the maximum ceiling and 8,192 saved points per bar. Base intervals are whole minutes from 1 minute to 1 day. Adjust `limits` where needed; precision supports 0–12 decimals. A point budget too small to retain minute OHLC is rejected, not silently truncated. JS numbers are floating-point; use ordinary positive price magnitudes. Import defaults to 300,000 bars and an 8,192-point-per-bar cap. Give the reader matching limits when using non-default generation limits.

**Web Worker (Vite example):**

```ts
// simulation.worker.ts
import 'candlebridge/worker';
```

```ts
// Browser main thread; options is the same object as above.
import type { WorkerGenerateResponse } from 'candlebridge';
const worker = new Worker(new URL('./simulation.worker.ts', import.meta.url), { type: 'module' });
worker.onmessage = ({ data }: MessageEvent<WorkerGenerateResponse>) => {
  if ('error' in data) console.error(data.code, data.error);
  else console.log(data.candles.length, data.durationMs);
  worker.terminate();
};
worker.postMessage({ id: 1, options });
```

Import the worker entry **inside a dedicated browser worker only**; the normal entry has no global message listeners. No volume, order submission or actual market data is part of this package. MIT.
