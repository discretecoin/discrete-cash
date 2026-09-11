import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { issueBody } from "../src/github-app.js";
import { normalizeSubmission } from "../src/validation.js";
import { validSubmission } from "./fixtures.js";

test("prepare CLI emits separated review and screenshot inputs", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "discrete-service-review-"));
  const eventPath = path.join(temporary, "event.json");
  const outputPath = path.join(temporary, "output.txt");
  const preparedRoot = path.join(temporary, "prepared");
  const payload = normalizeSubmission(validSubmission()).issuePayload;
  const body = issueBody(payload).replace(/^- \[ \]/gm, "- [x]");
  await writeFile(eventPath, JSON.stringify({
    issue: { number: 19, state: "open", body },
    comment: { body: "/prepare", author_association: "OWNER" }
  }));
  await writeFile(outputPath, "");

  const result = spawnSync(process.execPath, ["scripts/prepare-review.mjs"], {
    cwd: path.resolve("."),
    encoding: "utf8",
    env: { ...process.env, GITHUB_ACTIONS: 'false', GITHUB_EVENT_PATH: eventPath, GITHUB_OUTPUT: outputPath, PREPARED_ROOT: preparedRoot }
  });
  assert.equal(result.status, 0, result.stderr);

  const review = JSON.parse(await readFile(path.join(preparedRoot, "review", "service.json"), "utf8"));
  const preview = JSON.parse(await readFile(path.join(preparedRoot, "preview", "preview-request.json"), "utf8"));
  const output = await readFile(outputPath, "utf8");
  assert.equal(review.name, "Example Gateway");
  assert.deepEqual(preview, { id: "example-gateway", url: "https://merchant.example/" });
  assert.equal(JSON.stringify(preview).includes("contact"), false);
  assert.match(output, /service_name_b64=RXhhbXBsZSBHYXRld2F5/);
  assert.match(output, /review_branch=service-review\/issue-19-example-gateway/);
});
