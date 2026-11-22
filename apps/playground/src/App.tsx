import { useEffect, useMemo, useState } from 'react';
import {
  computeStats,
  randomSeed,
  readOhlcWindow,
  type Candle,
  type CandleBridgeErrorCode,
  type GenerateOptions,
  type WorkerGenerateResponse
} from 'candlebridge';
import CandlestickChart from './components/CandlestickChart';
import DrawCanvas from './components/DrawCanvas';
import PathInspector from './components/PathInspector';
import ScenarioForm from './components/ScenarioForm';
import DataPanel from './components/DataPanel';
import { MESSAGES, detectLocale, showError, type Locale } from './i18n';
import { frameName, frames, newScenario, toOptions, type Scenario } from './scenario';

type Mode = 'generate' | 'draw' | 'data';
type Result = {
  bars: Candle[];
  interval: number;
  options: GenerateOptions | null;
  source: 'generated' | 'edited' | 'imported';
  ms: number;
  symbol?: string;
};
const initial = newScenario();
function initialLocale(): Locale {
  const query = new URLSearchParams(location.search).get('lang');
  if (query === 'zh' || query === 'en') return query;
  try {
    const stored = localStorage.getItem('cb-language');
    return stored === 'zh' || stored === 'en' ? stored : detectLocale();
  } catch {
    return detectLocale();
  }
}
const price = (n: number) =>
  Number(n.toPrecision(7)).toLocaleString('en-US', { maximumSignificantDigits: 7 });

