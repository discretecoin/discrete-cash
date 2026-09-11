const CATEGORIES = new Set([
  "Network infrastructure",
  "Wallet",
  "Payments",
  "Merchant tools",
  "Mining",
  "Liquidity",
  "Analytics",
  "Other"
]);

const RELATIONSHIPS = new Set([
  "Owner or operator",
  "Team member or contributor",
  "Community nomination"
]);

export const MODERATOR_CHECKS = Object.freeze([
  "Website opens and represents the submitted service.",
  "Name, category, and description match what the website provides.",
  "Operator and public contact claims are supported by the website.",
  "Access and fund-handling claims are accurate.",
  "Material custody, trust, and user risks are disclosed clearly."
]);

function plainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(label + " must be an object.");
  }
  return value;
}

function exactKeys(value, allowed, label) {
  const keys = Object.keys(value);
  if (keys.length !== allowed.size || keys.some((key) => !allowed.has(key))) {
    throw new Error(label + " does not match the approved schema.");
  }
}

function requiredText(value, label, maxLength) {
  if (typeof value !== "string" || value !== value.trim() || !value || value.length > maxLength) {
    throw new Error(label + " is invalid.");
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    throw new Error(label + " contains control characters.");
  }
  return value;
}

function optionalText(value, label, maxLength) {
  if (typeof value !== "string" || value !== value.trim() || value.length > maxLength) {
    throw new Error(label + " is invalid.");
  }
  return value;
}

function httpsUrl(value, label, required) {
  const text = required
    ? requiredText(value, label, 300)
    : optionalText(value, label, 300);
  if (!text) return "";

  let parsed;
  try {
    parsed = new URL(text);
  } catch (_error) {
    throw new Error(label + " is not a valid URL.");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.href !== text) {
    throw new Error(label + " must be a normalized credential-free HTTPS URL.");
  }
  return text;
}

function publicContact(value) {
  const text = optionalText(value, "Public contact", 300);
  if (!text) return "";
  if (/^[^\s@:/?#]+@[^\s@:/?#]+\.[^\s@:/?#]+$/.test(text)) return text;
  return httpsUrl(text, "Public contact", true);
}

function serviceId(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function normalizeModerationPayload(input) {
  const payload = plainObject(input, "Moderation payload");
  exactKeys(payload, new Set(["schemaVersion", "relationship", "service"]), "Moderation payload");
  if (payload.schemaVersion !== 1) throw new Error("Unsupported moderation schema.");

  const relationship = requiredText(payload.relationship, "Relationship", 100);
  if (!RELATIONSHIPS.has(relationship)) throw new Error("Unsupported submitter relationship.");

  const inputService = plainObject(payload.service, "Service");
  exactKeys(inputService, new Set([
    "id", "name", "url", "category", "operator", "summary", "preview", "serviceType",
    "access", "fundHandling", "contact", "sourceUrl", "riskNotes"
  ]), "Service");

  const name = requiredText(inputService.name, "Service name", 80);
  const id = requiredText(inputService.id, "Service ID", 64);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || id !== serviceId(name)) {
    throw new Error("Service ID does not match the service name.");
  }

  const category = requiredText(inputService.category, "Category", 80);
  if (!CATEGORIES.has(category)) throw new Error("Unsupported service category.");

  const preview = requiredText(inputService.preview, "Preview path", 160);
  if (preview !== "assets/previews/" + id + ".png") {
    throw new Error("Preview path does not match the service ID.");
  }

  return {
    schemaVersion: 1,
    relationship,
    service: {
      id,
      name,
      url: httpsUrl(inputService.url, "Public URL", true),
      category,
      operator: requiredText(inputService.operator, "Operator", 100),
      summary: requiredText(inputService.summary, "Description", 400),
      preview,
      serviceType: requiredText(inputService.serviceType, "Service type", 60),
      access: requiredText(inputService.access, "Access", 60),
      fundHandling: requiredText(inputService.fundHandling, "Fund handling", 80),
      contact: publicContact(inputService.contact),
      sourceUrl: httpsUrl(inputService.sourceUrl, "Source code URL", false),
      riskNotes: requiredText(inputService.riskNotes, "Risk notes", 800)
    }
  };
}

function checklistFromBody(body) {
  const heading = "### Moderator checklist";
  const start = body.indexOf(heading);
  const end = body.indexOf("<details>", start + heading.length);
  if (start < 0 || end < 0) throw new Error("Moderator checklist is missing.");

  const section = body.slice(start + heading.length, end);
  return Array.from(section.matchAll(/^- \[([ xX])\] (.+)$/gm), (match) => ({
    checked: match[1].toLowerCase() === "x",
    label: match[2].trim()
  }));
}

function payloadFromBody(body) {
  const match = body.match(
    /<details>\s*<summary>Machine-readable normalized record<\/summary>\s*```json\s*([\s\S]*?)\s*```\s*<\/details>\s*$/
  );
  if (!match) throw new Error("Machine-readable moderation record is missing.");
  return JSON.parse(match[1]);
}

export function parsePreparedIssue(body) {
  if (typeof body !== "string") throw new Error("Issue body is missing.");
  const checks = checklistFromBody(body);
  if (checks.length !== MODERATOR_CHECKS.length || checks.some((check, index) => check.label !== MODERATOR_CHECKS[index])) {
    throw new Error("Moderator checklist was altered.");
  }
  if (checks.some((check) => !check.checked)) {
    throw new Error("Complete every moderator checkbox before preparing a preview.");
  }
  return normalizeModerationPayload(payloadFromBody(body));
}

function html(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function reviewReadme(service, issueNumber) {
  return [
    "# Private preview review: " + html(service.name),
    "",
    "Source moderation issue: #" + issueNumber,
    "",
    "![Homepage preview](./" + service.id + ".png)",
    "",
    "## Proposed public record",
    "",
    "| Field | Value |",
    "| --- | --- |",
    "| Service | **" + html(service.name) + "** |",
    "| Website | " + html(service.url) + " |",
    "| Category | " + html(service.category) + " |",
    "| Operator | " + html(service.operator) + " |",
    "| Service type | " + html(service.serviceType) + " |",
    "| Access | " + html(service.access) + " |",
    "| Fund handling | " + html(service.fundHandling) + " |",
    "| Public contact | " + html(service.contact || "Not provided") + " |",
    "| Source code | " + html(service.sourceUrl || "Not provided") + " |",
    "",
    "## Description",
    "",
    html(service.summary),
    "",
    "## Disclosed risks",
    "",
    html(service.riskNotes),
    "",
    "> Merging this private pull request approves disclosure of this record and preview for a separate public catalog pull request. It does not merge directly into the public website.",
    ""
  ].join("\n");
}
