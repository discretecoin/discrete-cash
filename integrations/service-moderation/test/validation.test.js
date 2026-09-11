import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSubmission } from "../src/validation.js";
import { validSubmission } from "./fixtures.js";

test("normalizes the public form payload for a private issue", () => {
  const normalized = normalizeSubmission(validSubmission());
  assert.equal(normalized.turnstileToken, "verified-test-token");
  assert.equal(normalized.issuePayload.service.id, "example-gateway");
  assert.equal(normalized.issuePayload.service.preview, "assets/previews/example-gateway.png");
  assert.equal(normalized.issuePayload.service.contact, "https://merchant.example/support");
  assert.equal(JSON.stringify(normalized.issuePayload).includes("turnstile"), false);
});

test("rejects schema smuggling and mismatched derived fields", () => {
  assert.throws(
    () => normalizeSubmission(validSubmission({ injected: true })),
    /unsupported fields/
  );
  assert.throws(
    () => normalizeSubmission(validSubmission({ service: { id: "different" } })),
    /does not match/
  );
  assert.throws(
    () => normalizeSubmission(validSubmission({ service: { preview: "https://merchant.example/preview.png" } })),
    /does not match/
  );
});

test("allows only credential-free HTTPS service URLs", () => {
  assert.throws(
    () => normalizeSubmission(validSubmission({ service: { url: "http://merchant.example/" } })),
    /must use HTTPS/
  );
  assert.throws(
    () => normalizeSubmission(validSubmission({ service: { url: "https://user:secret@merchant.example/" } })),
    /contain no credentials/
  );
});
