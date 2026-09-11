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

export class ValidationError extends Error {}

function plainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError(label + " must be an object.");
  }
  return value;
}

function exactKeys(value, allowed, label) {
  const extras = Object.keys(value).filter((key) => !allowed.has(key));
  if (extras.length) throw new ValidationError(label + " contains unsupported fields.");
}

function text(value, label, maxLength) {
  const normalized = String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim();
  if (!normalized) throw new ValidationError(label + " is required.");
  if (normalized.length > maxLength) throw new ValidationError(label + " is too long.");
  return normalized;
}

function optionalText(value, label, maxLength) {
  const normalized = String(value || "").trim();
  if (normalized.length > maxLength) throw new ValidationError(label + " is too long.");
  return normalized;
}

function httpsUrl(value, label, required) {
  const normalized = optionalText(value, label, 300);
  if (!normalized && !required) return "";
  if (!normalized) throw new ValidationError(label + " is required.");

  let parsed;
  try {
    parsed = new URL(normalized);
  } catch (_error) {
    throw new ValidationError(label + " must be a valid URL.");
  }

  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new ValidationError(label + " must use HTTPS and contain no credentials.");
  }
  return parsed.href;
}

function publicContact(value) {
  const normalized = optionalText(value, "Public contact", 300);
  if (!normalized) return "";
  if (/^[^\s@:/?#]+@[^\s@:/?#]+\.[^\s@:/?#]+$/.test(normalized)) return normalized;
  return httpsUrl(normalized, "Public contact", true);
}

function serviceId(value) {
  const id = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  if (!id) throw new ValidationError("Service name must contain letters or numbers.");
  return id;
}

export function normalizeSubmission(input) {
  const submission = plainObject(input, "Submission");
  exactKeys(submission, new Set(["schemaVersion", "relationship", "service", "turnstileToken"]), "Submission");
  if (submission.schemaVersion !== 1) throw new ValidationError("Unsupported submission schema.");

  const relationship = text(submission.relationship, "Relationship", 100);
  if (!RELATIONSHIPS.has(relationship)) throw new ValidationError("Unsupported submitter relationship.");

  const service = plainObject(submission.service, "Service");
  exactKeys(service, new Set([
    "id", "name", "url", "category", "operator", "summary", "preview", "serviceType",
    "access", "fundHandling", "contact", "sourceUrl", "riskNotes"
  ]), "Service");

  const name = text(service.name, "Service name", 80);
  const id = serviceId(name);
  if (service.id !== id) throw new ValidationError("Service ID does not match the service name.");

  const preview = "assets/previews/" + id + ".png";
  if (service.preview !== preview) throw new ValidationError("Homepage preview path does not match the service ID.");

  const category = text(service.category, "Category", 80);
  if (!CATEGORIES.has(category)) throw new ValidationError("Unsupported service category.");

  const url = httpsUrl(service.url, "Public URL", true);
  const contact = publicContact(service.contact);

  return {
    turnstileToken: text(submission.turnstileToken, "Verification token", 2048),
    issuePayload: {
      schemaVersion: 1,
      relationship,
      service: {
        id,
        name,
        url,
        category,
        operator: text(service.operator, "Operator", 100),
        summary: text(service.summary, "Description", 400),
        preview,
        serviceType: text(service.serviceType, "Service type", 60),
        access: text(service.access, "Access", 60),
        fundHandling: text(service.fundHandling, "Fund handling", 80),
        contact: contact === url ? "" : contact,
        sourceUrl: httpsUrl(service.sourceUrl, "Source code URL", false),
        riskNotes: text(service.riskNotes, "Risk notes", 800)
      }
    }
  };
}
