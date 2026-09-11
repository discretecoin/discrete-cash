"use strict";

(function (root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.DiscreteServices = api;
    if (root.document) {
      root.document.addEventListener("DOMContentLoaded", function () {
        api.renderCatalog(root.document, root.DiscreteServiceCatalog || []);
        api.mountDirectory(root.document);
        api.mountForms(root.document, typeof root.fetch === "function" ? root.fetch.bind(root) : null, root.DiscreteServiceIntake || {});
      });
    }
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function cleanText(value, fieldName, maxLength) {
    const text = String(value || "")
      .replace(/\r\n?/g, "\n")
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
      .trim();

    if (!text) {
      throw new Error(fieldName + " is required.");
    }
    if (text.length > maxLength) {
      throw new Error(fieldName + " is too long.");
    }
    return text;
  }

  function cleanOptionalText(value, maxLength) {
    const text = String(value || "").trim();
    if (!text) return "";
    if (text.length > maxLength) throw new Error("A field is too long.");
    return text;
  }

  function httpsUrl(value, fieldName, required) {
    const text = String(value || "").trim();
    if (!text && !required) return "";
    if (!text) throw new Error(fieldName + " is required.");

    let parsed;
    try {
      parsed = new URL(text);
    } catch (_error) {
      throw new Error(fieldName + " must be a valid URL.");
    }

    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      throw new Error(fieldName + " must use HTTPS and contain no credentials.");
    }
    return parsed.href;
  }

  function publicContact(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    if (text.length > 300) throw new Error("Public contact is too long.");
    if (/^[^\s@:/?#]+@[^\s@:/?#]+\.[^\s@:/?#]+$/.test(text)) return text;
    return httpsUrl(text, "Public contact", true);
  }

  function contactHref(value) {
    return value && !/^https:\/\//i.test(value) ? "mailto:" + encodeURIComponent(value) : value;
  }

  function catalogPreview(value, id) {
    const preview = cleanText(value, "Catalog homepage preview", 160);
    const match = preview.match(/^assets\/previews\/([a-z0-9]+(?:-[a-z0-9]+)*)\.png$/);
    if (!match || match[1] !== id) {
      throw new Error("Catalog homepage preview must be a local PNG named after the service ID.");
    }
    return preview;
  }

  function serviceId(value) {
    const id = String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64);

    if (!id) throw new Error("Service name must contain letters or numbers.");
    return id;
  }

  function buildCatalogRecord(fields) {
    const name = cleanText(fields.serviceName, "Service name", 80);
    const id = serviceId(name);
    const url = httpsUrl(fields.serviceUrl, "Public URL", true);
    const contact = publicContact(fields.contact);
    return {
      id: id,
      name: name,
      url: url,
      category: cleanText(fields.category, "Category", 80),
      operator: cleanText(fields.operator, "Who runs this service", 100),
      summary: cleanText(fields.description, "Short description", 400),
      preview: "assets/previews/" + id + ".png",
      serviceType: cleanText(fields.serviceType, "Service type", 60),
      access: cleanText(fields.access, "Access", 60),
      fundHandling: cleanText(fields.fundHandling, "Fund handling", 80),
      contact: contact === url ? "" : contact,
      sourceUrl: httpsUrl(fields.sourceUrl, "Source code URL", false),
      riskNotes: cleanText(fields.riskNotes, "Custody, trust, and material risks", 800)
    };
  }

  function buildServiceSubmission(fields) {
    return {
      schemaVersion: 1,
      relationship: cleanText(fields.submitterRelationship, "Your relationship to the service", 100),
      service: buildCatalogRecord(fields),
      turnstileToken: cleanText(fields.turnstileToken, "Anti-spam verification", 2048)
    };
  }

  function privateIntakeEndpoint(config) {
    return httpsUrl(config && config.endpoint, "Private intake endpoint", false);
  }

  function turnstileSiteKey(config) {
    return cleanOptionalText(config && config.turnstileSiteKey, 200);
  }

  function turnstileAction(config) {
    return cleanOptionalText(config && config.turnstileAction, 100) || "service_submission";
  }

  function loadTurnstile(document) {
    const view = document && document.defaultView;
    if (!document || !view) return Promise.reject(new Error("Verification cannot load in this browser."));
    if (view.turnstile && typeof view.turnstile.render === "function") return Promise.resolve(view.turnstile);
    if (view.DiscreteTurnstileLoader) return view.DiscreteTurnstileLoader;

    view.DiscreteTurnstileLoader = new Promise(function (resolve, reject) {
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.setAttribute("data-discrete-turnstile", "");
      script.addEventListener("load", function () {
        if (view.turnstile && typeof view.turnstile.render === "function") resolve(view.turnstile);
        else reject(new Error("Verification did not initialize."));
      }, { once: true });
      script.addEventListener("error", function () {
        reject(new Error("Verification could not be loaded."));
      }, { once: true });
      document.head.append(script);
    });

    return view.DiscreteTurnstileLoader;
  }

  async function submitPrivateIntake(fields, fetchRequest, config) {
    const endpoint = privateIntakeEndpoint(config);
    if (!endpoint || typeof fetchRequest !== "function") {
      throw new Error("Private submission intake is not connected.");
    }

    const response = await fetchRequest(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildServiceSubmission(fields)),
      credentials: "omit",
      referrerPolicy: "no-referrer"
    });

    if (!response || !response.ok) {
      throw new Error("The private moderation queue did not accept this submission.");
    }

    const receipt = typeof response.json === "function" ? await response.json() : {};
    return {
      submissionId: cleanOptionalText(receipt && receipt.submissionId, 100)
    };
  }

  function formFields(form) {
    const data = new FormData(form);
    return Object.fromEntries(data.entries());
  }

  function setValidityState(form) {
    Array.from(form.elements).forEach(function (field) {
      if (!field || typeof field.checkValidity !== "function" || field.type === "radio" || field.type === "checkbox") return;
      if (field.checkValidity()) field.removeAttribute("aria-invalid");
      else field.setAttribute("aria-invalid", "true");
    });
  }

  function bindPrivateSubmissionForm(form, fetchRequest, config) {
    if (!form) return;
    form.addEventListener("submit", function (event) { event.preventDefault(); });
    const message = form.querySelector(".form-message");
    const submitButton = form.querySelector('button[type="submit"]');
    const verificationContainer = form.querySelector("[data-turnstile-container]");
    const verificationToken = form.querySelector('input[name="turnstileToken"]');
    const endpoint = privateIntakeEndpoint(config);
    const siteKey = turnstileSiteKey(config);
    const availability = form.ownerDocument.querySelector("[data-intake-unavailable]");
    let turnstileApi = null;
    let widgetId = null;
    let submissionResultMessage = "";
    let submitting = false;

    if (!endpoint || !siteKey || typeof fetchRequest !== "function" || !verificationContainer || !verificationToken) {
      if (submitButton) submitButton.disabled = true;
      if (message) message.textContent = "Service submissions are not open yet. Please check back later.";
      return;
    }

    if (submitButton) submitButton.disabled = true;
    if (message) message.textContent = "Loading anti-spam verification…";
    if (availability) availability.hidden = true;

    loadTurnstile(form.ownerDocument).then(function (api) {
      turnstileApi = api;
      if (message) message.textContent = "Complete anti-spam verification to enable submission.";
      widgetId = api.render(verificationContainer, {
        sitekey: siteKey,
        action: turnstileAction(config),
        theme: "dark",
        callback: function (token) {
          verificationToken.value = token;
          if (submitButton) submitButton.disabled = false;
          if (message && !submissionResultMessage) message.textContent = "Verification complete. Ready to submit.";
        },
        "expired-callback": function () {
          submissionResultMessage = "";
          verificationToken.value = "";
          if (submitButton) submitButton.disabled = true;
          if (message) message.textContent = "Verification expired. Complete it again.";
        },
        "error-callback": function () {
          submissionResultMessage = "";
          verificationToken.value = "";
          if (submitButton) submitButton.disabled = true;
          if (message) message.textContent = "Verification failed to load. Try again.";
        }
      });
    }).catch(function (error) {
      if (submitButton) submitButton.disabled = true;
      if (message) message.textContent = error instanceof Error ? error.message : "Verification could not be loaded.";
    });

    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      if (submitting) return;
      setValidityState(form);

      if (!form.checkValidity()) {
        if (message) message.textContent = "Complete every required field before continuing.";
        form.reportValidity();
        return;
      }

      try {
        submitting = true;
        submissionResultMessage = "";
        if (submitButton) submitButton.disabled = true;
        if (message) message.textContent = "Sending to the private moderation queue…";
        const receipt = await submitPrivateIntake(formFields(form), fetchRequest, config);
        form.reset();
        if (message) {
          submissionResultMessage = receipt.submissionId
            ? "Submission received. Reference: " + receipt.submissionId
            : "Submission received for private review.";
          message.textContent = submissionResultMessage;
        }
      } catch (error) {
        submissionResultMessage = error instanceof Error ? error.message : "Unable to submit the request.";
        if (message) message.textContent = submissionResultMessage;
      } finally {
        submitting = false;
        verificationToken.value = "";
        if (submitButton) submitButton.disabled = true;
        if (turnstileApi && widgetId !== null && widgetId !== undefined) turnstileApi.reset(widgetId);
      }
    });
  }

  function normalizeCatalogRecord(record) {
    const name = cleanText(record && record.name, "Catalog service name", 80);
    const id = cleanText(record && record.id, "Catalog service ID", 64);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
      throw new Error("Catalog service ID must be a lowercase slug.");
    }

    return {
      id: id,
      name: name,
      url: httpsUrl(record.url, "Catalog public URL", true),
      category: cleanText(record.category, "Catalog category", 80),
      operator: cleanText(record.operator, "Catalog operator", 100),
      summary: cleanText(record.summary, "Catalog description", 400),
      preview: catalogPreview(record.preview, id),
      serviceType: cleanText(record.serviceType, "Catalog service type", 60),
      access: cleanText(record.access, "Catalog access", 60),
      fundHandling: cleanText(record.fundHandling, "Catalog fund handling", 80),
      contact: publicContact(record.contact),
      sourceUrl: httpsUrl(record.sourceUrl, "Catalog source URL", false),
      riskNotes: cleanText(record.riskNotes, "Catalog risk notes", 800)
    };
  }

  function setCardText(card, selector, value) {
    const element = card.querySelector(selector);
    if (element) element.textContent = value;
  }

  function setOptionalCardLink(card, rowSelector, linkSelector, url) {
    const row = card.querySelector(rowSelector);
    const link = card.querySelector(linkSelector);
    if (!row || !link) return;
    row.hidden = !url;
    if (url) link.href = url;
  }

  function renderCatalog(document, catalog) {
    const results = document.getElementById("service-results");
    const template = document.getElementById("service-card-template");
    if (!results || !template || !template.content) return [];
    if (!Array.isArray(catalog)) throw new Error("Service catalog must be an array.");

    const records = catalog.map(normalizeCatalogRecord);
    results.replaceChildren();

    records.forEach(function (record) {
      const fragment = template.content.cloneNode(true);
      const card = fragment.querySelector("[data-service-card]");
      const title = card.querySelector("[data-card-name]");
      const openLink = card.querySelector("[data-card-open]");
      const detailsTrigger = card.querySelector("[data-card-details-open]");
      const detailsDialog = card.querySelector("[data-card-details-modal]");
      const detailsClose = card.querySelector("[data-card-details-close]");
      const titleId = "service-" + record.id + "-title";
      const dialogId = "service-" + record.id + "-details";
      const dialogTitleId = dialogId + "-title";

      card.setAttribute("data-category", record.category);
      card.setAttribute("aria-labelledby", titleId);
      title.id = titleId;
      detailsDialog.id = dialogId;
      detailsDialog.setAttribute("aria-labelledby", dialogTitleId);
      detailsTrigger.setAttribute("aria-controls", dialogId);
      card.querySelector("[data-card-dialog-title]").id = dialogTitleId;

      const previewFrame = card.querySelector("[data-card-preview-frame]");
      const preview = card.querySelector("[data-card-preview]");
      if (previewFrame && preview) {
        preview.alt = record.name + " homepage preview";
        previewFrame.hidden = false;
        preview.addEventListener("error", function () {
          previewFrame.hidden = true;
        }, { once: true });
        preview.src = record.preview;
      }
      setCardText(card, "[data-card-name]", record.name);
      setCardText(card, "[data-card-dialog-title]", record.name);
      setCardText(card, "[data-card-domain]", new URL(record.url).hostname.replace(/^www\./, ""));
      setCardText(card, "[data-card-category]", record.category);
      setCardText(card, "[data-card-summary]", record.summary);
      setCardText(card, "[data-card-service-type]", record.serviceType);
      setCardText(card, "[data-card-access]", record.access);
      setCardText(card, "[data-card-fund-handling]", record.fundHandling);
      setCardText(card, "[data-card-operator]", record.operator);
      setCardText(card, "[data-card-fund-handling-detail]", record.fundHandling);
      setCardText(card, "[data-card-risks]", record.riskNotes);

      openLink.href = record.url;
      setOptionalCardLink(card, "[data-card-contact-row]", "[data-card-contact]", contactHref(record.contact));
      setOptionalCardLink(card, "[data-card-source-row]", "[data-card-source]", record.sourceUrl);

      function closeDetailsDialog() {
        if (typeof detailsDialog.close === "function") {
          detailsDialog.close();
          return;
        }
        detailsDialog.removeAttribute("open");
        document.documentElement.classList.remove("service-dialog-open");
        document.documentElement.style.removeProperty("--service-dialog-scrollbar-width");
        detailsTrigger.focus({ preventScroll: true });
      }

      detailsTrigger.addEventListener("click", function () {
        const viewport = document.defaultView;
        const scrollbarWidth = viewport
          ? Math.max(0, viewport.innerWidth - document.documentElement.clientWidth)
          : 0;
        document.documentElement.style.setProperty("--service-dialog-scrollbar-width", scrollbarWidth + "px");
        document.documentElement.classList.add("service-dialog-open");
        if (typeof detailsDialog.showModal === "function") {
          detailsDialog.showModal();
        } else {
          detailsDialog.setAttribute("open", "");
        }
      });
      detailsClose.addEventListener("click", closeDetailsDialog);
      detailsDialog.addEventListener("click", function (event) {
        if (event.target === detailsDialog) closeDetailsDialog();
      });
      detailsDialog.addEventListener("keydown", function (event) {
        if (event.key === "Escape") {
          event.preventDefault();
          closeDetailsDialog();
        }
      });
      detailsDialog.addEventListener("close", function () {
        document.documentElement.classList.remove("service-dialog-open");
        document.documentElement.style.removeProperty("--service-dialog-scrollbar-width");
        detailsTrigger.focus({ preventScroll: true });
      });

      results.append(fragment);
    });

    return records;
  }

  function normalizeDirectoryText(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function matchesDirectoryItem(item, query, activeCategory) {
    const normalizedCategory = normalizeDirectoryText(activeCategory);
    const categoryMatches = !normalizedCategory || normalizedCategory === "all" ||
      normalizeDirectoryText(item.category) === normalizedCategory;
    const queryMatches = !normalizeDirectoryText(query) ||
      normalizeDirectoryText(item.text).includes(normalizeDirectoryText(query));
    return categoryMatches && queryMatches;
  }

  function mountDirectory(document) {
    const results = document.getElementById("service-results");
    const search = document.getElementById("service-search");
    const filters = document.getElementById("category-filters");
    const count = document.getElementById("directory-result-count");
    const empty = document.getElementById("directory-empty");
    const emptyMessage = empty ? empty.querySelector("p") : null;
    const clear = document.getElementById("directory-clear");
    if (!results || !search || !filters || !count || !empty) return;

    const cards = Array.from(results.querySelectorAll("[data-service-card]"));
    const columns = [document.createElement("div"), document.createElement("div")];
    const narrowLayout = document.defaultView && document.defaultView.matchMedia
      ? document.defaultView.matchMedia("(max-width: 900px)")
      : null;
    let activeCategory = "all";
    let activeView = results.getAttribute("data-directory-view") || "cards";

    columns.forEach(function (column) {
      column.className = "directory-column";
    });
    results.replaceChildren(columns[0], columns[1]);

    const categoryCounts = new Map();
    cards.forEach(function (card) {
      const category = card.getAttribute("data-category") || "Other";
      categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
    });

    const allButton = filters.querySelector('[data-category-filter="all"]');
    if (allButton) {
      const total = allButton.querySelector("span");
      if (total) total.textContent = String(cards.length);
    }

    Array.from(categoryCounts.entries())
      .sort(function (left, right) { return left[0].localeCompare(right[0]); })
      .forEach(function (entry) {
        const button = document.createElement("button");
        const badge = document.createElement("span");
        button.type = "button";
        button.setAttribute("data-category-filter", entry[0]);
        button.setAttribute("aria-pressed", "false");
        button.append(document.createTextNode(entry[0] + " "));
        badge.textContent = String(entry[1]);
        button.append(badge);
        filters.append(button);
      });

    function layoutCards() {
      const singleColumn = activeView === "list" || (narrowLayout && narrowLayout.matches);
      const visibleCards = cards.filter(function (card) { return !card.hidden; });
      const hiddenCards = cards.filter(function (card) { return card.hidden; });

      columns[0].replaceChildren();
      columns[1].replaceChildren();
      columns[1].hidden = singleColumn;

      visibleCards.forEach(function (card, index) {
        columns[singleColumn ? 0 : index % 2].append(card);
      });
      hiddenCards.forEach(function (card) {
        columns[0].append(card);
      });
    }

    function applyFilters() {
      const query = search.value;
      let visible = 0;

      cards.forEach(function (card) {
        const matches = matchesDirectoryItem({
          category: card.getAttribute("data-category") || "",
          text: card.textContent || ""
        }, query, activeCategory);
        card.hidden = !matches;
        if (matches) visible += 1;
      });

      layoutCards();
      count.textContent = "Showing " + visible + " of " + cards.length;
      empty.hidden = visible !== 0;
      if (emptyMessage) {
        emptyMessage.textContent = cards.length === 0
          ? "No services are listed yet."
          : "No services match this search.";
      }
    }

    filters.addEventListener("click", function (event) {
      const button = event.target.closest("[data-category-filter]");
      if (!button || !filters.contains(button)) return;
      activeCategory = button.getAttribute("data-category-filter") || "all";
      Array.from(filters.querySelectorAll("[data-category-filter]")).forEach(function (candidate) {
        const selected = candidate === button;
        candidate.classList.toggle("is-active", selected);
        candidate.setAttribute("aria-pressed", String(selected));
      });
      applyFilters();
    });

    search.addEventListener("input", applyFilters);

    document.addEventListener("keydown", function (event) {
      const active = document.activeElement;
      const isEditing = active && (
        active.matches("input, textarea, select") || active.isContentEditable
      );
      if (event.key === "/" && !isEditing) {
        event.preventDefault();
        search.focus();
      }
    });

    Array.from(document.querySelectorAll("[data-view-button]")).forEach(function (button) {
      button.addEventListener("click", function () {
        const view = button.getAttribute("data-view-button") || "cards";
        activeView = view;
        results.setAttribute("data-directory-view", view);
        Array.from(document.querySelectorAll("[data-view-button]")).forEach(function (candidate) {
          const selected = candidate === button;
          candidate.classList.toggle("is-active", selected);
          candidate.setAttribute("aria-pressed", String(selected));
        });
        layoutCards();
      });
    });

    if (narrowLayout) {
      if (typeof narrowLayout.addEventListener === "function") {
        narrowLayout.addEventListener("change", layoutCards);
      } else if (typeof narrowLayout.addListener === "function") {
        narrowLayout.addListener(layoutCards);
      }
    }

    if (clear) {
      clear.addEventListener("click", function () {
        search.value = "";
        activeCategory = "all";
        const resetButton = filters.querySelector('[data-category-filter="all"]');
        if (resetButton) resetButton.click();
        search.focus();
      });
    }

    applyFilters();
  }

  function mountForms(document, fetchRequest, config) {
    bindPrivateSubmissionForm(document.getElementById("service-submission-form"), fetchRequest, config);
  }

  return {
    buildCatalogRecord: buildCatalogRecord,
    buildServiceSubmission: buildServiceSubmission,
    mountForms: mountForms,
    privateIntakeEndpoint: privateIntakeEndpoint,
    submitPrivateIntake: submitPrivateIntake,
    httpsUrl: httpsUrl,
    matchesDirectoryItem: matchesDirectoryItem,
    mountDirectory: mountDirectory,
    normalizeCatalogRecord: normalizeCatalogRecord,
    catalogPreview: catalogPreview,
    publicContact: publicContact,
    renderCatalog: renderCatalog
  };
});
