import { appendFile, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  normalizePublishedService,
  parseCatalogModule,
  pngDimensions,
  publicationIdentity,
  renderCatalogModule,
  upsertPublishedService
} from "../src/publication.js";

const [publicationRoot, publicRepositoryRoot] = process.argv.slice(2);
if (!publicationRoot || !publicRepositoryRoot) throw new Error("Publication and public repository paths are required.");

const source = path.resolve(publicationRoot);
const target = path.resolve(publicRepositoryRoot);
const service = normalizePublishedService(JSON.parse(await readFile(path.join(source, "service.json"), "utf8")));
const metadata = JSON.parse(await readFile(path.join(source, "metadata.json"), "utf8"));
const identity = publicationIdentity(`service-review/issue-${metadata.issueNumber}-${metadata.serviceId}`);
if (metadata.serviceName !== service.name || identity.serviceId !== service.id || identity.publicationBranch !== metadata.publicationBranch) {
  throw new Error("Publication metadata does not match the approved service.");
}

const previewSource = path.join(source, "preview.png");
const preview = await readFile(previewSource);
const dimensions = pngDimensions(preview);
if (dimensions.width !== 2880 || dimensions.height !== 1800 || preview.length < 1_000 || preview.length > 5_000_000) {
  throw new Error("Publication preview is invalid.");
}

const catalogPath = path.join(target, "services", "catalog.js");
const catalog = parseCatalogModule(await readFile(catalogPath, "utf8"));
const updatedCatalog = upsertPublishedService(catalog, service);
await writeFile(catalogPath, renderCatalogModule(updatedCatalog));

const previewTarget = path.join(target, "services", service.preview);
if (!previewTarget.startsWith(path.join(target, "services") + path.sep)) throw new Error("Publication preview destination is invalid.");
await mkdir(path.dirname(previewTarget), { recursive: true });
await copyFile(previewSource, previewTarget);

if (process.env.GITHUB_OUTPUT) {
  await appendFile(process.env.GITHUB_OUTPUT, [
    `issue_number=${identity.issueNumber}`,
    `service_id=${service.id}`,
    `service_name_b64=${Buffer.from(service.name, "utf8").toString("base64")}`,
    `publication_branch=${identity.publicationBranch}`,
    ""
  ].join("\n"));
}
