/**
 * `tsc` copies no .sql, so the migrations the built server reads at startup have
 * to be put next to it by hand. The Dockerfile used to be the only place that
 * did this, which left `npm run start` unable to boot locally at all.
 */
import { cpSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
cpSync(path.join(root, 'src/db/migrations'), path.join(root, 'dist/db/migrations'), {
  recursive: true,
});
