import assert from 'node:assert/strict';
import test from 'node:test';
import { authorizePrepare } from '../src/moderator-authorization.js';
import { handleRequest } from '../src/index.js';
import { publicationTarget } from '../scripts/publication-target.mjs';
import { validatePublicDiff } from '../scripts/check-public-diff.mjs';
import { configuration } from '../scripts/configure.mjs';
import { validSubmission, testEnv } from './fixtures.js';

test('moderation checks actual write permission and current private issue', async () => {
  const event = { issue: { number: 7 }, comment: { body: '/prepare', user: { login: 'moderator' } } };
  const env = { GITHUB_REPOSITORY: 'example-org/queue', GH_TOKEN: 'test-token' };
  let permission = 'read';
  let privateRepo = true;
  let readIssue = false;
  const transport = async url => {
    if (url.endsWith('/permission')) return Response.json({ permission });
    if (url.endsWith('/issues/7')) { readIssue = true; return Response.json({ number: 7, state: 'open', body: 'current body' }); }
    return Response.json({ private: privateRepo, full_name: env.GITHUB_REPOSITORY });
  };
  await assert.rejects(authorizePrepare(event, env, transport), /write authority/);
  assert.equal(readIssue, false);
  permission = 'write'; privateRepo = false;
  await assert.rejects(authorizePrepare(event, env, transport), /private repository/);
  privateRepo = true;
  assert.equal((await authorizePrepare(event, env, transport)).body, 'current body');
  await assert.rejects(authorizePrepare(event, env, async () => new Response('', { status: 403 })), /verify moderation authority/);
});

test('publication target defaults to the canonical site and rejects injected values', () => {
  assert.deepEqual(publicationTarget({}), { owner: 'discretecoin', repository: 'discrete-cash', branch: 'main', full_name: 'discretecoin/discrete-cash' });
  for (const env of [{ PUBLIC_REPO_OWNER: 'org\ninjected=x' }, { PUBLIC_BASE_BRANCH: '--exec' }, { PUBLIC_BASE_BRANCH: 'main..bad' }]) {
    assert.throws(() => publicationTarget(env), /Invalid/);
  }
});

test('setup requires maintainer identifiers and accepts only an HTTPS origin', () => {
  const args = ['--owner', 'example-org', '--repo', 'queue', '--worker', 'example-intake'];
  assert.equal(configuration(args).origin, 'https://discrete.cash');
  assert.throws(() => configuration([]), /Invalid/);
  for (const origin of ['http://example.com', 'https://user:pass@example.com', 'https://example.com/path']) {
    assert.throws(() => configuration([...args, '--origin', origin]), /Invalid/);
  }
});

test('public diff permits first image, record-only or image-only updates and no-op retries', () => {
  assert.equal(validatePublicDiff(' M services/catalog.js\0?? services/assets/previews/example.png\0', 'example'), true);
  assert.equal(validatePublicDiff(' M services/catalog.js\0', 'example'), true);
  assert.equal(validatePublicDiff(' M services/assets/previews/example.png\0', 'example'), true);
  assert.equal(validatePublicDiff('', 'example'), false);
  for (const diff of ['?? reviews/7/service.json\0', ' D services/catalog.js\0', '?? services/assets/previews/other.png\0']) {
    assert.throws(() => validatePublicDiff(diff, 'example'), /Unexpected/);
  }
});

test('server checks Turnstile action and hostname; upstream failures return no private details', async () => {
  const request = () => new Request('https://intake.example/v1/submissions', {
    method: 'POST', headers: { Origin: 'https://discrete.cash', 'Content-Type': 'application/json' }, body: JSON.stringify(validSubmission())
  });
  let created = 0;
  for (const result of [{ success: false }, { success: true, action: 'other', hostname: 'discrete.cash' }, { success: true, action: 'service_submission', hostname: 'attacker.example' }]) {
    const response = await handleRequest(request(), testEnv, { fetchRequest: async () => Response.json(result), createModerationIssue: async () => { created++; } });
    assert.equal(response.status, 403);
  }
  assert.equal(created, 0);
  const response = await handleRequest(request(), testEnv, {
    fetchRequest: async () => Response.json({ success: true, action: 'service_submission', hostname: 'discrete.cash' }),
    createModerationIssue: async () => { throw new Error('private URL and secret test detail'); }
  });
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: 'Moderation queue unavailable.' });
  const missingLimit = await handleRequest(request(), { ...testEnv, SUBMISSION_RATE_LIMIT: undefined });
  assert.equal(missingLimit.status, 502);
});
