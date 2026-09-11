"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const services = require("../services/services.js");

function exampleFields(overrides) {
  return Object.assign({
    serviceName: "Example Gateway",
    serviceUrl: "https://merchant.example/",
    category: "Payments",
    operator: "Example Operator",
    submitterRelationship: "Community nomination",
    description: "Creates payment requests for Discrete merchants.",
    serviceType: "Payment gateway",
    access: "Web and API",
    fundHandling: "Non-custodial",
    contact: "https://merchant.example/support",
    sourceUrl: "https://github.com/example/gateway",
    riskNotes: "Example information must be independently verified.",
    turnstileToken: "verified-test-token"
  }, overrides || {});
}

test("builds a structured private moderation payload", function () {
  const submission = services.buildServiceSubmission(exampleFields());

  assert.equal(submission.schemaVersion, 1);
  assert.equal(submission.relationship, "Community nomination");
  assert.equal(submission.service.id, "example-gateway");
  assert.equal(submission.service.category, "Payments");
  assert.equal(submission.service.serviceType, "Payment gateway");
  assert.equal(submission.service.preview, "assets/previews/example-gateway.png");
  assert.equal(submission.turnstileToken, "verified-test-token");
});

test("listing requests require credential-free HTTPS URLs", function () {
  const base = {
    serviceName: "Example",
    serviceUrl: "http://merchant.example/",
    category: "Payments",
    operator: "Operator",
    submitterRelationship: "Owner or operator",
    description: "Description",
    serviceType: "Payment gateway",
    access: "Web",
    fundHandling: "Non-custodial",
    contact: "",
    sourceUrl: "",
    riskNotes: "Risk disclosure"
  };

  assert.throws(function () { services.buildServiceSubmission(base); }, /must use HTTPS/);
  assert.throws(function () {
    services.buildServiceSubmission(Object.assign({}, base, {
      serviceUrl: "https://user:secret@merchant.example/"
    }));
  }, /contain no credentials/);
});

test("submission fields map to the same catalog schema used by service cards", function () {
  const record = services.buildCatalogRecord({
    serviceName: "Example Gateway",
    serviceUrl: "https://merchant.example/",
    category: "Payments",
    operator: "Example Operator",
    description: "Creates payment requests for Discrete merchants.",
    serviceType: "Payment gateway",
    access: "Web and API",
    fundHandling: "Non-custodial",
    contact: "https://merchant.example/support",
    sourceUrl: "https://github.com/example/gateway",
    riskNotes: "Example information must be independently verified."
  });

  assert.deepEqual(Object.keys(record), [
    "id", "name", "url", "category", "operator", "summary", "preview", "serviceType", "access",
    "fundHandling", "contact", "sourceUrl", "riskNotes"
  ]);
  assert.equal(record.id, "example-gateway");
  assert.equal(record.summary, "Creates payment requests for Discrete merchants.");
  assert.equal(record.preview, "assets/previews/example-gateway.png");
  assert.equal(record.fundHandling, "Non-custodial");
  assert.deepEqual(services.normalizeCatalogRecord(record), record);
});

test("does not duplicate the main service URL as a contact URL", function () {
  const fields = {
    serviceName: "Example Gateway",
    serviceUrl: "https://merchant.example",
    category: "Payments",
    operator: "Example Operator",
    submitterRelationship: "Owner or operator",
    description: "Creates payment requests for Discrete merchants.",
    serviceType: "Payment gateway",
    access: "Web",
    fundHandling: "Non-custodial",
    contact: "https://merchant.example/",
    sourceUrl: "",
    riskNotes: "Users verify each payment request before signing."
  };

  const record = services.buildCatalogRecord(fields);
  assert.equal(record.contact, "");
});

test("accepts a public support email and rejects malformed contacts", function () {
  assert.equal(services.publicContact("support@example.com"), "support@example.com");
  assert.equal(services.publicContact("https://example.com/support"), "https://example.com/support");
  assert.throws(function () { services.publicContact("support at example.com"); }, /email address or HTTPS URL|valid URL/);
  assert.throws(function () { services.publicContact("http://example.com/support"); }, /must use HTTPS/);
});

test("homepage previews map to deterministic local catalog assets", function () {
  assert.equal(services.catalogPreview("assets/previews/example.png", "example"), "assets/previews/example.png");
  assert.throws(function () { services.catalogPreview("https://example.com/preview.png", "example"); }, /local PNG/);
});

test("posts submissions only to the configured private intake endpoint", async function () {
  let request;
  const receipt = await services.submitPrivateIntake(exampleFields(), async function (url, options) {
    request = { url: url, options: options };
    return {
      ok: true,
      json: async function () { return { submissionId: "REQ-42" }; }
    };
  }, { endpoint: "https://intake.example/submissions" });

  assert.equal(receipt.submissionId, "REQ-42");
  assert.equal(request.url, "https://intake.example/submissions");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.credentials, "omit");
  assert.equal(request.options.referrerPolicy, "no-referrer");
  assert.deepEqual(JSON.parse(request.options.body), services.buildServiceSubmission(exampleFields()));
});

test("fails closed while private intake is not configured", async function () {
  await assert.rejects(
    services.submitPrivateIntake(exampleFields(), async function () {}, {}),
    /not connected/
  );
});

test("missing verification fails before sending any request", async function () {
  let requests = 0;
  await assert.rejects(services.submitPrivateIntake(exampleFields({ turnstileToken: "" }), async () => {
    requests += 1;
  }, { endpoint: "https://intake.example/submissions" }), /Anti-spam verification/);
  assert.equal(requests, 0);
});

test("failed requests are surfaced without automatic retry or changing entered data", async function () {
  const fields = exampleFields();
  const before = JSON.stringify(fields);
  let attempts = 0;
  const config = { endpoint: "https://intake.example/submissions" };
  await assert.rejects(services.submitPrivateIntake(fields, async () => {
    attempts += 1;
    return { ok: false };
  }, config), /did not accept/);
  assert.equal(attempts, 1);
  await assert.rejects(services.submitPrivateIntake(fields, async () => {
    throw new Error("Network failure");
  }, config), /Network failure/);
  assert.equal(JSON.stringify(fields), before);
  const receipt = await services.submitPrivateIntake({ ...fields, turnstileToken: "new-test-token" }, async () => {
    attempts += 1;
    return { ok: true, json: async () => ({ submissionId: "REQ-RETRY" }) };
  }, config);
  assert.equal(attempts, 2);
  assert.equal(receipt.submissionId, "REQ-RETRY");
});

test("does not expose public GitHub issue builders", function () {
  assert.equal(services.buildServiceIssue, undefined);
  assert.equal(services.buildFeedbackIssue, undefined);
});
