import { normalizeModerationPayload } from "./moderation-review.js";

const CATALOG_PREFIX = `"use strict";

(function (root, factory) {
  const catalog = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = catalog;
  }

  if (root) {
    root.DiscreteServiceCatalog = catalog;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  return Object.freeze(`;

const CATALOG_SUFFIX = `);
});
`;

export function normalizePublishedService(input) {
  const service = normalizeModerationPayload({
    schemaVersion: 1,
    relationship: "Community nomination",
    service: input
  }).service;
  if (/[\r\n]/.test(service.name)) throw new Error("Published service name must be a single line.");
  return service;
}

export function parseCatalogModule(source) {
  const normalizedSource = typeof source === "string" ? source.replace(/\r\n/g, "\n") : source;
  if (typeof normalizedSource !== "string" || !normalizedSource.startsWith(CATALOG_PREFIX) || !normalizedSource.endsWith(CATALOG_SUFFIX)) {
    throw new Error("Public catalog module does not match the generated format.");
  }
  const encoded = normalizedSource.slice(CATALOG_PREFIX.length, -CATALOG_SUFFIX.length);
  const records = JSON.parse(encoded);
  if (!Array.isArray(records)) throw new Error("Public catalog must be an array.");
  return records.map(normalizePublishedService);
}

export function upsertPublishedService(records, candidate) {
  if (!Array.isArray(records)) throw new Error("Public catalog must be an array.");
  const normalized = normalizePublishedService(candidate);
  const catalog = records.map(normalizePublishedService);
  const conflictingUrl = catalog.find((record) => record.id !== normalized.id && record.url === normalized.url);
  if (conflictingUrl) throw new Error("Another catalog record already uses this public URL.");

  const existingIndex = catalog.findIndex((record) => record.id === normalized.id);
  if (existingIndex < 0) catalog.push(normalized);
  else catalog[existingIndex] = normalized;

  catalog.sort((left, right) => {
    const leftName = left.name.toLocaleLowerCase("en-US");
    const rightName = right.name.toLocaleLowerCase("en-US");
    if (leftName < rightName) return -1;
    if (leftName > rightName) return 1;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
  return catalog;
}

export function renderCatalogModule(records) {
  if (!Array.isArray(records)) throw new Error("Public catalog must be an array.");
  const normalized = records.map(normalizePublishedService);
  return CATALOG_PREFIX + JSON.stringify(normalized, null, 2) + CATALOG_SUFFIX;
}

export function pngDimensions(bytes) {
  const buffer = Buffer.from(bytes);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(signature) || buffer.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("Homepage preview is not a valid PNG.");
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

export function publicationIdentity(headRef) {
  const match = String(headRef || "").match(/^service-review\/issue-([1-9][0-9]*)-([a-z0-9]+(?:-[a-z0-9]+)*)$/);
  if (!match) throw new Error("Review branch does not match the workflow-owned format.");
  return {
    issueNumber: Number(match[1]),
    serviceId: match[2],
    publicationBranch: `service-catalog/issue-${match[1]}-${match[2]}`
  };
}
