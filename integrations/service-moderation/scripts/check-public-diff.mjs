import { execFileSync } from 'node:child_process';
import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export function validatePublicDiff(status, id) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id || '')) throw new Error('Invalid service ID.');
  const records = status.split('\0').filter(Boolean);
  const allowed = new Set(['services/catalog.js', 'services/assets/previews/' + id + '.png']);
  for (const record of records) {
    if (![' M', '??'].includes(record.slice(0, 2)) || !allowed.has(record.slice(3))) {
      throw new Error('Unexpected public file change.');
    }
  }
  if (records.length > 2) throw new Error('Unexpected public diff size.');
  return records.length > 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const status = execFileSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { encoding: 'utf8' });
  const changed = validatePublicDiff(status, process.env.SERVICE_ID);
  await appendFile(process.env.GITHUB_OUTPUT, 'changed=' + changed + '\n');
}
