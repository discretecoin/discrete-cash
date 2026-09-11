"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const catalog = require("../services/catalog.js");
const services = require("../services/services.js");

const root = path.resolve(__dirname, "..");
const page = fs.readFileSync(path.join(root, "services/index.html"), "utf8");
const sample = {
  id: "example-metrics",
  name: "Example Metrics",
  url: "https://metrics.example/",
  category: "Analytics",
  operator: "Example operator",
  summary: "A synthetic record used only for validation.",
  preview: "assets/previews/example-metrics.png",
  serviceType: "Network metrics",
  access: "Public",
  fundHandling: "No custody",
  contact: "",
  sourceUrl: "",
  riskNotes: "Example data may be delayed."
};

test("published records validate, have unique IDs, and reference local PNG files", () => {
  assert.ok(Array.isArray(catalog));
  const ids = new Set();
  for (const raw of catalog) {
    const record = services.normalizeCatalogRecord(raw);
    assert.ok(!ids.has(record.id), "Duplicate service ID: " + record.id);
    ids.add(record.id);
    const preview = fs.readFileSync(path.join(root, "services", record.preview));
    assert.deepEqual(preview.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
});

test("the catalog loads in a browser without CommonJS globals", () => {
  const context = {};
  vm.runInNewContext(fs.readFileSync(path.join(root, "services/catalog.js"), "utf8"), context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.DiscreteServiceCatalog)), catalog);
});

test("a neutral record accepts optional public contact and source URLs", () => {
  assert.deepEqual(services.normalizeCatalogRecord(sample), sample);
  const record = services.normalizeCatalogRecord({ ...sample,
    contact: "contact@operator.example", sourceUrl: "https://code.example/project" });
  assert.equal(record.contact, "contact@operator.example");
  assert.equal(record.sourceUrl, "https://code.example/project");
  assert.equal(services.publicContact("https://operator.example/people/@team"), "https://operator.example/people/@team");
  assert.throws(() => services.publicContact("contact@operator.example?subject=test"));
});

test("catalog links reject executable schemes, insecure transport, and credentials", () => {
  for (const field of ["url", "contact", "sourceUrl"]) {
    for (const value of ["javascript:alert(1)", "data:text/html,test", "http://service.example", "https://user:secret@service.example"]) {
      assert.throws(() => services.normalizeCatalogRecord({ ...sample, [field]: value }));
    }
  }
});

test("preview paths cannot escape their directory or reference another service", () => {
  for (const preview of ["../image.png", "assets/previews/../image.png", "assets/previews/other.png", "https://images.example/image.png", "assets/previews/example-metrics.svg"]) {
    assert.throws(() => services.normalizeCatalogRecord({ ...sample, preview }));
  }
  assert.throws(() => services.normalizeCatalogRecord({ ...sample, id: "Invalid ID" }));
});

test("required descriptions and disclosures reject absent or excessive content", () => {
  for (const field of ["name", "operator", "summary", "riskNotes", "fundHandling"]) {
    assert.throws(() => services.normalizeCatalogRecord({ ...sample, [field]: "" }));
    assert.throws(() => services.normalizeCatalogRecord({ ...sample, [field]: "x".repeat(801) }));
  }
});

test("combined category and text filters normalize case, accents, and spacing", () => {
  const item = { category: "Analytics", text: "Example Café public metrics" };
  assert.equal(services.matchesDirectoryItem(item, "CAFE   PUBLIC", "analytics"), true);
  assert.equal(services.matchesDirectoryItem(item, "metrics", "Wallets"), false);
  assert.equal(services.matchesDirectoryItem(item, "missing", "all"), false);
  assert.equal(services.matchesDirectoryItem(item, "", "all"), true);
});

test("all local page assets and homepage directory links resolve", () => {
  for (const match of page.matchAll(/(?:src|href)="([^"#]+)"/g)) {
    const url = match[1].split(/[?#]/)[0];
    if (/^[a-z]+:/i.test(url)) continue;
    assert.ok(fs.existsSync(path.resolve(root, "services", url)), "Missing local resource: " + url);
  }
  const home = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.match(home, /id="dcMenu"[^>]*>\s*<a href="services\/"[^>]*>Ecosystem services<\/a>/);
  assert.match(home, /href="services\/"[^>]*>Ecosystem services<\/a>/);
});

test("the catalog page exposes no form, rating control, or remote submission script", () => {
  assert.doesNotMatch(page, /<form\b|type="submit"|name="rating"|src="https?:/i);
  assert.match(page, /A listing is not an endorsement\./);
});
