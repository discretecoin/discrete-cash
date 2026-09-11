# Private service moderation package

This is the runnable intake and moderation companion for the website's
`/services/submit/` form. Install this directory as the **root of a new private
repository controlled by the website maintainers**. Its nested workflows are
templates here; GitHub will run them after installation in that private repo.

The website remains static. This package runs the receiving API on a Cloudflare
Worker and the moderation/preview/publication jobs on GitHub Actions. Creating a
private repository alone does not activate submissions. The code is included;
maintainers supply their own accounts, repository settings and credentials.
No existing queue, submissions, keys or deployed endpoint are included.

## What happens to a submission

1. The form sends its normalized record and Turnstile token to the Worker.
2. The Worker limits requests, validates the schema, verifies Turnstile on the
   server, checks that the configured repository is private and opens an issue
   there. The visitor receives only a `MOD-<number>` reference.
3. A moderator checks the website and all five issue checkboxes, then comments
   `/prepare`. The workflow verifies their current repository **write/admin**
   permission and reads the current issue. Read/triage access is insufficient.
4. A separate GitHub-hosted job receives only the public URL and service ID. It
   captures a 2880x1800 PNG. It has no repository checkout, App key or repository
   token in its environment. A subsequent job opens a private review PR with
   the normalized public record and image.
5. A maintainer checks that private PR and merges it. The publisher exports only
   the exact approved record/image and opens a PR to `discretecoin/discrete-cash`,
   targeting `main`. It never merges the public PR or writes directly to `main`.
6. Maintainers merge the public PR through the normal website release process.
   That publishes the card and its local image. Reviews/ratings are not included.

For rejection, close the private issue without `/prepare`, or close the private
review PR without merging. Neither action publishes a service. Never put private
evidence or non-public contact information in the record or screenshot approved
for public export.

## 1. Install in a private repository

Prerequisites: Git, GitHub CLI, Node.js 24 and a maintainer-controlled Cloudflare
account. Commands below assume a shell with Git and Node on PATH.

From a checkout containing the reviewed website contribution:

```sh
git archive --format=zip --output=../service-moderation-template.zip HEAD:integrations/service-moderation
```

Extract that archive into an empty directory. It includes `.github/workflows`
and `.gitignore`, and excludes website history and runtime files. Create an
empty **private** GitHub repository under the maintainers' organization, with
Issues and Actions enabled. Do not initialize it with another README.

In the extracted directory, replace the example identifiers with your own:

```sh
node scripts/configure.mjs --owner YOUR_ORG --repo YOUR_PRIVATE_REPO --worker YOUR_UNIQUE_WORKER_NAME
npm ci --ignore-scripts
npm test
npx wrangler deploy --dry-run
git init -b main
git add .
git commit -m "Initialize private service moderation"
git remote add origin https://github.com/YOUR_ORG/YOUR_PRIVATE_REPO.git
git push -u origin main
```

The rate-limit namespace defaults to `1001`; use `--rate-namespace` with another
positive integer if that namespace already serves another limiter in your
Cloudflare account. Use `--origin https://your-site.example` for a staging site.

In the private repository's Actions settings, allow the pinned actions used by
the two workflows and enable **Allow GitHub Actions to create and approve pull
requests**. Grant moderators write access. Keep main protected and require
human review of private review PRs; do not enable automatic merge. Use GitHub's
merge-commit or squash-merge option for those PRs. The exporter compares the
reviewed files with the actual merged commit and rejects mismatches.

## 2. Give the Worker access to the private queue

Create a dedicated GitHub App owned by the maintainers, with repository
**Issues: read/write** and **Metadata: read**. Disable its webhook; no callback
server is needed. Install it on **only the new private moderation repository**.
Record its App ID and installation ID; generate a private key.

The Worker accepts an unencrypted PKCS#8 PEM key (`BEGIN PRIVATE KEY`). If the
downloaded key says `BEGIN RSA PRIVATE KEY`, convert it locally:

```sh
openssl pkcs8 -topk8 -nocrypt -in intake-app-key.pem -out intake-app-key-pkcs8.pem
```

Create a Turnstile widget for the website hostname in the maintainer's Cloudflare
account. Its public site key goes on the form; its secret belongs only in the
Worker. The configured action is `service_submission`.

Log in with Wrangler, then enter each value at its secret prompt:

```sh
npx wrangler login
npx wrangler secret put GITHUB_APP_ID
npx wrangler secret put GITHUB_INSTALLATION_ID
npx wrangler secret put GITHUB_PRIVATE_KEY_PKCS8
npx wrangler secret put TURNSTILE_SECRET_KEY
npx wrangler deploy
```

Keep key files outside the repository and delete local copies through your
normal secret-handling process after provisioning. For local development only,
copy `.dev.vars.example` to ignored `.dev.vars`; never commit its populated copy.
The intake App needs no access to the public website or its code.

## 3. Configure publication access

