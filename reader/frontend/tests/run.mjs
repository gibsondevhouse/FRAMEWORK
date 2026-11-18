import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { rolldown } from 'rolldown';

const testDir = dirname(fileURLToPath(import.meta.url));
const testEntry = resolve(testDir, 'unit.test.ts');
const workDir = mkdtempSync(join(tmpdir(), 'framework-fe-test-'));
const outFile = join(workDir, 'unit.test.mjs');

try {
  const bundle = await rolldown({
    input: testEntry,
    external: (id) => id.startsWith('node:'),
  });
  await bundle.write({
    file: outFile,
    format: 'esm',
    sourcemap: 'inline',
  });
  await bundle.close();

  const res = spawnSync(process.execPath, ['--test', outFile], {
    stdio: 'inherit',
  });
  process.exitCode = res.status ?? 1;
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
