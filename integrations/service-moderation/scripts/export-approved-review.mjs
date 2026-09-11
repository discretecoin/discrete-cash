import { execFileSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizePublishedService, pngDimensions, publicationIdentity } from "../src/publication.js";

const [destinationRoot] = process.argv.slice(2);
if (!destinationRoot) throw new Error("Publication destination is required.");

const baseSha = String(process.env.PR_BASE_SHA || "");
const headSha = String(process.env.PR_HEAD_SHA || "");
const headRef = String(process.env.PR_HEAD_REF || "");
if (!/^[0-9a-f]{40}$/.test(baseSha) || !/^[0-9a-f]{40}$/.test(headSha)) {
  throw new Error("Pull request commit identifiers are invalid.");
}

const identity = publicationIdentity(headRef);
const reviewRoot = `reviews/${identity.issueNumber}`;
const servicePath = `${reviewRoot}/service.json`;

function gitText(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 2_000_000 }).trim();
}

function gitBytes(args) {
  return execFileSync("git", args, { encoding: null, maxBuffer: 6_000_000 });
}

const mergeSha = String(process.env.PR_MERGE_SHA || '');
if (process.env.GITHUB_ACTIONS === 'true' && !mergeSha) throw new Error('Merged commit is required.');
if (mergeSha && !/^[0-9a-f]{40}$/.test(mergeSha)) throw new Error('Merged commit is invalid.');
// The parent of the merged commit is stable even if the target branch advances.
const targetBase = mergeSha ? gitText(['rev-parse', mergeSha + '^1']) : baseSha;
const mergeBase = gitText(["merge-base", targetBase, headSha]);
const changedPaths = gitText(["diff", "--name-only", mergeBase, headSha])
  .split(/\r?\n/)
  .filter(Boolean);

const service = normalizePublishedService(JSON.parse(gitText(["show", `${headSha}:${servicePath}`])));
if (service.id !== identity.serviceId) throw new Error("Review branch and service ID do not match.");

const previewPath = `${reviewRoot}/${service.id}.png`;
const readmePath = `${reviewRoot}/README.md`;
const expectedPaths = [readmePath, servicePath, previewPath].sort();
if (changedPaths.length !== expectedPaths.length || changedPaths.slice().sort().some((value, index) => value !== expectedPaths[index])) {
  throw new Error("Approved review pull request contains files outside its review package.");
}

for (const filePath of expectedPaths) {
  const treeEntry = gitText(["ls-tree", headSha, "--", filePath]);
  if (!treeEntry.startsWith("100644 blob ")) throw new Error("Review package contains an invalid file mode.");
  if (mergeSha && !gitBytes(['show', `${mergeSha}:${filePath}`]).equals(gitBytes(['show', `${headSha}:${filePath}`]))) {
    throw new Error('Merged review differs from the approved head.');
  }
}

const preview = gitBytes(["show", `${headSha}:${previewPath}`]);
const dimensions = pngDimensions(preview);
if (dimensions.width !== 2880 || dimensions.height !== 1800 || preview.length < 1_000 || preview.length > 5_000_000) {
  throw new Error("Homepage preview must be a 2880x1800 PNG within the publication size limit.");
}

const destination = path.resolve(destinationRoot);
const relativeDestination = path.relative(process.cwd(), destination);
if (!relativeDestination || relativeDestination.startsWith('..') || path.isAbsolute(relativeDestination)) {
  throw new Error('Publication destination must be a child of the working directory.');
}
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await writeFile(path.join(destination, "service.json"), JSON.stringify(service, null, 2) + "\n");
await writeFile(path.join(destination, "preview.png"), preview);
await writeFile(path.join(destination, "metadata.json"), JSON.stringify({
  issueNumber: identity.issueNumber,
  serviceId: service.id,
  serviceName: service.name,
  publicationBranch: identity.publicationBranch
}, null, 2) + "\n");
