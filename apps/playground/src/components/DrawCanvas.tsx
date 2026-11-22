import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent, WheelEvent } from 'react';
import { computeIndicators, createManualExecution, type Candle } from 'candlebridge';
import type { Locale } from '../i18n';

interface Props {
  candles: Candle[];
  onChange: (next: Candle[]) => void;
  locale: Locale;
  hint: string;
}

interface Bounds {
  min: number;
  max: number;
}

const PAD_LEFT = 74;
const PAD_RIGHT = 14;
const PAD_BOTTOM = 26;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function showPrice(v: number): string {
  if (!Number.isFinite(v)) return '—';
  if (v >= 1_000_000 || (v > 0 && v < 0.0001)) return v.toExponential(4);
  return Number(v.toPrecision(7)).toString();
}

export default function DrawCanvas({ candles, onChange, locale, hint }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const lastPoint = useRef<{ index: number; price: number } | null>(null);
  const fixedBounds = useRef<Bounds | null>(null);

  const [canvasWidth, setCanvasWidth] = useState(900);
  const [viewStart, setViewStart] = useState(0);
  const [visibleCount, setVisibleCount] = useState(120);
  const [hoverIdx, setHoverIdx] = useState(-1);

  const ind = useMemo(() => computeIndicators(candles), [candles]);
  const capacity = Math.max(16, Math.floor((canvasWidth - PAD_LEFT - PAD_RIGHT) / 5));
  const windowSize = Math.min(candles.length, Math.max(16, Math.round(Math.min(visibleCount, capacity))));
  const safeStart = Math.round(clamp(viewStart, 0, Math.max(0, candles.length - windowSize)));
  const visible = useMemo(
    () => candles.slice(safeStart, safeStart + windowSize),
    [candles, safeStart, windowSize]
  );

  const anchor = candles[0]?.open || 1;
  const { minimumPrice, maximumPrice, decimals } = useMemo(() => {
    let min = Infinity,
      max = 0,
      scale = 8;
    for (const c of candles) {
      for (const value of [c.open, c.close, c.high, c.low])
        if (Number(value.toFixed(8)) !== value) scale = 12;
      min = Math.min(min, c.execution?.minimumPrice ?? Math.min(1e-8, c.low), c.low);
      max = Math.max(max, c.execution?.maximumPrice ?? anchor * 25, c.high);
    }
    return { minimumPrice: min, maximumPrice: max, decimals: scale };
  }, [candles, anchor]);

  const bounds = useMemo<Bounds>(() => {
    if (!visible.length) return { min: anchor * 0.9, max: anchor * 1.1 };
    let lo = Infinity;
    let hi = 0;
    for (const c of visible) {
      if (c.low < lo) lo = c.low;
      if (c.high > hi) hi = c.high;
    }
    const span = Math.max(hi - lo, anchor * 0.005, 1e-8);
    return { min: Math.max(1e-8, lo - span * 0.14), max: hi + span * 0.14 };
  }, [visible, anchor]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver((entries) => {
      setCanvasWidth(Math.max(1, Math.floor(entries[0].contentRect.width)));
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const plotWidth = width - PAD_LEFT - PAD_RIGHT;
    const top = 18;
    const priceBottom = height * 0.72;
    const macTop = height * 0.79;
    const macBottom = height - PAD_BOTTOM;
    const yOf = (p: number) =>
      top + ((bounds.max - p) / Math.max(1e-12, bounds.max - bounds.min)) * (priceBottom - top);

    ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'left';
    for (let i = 0; i <= 5; i++) {
      const price = bounds.max - ((bounds.max - bounds.min) * i) / 5;
      const y = yOf(price);
      ctx.strokeStyle = '#182520';
      ctx.beginPath();
      ctx.moveTo(PAD_LEFT, y);
      ctx.lineTo(width - PAD_RIGHT, y);
      ctx.stroke();
      ctx.fillStyle = '#8aa098';
      ctx.fillText(showPrice(price), 6, y + 4);
    }

    if (!visible.length) return;
    const xOf = (i: number) => PAD_LEFT + ((i + 0.5) / visible.length) * plotWidth;
    const bodyWidth = Math.max(1.5, Math.min(10, (plotWidth / visible.length) * 0.65));

    visible.forEach((c, i) => {
      const x = xOf(i);
      ctx.strokeStyle = ctx.fillStyle = c.close >= c.open ? '#2dd4bf' : '#fb7185';
      ctx.beginPath();
      ctx.moveTo(x, yOf(c.high));
      ctx.lineTo(x, yOf(c.low));
      ctx.stroke();
      const yTop = yOf(Math.max(c.open, c.close));
      const bodyH = Math.max(1.5, Math.abs(yOf(c.open) - yOf(c.close)));
      ctx.fillRect(x - bodyWidth / 2, yTop, bodyWidth, bodyH);
    });

    for (const [series, color] of [
      [ind.ema7, '#eab85f'],
      [ind.ema25, '#5bb9ee'],
      [ind.ema99, '#c58bdf']
    ] as const) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(PAD_LEFT, top, plotWidth, priceBottom - top);
      ctx.clip();
      ctx.beginPath();
      for (let i = 0; i < visible.length; i++) {
        const x = xOf(i);
        const y = yOf(series[safeStart + i]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.restore();
    }

    const macd = ind.histogram.slice(safeStart, safeStart + windowSize);
    const dif = ind.dif.slice(safeStart, safeStart + windowSize);
    const dea = ind.dea.slice(safeStart, safeStart + windowSize);
    const peak = Math.max(1e-12, ...macd.map(Math.abs), ...dif.map(Math.abs), ...dea.map(Math.abs));
    const macY = (n: number) => (macTop + macBottom) / 2 - (n / peak) * (macBottom - macTop) * 0.44;

    ctx.strokeStyle = '#22332c';
    ctx.beginPath();
    ctx.moveTo(PAD_LEFT, macY(0));
    ctx.lineTo(width - PAD_RIGHT, macY(0));
    ctx.stroke();

    for (let i = 0; i < macd.length; i++) {
      ctx.fillStyle = macd[i] >= 0 ? '#2dd4bf' : '#fb7185';
      const y0 = macY(0);
      const y1 = macY(macd[i]);
      ctx.fillRect(
        xOf(i) - bodyWidth * 0.35,
        Math.min(y0, y1),
        Math.max(1, bodyWidth * 0.7),
        Math.max(1, Math.abs(y1 - y0))
      );
    }

    for (const [series, color] of [
      [dif, '#5bb9ee'],
      [dea, '#eab85f']
    ] as const) {
      ctx.beginPath();
      for (let i = 0; i < series.length; i++) {
        if (i === 0) ctx.moveTo(xOf(i), macY(series[i]));
        else ctx.lineTo(xOf(i), macY(series[i]));
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    ctx.fillStyle = '#8aa098';
    ctx.fillText('MACD', 8, macTop + 10);

    const timeStr = (c: Candle) =>
      new Date(c.openTime).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
    ctx.textAlign = 'left';
    ctx.fillText(timeStr(visible[0]), PAD_LEFT, height - 6);
    ctx.textAlign = 'right';
    ctx.fillText(timeStr(visible[visible.length - 1]), width - PAD_RIGHT, height - 6);

    if (hoverIdx >= 0 && hoverIdx < visible.length) {
      const x = xOf(hoverIdx);
      ctx.strokeStyle = '#6f857c';
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, macBottom);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }, [visible, bounds, ind, safeStart, windowSize, canvasWidth, hoverIdx, locale]);

  function paintAt(event: PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || !visible.length) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const scale = fixedBounds.current ?? bounds;
    const localIdx = Math.round(
      clamp((event.clientX - rect.left - PAD_LEFT) / (rect.width - PAD_LEFT - PAD_RIGHT), 0, 1) *
        Math.max(0, visible.length - 1)
    );
    const price = clamp(
      scale.max -
        clamp((event.clientY - rect.top - 18) / (rect.height * 0.72 - 18), 0, 1) * (scale.max - scale.min),
      minimumPrice,
      maximumPrice
    );

    const current = { index: safeStart + localIdx, price };
    const prev = lastPoint.current ?? current;
    const from = Math.min(prev.index, current.index);
    const until = Math.max(prev.index, current.index);
    const next = candles.slice();

    for (let i = from; i <= until; i++) {
      const t = current.index === prev.index ? 1 : (i - prev.index) / (current.index - prev.index);
      const close = Math.max(
        minimumPrice,
        Math.min(maximumPrice, Number((prev.price + (current.price - prev.price) * t).toFixed(decimals)))
      );
      const open = i > 0 ? next[i - 1].close : next[0].open;
      const high = Math.min(maximumPrice, Math.max(open, close, next[i].high));
      const low = Math.max(minimumPrice, Math.min(open, close, next[i].low));
      const updated: Candle = { ...next[i], open, high, low, close, execution: undefined };
      next[i] = {
        ...updated,
        execution: createManualExecution(updated, minimumPrice, maximumPrice, decimals)
      };
    }

    if (until + 1 < next.length) {
      const i = until + 1;
      const open = next[i - 1].close;
      const updated: Candle = {
        ...next[i],
        open,
        high: Math.max(next[i].high, open),
        low: Math.min(next[i].low, open),
        execution: undefined
      };
      next[i] = {
        ...updated,
        execution: createManualExecution(updated, minimumPrice, maximumPrice, decimals)
      };
    }

    lastPoint.current = current;
    onChange(next);
  }

  const hovered = visible[hoverIdx];

  return (
    <div className="chart-shell">
      <div className="chart-overlay-bar">
        <span className="draw-hint">{hint}</span>
        <div className="ohlc-readout">
          {hovered
            ? `O ${showPrice(hovered.open)}   H ${showPrice(hovered.high)}   L ${showPrice(hovered.low)}   C ${showPrice(hovered.close)}`
            : '—'}
        </div>
      </div>
      <canvas
        ref={canvasRef}
        className="draw-canvas"
        aria-label={hint}
        onWheel={(e: WheelEvent<HTMLCanvasElement>) => {
          e.preventDefault();
          if (!candles.length) return;
          if (e.shiftKey) {
            setViewStart((n) =>
              clamp(
                n + Math.sign(e.deltaY) * Math.max(1, Math.round(windowSize * 0.2)),
                0,
                candles.length - windowSize
              )
            );
          } else {
            setVisibleCount((n) => clamp(n * (e.deltaY > 0 ? 1.35 : 0.72), 16, capacity));
          }
        }}
        onPointerDown={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          if (e.clientY - rect.top > rect.height * 0.72) return;
          drawing.current = true;
          fixedBounds.current = bounds;
          lastPoint.current = null;
          e.currentTarget.setPointerCapture(e.pointerId);
          paintAt(e);
        }}
        onPointerMove={(e) => {
          if (drawing.current) {
            paintAt(e);
          } else {
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = clamp(
              (e.clientX - rect.left - PAD_LEFT) / (rect.width - PAD_LEFT - PAD_RIGHT),
              0,
              0.9999
            );
            setHoverIdx(Math.floor(ratio * visible.length));
          }
        }}
        onPointerUp={() => {
          drawing.current = false;
          fixedBounds.current = null;
          lastPoint.current = null;
        }}
        onPointerCancel={() => {
          drawing.current = false;
          fixedBounds.current = null;
        }}
        onPointerLeave={() => setHoverIdx(-1)}
      />
      {candles.length > windowSize && (
        <div className="chart-scrubber">
          <button type="button" onClick={() => setViewStart((n) => Math.max(0, n - windowSize))}>
            ←
          </button>
          <input
            type="range"
            aria-label={locale === 'zh' ? '手绘时间窗口' : 'Drawing time window'}
            min={0}
            max={Math.max(0, candles.length - windowSize)}
            value={safeStart}
            onChange={(e) => setViewStart(Number(e.target.value))}
          />
          <button
            type="button"
            onClick={() => setViewStart((n) => Math.min(candles.length - windowSize, n + windowSize))}
          >
            →
          </button>
        </div>
      )}
    </div>
  );
}
