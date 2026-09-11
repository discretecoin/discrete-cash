import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export function publicationTarget(env) {
  const owner = env.PUBLIC_REPO_OWNER || 'discretecoin';
  const repository = env.PUBLIC_REPO_NAME || 'discrete-cash';
  const branch = env.PUBLIC_BASE_BRANCH || 'main';
  if (!/^[A-Za-z0-9-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repository) ||
      !/^[A-Za-z0-9][A-Za-z0-9_./-]*$/.test(branch) || branch.includes('..') ||
      branch.endsWith('/') || branch.endsWith('.lock') || branch.includes('//')) {
    throw new Error('Invalid public publication target.');
  }
  return { owner, repository, branch, full_name: owner + '/' + repository };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const target = publicationTarget(process.env);
  if (!process.env.GITHUB_OUTPUT) throw new Error('GitHub output path is required.');
  await appendFile(process.env.GITHUB_OUTPUT,
    Object.entries(target).map(([key, value]) => key + '=' + value).join('\n') + '\n');
}
