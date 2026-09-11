import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { authorizePrepare } from "../src/moderator-authorization.js";
import { parsePreparedIssue, reviewReadme } from "../src/moderation-review.js";

const eventPath = process.env.GITHUB_EVENT_PATH;
const outputPath = process.env.GITHUB_OUTPUT;
if (!eventPath || !outputPath) throw new Error("GitHub event paths are required.");

const event = JSON.parse(await readFile(eventPath, "utf8"));
if (process.env.GITHUB_ACTIONS === "true") {
  event.issue = await authorizePrepare(event, process.env);
}
const association = event.comment && event.comment.author_association;
if (!event.issue || event.issue.pull_request || event.issue.state !== "open") {
  throw new Error("The prepare command must target an open issue.");
}
if (!event.comment || event.comment.body.trim() !== "/prepare") {
  throw new Error("The comment must contain only /prepare.");
}
if (!new Set(["OWNER", "MEMBER", "COLLABORATOR"]).has(association)) {
  throw new Error("The prepare command requires repository write authority.");
}

const issueNumber = Number(event.issue.number);
if (!Number.isSafeInteger(issueNumber) || issueNumber < 1) throw new Error("Issue number is invalid.");

const payload = parsePreparedIssue(event.issue.body);
const service = payload.service;
const root = path.resolve(process.env.PREPARED_ROOT || "prepared");
const reviewDirectory = path.join(root, "review");
const previewDirectory = path.join(root, "preview");
await mkdir(reviewDirectory, { recursive: true });
await mkdir(previewDirectory, { recursive: true });

await writeFile(path.join(reviewDirectory, "service.json"), JSON.stringify(service, null, 2) + "\n");
await writeFile(path.join(reviewDirectory, "README.md"), reviewReadme(service, issueNumber));
await writeFile(path.join(reviewDirectory, "metadata.json"), JSON.stringify({ issueNumber, serviceId: service.id }, null, 2) + "\n");
await writeFile(path.join(previewDirectory, "preview-request.json"), JSON.stringify({ id: service.id, url: service.url }, null, 2) + "\n");
await copyFile("scripts/capture-homepage.mjs", path.join(previewDirectory, "capture-homepage.mjs"));
await copyFile("src/public-network.js", path.join(previewDirectory, "public-network.js"));
await copyFile("src/preview-network.js", path.join(previewDirectory, "preview-network.js"));
await copyFile("screenshot-runner/package.json", path.join(previewDirectory, "package.json"));
await copyFile("screenshot-runner/package-lock.json", path.join(previewDirectory, "package-lock.json"));

const branch = "service-review/issue-" + issueNumber + "-" + service.id;
await writeFile(outputPath, [
  "issue_number=" + issueNumber,
  "service_id=" + service.id,
  "service_name_b64=" + Buffer.from(service.name, "utf8").toString("base64"),
  "review_branch=" + branch
].join("\n") + "\n", { flag: "a" });
