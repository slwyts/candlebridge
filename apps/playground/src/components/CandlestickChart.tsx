import { useEffect, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  TickMarkType,
  createChart,
  type IChartApi,
  type Time,
  type UTCTimestamp
} from 'lightweight-charts';
import { computeIndicators, type Candle } from 'candlebridge';
import type { Locale } from '../i18n';

interface Props {
  candles: Candle[];
  overview: boolean;
  locale: Locale;
}

const EMA_COLORS = ['#eab85f', '#5bb9ee', '#c58bdf'] as const;
const EMA_LABELS = ['EMA 7', 'EMA 25', 'EMA 99'] as const;

function formatPrice(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1_000_000 || (n > 0 && n < 0.0001)) return n.toExponential(4);
  const decimals = n < 0.01 ? 8 : n < 10 ? 5 : n < 1000 ? 3 : 2;
  return Number(n.toFixed(decimals)).toString();
}

function formatTime(unixSeconds: number, locale: Locale): string {
  return new Date(unixSeconds * 1000).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

export default function CandlestickChart({ candles, overview, locale }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ReturnType<IChartApi['addSeries']>[]>([]);
  const [showEma, setShowEma] = useState([true, true, true]);
  const [summary, setSummary] = useState('');
  const [windowEnd, setWindowEnd] = useState(0);
  const [windowWidth, setWindowWidth] = useState(140);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const chart = createChart(node, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: '#090e0d' },
        textColor: '#8aa098',
        attributionLogo: true
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: '#16221e' }
      },
      rightPriceScale: {
        borderColor: '#1f302a',
        minimumWidth: 82
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        minBarSpacing: 0.001,
        lockVisibleTimeRangeOnResize: true,
        borderColor: '#1f302a',
        tickMarkFormatter: (time: Time, type: TickMarkType) => {
          const d = new Date(Number(time) * 1000);
          const pad = (n: number) => String(n).padStart(2, '0');
          if (type === TickMarkType.Year) return String(d.getFullYear());
          if (type === TickMarkType.Month) return `${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
          if (type === TickMarkType.DayOfMonth) return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
          return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
        }
      },
      localization: {
        locale: locale === 'zh' ? 'zh-CN' : 'en-US',
        timeFormatter: (time: Time) => formatTime(Number(time), locale)
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false
      },
      handleScale: {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: true
      }
    });

    chartRef.current = chart;
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#2dd4bf',
      downColor: '#fb7185',
      wickUpColor: '#2dd4bf',
      wickDownColor: '#fb7185',
      borderVisible: false
    });
    const emaSeries = EMA_COLORS.map((color) =>
      chart.addSeries(LineSeries, {
        color,
        lineWidth: 1,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false
      })
    );
    const histogram = chart.addSeries(
      HistogramSeries,
      { lastValueVisible: false, priceLineVisible: false },
      1
    );
    const dif = chart.addSeries(
      LineSeries,
      { color: '#5bb9ee', lineWidth: 1, lastValueVisible: false, priceLineVisible: false },
      1
    );
    const dea = chart.addSeries(
      LineSeries,
      { color: '#eab85f', lineWidth: 1, lastValueVisible: false, priceLineVisible: false },
      1
    );

    seriesRef.current = [candleSeries, ...emaSeries, histogram, dif, dea];

    const resizePanes = () => {
      const panes = chart.panes();
      const height = node.clientHeight;
      panes[0]?.setHeight(Math.floor(height * 0.72));
      panes[1]?.setHeight(Math.floor(height * 0.24));
    };
    const observer = new ResizeObserver(resizePanes);
    observer.observe(node);
    resizePanes();

    chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (range) {
        setWindowEnd(Math.round(range.to));
        setWindowWidth(Math.max(10, Math.round(range.to - range.from)));
      }
    });

    chart.subscribeCrosshairMove((event) => {
      const point = event.seriesData.get(candleSeries);
      if (point && 'open' in point) {
        const prefix = event.time ? `${formatTime(Number(event.time), locale)}  ` : '';
        setSummary(
          `${prefix}O ${formatPrice(point.open)}   H ${formatPrice(point.high)}   L ${formatPrice(point.low)}   C ${formatPrice(point.close)}`
        );
      }
    });

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [locale]);

  useEffect(() => {
    const chart = chartRef.current;
    const [candleSeries, ...overlays] = seriesRef.current;
    if (!chart || !candleSeries) return;

    const data = candles.map((c) => ({
      time: Math.floor(c.openTime / 1000) as UTCTimestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close
    }));
    const refPrice = candles[0]?.open ?? 1;
    const precision = refPrice < 0.001 ? 8 : refPrice < 1 ? 6 : refPrice < 100 ? 4 : 2;
    candleSeries.applyOptions({
      priceFormat: { type: 'price', precision, minMove: 10 ** -precision }
    });
    candleSeries.setData(data);

    const ind = computeIndicators(candles);
    const seriesData = [ind.ema7, ind.ema25, ind.ema99, ind.histogram, ind.dif, ind.dea];
    seriesData.forEach((values, i) => {
      overlays[i].setData(
        values.map((v, j) => ({
          time: data[j].time,
          value: v,
          ...(i === 3 ? { color: v >= 0 ? '#2dd4bf' : '#fb7185' } : {})
        }))
      );
      if (i >= 3) {
        overlays[i].applyOptions({
          priceFormat: { type: 'price', precision, minMove: 10 ** -precision }
        });
      }
    });

    if (overview) {
      chart.timeScale().fitContent();
    } else {
      chart.timeScale().setVisibleLogicalRange({
        from: Math.max(-1, candles.length - 140),
        to: candles.length + 2
      });
    }

    const last = candles.at(-1);
    setSummary(
      last
        ? `O ${formatPrice(last.open)}   H ${formatPrice(last.high)}   L ${formatPrice(last.low)}   C ${formatPrice(last.close)}`
        : '—'
    );
  }, [candles, overview, locale]);

  useEffect(() => {
    showEma.forEach((visible, idx) => {
      seriesRef.current[idx + 1]?.applyOptions({ visible });
    });
  }, [showEma, locale]);

  const panTo = (end: number) => {
    chartRef.current?.timeScale().setVisibleLogicalRange({
      from: Math.max(-1, end - windowWidth),
      to: end + 2
    });
  };

  const maxIdx = Math.max(0, candles.length - 1);
  const clampedEnd = Math.min(Math.max(0, windowEnd), maxIdx);

  return (
    <div className="chart-shell">
      <div className="chart-overlay-bar">
        <div className="ema-toggles">
          {EMA_LABELS.map((label, idx) => (
            <label key={label} style={{ color: EMA_COLORS[idx] }}>
              <input
                type="checkbox"
                checked={showEma[idx]}
                onChange={(e) => setShowEma((prev) => prev.map((v, i) => (i === idx ? e.target.checked : v)))}
              />
              {label}
            </label>
          ))}
          <span className="macd-tag">MACD 12/26/9</span>
        </div>
        <div className="ohlc-readout">{summary || '—'}</div>
      </div>
      <div
        ref={containerRef}
        className="chart-host"
        role="img"
        aria-label={locale === 'zh' ? '合成 K 线、EMA 与 MACD' : 'Synthetic OHLC, EMA and MACD'}
      />
      <div className="chart-scrubber">
        <button type="button" onClick={() => panTo(Math.max(0, windowEnd - windowWidth * 0.8))}>
          ←
        </button>
        <input
          type="range"
          aria-label={locale === 'zh' ? '图表时间窗口' : 'Chart time window'}
          min={0}
          max={maxIdx}
          value={clampedEnd}
          onChange={(e) => panTo(Number(e.target.value))}
        />
        <button type="button" onClick={() => panTo(Math.min(maxIdx, windowEnd + windowWidth * 0.8))}>
          →
        </button>
      </div>
    </div>
  );
}
