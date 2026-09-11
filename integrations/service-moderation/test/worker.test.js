import assert from "node:assert/strict";
import test from "node:test";
import { handleRequest } from "../src/index.js";
import { testEnv, validSubmission } from "./fixtures.js";

function submissionRequest(body = validSubmission(), origin = "https://discrete.cash") {
  return new Request("https://intake.example/v1/submissions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(body)
  });
}

test("rejects origins outside the public site allowlist", async () => {
  const response = await handleRequest(submissionRequest(validSubmission(), "https://attacker.example"), testEnv);
  assert.equal(response.status, 403);
  assert.equal(response.headers.has("Access-Control-Allow-Origin"), false);
});

test("rejects an oversized body even without a Content-Length header", async () => {
  const request = new Request("https://intake.example/v1/submissions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://discrete.cash" },
    body: JSON.stringify({ padding: "x".repeat(20_001) })
  });
  request.headers.delete("Content-Length");

  const response = await handleRequest(request, testEnv);
  assert.equal(response.status, 413);
});

test("rate limits before Turnstile or GitHub work", async () => {
  let verified = false;
  let created = false;
  const response = await handleRequest(submissionRequest(), testEnv, {
    rateLimit: { limit: async () => ({ success: false }) },
    verifyTurnstile: async () => { verified = true; },
    createModerationIssue: async () => { created = true; }
  });

  assert.equal(response.status, 429);
  assert.equal(verified, false);
  assert.equal(created, false);
});

test("does not create an issue when Turnstile verification fails", async () => {
  let created = false;
  const response = await handleRequest(submissionRequest(), testEnv, {
    verifyTurnstile: async () => false,
    createModerationIssue: async () => { created = true; }
  });
  assert.equal(response.status, 403);
  assert.equal(created, false);
});

test("returns an opaque reference after creating a private issue", async () => {
  let captured;
  const response = await handleRequest(submissionRequest(), testEnv, {
    verifyTurnstile: async () => true,
    createModerationIssue: async (payload) => {
      captured = payload;
      return { number: 42 };
    }
  });

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { submissionId: "MOD-42" });
  assert.equal(captured.service.name, "Example Gateway");
  assert.equal(JSON.stringify(captured).includes("verified-test-token"), false);
});
