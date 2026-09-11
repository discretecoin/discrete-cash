# Ecosystem service directory

This directory is a static page at `/services/`. It uses the website's shared
assets and requires no build or server-side runtime on the website host.
Publish it with the existing site. JavaScript enables the catalog,
search, category filters, card/list views, and service-details dialogs.

The initial catalog is empty. A service-submission form is included at
`/services/submit/`. Sending is disabled until a private intake endpoint and
anti-spam verification are configured. Reviews and ratings are not included.

## Connecting private submissions

The receiving Worker, private moderation workflows, automatic screenshots,
approved-publication scripts and their setup guide are included in
[`integrations/service-moderation`](../integrations/service-moderation/README.md).
Install that package in the maintainers' separate private repository and follow
its activation checklist. Its workflows are intentionally nested here so they
do not process submissions in the public website repository.

Set `endpoint` and the public `turnstileSiteKey` in `intake-config.js` only after
the receiving service is ready. The checked-in values are empty. The catalog
itself does not load that configuration or contact the intake service.

The form sends a credential-free HTTPS POST with JSON containing `schemaVersion`
set to `1`, the submitter's `relationship`, the `service` record described below, and a
`turnstileToken`. The endpoint should return a successful JSON response with an
opaque `submissionId`. Errors preserve the form's contents; verification must be
repeated before another attempt. There is no automatic retry.

The website maintainers should control the endpoint and its separate private
moderation repository. The receiving service must validate the payload and Turnstile token, restrict
allowed website origins, and store submissions in a private moderation queue.
It must handle duplicate/retried requests without publishing them, avoid storing
verification tokens, and return no private issue URL or moderation data. API
tokens, GitHub credentials, and the Turnstile secret stay on that service, never
in this repository. The code is supplied here; hosting, account resources and
credentials must be provisioned by the maintainers before connecting the form.

Before enabling the connection, test an actual private submission, rejection,
failed verification, and retry against the intended queue. An endpoint URL alone
does not prove that the privacy or moderation requirements are met.

## Maintaining the catalog

Only approved public information belongs in `catalog.js`. Initial submissions,
private contact information, and moderation evidence must remain in a private
review process. A public issue or pull request is not a private intake channel.

After review, add a record to the array returned by `catalog.js` and add its
homepage preview at `assets/previews/<id>.png`. Review the image for private or
unrelated information before committing it. The browser loads the local image;
it does not fetch screenshots from a third party. A missing image is hidden.

Each record has these fields:

| Field | Requirement |
| --- | --- |
| `id` | Unique lowercase slug, at most 64 characters |
| `name` | Public service name, at most 80 characters |
| `url` | HTTPS URL with no embedded credentials |
| `category` | Public category, at most 80 characters |
| `operator` | Public operator name, at most 100 characters |
| `summary` | Plain-text description, at most 400 characters |
| `preview` | `assets/previews/<id>.png`, matching this record's ID |
| `serviceType` | Service type, at most 60 characters |
| `access` | Access requirements, at most 60 characters |
| `fundHandling` | Fund-handling model, at most 80 characters |
| `contact` | Optional public email or HTTPS URL; otherwise `""` |
| `sourceUrl` | Optional HTTPS source-code URL; otherwise `""` |
| `riskNotes` | Plain-text trust and material-risk disclosure, at most 800 characters |

The renderer inserts catalog text as text, validates URLs and image paths, and
omits empty contact/source links. A listing is not an endorsement.

## Validation and release

Run `node --test tests/*.test.cjs` from the repository root with Node.js 22 or
later. No npm dependencies or installation step are needed. Tests validate every
published record and its local preview as well as the existing payment page.

Serve the repository with a local static server and check `/services/` on desktop
and mobile. For populated catalogs, exercise search with category filtering,
Clear filters, Cards/List, and each details dialog; confirm Escape and the close
button return focus to the originating card. Check the empty catalog and missing
image states too. Do not commit temporary demonstration records.

The homepage changes add a header and footer link plus narrow-screen navigation
spacing. To withdraw the directory, revert the directory contribution through
the normal website release process.
