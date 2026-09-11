import assert from "node:assert/strict";
import test from "node:test";
import { issueBody } from "../src/github-app.js";
import { parsePreparedIssue, reviewReadme } from "../src/moderation-review.js";
import { assertPublicHostname, isPublicAddress } from "../src/public-network.js";
import { normalizeSubmission } from "../src/validation.js";
import { validSubmission } from "./fixtures.js";

function completedBody(payload) {
  return issueBody(payload).replace(/^- \[ \]/gm, "- [x]");
}

test("extracts only a checked and normalized service record", () => {
  const payload = normalizeSubmission(validSubmission()).issuePayload;
  const prepared = parsePreparedIssue(completedBody(payload));

  assert.deepEqual(prepared, payload);
  assert.equal(JSON.stringify(prepared).includes("turnstile"), false);
});

test("refuses preparation while a moderator check is incomplete", () => {
  const payload = normalizeSubmission(validSubmission()).issuePayload;
  assert.throws(() => parsePreparedIssue(issueBody(payload)), /Complete every moderator checkbox/);
});

test("refuses altered checklist text and schema additions", () => {
  const payload = normalizeSubmission(validSubmission()).issuePayload;
  const alteredChecklist = completedBody(payload).replace("Website opens", "Website maybe opens");
  assert.throws(() => parsePreparedIssue(alteredChecklist), /checklist was altered/);

  const alteredPayload = structuredClone(payload);
  alteredPayload.service.hidden = "not public";
  assert.throws(() => parsePreparedIssue(completedBody(alteredPayload)), /approved schema/);
});

test("renders a private review without submitter relationship data", () => {
  const payload = normalizeSubmission(validSubmission()).issuePayload;
  const readme = reviewReadme(payload.service, 19);

  assert.match(readme, /Private preview review: Example Gateway/);
  assert.match(readme, /\.\/example-gateway\.png/);
  assert.equal(readme.includes(payload.relationship), false);
});

test("blocks local, private, link-local, and documentation networks", () => {
  for (const address of ["127.0.0.1", "10.1.2.3", "169.254.169.254", "172.20.0.1", "192.168.1.1", "::1", "fc00::1", "2001:db8::1", "::ffff:7f00:1", "::ffff:127.0.0.1"]) {
    assert.equal(isPublicAddress(address), false, address);
  }
  for (const address of ["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) {
    assert.equal(isPublicAddress(address), true, address);
  }
  assert.throws(() => assertPublicHostname("localhost"), /not public/);
  assert.throws(() => assertPublicHostname("service.internal"), /not public/);
  assert.equal(assertPublicHostname("example.com"), "example.com");
});
