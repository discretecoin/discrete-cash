import assert from 'node:assert/strict';
import test from 'node:test';
import { pinnedAddress, publicResource } from '../src/preview-network.js';

test('preview pins a checked public address and rejects mixed/private DNS results', async () => {
  const answer = { address: '1.1.1.1', family: 4 };
  assert.deepEqual(await pinnedAddress('example.com', async () => [answer]), answer);
  for (const answers of [[], [{ address: '127.0.0.1', family: 4 }], [answer, { address: '10.1.2.3', family: 4 }]]) {
    await assert.rejects(pinnedAddress('example.com', async () => answers), /public addresses/);
  }
  for (const url of ['http://user:pass@example.com', 'https://example.com:8080', 'file:///etc/hosts']) {
    await assert.rejects(publicResource(url), /not allowed/);
  }
});
