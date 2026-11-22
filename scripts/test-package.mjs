// Exercise the release archive as an offline third-party consumer, outside the workspace.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'candlebridge-pack-'));
const npm = (args, cwd) =>
  execFileSync(process.execPath, [process.env.npm_execpath, ...args], { cwd, encoding: 'utf8' });
try {
  npm(['pack', '--workspace=candlebridge', '--pack-destination', scratch, '--json'], root);
  const archives = readdirSync(scratch).filter((file) => file.endsWith('.tgz'));
  assert.equal(archives.length, 1);
  const [filename] = archives;
  npm(
    [
      'install',
      '--prefix',
      scratch,
      '--offline',
      '--no-audit',
      '--no-fund',
      '--ignore-scripts',
      join(scratch, filename)
    ],
    scratch
  );
  const installed = join(scratch, 'node_modules', 'candlebridge');
  assert.deepEqual(readdirSync(installed).sort(), ['LICENSE', 'README.md', 'dist', 'package.json']);
  for (const file of ['index.js', 'index.cjs', 'index.d.ts', 'index.d.cts', 'worker.js', 'worker.d.ts'])
    assert.ok(existsSync(join(installed, 'dist', file)), `Missing ${file}`);
  for (const ext of ['mts', 'cts'])
    copyFileSync(join(root, 'scripts', 'consumer.mts'), join(scratch, `consumer.${ext}`));
  execFileSync(
    process.execPath,
    [
      join(root, 'node_modules/typescript/bin/tsc'),
      '--module',
      'NodeNext',
      '--target',
      'ES2022',
      '--strict',
      'consumer.mts',
      'consumer.cts'
    ],
    { cwd: scratch, stdio: 'inherit' }
  );
  for (const ext of ['mjs', 'cjs'])
    execFileSync(process.execPath, [`consumer.${ext}`], { cwd: scratch, stdio: 'inherit' });
  console.log(
    `Verified ${filename}: clean install, ESM + CommonJS, both type declarations, worker and license.`
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
