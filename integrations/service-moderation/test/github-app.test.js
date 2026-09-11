import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { createAppJwt, createModerationIssue, issueBody } from "../src/github-app.js";
import { normalizeSubmission } from "../src/validation.js";
import { testEnv, validSubmission } from "./fixtures.js";

function testPrivateKey() {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return privateKey.export({ type: "pkcs8", format: "pem" });
}

test("creates a short-lived RS256 GitHub App JWT from a PKCS#8 key", async () => {
  const now = 1_800_000_000;
  const jwt = await createAppJwt("12345", testPrivateKey(), now);
  const parts = jwt.split(".");
  const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));

  assert.equal(parts.length, 3);
  assert.equal(payload.iss, "12345");
  assert.equal(payload.iat, now - 60);
  assert.equal(payload.exp, now + 540);
});

test("restricts the installation token and writes only the normalized private issue", async () => {
  const requests = [];
  const env = Object.assign({}, testEnv, {
    GITHUB_APP_ID: "12345",
    GITHUB_INSTALLATION_ID: "67890",
    GITHUB_PRIVATE_KEY_PKCS8: testPrivateKey()
  });
  const payload = normalizeSubmission(validSubmission()).issuePayload;

  const issue = await createModerationIssue(payload, env, async (url, options) => {
    requests.push({ url, options, body: options.body ? JSON.parse(options.body) : undefined });
    if (url.includes('/issues?')) return Response.json([]);
    if (url.endsWith('/repos/example-org/discrete-cash-services-moderation')) {
      return Response.json({ private: true, full_name: 'example-org/discrete-cash-services-moderation' });
    }
    if (url.includes("/access_tokens")) {
      return new Response(JSON.stringify({ token: "installation-token" }), {
        status: 201,
        headers: { "Content-Type": "application/json" }
      });
    }
    return new Response(JSON.stringify({ number: 19 }), {
      status: 201,
      headers: { "Content-Type": "application/json" }
    });
  });

  assert.equal(issue.number, 19);
  const issueRequest = requests.find(request => request.url.endsWith('/issues'));
  assert.deepEqual(requests[0].body, {
    repositories: ["discrete-cash-services-moderation"],
    permissions: { issues: "write" }
  });
  assert.equal(requests[0].options.headers["User-Agent"], "discrete-services-moderation/0.1");
  assert.match(issueRequest.url, /example-org\/discrete-cash-services-moderation\/issues$/);
  assert.equal(issueRequest.body.title, "[Service submission] Example Gateway");
  assert.match(issueRequest.body.body, /### At a glance/);
  assert.match(issueRequest.body.body, /<strong>Example Gateway<\/strong>/);
  assert.match(issueRequest.body.body, /### Moderator checklist/);
  assert.match(issueRequest.body.body, /comment containing only `\/prepare`/);
  assert.match(issueRequest.body.body, /<details>/);
  assert.match(issueRequest.body.body, /Machine-readable normalized record/);
  assert.equal(issueRequest.body.body.includes("verified-test-token"), false);
  assert.match(issueRequest.options.headers.Authorization, /^Bearer installation-token$/);
  assert.equal(issueRequest.options.headers["User-Agent"], "discrete-services-moderation/0.1");
});

test('refuses public storage and returns the original reference on a sequential retry', async () => {
  const env = { ...testEnv, GITHUB_APP_ID: '123', GITHUB_INSTALLATION_ID: '456', GITHUB_PRIVATE_KEY_PKCS8: testPrivateKey() };
  const payload = normalizeSubmission(validSubmission()).issuePayload;
  let privateRepo = false;
  let stored = [];
  let creates = 0;
  const transport = async (url, options) => {
    if (url.includes('/access_tokens')) return Response.json({ token: 'test-token' });
    if (url.includes('/issues?')) return Response.json(stored);
    if (url.endsWith('/issues')) {
      creates++;
      stored = [{ number: 23, body: JSON.parse(options.body).body }];
      return Response.json({ number: 23 });
    }
    return Response.json({ private: privateRepo, full_name: 'example-org/discrete-cash-services-moderation' });
  };
  await assert.rejects(createModerationIssue(payload, env, transport), /private repository/);
  assert.equal(creates, 0);
  privateRepo = true;
  assert.equal((await createModerationIssue(payload, env, transport)).number, 23);
  assert.equal((await createModerationIssue(payload, env, transport)).number, 23);
  assert.equal(creates, 1);
});

test("escapes submitted text in the human view and raw record", () => {
  const payload = normalizeSubmission(validSubmission({
    service: {
      summary: "</details>\n# Forged moderator heading",
      riskNotes: "Use <script>alert('no')</script>."
    }
  })).issuePayload;
  const body = issueBody(payload);

  assert.match(body, /<p>&lt;\/details&gt;<br># Forged moderator heading<\/p>/);
  assert.match(body, /Use &lt;script&gt;alert\(&#39;no&#39;\)&lt;\/script&gt;\./);
  assert.equal(body.includes('"summary": "</details>'), false);
  assert.match(body, /"summary": "\\u003c\/details\\u003e/);
});
