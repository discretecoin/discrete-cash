const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const frontend = require('../services/services.js');
const backend = file => import(pathToFileURL(path.join(__dirname, '../integrations/service-moderation', file)).href);

test('shipped catalog and approved backend record use the same frontend schema', async () => {
  const publisher = await backend('src/publication.js');
  const fixtures = await backend('test/fixtures.js');
  const validation = await backend('src/validation.js');
  const catalog = publisher.parseCatalogModule(fs.readFileSync(path.join(__dirname,'../services/catalog.js'),'utf8'));
  assert.ok(Array.isArray(catalog));
  const record = validation.normalizeSubmission(fixtures.validSubmission()).issuePayload.service;
  assert.deepEqual(frontend.normalizeCatalogRecord(record), record);
  assert.deepEqual(publisher.parseCatalogModule(publisher.renderCatalogModule([record])), [record]);
});