Create a separate GitHub App with **Contents: read/write**, **Pull requests:
read/write** and **Metadata: read**. Disable its webhook. Install it on **only
the public website repository**. This App opens public catalog PRs; it does not
need access to private submissions.

In the **private moderation repository**, set these Actions values:

| Type | Name | Value |
| --- | --- | --- |
| Variable | `PUBLISHER_APP_CLIENT_ID` | Publisher App's Client ID |
| Secret | `PUBLISHER_PRIVATE_KEY` | Publisher App's complete PEM private key |
| Variable, optional | `PUBLIC_REPO_OWNER` | Defaults to `discretecoin` |
| Variable, optional | `PUBLIC_REPO_NAME` | Defaults to `discrete-cash` |
| Variable, optional | `PUBLIC_BASE_BRANCH` | Defaults to `main` |

For acceptance testing, point these three optional variables at a maintainer's
test website repository containing this contribution. Never grant the publisher
a bypass of public branch protection. Organization policies must permit the App
to create its `service-catalog/*` branches and pull requests.

## 4. Connect the existing form and verify the deployment

After configuring and deploying the Worker, update the website's
`services/intake-config.js` through a normal PR:

```js
window.DiscreteServiceIntake = Object.freeze({
  endpoint: "https://YOUR_WORKER.YOUR_SUBDOMAIN.workers.dev/v1/submissions",
  turnstileSiteKey: "YOUR_PUBLIC_SITE_KEY",
  turnstileAction: "service_submission"
});
```

These are public connection values. Do not add App credentials, installation
tokens or the Turnstile secret to the website. Blank values intentionally keep
the form from claiming that submissions are enabled.

Before announcing intake, exercise this checklist against the actual deployment:

- Submit a synthetic service from the allowed website hostname. Confirm the
  browser receives a reference and the issue is visible only in the private repo.
- Reject a test submission. Confirm nothing appears in the public catalog.
- Test invalid/expired verification, invalid input and failed queue access.
  Each must produce an error without exposing private details or losing form data.
- Retry the same successful submission with fresh verification. Confirm it
  returns the same reference in the sequential retry case.
- Have a read-only collaborator attempt `/prepare`; confirm rejection. Complete
  the five checks as a writer, prepare the preview, and visually inspect the PNG.
- Merge the private test review and inspect the resulting public test PR: only
  `services/catalog.js` and `services/assets/previews/<id>.png` may change.
  Merge it in the test site and check the visible card and detail dialog.
- Rerun publication using **Actions → Publish approved service → Run workflow**,
  entering the merged private PR number. An existing public PR is updated; an
  identical package already on the target branch is a successful no-op.

After the test-site run, set the publication target to the canonical repository
and deploy its public connection settings. Account resources and these live
acceptance checks are deployment work; local unit tests cannot establish them.

## Retry, screenshot and operational boundaries

The Worker looks for an identical normalized submission among recently updated
issues (24 hours, at most 1000 records). It recovers sequential retries, including
a lost success response. GitHub issue creation is not atomic: simultaneous
identical requests can still create two private issues. Close duplicates during
moderation; publishing uses a deterministic service ID and cannot append a
second catalog entry for that ID. A different ID using an existing URL is rejected.
The limiter is a coarse shared submission budget, not an identity system.

The screenshot job checks public network addresses and pins HTTP connections to
the checked address, including redirected/resource requests. It blocks WebSockets,
service workers, nonstandard ports, and non-GET/HEAD requests, with time/size/count
limits. Some sites will consequently render incompletely or refuse automation.
A screenshot is evidence for human review, not proof that a service is safe.
Capture failure stops the workflow; correct the record/site issue and rerun
`/prepare`. Do not bypass the private visual review.

The workflows use GitHub-hosted Linux runners. Keep capture off self-hosted runners
with access to internal systems. GitHub provides per-job runtime infrastructure;
the capture job's empty permissions do not mean the runner has no platform metadata.

No plan upgrade, card registration or paid resource is activated by this package.
Maintain account spending limits and check the applicable Worker, Turnstile and
private Actions quotas before enabling it; this is not an unlimited-cost guarantee.

To pause intake, clear the website endpoint/site key and disable the Worker.
To pause publication, disable its private workflow or revoke the publisher App.
To withdraw a published listing, revert its public catalog PR. Keep private audit
records under the maintainers' retention policy; never copy them back into this
public template.

## Local verification

`npm test` runs dependency-free schema, authorization, private-storage, retry,
publication and synthetic local Git pipeline tests. Turnstile/GitHub responses
are mocked. The pipeline test uses a generated PNG, not a live browser.
`npx wrangler deploy --dry-run` bundles the Worker without deploying it.
The website root additionally tests the actual catalog/backend schema contract.

Reference documentation: [GitHub App installation tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation),
[repository collaborator permission](https://docs.github.com/en/rest/collaborators/collaborators#get-repository-permissions-for-a-user),
[server-side Turnstile validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/),
and [Worker rate limits](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).
