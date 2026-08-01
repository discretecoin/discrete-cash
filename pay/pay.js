/* SPDX-License-Identifier: MIT */
(function attachDiscretePay(root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.DiscretePay = api;

  if (typeof document !== "undefined") {
    document.addEventListener("DOMContentLoaded", function onReady() {
      api.initializePage(
        document,
        root.location ? root.location.hash : "",
        root.location || null,
        root.qrcodegen || null
      );
    });
    // Browsers can reuse the same document when only the fragment changes.
    // Reload so a second payment link can never leave stale recipient or
    // amount data from the previous request on screen.
    if (typeof root.addEventListener === "function" && root.location &&
        typeof root.location.reload === "function") {
      root.addEventListener("hashchange", function onPaymentLinkChanged() {
        root.location.reload();
      });
    }
  }
}(typeof globalThis !== "undefined" ? globalThis : this, function createDiscretePay() {
  "use strict";

  const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const UINT32_MAX = 4294967295n;
  const UINT16_MAX = 65535n;
  const MAX_AMOUNT_CENTS = 999999999n;
  const MAX_NATIVE_URI_LENGTH = 1024;
  const MAX_FRAGMENT_LENGTH = 4096;
  const ACCOUNT_SYMBOL = "[0-9A-HJKMNP-TV-Z]";
  const ACCOUNT_FINGERPRINT = new RegExp("^" + ACCOUNT_SYMBOL + "{4}$");
  const ACCOUNT_CHECK = new RegExp("^" + ACCOUNT_SYMBOL + "$");
  const RAW_FORBIDDEN = /[\u0000-\u0020\u007f-\u009f]/;
  const LABEL_FORBIDDEN = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/i;

  function invalid(message) {
    const error = new Error(message);
    error.name = "InvalidPaymentRequest";
    return error;
  }

  function crockfordValue(character) {
    return CROCKFORD.indexOf(character);
  }

  function luhn32CheckCharacter(symbols) {
    let sum = 0;
    let shouldDouble = true;

    for (let index = symbols.length - 1; index >= 0; index -= 1) {
      let value = crockfordValue(symbols[index]);
      if (value < 0) {
        throw invalid("The account number contains an unsupported symbol.");
      }
      if (shouldDouble) {
        value *= 2;
        if (value >= 32) {
          value = Math.floor(value / 32) + (value % 32);
        }
      }
      sum += value;
      shouldDouble = !shouldDouble;
    }

    return CROCKFORD[(32 - (sum % 32)) % 32];
  }

  function parseCanonicalUint32(value) {
    if (!/^(?:0|[1-9][0-9]*)$/.test(value)) {
      return null;
    }
    const parsed = BigInt(value);
    return parsed <= UINT32_MAX ? parsed : null;
  }

  function validateAccountNumber(accountNumber) {
    const fields = accountNumber.split("-");
    if (fields.length !== 4 && fields.length !== 5) {
      return false;
    }

    const height = fields[0];
    const transactionIndex = fields[1];
    const fingerprint = fields[2];
    const hasSubaddress = fields.length === 5;
    const subaddressIndex = hasSubaddress ? fields[3] : "";
    const checkCharacter = fields[fields.length - 1];

    const parsedHeight = parseCanonicalUint32(height);
    const parsedTransactionIndex = parseCanonicalUint32(transactionIndex);
    if (parsedHeight === null || parsedTransactionIndex === null || parsedTransactionIndex > UINT16_MAX) {
      return false;
    }
    if (hasSubaddress && parseCanonicalUint32(subaddressIndex) === null) {
      return false;
    }
    if (!ACCOUNT_FINGERPRINT.test(fingerprint) || !ACCOUNT_CHECK.test(checkCharacter)) {
      return false;
    }

    const payload = height + transactionIndex + fingerprint + subaddressIndex;
    return luhn32CheckCharacter(payload) === checkCharacter;
  }

  function decodeQueryValue(value) {
    try {
      return decodeURIComponent(value);
    } catch (error) {
      throw invalid("The payment request contains invalid percent encoding.");
    }
  }

  function parseAmount(amount) {
    if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/.test(amount)) {
      throw invalid("The payment amount is malformed.");
    }

    const parts = amount.split(".");
    const whole = BigInt(parts[0]);
    const fraction = (parts[1] || "").padEnd(2, "0");
    const cents = (whole * 100n) + BigInt(fraction);
    if (cents > MAX_AMOUNT_CENTS) {
      throw invalid("The payment amount exceeds the wallet limit.");
    }
    return amount;
  }

  function parseQuery(query) {
    const values = Object.create(null);
    if (query === "") {
      throw invalid("The payment request has an empty query string.");
    }

    query.split("&").forEach(function parsePair(pair) {
      const separator = pair.indexOf("=");
      if (separator <= 0 || pair.indexOf("=", separator + 1) !== -1) {
        throw invalid("The payment request query is malformed.");
      }

      const key = pair.slice(0, separator);
      const encodedValue = pair.slice(separator + 1);
      if (key !== "amount" && key !== "label") {
        throw invalid("The payment request contains an unsupported parameter.");
      }
      if (Object.prototype.hasOwnProperty.call(values, key)) {
        throw invalid("The payment request contains a duplicate parameter.");
      }
      values[key] = decodeQueryValue(encodedValue);
    });

    const result = { amount: null, label: "" };
    if (Object.prototype.hasOwnProperty.call(values, "amount")) {
      result.amount = parseAmount(values.amount);
    }
    if (Object.prototype.hasOwnProperty.call(values, "label")) {
      if (values.label.length > 64 || LABEL_FORBIDDEN.test(values.label)) {
        throw invalid("The payment label contains unsafe or excessive text.");
      }
      result.label = values.label;
    }
    return result;
  }

  function parsePaymentUri(uri) {
    if (typeof uri !== "string" || uri.length === 0 || uri.length > MAX_NATIVE_URI_LENGTH) {
      throw invalid("The payment URI is missing or too long.");
    }
    if (!uri.startsWith("discrete:") || uri.startsWith("discrete://")) {
      throw invalid("The payment URI must use the canonical discrete: scheme.");
    }
    if (RAW_FORBIDDEN.test(uri) || uri.includes("#")) {
      throw invalid("The payment URI contains forbidden characters.");
    }

    const body = uri.slice("discrete:".length);
    const querySeparator = body.indexOf("?");
    if (querySeparator !== -1 && body.indexOf("?", querySeparator + 1) !== -1) {
      throw invalid("The payment URI contains more than one query separator.");
    }

    const recipient = querySeparator === -1 ? body : body.slice(0, querySeparator);
    if (!validateAccountNumber(recipient)) {
      throw invalid("The recipient is not a canonical Discrete account number.");
    }

    const query = querySeparator === -1
      ? { amount: null, label: "" }
      : parseQuery(body.slice(querySeparator + 1));

    return {
      uri: uri,
      recipient: recipient,
      amount: query.amount,
      label: query.label
    };
  }

  function parseShareHash(hash) {
    if (typeof hash !== "string" || hash.length === 0 || hash.length > MAX_FRAGMENT_LENGTH) {
      throw invalid("The payment link is missing or too long.");
    }

    const match = /^#v=1&request=([^&]+)$/.exec(hash);
    if (!match) {
      throw invalid("The payment link format is not supported.");
    }

    let uri;
    try {
      uri = decodeURIComponent(match[1]);
    } catch (error) {
      throw invalid("The payment link contains invalid percent encoding.");
    }
    return parsePaymentUri(uri);
  }

  function makeShareLink(baseUrl, uri) {
    const parsed = parsePaymentUri(uri);
    let parsedBase;
    try {
      parsedBase = new URL(baseUrl);
    } catch (error) {
      throw invalid("The payment link base URL is invalid.");
    }
    const canonicalBase = parsedBase.origin + parsedBase.pathname + parsedBase.hash;
    if (parsedBase.protocol !== "https:" || parsedBase.username !== "" ||
        parsedBase.password !== "" || parsedBase.search !== "" ||
        !parsedBase.pathname.endsWith("/pay/") ||
        parsedBase.hash !== "#v=1&request=" || baseUrl !== canonicalBase) {
      throw invalid("The payment link base URL is invalid.");
    }
    return baseUrl + encodeURIComponent(parsed.uri);
  }

  function makeCurrentShareLink(locationLike, uri) {
    if (!locationLike || locationLike.protocol !== "https:" ||
        typeof locationLike.origin !== "string" || !locationLike.origin.startsWith("https://") ||
        typeof locationLike.pathname !== "string" || !locationLike.pathname.startsWith("/")) {
      throw invalid("The payment link must be opened from its HTTPS page.");
    }

    return makeShareLink(
      locationLike.origin + locationLike.pathname + "#v=1&request=",
      uri
    );
  }

  function copyText(text, pageDocument) {
    if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }

    return new Promise(function fallbackCopy(resolve, reject) {
      const copyDocument = pageDocument || (typeof document !== "undefined" ? document : null);
      if (!copyDocument || !copyDocument.body || typeof copyDocument.execCommand !== "function") {
        reject(new Error("Clipboard access is unavailable."));
        return;
      }

      const copyField = copyDocument.createElement("textarea");
      copyField.value = text;
      copyField.setAttribute("readonly", "");
      copyField.className = "clipboard-helper";
      copyDocument.body.appendChild(copyField);
      copyField.focus();
      copyField.select();
      try {
        if (copyDocument.execCommand("copy")) {
          resolve();
        } else {
          reject(new Error("Clipboard access was rejected."));
        }
      } catch (error) {
        reject(error);
      } finally {
        copyField.remove();
      }
    });
  }

  function renderQrCode(canvas, shareUrl, qrLibrary) {
    if (!canvas || typeof canvas.getContext !== "function") {
      throw invalid("The QR code canvas is unavailable.");
    }
    if (typeof shareUrl !== "string" || !shareUrl.startsWith("https://")) {
      throw invalid("Only an HTTPS payment link can be encoded as this QR code.");
    }

    const library = qrLibrary ||
      (typeof globalThis !== "undefined" ? globalThis.qrcodegen : null);
    if (!library || !library.QrCode || !library.QrCode.Ecc) {
      throw invalid("The QR code generator is unavailable.");
    }

    const qrCode = library.QrCode.encodeText(shareUrl, library.QrCode.Ecc.MEDIUM);
    const border = 4;
    const moduleCount = qrCode.size + (border * 2);
    const scale = Math.max(1, Math.floor(300 / moduleCount));
    const pixelSize = moduleCount * scale;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) {
      throw invalid("The browser could not create a QR code canvas.");
    }

    canvas.width = pixelSize;
    canvas.height = pixelSize;
    context.imageSmoothingEnabled = false;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, pixelSize, pixelSize);
    context.fillStyle = "#000000";
    for (let y = 0; y < qrCode.size; y += 1) {
      for (let x = 0; x < qrCode.size; x += 1) {
        if (qrCode.getModule(x, y)) {
          context.fillRect((x + border) * scale, (y + border) * scale, scale, scale);
        }
      }
    }

    return {
      payload: shareUrl,
      moduleCount: qrCode.size,
      pixelSize: pixelSize
    };
  }

  function initializePage(pageDocument, hash, pageLocation, qrLibrary) {
    const loadingPanel = pageDocument.getElementById("loading-panel");
    const errorPanel = pageDocument.getElementById("error-panel");
    const errorMessage = pageDocument.getElementById("error-message");
    const requestPanel = pageDocument.getElementById("request-panel");

    let request;
    let shareUrl;
    try {
      request = parseShareHash(hash);
      shareUrl = makeCurrentShareLink(pageLocation, request.uri);
    } catch (error) {
      loadingPanel.hidden = true;
      requestPanel.hidden = true;
      errorMessage.textContent = error && error.message ? error.message : "The payment request is invalid.";
      errorPanel.hidden = false;
      return;
    }

    const recipient = pageDocument.getElementById("recipient-value");
    const amount = pageDocument.getElementById("amount-value");
    const amountUnit = pageDocument.getElementById("amount-unit");
    const labelRow = pageDocument.getElementById("label-row");
    const label = pageDocument.getElementById("label-value");
    const paymentUri = pageDocument.getElementById("payment-uri");
    const openWallet = pageDocument.getElementById("open-wallet");
    const copyButton = pageDocument.getElementById("copy-link");
    const copyStatus = pageDocument.getElementById("copy-status");
    const showQrButton = pageDocument.getElementById("show-qr");
    const qrPanel = pageDocument.getElementById("qr-panel");
    const qrCanvas = pageDocument.getElementById("payment-qr");
    const qrStatus = pageDocument.getElementById("qr-status");

    recipient.textContent = request.recipient;
    if (request.amount === null) {
      amount.textContent = "Not specified";
      amountUnit.hidden = true;
    } else {
      amount.textContent = request.amount;
      amountUnit.hidden = false;
    }
    if (request.label === "") {
      labelRow.hidden = true;
    } else {
      label.textContent = request.label;
      labelRow.hidden = false;
    }

    paymentUri.value = request.uri;
    openWallet.setAttribute("href", request.uri);
    copyButton.addEventListener("click", function onCopy() {
      copyStatus.textContent = "";
      copyText(shareUrl, pageDocument).then(function copied() {
        copyStatus.textContent = "Payment link copied.";
      }).catch(function copyFailed() {
        copyStatus.textContent = "Could not access the clipboard. Copy this page URL from the browser instead.";
      });
    });

    let qrRendered = false;
    showQrButton.addEventListener("click", function onToggleQr() {
      const shouldShow = qrPanel.hidden;
      if (shouldShow && !qrRendered) {
        qrStatus.textContent = "";
        try {
          renderQrCode(qrCanvas, shareUrl, qrLibrary);
          qrRendered = true;
        } catch (error) {
          qrStatus.textContent = "Could not generate the QR code. Copy the payment link instead.";
          return;
        }
      }

      qrPanel.hidden = !shouldShow;
      showQrButton.setAttribute("aria-expanded", shouldShow ? "true" : "false");
      showQrButton.textContent = shouldShow ? "Hide QR code" : "Show QR code";
    });

    loadingPanel.hidden = true;
    errorPanel.hidden = true;
    requestPanel.hidden = false;
  }

  return {
    luhn32CheckCharacter: luhn32CheckCharacter,
    validateAccountNumber: validateAccountNumber,
    parsePaymentUri: parsePaymentUri,
    parseShareHash: parseShareHash,
    makeShareLink: makeShareLink,
    makeCurrentShareLink: makeCurrentShareLink,
    renderQrCode: renderQrCode,
    initializePage: initializePage
  };
}));
