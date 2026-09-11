import { createModerationIssue } from "./github-app.js";
import { normalizeSubmission, ValidationError } from "./validation.js";

function allowedOrigins(env) {
  return new Set(String(env.ALLOWED_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean));
}

function corsHeaders(origin) {
  const headers = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff"
  };
  if (origin) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function jsonResponse(body, status, origin) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(origin) });
}

async function verifyTurnstile(token, env, fetchRequest) {
  const response = await fetchRequest("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: token })
  });
  if (!response.ok) return false;

  const result = await response.json();
  const hostnames = new Set(String(env.TURNSTILE_HOSTNAMES || "").split(",").map((value) => value.trim()).filter(Boolean));
  return result.success === true
    && result.action === env.TURNSTILE_ACTION
    && hostnames.has(result.hostname);
}

async function limitedBody(request) {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 20_000) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

export async function handleRequest(request, env, dependencies = {}) {
  const origin = request.headers.get("Origin") || "";
  if (!allowedOrigins(env).has(origin)) return jsonResponse({ error: "Origin not allowed." }, 403, "");

  const url = new URL(request.url);
  if (url.pathname !== "/v1/submissions") return jsonResponse({ error: "Not found." }, 404, origin);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405, origin);

  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return jsonResponse({ error: "JSON body required." }, 415, origin);
  }

  try {
    const rateLimit = dependencies.rateLimit || env.SUBMISSION_RATE_LIMIT;
    const rateLimitResult = await rateLimit.limit({ key: "service-submission" });
    if (!rateLimitResult.success) {
      return jsonResponse({ error: "Too many submissions. Try again later." }, 429, origin);
    }

    const contentLength = Number(request.headers.get("Content-Length") || "0");
    if (contentLength > 20_000) return jsonResponse({ error: "Submission is too large." }, 413, origin);

    const rawBody = await limitedBody(request);
    if (rawBody === null) {
      return jsonResponse({ error: "Submission is too large." }, 413, origin);
    }
    const normalized = normalizeSubmission(JSON.parse(rawBody));
    const verify = dependencies.verifyTurnstile || verifyTurnstile;
    const accepted = await verify(normalized.turnstileToken, env, dependencies.fetchRequest || fetch);
    if (!accepted) return jsonResponse({ error: "Verification failed." }, 403, origin);

    const createIssue = dependencies.createModerationIssue || createModerationIssue;
    const issue = await createIssue(normalized.issuePayload, env, dependencies.fetchRequest || fetch);
    return jsonResponse({ submissionId: "MOD-" + issue.number }, 201, origin);
  } catch (error) {
    if (error instanceof ValidationError || error instanceof SyntaxError) {
      return jsonResponse({ error: "Invalid submission." }, 400, origin);
    }
    console.error('Moderation queue operation failed.');
    return jsonResponse({ error: "Moderation queue unavailable." }, 502, origin);
  }
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  }
};