export default function App() {
  const [locale, setLocale] = useState(initialLocale),
    [scene, setScene] = useState(initial);
  const [mode, setMode] = useState<Mode>('generate'),
    [view, setView] = useState(3600),
    [overview, setOverview] = useState(true);
  const [job, setJob] = useState<GenerateOptions | null>(() => toOptions(initial));
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<Result>({
    bars: [],
    interval: 300,
    options: null,
    source: 'generated',
    ms: 0
  });
  const [error, setError] = useState<string | { msg: string; code?: CandleBridgeErrorCode }>(''),
    [cancelled, setCancelled] = useState(false);
  const t = MESSAGES[locale],
    zh = locale === 'zh';

  useEffect(() => {
    document.documentElement.lang = zh ? 'zh-CN' : 'en';
    try {
      localStorage.setItem('cb-language', locale);
    } catch {
      /* optional preference */
    }
  }, [locale, zh]);
  useEffect(() => {
    if (!job) return;
    let worker: Worker | undefined,
      timer: ReturnType<typeof setTimeout> | undefined,
      live = true;
    const fail = (msg: string, code?: CandleBridgeErrorCode) => {
      if (live) {
        setError({ msg, code });
        setJob(null);
      }
    };
    try {
      worker = new Worker(new URL('./generator.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data }: MessageEvent<WorkerGenerateResponse>) => {
        if (!live) return;
        if ('error' in data) {
          fail(data.error, data.code);
          return;
        }
        setResult({
          bars: data.candles,
          interval: job.intervalSeconds,
          options: job,
          ms: data.durationMs,
          source: 'generated'
        });
        setView(
          frames.find((n) => n >= job.intervalSeconds && (job.count * job.intervalSeconds) / n <= 250) ??
            job.intervalSeconds
        );
        setPage(0);
        setJob(null);
      };
      worker.onerror = () => fail('Worker failed / 生成线程出错');
      worker.onmessageerror = () => fail('Invalid worker reply / 无法读取生成结果');
      timer = setTimeout(
        () =>
          fail('Sampling timed out. Shorten the run or widen the bounds. / 生成超时，请缩短时长或放宽范围。'),
        90_000
      );
      worker.postMessage({ options: job });
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
    return () => {
      live = false;
      worker?.terminate();
      clearTimeout(timer);
    };
  }, [job]);

  const { bars } = result;
  const stats = useMemo(() => computeStats(bars), [bars]);
  const baseView = view === result.interval;
  const pageSize = 6000,
    totalView = Math.ceil(stats.durationMs / (view * 1000));
  const offset = Math.max(0, Math.min(page, Math.ceil(totalView / pageSize) - 1)) * pageSize;
  const chartBars = useMemo(
    () =>
      mode === 'draw'
        ? []
        : baseView
          ? bars.slice(offset, offset + pageSize)
          : readOhlcWindow(bars, view, offset, pageSize),
    [bars, view, mode, baseView, offset]
  );
  const run = (s: Scenario, reroll = false) => {
    const next = reroll ? { ...s, model: { ...s.model, seed: randomSeed() } } : s;
    setScene(next);
    setError('');
    setCancelled(false);
    setJob(toOptions(next));
  };
  const sizes = [...new Set([...frames, result.interval])].sort((a, b) => a - b);
  const intervalForDisplay = (count: number, interval: number) =>
    frames.find((n) => n >= interval && (count * interval) / n <= 24_000) ?? 86_400;
  const displayStatus = job
    ? t.btnGenerating
    : cancelled
      ? zh
        ? '已取消，上次结果已保留。'
        : 'Cancelled. Previous data retained.'
      : !bars.length
        ? '—'
        : result.source === 'generated'
          ? t.generatedMsg(bars.length, result.ms)
          : result.source === 'imported'
            ? t.importedMsg(bars.length)
            : zh
              ? '手绘已应用'
              : 'Drawing applied';
  const metrics = [
    [t.statPath, `${price(stats.startPrice)} → ${price(stats.endPrice)}`],
    [t.statReturn, `${stats.returnPct >= 0 ? '+' : ''}${stats.returnPct.toFixed(2)}%`],
    [t.statDrawdown, `${stats.maxDrawdownPct.toFixed(2)}%`],
    [t.statBalance, `${stats.bullishCount} / ${stats.bearishCount}`]
  ];
  return (
    <>
      <header className="mast">
        <div className="mast-inner">
          <div className="brand">
            <i aria-hidden className="mark">
              <b />
              <b />
              <b />
            </i>
            CandleBridge
          </div>
          <div className="mast-right">
            <span className="edition">
              PATH LAB <em>/</em> 0.1
            </span>
            <button className="language" onClick={() => setLocale(zh ? 'en' : 'zh')}>
              {zh ? 'English' : '中文'}
            </button>
          </div>
        </div>
      </header>
      <main>
        <div className="intro">
          <div>
            <div className="eyebrow">
              <i /> {zh ? '合成数据 · 开源算法实验室' : 'SYNTHETIC DATA  /  OPEN-SOURCE LAB'}
            </div>
            <h1>
              {zh ? 'K 线实验台' : 'Candlestick playground'}
              <span>.</span>
            </h1>
            <p>
              {zh
                ? '从一条价格路径生成多个周期的 K 线。固定种子可以重现，拖动影线下方的检查器可以查看盘中细节。'
                : 'One price path, many timeframes. Pin a seed to reproduce it, or inspect what happened inside a single candle.'}
            </p>
          </div>
        </div>
        <div className="lab">
          <aside className="settings">
            <nav className="modes" aria-label={zh ? '工作模式' : 'Workspace mode'}>
              {(
                [
                  ['generate', t.modeGenerate],
                  ['draw', t.modeDraw],
                  ['data', t.modeIo]
                ] as const
              ).map(([key, label]) => (
                <button key={key} aria-pressed={mode === key} onClick={() => setMode(key)}>
                  {label}
                </button>
              ))}
            </nav>
            {mode === 'generate' ? (
              <ScenarioForm
                locale={locale}
                scene={scene}
                setScene={setScene}
                run={run}
                busy={!!job}
                cancel={() => {
                  setJob(null);
                  setCancelled(true);
                }}
              />
            ) : mode === 'data' ? (
              <DataPanel
                candles={bars}
                locale={locale}
                options={result.options}
                symbol={result.symbol}
                fail={setError}
                onImport={(data) => {
                  setJob(null);
                  setPage(0);
                  setCancelled(false);
                  setError('');
                  setResult({
                    bars: data.candles,
                    interval: data.intervalSeconds,
                    options: null,
                    source: 'imported',
                    ms: 0,
                    symbol: data.symbol
                  });
                  setView(
                    data.candles.length > 24000
                      ? intervalForDisplay(data.candles.length, data.intervalSeconds)
                      : data.intervalSeconds
                  );
                }}
              />
            ) : (
              <div className="draw-panel">
                <div className="section-kicker">
                  <b>02</b> {zh ? '路径编辑' : 'PATH EDITOR'}
                </div>
                <h2>{t.modeDraw}</h2>
                <p>{t.drawHint}</p>
                <p>
                  {zh
                    ? '编辑作用于基础周期。下一根的开盘价会跟随上一根的收盘价，导出完整 JSON 可保存新路径。'
                    : 'Edit the base interval. Each edit reconnects the next open to the previous close. Export full JSON to keep the edited path.'}
                </p>
                <button onClick={() => setMode('data')}>{t.modeIo} →</button>
              </div>
            )}
            <div className="status" role={error ? 'alert' : 'status'}>
              <i className={error ? 'warn' : ''} />
              {(typeof error === 'string' ? error : showError(locale, error.msg, error.code)) ||
                displayStatus}
            </div>
          </aside>
          <div className="results">
            <div className="tape">
              <div>
                <div className="eyebrow">{zh ? '价格路径' : 'PRICE PATH'}</div>
                <h2>{result.symbol || (zh ? '合成行情' : 'Synthetic market')}</h2>
              </div>
              <div className="meta">
                {bars.length.toLocaleString()} {zh ? '根' : 'bars'} <span>·</span>{' '}
                {frameName(result.interval)}
              </div>
            </div>
            <div className="metrics">
              {metrics.map(([name, val], i) => (
                <div key={name}>
                  <small>{name}</small>
                  <strong className={i === 1 ? (stats.returnPct < 0 ? 'negative' : 'positive') : ''}>
                    {bars.length ? val : '—'}
                  </strong>
                </div>
              ))}
            </div>
            {mode !== 'draw' && (
              <div className="toolbar">
                <div className="frames" aria-label={t.resampleLabel}>
                  {sizes.map((n) => (
                    <button
                      key={n}
                      aria-pressed={view === n}
                      onClick={() => {
                        setView(n);
                        setPage(0);
                      }}
                    >
                      {frameName(n)}
                    </button>
                  ))}
                </div>
                <button aria-pressed={overview} onClick={() => setOverview(!overview)}>
                  {overview ? t.viewOverview : t.viewCandles} ⇄
                </button>
              </div>
            )}
            {mode !== 'draw' && totalView > pageSize && (
              <div className="view-pages">
                <button
                  disabled={offset === 0}
                  aria-label={zh ? '上一页' : 'Previous page'}
                  onClick={() => setPage((p) => p - 1)}
                >
                  ←
                </button>
                <span>
                  {offset + 1}–{Math.min(offset + pageSize, totalView)} / {totalView} ·{' '}
                  {zh ? '指标按本页计算' : 'Indicators use this page'}
                </span>
                <button
                  disabled={offset + pageSize >= totalView}
                  aria-label={zh ? '下一页' : 'Next page'}
                  onClick={() => setPage((p) => p + 1)}
                >
                  →
                </button>
              </div>
            )}
            {mode !== 'draw' ? (
              <CandlestickChart candles={chartBars} overview={overview} locale={locale} />
            ) : bars.length > 24000 ? (
              <p>
                {zh
                  ? '手绘最多支持 24,000 根；较长导入仍可预览和导出。'
                  : 'Drawing supports up to 24,000 bars; longer imports can still be previewed and exported.'}
              </p>
            ) : (
              <DrawCanvas
                candles={bars}
                locale={locale}
                hint={t.drawHint}
                onChange={(next) => {
                  setJob(null);
                  setError('');
                  setCancelled(false);
                  setResult({ ...result, bars: next, source: 'edited', options: null });
                }}
              />
            )}
            <PathInspector candles={bars} locale={locale} />
          </div>
        </div>
        <footer>
          <span>
            CandleBridge <i>/</i> MIT
          </span>
          <span>
            {zh ? '图表' : 'Charting'}:{' '}
            <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">
              TradingView Lightweight Charts™
            </a>{' '}
            ·{' '}
            <a href={`${import.meta.env.BASE_URL}third-party-notices.txt`}>{zh ? '第三方声明' : 'Notices'}</a>
          </span>
        </footer>
      </main>
    </>
  );
}
