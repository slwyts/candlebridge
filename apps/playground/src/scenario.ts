import { DEFAULT_MODEL, type GenerateOptions, type ModelParameters } from 'candlebridge';
import { PRESETS, type PlaygroundPreset } from './presets';

export type Scenario = Omit<PlaygroundPreset, 'model'> & {
  model: ModelParameters;
  startUtc: string;
  boundsLocked: boolean;
};

export const frames = [60, 300, 900, 1800, 3600, 14_400, 86_400];
export const frameName = (s: number) =>
  s === 86_400 ? '1D' : s % 3600 === 0 ? `${s / 3600}h` : `${s / 60}m`;
export const newScenario = (preset = PRESETS[0], startUtc = '2026-01-05T00:00'): Scenario => ({
  ...preset,
  startUtc,
  model: { ...DEFAULT_MODEL, ...preset.model },
  boundsLocked: false
});

export function toOptions(s: Scenario): GenerateOptions {
  const duration = s.duration * (s.durationUnit === 'hours' ? 3600 : 86400);
  const interval = s.intervalSeconds === 60 && Math.round(duration / 60) > 24000 ? 300 : s.intervalSeconds;
  const change = s.direction === 'sideways' ? 0 : (s.direction === 'down' ? -1 : 1) * s.targetMovePct;
  const endPrice = s.startPrice * (1 + change / 100);
  const auto = !s.boundsLocked && s.model.lockTarget;
  return {
    startPrice: s.startPrice,
    endPrice,
    count: Math.round(duration / interval),
    intervalSeconds: interval,
    startTime: Date.parse(`${s.startUtc}Z`),
    minimumPrice: Math.min(
      s.startPrice * (1 + s.minimumPct / 100),
      auto ? Math.min(s.startPrice, endPrice) * 0.97 : Infinity
    ),
    maximumPrice: Math.max(
      s.startPrice * (1 + s.maximumPct / 100),
      auto ? Math.min(s.startPrice * 25, Math.max(s.startPrice, endPrice) * 1.03) : 0
    ),
    intensity: s.intensity,
    seed: s.model.seed,
    model: { ...s.model, intensity: s.intensity }
  };
}

export function codeFor(options: GenerateOptions | null) {
  if (!options)
    return `import { readFileSync } from 'node:fs';\nimport { parseCandlesJson } from 'candlebridge';\n\nconst { candles } = parseCandlesJson(\n  readFileSync('candlebridge.json', 'utf8')\n);`;
  const { model, ...main } = options;
  const overrides = Object.fromEntries(
    Object.entries(model ?? {}).filter(
      ([k, v]) => k !== 'seed' && k !== 'intensity' && v !== DEFAULT_MODEL[k as keyof ModelParameters]
    )
  );
  const minimal = { ...main, ...(Object.keys(overrides).length ? { model: overrides } : {}) };
  return `import { generateCandles } from 'candlebridge';\n\nconst candles = generateCandles(${JSON.stringify(minimal, null, 2)});`;
}
