export function validSubmission(overrides = {}) {
  const service = Object.assign({
    id: "example-gateway",
    name: "Example Gateway",
    url: "https://merchant.example/",
    category: "Payments",
    operator: "Example Operator",
    summary: "Creates payment requests for Discrete merchants.",
    preview: "assets/previews/example-gateway.png",
    serviceType: "Payment gateway",
    access: "Web and API",
    fundHandling: "Non-custodial",
    contact: "https://merchant.example/support",
    sourceUrl: "https://github.com/example/gateway",
    riskNotes: "Users verify each request before signing."
  }, overrides.service || {});

  return Object.assign({
    schemaVersion: 1,
    relationship: "Community nomination",
    service,
    turnstileToken: "verified-test-token"
  }, overrides, { service });
}

export const testEnv = Object.freeze({
  ALLOWED_ORIGINS: "https://discrete.cash",
  TURNSTILE_HOSTNAMES: "discrete.cash",
  TURNSTILE_ACTION: "service_submission",
  MODERATION_REPO_OWNER: "example-org",
  MODERATION_REPO_NAME: "discrete-cash-services-moderation",
  SUBMISSION_RATE_LIMIT: Object.freeze({
    limit: async () => ({ success: true })
  })
});
