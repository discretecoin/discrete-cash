const GITHUB_API = "https://api.github.com";
const API_VERSION = "2026-03-10";

function base64Url(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function pemBytes(pem) {
  const encoded = String(pem || "")
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  if (!encoded) throw new Error("GitHub App PKCS#8 private key is missing.");
  const binary = atob(encoded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function createAppJwt(appId, privateKeyPem, nowSeconds = Math.floor(Date.now() / 1000)) {
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({
    iat: nowSeconds - 60,
    exp: nowSeconds + 540,
    iss: String(appId)
  }));
  const unsigned = header + "." + payload;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemBytes(privateKeyPem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  return unsigned + "." + base64Url(signature);
}

async function githubJson(fetchRequest, url, options, operation) {
  const response = await fetchRequest(url, options);
  if (!response.ok) {
    let message = "";
    try {
      const rawBody = await response.text();
      const errorBody = JSON.parse(rawBody);
      message = typeof errorBody.message === "string" ? " " + errorBody.message : "";
    } catch (_error) {
      message = " No JSON error body returned.";
    }
    throw new Error("GitHub " + operation + " failed with status " + response.status + "." + message);
  }
  return response.json();
}

async function createInstallationToken(env, fetchRequest) {
  const jwt = await createAppJwt(env.GITHUB_APP_ID, env.GITHUB_PRIVATE_KEY_PKCS8);
  const installation = await githubJson(
    fetchRequest,
    GITHUB_API + "/app/installations/" + encodeURIComponent(env.GITHUB_INSTALLATION_ID) + "/access_tokens",
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: "Bearer " + jwt,
        "X-GitHub-Api-Version": API_VERSION,
        "Content-Type": "application/json",
        "User-Agent": "discrete-services-moderation/0.1"
      },
      body: JSON.stringify({
        repositories: [env.MODERATION_REPO_NAME],
        permissions: { issues: "write" }
      })
    },
    "installation token request"
  );
  return installation.token;
}

function html(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function paragraph(value) {
  return "<p>" + html(value).replace(/\n/g, "<br>") + "</p>";
}

function link(url, fallback = "Not provided") {
  if (!url) return "<em>" + fallback + "</em>";
  return '<a href="' + html(url) + '">' + html(url) + "</a>";
}

function contact(value) {
  if (!value) return "<em>Not provided</em>";
  if (value.startsWith("https://")) return link(value);
  return '<a href="mailto:' + html(value) + '">' + html(value) + "</a>";
}

function safeJson(payload) {
  const replacements = { "<": "\\u003c", ">": "\\u003e", "&": "\\u0026", "`": "\\u0060" };
  return JSON.stringify(payload, null, 2).replace(/[<>&`]/g, (character) => replacements[character]);
}

export function issueBody(payload) {
  const service = payload.service;
  return [
    "## Private service submission",
    "",
    "> Internal moderation record. Submission does not publish the service automatically.",
    "",
    "### At a glance",
    "",
    "| Field | Submitted value |",
    "| --- | --- |",
    "| **Service** | <strong>" + html(service.name) + "</strong> |",
    "| **Website** | " + link(service.url) + " |",
    "| **Category** | " + html(service.category) + " |",
    "| **Submitted as** | " + html(payload.relationship) + " |",
    "| **Operator** | " + html(service.operator) + " |",
    "| **Public contact** | " + contact(service.contact) + " |",
    "| **Source code** | " + link(service.sourceUrl) + " |",
    "",
    "### What the service does",
    "",
    paragraph(service.summary),
    "",
    "### Catalog card data",
    "",
    "| Field | Submitted value |",
    "| --- | --- |",
    "| **Service type** | " + html(service.serviceType) + " |",
    "| **Access** | " + html(service.access) + " |",
    "| **Fund handling** | " + html(service.fundHandling) + " |",
    "",
    "### Disclosed custody, trust, and material risks",
    "",
    paragraph(service.riskNotes),
    "",
    "### Moderator checklist",
    "",
    "- [ ] Website opens and represents the submitted service.",
    "- [ ] Name, category, and description match what the website provides.",
    "- [ ] Operator and public contact claims are supported by the website.",
    "- [ ] Access and fund-handling claims are accurate.",
    "- [ ] Material custody, trust, and user risks are disclosed clearly.",
    "",
    "### Prepare a private preview",
    "",
    "After completing every checkbox, add a comment containing only `/prepare`.",
    "The preview workflow captures the homepage on an isolated GitHub-hosted runner and opens a private review pull request. Nothing is added to the public directory at this stage.",
    "",
    "<details>",
    "<summary>Machine-readable normalized record</summary>",
    "",
    "",
    "```json",
    safeJson(payload),
    "```",
    "",
    "</details>"
  ].join("\n");
}

export async function createModerationIssue(payload, env, fetchRequest = fetch) {
  if (!/^[A-Za-z0-9-]+$/.test(env.MODERATION_REPO_OWNER || '') ||
      !/^[A-Za-z0-9_.-]+$/.test(env.MODERATION_REPO_NAME || '')) {
    throw new Error('Private moderation repository is not configured.');
  }
  const token = await createInstallationToken(env, fetchRequest);
  const repositoryPath = encodeURIComponent(env.MODERATION_REPO_OWNER) + "/" + encodeURIComponent(env.MODERATION_REPO_NAME);
  const headers = {
    Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token,
    'X-GitHub-Api-Version': API_VERSION, 'User-Agent': 'discrete-services-moderation/0.1'
  };
  const repository = await githubJson(fetchRequest, GITHUB_API + '/repos/' + repositoryPath,
    { headers }, 'private repository verification');
  if (repository.private !== true || repository.full_name?.toLowerCase() !== repositoryPath.toLowerCase()) {
    throw new Error('Submission storage must be the configured private repository.');
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload)));
  const fingerprint = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const marker = '<!-- submission-sha256:' + fingerprint + ' -->';
  // Recover a recent sequential retry, including a lost successful response.
  // GitHub issue creation is not atomic: simultaneous requests may still duplicate.
  const since = encodeURIComponent(new Date(Date.now() - 86_400_000).toISOString());
  for (let page = 1; page <= 10; page++) {
    const issues = await githubJson(fetchRequest, GITHUB_API + '/repos/' + repositoryPath +
      '/issues?state=all&sort=created&direction=desc&per_page=100&since=' + since + '&page=' + page,
    { headers }, 'retry lookup');
    if (!Array.isArray(issues)) throw new Error('Invalid retry lookup result.');
    const existing = issues.find(issue => !issue.pull_request && issue.body?.startsWith(marker + '\n'));
    if (existing) return { number: existing.number };
    if (issues.length < 100) break;
    if (page === 10) throw new Error('Retry lookup capacity exceeded.');
  }
  return githubJson(fetchRequest, GITHUB_API + "/repos/" + repositoryPath + "/issues", {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: "Bearer " + token,
      "X-GitHub-Api-Version": API_VERSION,
      "Content-Type": "application/json",
      "User-Agent": "discrete-services-moderation/0.1"
    },
    body: JSON.stringify({
      title: "[Service submission] " + payload.service.name.replace(/\s+/g, " "),
      body: marker + '\n' + issueBody(payload)
    })
  }, "issue creation");
}
