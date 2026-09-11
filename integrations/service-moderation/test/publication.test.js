import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  parseCatalogModule,
  pngDimensions,
  publicationIdentity,
  renderCatalogModule,
  upsertPublishedService
} from "../src/publication.js";
import { normalizeSubmission } from "../src/validation.js";
import { validSubmission } from "./fixtures.js";

function previewPng(width = 2880, height = 1800) {
  const bytes = Buffer.alloc(1_024);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

test("upserts normalized services into a deterministic generated catalog", () => {
  const service = normalizeSubmission(validSubmission()).issuePayload.service;
  const emptyModule = renderCatalogModule([]);
  assert.deepEqual(parseCatalogModule(emptyModule), []);

  const updated = upsertPublishedService([], service);
  assert.deepEqual(parseCatalogModule(renderCatalogModule(updated)), [service]);
  assert.deepEqual(upsertPublishedService(updated, service), [service]);

  const collision = { ...service, id: "another-gateway", name: "Another Gateway", preview: "assets/previews/another-gateway.png" };
  assert.throws(() => upsertPublishedService(updated, collision), /already uses this public URL/);
  const multilineName = { ...service, id: "example-gateway", name: "Example\nGateway" };
  assert.throws(() => upsertPublishedService([], multilineName), /single line/);
});

test("parses the exact empty public catalog format with LF or CRLF", () => {
  const publicCatalog = `"use strict";

(function (root, factory) {
  const catalog = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = catalog;
  }

  if (root) {
    root.DiscreteServiceCatalog = catalog;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  return Object.freeze([]);
});
`;
  assert.deepEqual(parseCatalogModule(publicCatalog), []);
  assert.deepEqual(parseCatalogModule(publicCatalog.replace(/\n/g, "\r\n")), []);
});

test("validates review branch identity and PNG dimensions", () => {
  assert.deepEqual(publicationIdentity("service-review/issue-19-example-gateway"), {
    issueNumber: 19,
    serviceId: "example-gateway",
    publicationBranch: "service-catalog/issue-19-example-gateway"
  });
  assert.throws(() => publicationIdentity("feature/example-gateway"), /workflow-owned format/);
  assert.deepEqual(pngDimensions(previewPng()), { width: 2880, height: 1800 });
  assert.throws(() => pngDimensions(Buffer.from("not a png")), /valid PNG/);
});

test("apply publication CLI writes only the generated catalog and fixed preview", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "discrete-publication-"));
  const publication = path.join(temporary, "publication");
  const publicRepository = path.join(temporary, "public");
  await mkdir(path.join(publication), { recursive: true });
  await mkdir(path.join(publicRepository, "services", "assets", "previews"), { recursive: true });

  const service = normalizeSubmission(validSubmission()).issuePayload.service;
  await writeFile(path.join(publication, "service.json"), JSON.stringify(service));
  await writeFile(path.join(publication, "metadata.json"), JSON.stringify({
    issueNumber: 19,
    serviceId: service.id,
    serviceName: service.name,
    publicationBranch: "service-catalog/issue-19-example-gateway"
  }));
  await writeFile(path.join(publication, "preview.png"), previewPng());
  await writeFile(path.join(publicRepository, "services", "catalog.js"), renderCatalogModule([]));

  const result = spawnSync(process.execPath, ["scripts/apply-publication.mjs", publication, publicRepository], {
    cwd: path.resolve("."),
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(parseCatalogModule(await readFile(path.join(publicRepository, "services", "catalog.js"), "utf8")), [service]);
  assert.deepEqual(pngDimensions(await readFile(path.join(publicRepository, "services", service.preview))), { width: 2880, height: 1800 });
});
