import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { normalizeModerationPayload } from "../src/moderation-review.js";

const [recordDirectory, screenshotPath, destinationRoot] = process.argv.slice(2);
if (!recordDirectory || !screenshotPath || !destinationRoot) throw new Error("Review package paths are required.");

const service = JSON.parse(await readFile(path.join(recordDirectory, "service.json"), "utf8"));
const metadata = JSON.parse(await readFile(path.join(recordDirectory, "metadata.json"), "utf8"));
const normalized = normalizeModerationPayload({ schemaVersion: 1, relationship: "Community nomination", service }).service;
if (normalized.id !== metadata.serviceId || !Number.isSafeInteger(metadata.issueNumber) || metadata.issueNumber < 1) {
  throw new Error("Review package metadata is invalid.");
}

const root = path.resolve(destinationRoot);
const destination = path.resolve(root, String(metadata.issueNumber));
if (!destination.startsWith(root + path.sep)) throw new Error("Review destination is invalid.");
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await copyFile(path.join(recordDirectory, "service.json"), path.join(destination, "service.json"));
await copyFile(path.join(recordDirectory, "README.md"), path.join(destination, "README.md"));
await copyFile(screenshotPath, path.join(destination, normalized.id + ".png"));
