import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function configuration(args) {
  const values = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]; const value = args[i + 1];
    if (!['--owner','--repo','--worker','--origin','--rate-namespace'].includes(key) || !value || values[key]) {
      throw new Error('Use --owner OWNER --repo PRIVATE_REPO --worker WORKER_NAME [--origin HTTPS_ORIGIN] [--rate-namespace INTEGER].');
    }
    values[key] = value;
  }
  const owner = values['--owner']; const repo = values['--repo']; const worker = values['--worker'];
  const origin = new URL(values['--origin'] || 'https://discrete.cash');
  const namespace = values['--rate-namespace'] || '1001';
  if (!/^[A-Za-z0-9-]+$/.test(owner || '') || !/^[A-Za-z0-9_.-]+$/.test(repo || '') ||
      !/^[a-z0-9][a-z0-9-]{0,62}$/.test(worker || '') || !/^[1-9][0-9]{0,9}$/.test(namespace) ||
      origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') {
    throw new Error('Invalid owner, private repository, Worker name, namespace or HTTPS origin.');
  }
  return { owner, repo, worker, origin: origin.origin, hostname: origin.hostname, namespace };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = configuration(process.argv.slice(2));
  const configPath = fileURLToPath(new URL('../wrangler.jsonc', import.meta.url));
  const worker = JSON.parse(await readFile(configPath, 'utf8'));
  worker.name = config.worker;
  worker.vars.MODERATION_REPO_OWNER = config.owner;
  worker.vars.MODERATION_REPO_NAME = config.repo;
  worker.vars.ALLOWED_ORIGINS = config.origin;
  worker.vars.TURNSTILE_HOSTNAMES = config.hostname;
  worker.ratelimits[0].namespace_id = config.namespace;
  await writeFile(configPath, JSON.stringify(worker, null, 2) + '\n');
  console.log('Updated non-secret Worker settings. Repository visibility is verified on every submission.');
}
