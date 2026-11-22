import { useEffect, useMemo, useState } from 'react';
import { candlePoints, interpolatePriceAt, type Candle } from 'candlebridge';
import { MESSAGES, type Locale } from '../i18n';

interface Props {
  candles: Candle[];
  locale: Locale;
}

function formatNum(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1_000_000 || (n > 0 && n < 0.0001)) return n.toExponential(4);
  return Number(n.toPrecision(7)).toString();
}

export default function PathInspector({ candles, locale }: Props) {
  const t = MESSAGES[locale];
  const [candleIdx, setCandleIdx] = useState(0);
  const [progressPct, setProgressPct] = useState(50);

  useEffect(() => {
    setCandleIdx((prev) => Math.min(prev, Math.max(0, candles.length - 1)));
  }, [candles.length]);

  const candle = candles[candleIdx];
  const points = useMemo(() => (candle ? candlePoints(candle) : []), [candle]);

  if (!candle || points.length < 2) return null;

  const durationMs = candle.closeTime - candle.openTime;
  const offsetMs = Math.round((durationMs * progressPct) / 100);
  const currentPrice = interpolatePriceAt(candle, candle.openTime + offsetMs, { priceDecimals: 8 });

  const minP = Math.min(...points.map((p) => p[1]));
  const maxP = Math.max(...points.map((p) => p[1]));
  const spanP = Math.max(maxP - minP, candle.open * 1e-6, 1e-10);

  const width = 640;
  const height = 104;
  const padX = 10;
  const padY = 12;
  const toX = (ms: number) => padX + (ms / Math.max(1, durationMs)) * (width - padX * 2);
  const toY = (p: number) => padY + ((maxP - p) / spanP) * (height - padY * 2);

  const poly = points.map(([ms, p]) => `${toX(ms).toFixed(1)},${toY(p).toFixed(1)}`).join(' ');
  const markerX = toX(offsetMs);
  const markerY = toY(currentPrice);
  const strokeColor = candle.close >= candle.open ? '#2dd4bf' : '#fb7185';

  return (
    <section className="inspector-card">
      <div className="inspector-header">
        <div>
          <h3>{t.inspectorTitle}</h3>
          <p>{t.inspectorSubtitle}</p>
        </div>
        <div className="inspector-controls">
          <label>
            <span>{t.candleIndex}</span>
            <input
              type="number"
              min={1}
              max={candles.length}
              value={candleIdx + 1}
              onChange={(e) => {
                const v = Math.max(1, Math.min(candles.length, Number(e.target.value) || 1));
                setCandleIdx(Math.floor(v) - 1);
              }}
            />
          </label>
          <span className="pill-badge">
            {points.length} {t.pointsCount}
          </span>
        </div>
      </div>

      <div className="inspector-body">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="path-svg"
          preserveAspectRatio="none"
          role="img"
          aria-label={t.inspectorTitle}
        >
          <line
            x1={padX}
            y1={toY(candle.open)}
            x2={width - padX}
            y2={toY(candle.open)}
            stroke="#263832"
            strokeDasharray="3 4"
          />
          <polyline fill="none" stroke={strokeColor} strokeWidth="2" points={poly} />
          <line
            x1={markerX}
            y1={padY}
            x2={markerX}
            y2={height - padY}
            stroke="#94a3b8"
            strokeDasharray="2 3"
          />
          <circle cx={markerX} cy={markerY} r="4" fill="#f8fafc" stroke={strokeColor} strokeWidth="2" />
        </svg>

        <div className="inspector-scrubber">
          <input
            type="range"
            aria-label={t.offset}
            min={0}
            max={100}
            step={0.5}
            value={progressPct}
            onChange={(e) => setProgressPct(Number(e.target.value))}
          />
          <div className="inspector-readout">
            <span>
              {t.offset}: <strong>+{(offsetMs / 1000).toFixed(1)}s</strong> / {(durationMs / 1000).toFixed(0)}
              s
            </span>
            <span>
              {t.interpolated}: <strong>{formatNum(currentPrice)}</strong>
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
