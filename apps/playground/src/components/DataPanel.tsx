import { useRef, useState } from 'react';
import {
  CandleBridgeError,
  parseCandlesJson,
  serializeCandlesCsv,
  serializeCandlesJson,
  type Candle,
  type GenerateOptions,
  type ParsedCandleSet
} from 'candlebridge';
import { MESSAGES, showError, type Locale } from '../i18n';
import { codeFor } from '../scenario';

function download(name: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function DataPanel({
  locale,
  candles,
  options,
  symbol,
  onImport,
  fail
}: {
  locale: Locale;
  candles: Candle[];
  options: GenerateOptions | null;
  symbol?: string;
  onImport: (set: ParsedCandleSet) => void;
  fail: (message: string) => void;
}) {
  const t = MESSAGES[locale],
    zh = locale === 'zh';
  const file = useRef<HTMLInputElement>(null),
    [copied, setCopied] = useState(false);
  const snippet = codeFor(options);
  return (
    <div className="data-panel">
      <div className="section-kicker">
        <b>03</b> {zh ? '数据工作台' : 'DATA EXCHANGE'}
      </div>
      <h2>{t.importTitle}</h2>
      <p>{t.importDesc}</p>
      <input
        ref={file}
        type="file"
        accept=".json,application/json"
        aria-label={t.chooseFile}
        hidden
        onChange={async (e) => {
          const picked = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (!picked) return;
          try {
            if (picked.size > 90 * 1024 * 1024)
              throw Error(zh ? '文件超过 90 MiB。' : 'File exceeds 90 MiB.');
            onImport(parseCandlesJson(await picked.text()));
          } catch (err) {
            fail(
              showError(
                locale,
                err instanceof Error ? err.message : String(err),
                err instanceof CandleBridgeError ? err.code : undefined
              )
            );
          }
        }}
      />
      <div className="actions">
        <button onClick={() => file.current?.click()}>{t.chooseFile}</button>
        <button
          onClick={() =>
            download(
              'sample.json',
              JSON.stringify({
                intervalSeconds: 300,
                candles: [
                  [100, 103, 99, 102],
                  [102, 104, 101, 103]
                ]
              }),
              'application/json'
            )
          }
        >
          {t.downloadSample}
        </button>
      </div>
      <h3>{t.exportTitle}</h3>
      <div className="export-buttons">
        <button
          disabled={!candles.length}
          onClick={() =>
            download('candlebridge.json', serializeCandlesJson(candles, { symbol }), 'application/json')
          }
        >
          {t.exportJsonFull}
        </button>
        <button
          disabled={!candles.length}
          onClick={() =>
            download(
              'candlebridge-ohlc.json',
              serializeCandlesJson(candles, { includeExecution: false, symbol }),
              'application/json'
            )
          }
        >
          {t.exportJsonOhlc}
        </button>
        <button
          disabled={!candles.length}
          onClick={() =>
            download(
              'klines.json',
              serializeCandlesJson(candles, { format: 'klines', symbol }),
              'application/json'
            )
          }
        >
          {zh ? '导出兼容格式（klines）' : 'Export legacy JSON (klines)'}
        </button>
        <button
          disabled={!candles.length}
          onClick={() => download('candlebridge.csv', serializeCandlesCsv(candles), 'text/csv')}
        >
          {t.exportCsv}
        </button>
      </div>
      <h3>{t.codeTitle}</h3>
      <p>
        {options
          ? zh
            ? '用同一组参数重现图上的原始数据。'
            : 'Recreate the displayed dataset with the same options.'
          : zh
            ? '数据已经编辑或导入；请从完整 JSON 恢复。'
            : 'Edited or imported data: load the full JSON export to reproduce it.'}
      </p>
      <pre>
        <code>{snippet}</code>
      </pre>
      <button
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(snippet);
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          } catch {
            fail(
              zh
                ? '无法访问剪贴板，可以手动复制代码。'
                : 'Clipboard unavailable. Select the code to copy it manually.'
            );
          }
        }}
      >
        {copied ? t.copied : t.copyCode}
      </button>
    </div>
  );
}
