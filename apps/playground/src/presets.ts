import { DEFAULT_MODEL, type Intensity, type ModelParameters } from 'candlebridge';

export type Direction = 'up' | 'down' | 'sideways';
export type PresetId = 'bull' | 'chop' | 'crash' | 'gbm' | 'month';

export interface PlaygroundPreset {
  id: PresetId;
  startPrice: number;
  direction: Direction;
  targetMovePct: number;
  duration: number;
  durationUnit: 'hours' | 'days';
  intervalSeconds: number;
  minimumPct: number;
  maximumPct: number;
  intensity: Intensity;
  model: Partial<ModelParameters>;
}

export const PRESETS: PlaygroundPreset[] = [
  {
    id: 'bull',
    startPrice: 100,
    direction: 'up',
    targetMovePct: 35,
    duration: 7,
    durationUnit: 'days',
    intervalSeconds: 300,
    minimumPct: -12,
    maximumPct: 48,
    intensity: 'medium',
    model: { ...DEFAULT_MODEL, seed: 20261007 }
  },
  {
    id: 'chop',
    startPrice: 2.5,
    direction: 'sideways',
    targetMovePct: 0,
    duration: 3,
    durationUnit: 'days',
    intervalSeconds: 300,
    minimumPct: -14,
    maximumPct: 16,
    intensity: 'high',
    model: { ...DEFAULT_MODEL, seed: 884210, highMultiplier: 2.5, stateMinimum: 20, stateMaximum: 180 }
  },
  {
    id: 'crash',
    startPrice: 64_000,
    direction: 'down',
    targetMovePct: 26,
    duration: 5,
    durationUnit: 'days',
    intervalSeconds: 300,
    minimumPct: -38,
    maximumPct: 12,
    intensity: 'high',
    model: { ...DEFAULT_MODEL, seed: 912045, df: 4, jumpProbability: 0.05, jumpMaximum: 3.2 }
  },
  {
    id: 'gbm',
    startPrice: 100,
    direction: 'up',
    targetMovePct: 18,
    duration: 7,
    durationUnit: 'days',
    intervalSeconds: 300,
    minimumPct: -10,
    maximumPct: 32,
    intensity: 'medium',
    model: {
      ...DEFAULT_MODEL,
      seed: 20261007,
      fatTail: false,
      shock: 0,
      memory: false,
      jumps: false,
      regimes: false
    }
  },
  {
    id: 'month',
    startPrice: 1,
    direction: 'up',
    targetMovePct: 42,
    duration: 30,
    durationUnit: 'days',
    intervalSeconds: 300,
    minimumPct: -18,
    maximumPct: 65,
    intensity: 'medium',
    model: { ...DEFAULT_MODEL, seed: 302026 }
  }
];
