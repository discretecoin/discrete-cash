import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { deflateSync } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { issueBody } from '../src/github-app.js';
import { handleRequest } from '../src/index.js';
import { parseCatalogModule, renderCatalogModule } from '../src/publication.js';
import { validSubmission, testEnv } from './fixtures.js';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));

function fixturePng() {
  const chunk = (name, bytes) => {
    const type = Buffer.from(name);
    const data = Buffer.concat([type, bytes]);
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let i = 0; i < 8; i++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    const size = Buffer.alloc(4); size.writeUInt32BE(bytes.length);
    const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([size, data, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(2880); header.writeUInt32BE(1800, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.alloc((2880 * 3 + 1) * 1800))), chunk('IEND', Buffer.alloc(0))]);
}

test('synthetic intake passes private review and exact merged export, then publishes once', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'services-pipeline-'));
  const privateRepo = path.join(temporary, 'private');
  const site = path.join(temporary, 'site');
  await mkdir(privateRepo); await mkdir(path.join(site, 'services'), { recursive: true });
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Test Moderator', '-c', 'user.email=test@example.invalid', ...args], { cwd: privateRepo, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }).trim();
  const run = (name, args = [], env = {}, cwd = packageRoot) => spawnSync(process.execPath, [path.join(packageRoot, 'scripts', name), ...args], {
    cwd, encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: 'false', GITHUB_OUTPUT: path.join(temporary,'output'), ...env }
  });
  const succeeds = result => assert.equal(result.status, 0, result.stderr);
  let privateBody;
  const response = await handleRequest(new Request('https://intake.example/v1/submissions', {
    method: 'POST', headers: { Origin: 'https://discrete.cash', 'Content-Type': 'application/json' }, body: JSON.stringify(validSubmission())
  }), testEnv, { verifyTurnstile: async () => true, createModerationIssue: async payload => {
    privateBody = issueBody(payload); return { number: 7 };
  } });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { submissionId: 'MOD-7' });
  const eventPath = path.join(temporary, 'event.json');
  const prepared = path.join(temporary, 'prepared');
  const event = { issue: { number: 7, state: 'open', body: privateBody }, comment: { body: '/prepare', author_association: 'OWNER' } };
  await writeFile(eventPath, JSON.stringify(event));
  const prepareEnv = { GITHUB_EVENT_PATH: eventPath, PREPARED_ROOT: prepared };
  assert.notEqual(run('prepare-review.mjs', [], prepareEnv).status, 0, 'Unchecked submission must not prepare');
  event.issue.body = privateBody.replace(/^- \[ \]/gm, '- [x]');
  await writeFile(eventPath, JSON.stringify(event));
  succeeds(run('prepare-review.mjs', [], prepareEnv));
  const preview = JSON.parse(await readFile(path.join(prepared, 'preview/preview-request.json')));
  assert.deepEqual(Object.keys(preview).sort(), ['id','url']);
  const pngPath = path.join(temporary, 'synthetic.png');
  await writeFile(pngPath, fixturePng());
  git('init', '-b', 'main');
  await writeFile(path.join(privateRepo, 'README.md'), 'Synthetic private repository.\n');
  git('add', '.'); git('commit', '-m', 'Initialize fixture');
  const base = git('rev-parse', 'HEAD');
  const branch = 'service-review/issue-7-example-gateway';
  git('checkout', '-b', branch);
  succeeds(run('assemble-review.mjs', [path.join(prepared,'review'), pngPath, path.join(privateRepo,'reviews')]));
  git('add', 'reviews'); git('commit', '-m', 'Approve synthetic review');
  const head = git('rev-parse','HEAD');
  git('checkout','main'); git('merge','--no-ff',branch,'-m','Merge synthetic approval');
  const merge = git('rev-parse','HEAD');
  const exportEnv = { PR_BASE_SHA: base, PR_HEAD_SHA: head, PR_HEAD_REF: branch, PR_MERGE_SHA: merge };
  succeeds(run('export-approved-review.mjs', ['publication'], exportEnv, privateRepo));
  const publication = path.join(privateRepo,'publication');
  assert.deepEqual((await readdir(publication)).sort(), ['metadata.json','preview.png','service.json']);
  assert.equal((await readFile(path.join(publication,'service.json'),'utf8')).includes('relationship'), false);
  await writeFile(path.join(site,'services/catalog.js'), renderCatalogModule([]));
  succeeds(run('apply-publication.mjs', [publication,site]));
  const first = await readFile(path.join(site,'services/catalog.js'),'utf8');
  succeeds(run('apply-publication.mjs', [publication,site]));
  assert.equal(await readFile(path.join(site,'services/catalog.js'),'utf8'), first);
  assert.equal(parseCatalogModule(first).length, 1);
  // A post-approval edit cannot silently substitute another record in export.
  await writeFile(path.join(privateRepo,'reviews/7/service.json'), JSON.stringify({ ...validSubmission().service, summary:'Changed after approval' }));
  git('add','reviews'); git('commit','-m','Unapproved fixture edit');
  assert.notEqual(run('export-approved-review.mjs', ['publication-bad'], { ...exportEnv, PR_HEAD_SHA: git('rev-parse','HEAD') }, privateRepo).status, 0);
});
