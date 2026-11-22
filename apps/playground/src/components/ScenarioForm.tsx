import type { FormEvent } from 'react';
import { type Intensity, type ModelParameters } from 'candlebridge';
import { MESSAGES, type Locale } from '../i18n';
import { PRESETS } from '../presets';
import { frames, frameName, newScenario, type Scenario } from '../scenario';

const numericModel = [
  ['df', 3, 30, 1],
  ['baseVolatility', 0.001, 5, 0.001],
  ['decay', 0, 0.999, 0.001],
  ['shock', 0, 2, 0.01],
  ['jumpProbability', 0, 1, 0.01],
  ['jumpMinimum', 0, 30, 0.01],
  ['jumpMaximum', 0, 30, 0.01],
  ['lowMultiplier', 0.01, 10, 0.01],
  ['highMultiplier', 0.01, 10, 0.01],
  ['trendMultiplier', 0.01, 10, 0.01],
  ['stateMinimum', 1, 43200, 1],
  ['stateMaximum', 1, 43200, 1],
  ['trendStrength', 0, 1, 0.0001]
] as const;
const switches = ['lockTarget', 'fatTail', 'memory', 'jumps', 'regimes'] as const;

export default function ScenarioForm({
  locale,
  scene: s,
  setScene,
  run,
  busy,
  cancel
}: {
  locale: Locale;
  scene: Scenario;
  setScene: (s: Scenario) => void;
  run: (s: Scenario, reroll?: boolean) => void;
  busy: boolean;
  cancel: () => void;
}) {
  const t = MESSAGES[locale],
    zh = locale === 'zh';
  const edit = (patch: Partial<Scenario>) => setScene({ ...s, ...patch });
  const model = (patch: Partial<ModelParameters>) => edit({ model: { ...s.model, ...patch } });
  const input = (
    label: string,
    n: number,
    action: (n: number) => void,
    min?: number,
    max?: number,
    step: number | 'any' = 'any',
    disabled = false
  ) => (
    <label key={label}>
      {label}
      <input
        type="number"
        value={Number.isFinite(n) ? n : ''}
        required
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => action(e.target.valueAsNumber)}
      />
    </label>
  );
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const button = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    run(s, button?.value === 'reroll');
  };
  return (
    <form onSubmit={submit} className="scenarios">
      <div className="section-kicker">
        <b>01</b> {zh ? '参数面板' : 'SCENARIO CONTROLS'}
      </div>
      <h2>{t.basicSettings}</h2>
      <label>
        {t.presets}
        <select
          value={s.id}
          onChange={(e) => {
            const next = newScenario(
              PRESETS.find((p) => p.id === e.target.value),
              s.startUtc
            );
            setScene(next);
            run(next);
          }}
        >
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {t.presetNames[p.id]}
            </option>
          ))}
        </select>
      </label>
      <div className="fields">
        {input(t.startPrice, s.startPrice, (startPrice) => edit({ startPrice }), 1e-8)}
        <label>
          {t.direction}
          <select
            value={s.direction}
            disabled={!s.model.lockTarget}
            onChange={(e) => edit({ direction: e.target.value as Scenario['direction'] })}
          >
            <option value="up">{t.dirUp}</option>
            <option value="down">{t.dirDown}</option>
            <option value="sideways">{t.dirSideways}</option>
          </select>
        </label>
        {input(
          t.targetMove,
          s.targetMovePct,
          (targetMovePct) => edit({ targetMovePct }),
          0,
          undefined,
          'any',
          !s.model.lockTarget || s.direction === 'sideways'
        )}
        <label>
          {t.intensity}
          <select value={s.intensity} onChange={(e) => edit({ intensity: e.target.value as Intensity })}>
            {(['low', 'medium', 'high'] as const).map((k) => (
              <option key={k} value={k}>
                {t[k]}
              </option>
            ))}
          </select>
        </label>
        {input(t.duration, s.duration, (duration) => edit({ duration }), 0.001)}
        <label>
          {zh ? '时间单位' : 'Duration unit'}
          <select
            value={s.durationUnit}
            onChange={(e) =>
              edit({
                durationUnit: e.target.value as Scenario['durationUnit'],
                duration: s.duration * (e.target.value === 'hours' ? 24 : 1 / 24)
              })
            }
          >
            <option value="hours">{t.hours}</option>
            <option value="days">{t.days}</option>
          </select>
        </label>
        <label>
          {t.storageInterval}
          <select
            value={s.intervalSeconds}
            onChange={(e) => edit({ intervalSeconds: Number(e.target.value) })}
          >
            {frames.map((n) => (
              <option key={n} value={n}>
                {frameName(n)}
              </option>
            ))}
          </select>
        </label>
        {input(t.seed, s.model.seed, (seed) => model({ seed }), 0, 4294967295, 1)}
      </div>
      <details className="advanced">
        <summary>{t.advancedModel}</summary>
        <label>
          {zh ? '起始时间（UTC）' : 'Start time (UTC)'}
          <input
            type="datetime-local"
            required
            step="60"
            value={s.startUtc}
            onChange={(e) => edit({ startUtc: e.target.value })}
          />
        </label>
        <div className="fields">
          {input(
            t.minBound,
            s.minimumPct,
            (minimumPct) => edit({ minimumPct, boundsLocked: true }),
            -99.999999,
            0
          )}
          {input(t.maxBound, s.maximumPct, (maximumPct) => edit({ maximumPct, boundsLocked: true }), 0, 2400)}
        </div>
        <label className="toggle">
          <input
            type="checkbox"
            checked={s.boundsLocked}
            onChange={(e) => edit({ boundsLocked: e.target.checked })}
          />
          {zh ? '固定价格范围' : 'Keep explicit bounds'}
        </label>
        <label>
          {t.fineSeconds}
          <select
            value={s.model.fineSeconds}
            onChange={(e) => model({ fineSeconds: Number(e.target.value) as 1 | 5 })}
          >
            <option value="1">{t.sec1}</option>
            <option value="5">{t.sec5}</option>
          </select>
        </label>
        <div className="switches">
          {switches.map((k) => (
            <label className="toggle" key={k}>
              <input
                type="checkbox"
                checked={s.model[k]}
                onChange={(e) => model({ [k]: e.target.checked })}
              />
              {t.switches[k]}
            </label>
          ))}
        </div>
        <div className="fields">
          {numericModel.map(([k, min, max, step]) =>
            input(t.params[k], s.model[k], (v) => model({ [k]: v }), min, max, step)
          )}
        </div>
      </details>
      <div className="actions">
        <button className="primary" type="submit" disabled={busy}>
          {busy ? t.btnGenerating : t.btnGenerate} <span aria-hidden>↗</span>
        </button>
        {busy ? (
          <button type="button" onClick={cancel}>
            {zh ? '取消' : 'Cancel'}
          </button>
        ) : (
          <button type="submit" value="reroll">
            {t.btnReroll}
          </button>
        )}
      </div>
    </form>
  );
}
