"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const pay = require("../pay/pay.js");

const PAGE_BASE = "https://discrete.cash/pay/";
const BASE = PAGE_BASE + "#";
const LEGACY_BASE = PAGE_BASE + "#v=1&request=";
const PAGE_LOCATION = {
  protocol: "https:",
  origin: "https://discrete.cash",
  pathname: "/pay/"
};

function hashFor(uri) {
  return "#" + uri;
}

test("accepts canonical base and deposit account numbers", function () {
  assert.equal(pay.validateAccountNumber("100-1-GS7P-6"), true);
  assert.equal(pay.validateAccountNumber("5008-1-1DRS-6"), true);
  assert.equal(pay.validateAccountNumber("4821-7-KQ9D-R"), true);
  assert.equal(pay.validateAccountNumber("4821-7-KQ9D-3-Y"), true);
});

test("rejects checksum errors and non-canonical account forms", function () {
  assert.equal(pay.validateAccountNumber("100-1-GS7P-7"), false);
  assert.equal(pay.validateAccountNumber("0100-1-GS7P-6"), false);
  assert.equal(pay.validateAccountNumber("100-1-gs7p-6"), false);
  assert.equal(pay.validateAccountNumber("4294967296-1-GS7P-6"), false);
  assert.equal(pay.validateAccountNumber("10-4294967295-NF6Y-X"), false);
  assert.equal(pay.validateAccountNumber("4821-7-KQ9D-X"), false);
});

test("parses a wallet-generated request", function () {
  const uri = "discrete:100-1-GS7P-6?amount=1.00&label=donate";
  assert.deepEqual(pay.parseShareHash(hashFor(uri)), {
    uri: uri,
    recipient: "100-1-GS7P-6",
    amount: "1.00",
    label: "donate"
  });
  assert.equal(pay.makeShareLink(BASE, uri), BASE + uri);
  assert.equal(
    pay.makeCurrentShareLink(PAGE_LOCATION, uri),
    BASE + uri
  );
});

test("readable links preserve the native URI encoding", function () {
  const uri = "discrete:100-1-GS7P-6?amount=2.50&label=C%2B%2B";
  const shareLink = pay.makeShareLink(BASE, uri);
  assert.match(shareLink, /#discrete:100-1-GS7P-6\?amount=2\.50&label=C%2B%2B$/);
  const parsed = pay.parseShareHash(new URL(shareLink).hash);
  assert.equal(parsed.uri, uri);
  assert.equal(parsed.label, "C++");
});

test("legacy links decode the outer fragment once and remain parser-compatible", function () {
  const uri = "discrete:100-1-GS7P-6?amount=2.50&label=C%2B%2B";
  const shareLink = LEGACY_BASE + encodeURIComponent(uri);
  assert.match(shareLink, /label%3DC%252B%252B$/);
  const parsed = pay.parseShareHash(new URL(shareLink).hash);
  assert.equal(parsed.uri, uri);
  assert.equal(parsed.label, "C++");
  assert.equal(
    pay.makeCurrentShareLink(PAGE_LOCATION, parsed.uri),
    BASE + uri
  );
});

test("preserves a raw plus instead of applying form-url-encoded semantics", function () {
  const uri = "discrete:100-1-GS7P-6?label=C++";
  assert.equal(pay.parseShareHash(hashFor(uri)).label, "C++");
});

test("preserves unicode and reserved label characters", function () {
  const label = "Донат & coffee #1?";
  const uri = "discrete:100-1-GS7P-6?label=" + encodeURIComponent(label);
  assert.equal(pay.parseShareHash(hashFor(uri)).label, label);
});

test("accepts requests without an amount", function () {
  const parsed = pay.parsePaymentUri("discrete:100-1-GS7P-6?label=donate");
  assert.equal(parsed.amount, null);
  assert.equal(parsed.label, "donate");
});

test("accepts exact amount and label boundaries", function () {
  const label = "x".repeat(64);
  const parsed = pay.parsePaymentUri(
    "discrete:100-1-GS7P-6?amount=9999999.99&label=" + label
  );
  assert.equal(parsed.amount, "9999999.99");
  assert.equal(parsed.label, label);
  assert.throws(function () {
    pay.parsePaymentUri("discrete:100-1-GS7P-6?label=" + "x".repeat(65));
  });

  const utf16Boundary = encodeURIComponent("💸".repeat(32));
  assert.equal(
    pay.parsePaymentUri("discrete:100-1-GS7P-6?label=" + utf16Boundary).label,
    "💸".repeat(32)
  );
  assert.throws(function () {
    pay.parsePaymentUri(
      "discrete:100-1-GS7P-6?label=" + encodeURIComponent("💸".repeat(33))
    );
  });
});

test("accepts explicit zero while wallet-generated requests omit it", function () {
  assert.equal(
    pay.parsePaymentUri("discrete:100-1-GS7P-6?amount=0").amount,
    "0"
  );
  assert.equal(
    pay.parsePaymentUri("discrete:100-1-GS7P-6?amount=0.00").amount,
    "0.00"
  );
});

test("rejects full addresses and non-canonical schemes", function () {
  assert.throws(function () { pay.parsePaymentUri("discrete:disc1q8dch5gp5fmgrjsc0c3j8d3vfz2w"); });
  assert.throws(function () { pay.parsePaymentUri("DISCRETE:100-1-GS7P-6"); });
  assert.throws(function () { pay.parsePaymentUri("discrete://100-1-GS7P-6"); });
});

test("rejects malformed, duplicate, unknown, and excessive parameters", function () {
  assert.throws(function () { pay.parsePaymentUri("discrete:100-1-GS7P-6?amount=1&amount=2"); });
  assert.throws(function () { pay.parsePaymentUri("discrete:100-1-GS7P-6?message=hello"); });
  assert.throws(function () { pay.parsePaymentUri("discrete:100-1-GS7P-6?amount=10000000.00"); });
  assert.throws(function () { pay.parsePaymentUri("discrete:100-1-GS7P-6?amount=1.001"); });
  assert.throws(function () { pay.parsePaymentUri("discrete:100-1-GS7P-6?label=%E0%A4%A"); });
});

test("rejects control and bidirectional label characters", function () {
  const newline = "discrete:100-1-GS7P-6?label=" + encodeURIComponent("hello\nworld");
  const bidi = "discrete:100-1-GS7P-6?label=" + encodeURIComponent("pay\u202Eevil");
  assert.throws(function () { pay.parsePaymentUri(newline); });
  assert.throws(function () { pay.parsePaymentUri(bidi); });
});

test("rejects malformed or ambiguous outer fragments", function () {
  assert.throws(function () { pay.parseShareHash(""); });
  assert.throws(function () { pay.parseShareHash("#/v1/discrete:100-1-GS7P-6"); });
  assert.throws(function () { pay.parseShareHash("#request=x&v=1"); });
  assert.throws(function () { pay.parseShareHash("#v=2&request=x"); });
  assert.throws(function () { pay.parseShareHash("#v=1&request=x&extra=y"); });
  assert.throws(function () { pay.parseShareHash("#v=1&request=%E0%A4%A"); });
});

test("canonical current link is HTTPS and excludes page query parameters", function () {
  const uri = "discrete:100-1-GS7P-6?amount=1.00";
  const locationWithQuery = {
    protocol: "https:",
    origin: "https://discrete.cash",
    pathname: "/pay/",
    search: "?utm_source=chat"
  };
  assert.equal(
    pay.makeCurrentShareLink(locationWithQuery, uri),
    "https://discrete.cash/pay/#" + uri
  );
  assert.throws(function () {
    pay.makeCurrentShareLink({ protocol: "http:", origin: "http://example.test", pathname: "/pay/" }, uri);
  });
  assert.throws(function () {
    pay.makeShareLink("https://example.test/not-pay/#", uri);
  });
  assert.throws(function () {
    pay.makeShareLink("javascript:alert(1)", uri);
  });
  assert.throws(function () {
    pay.makeShareLink("https://example.test/pay/#v=1&request=", uri);
  });
});

test("QR renderer encodes the exact HTTPS share link", function () {
  const uri = "discrete:100-1-GS7P-6?amount=1.00&label=donate";
  const shareUrl = pay.makeCurrentShareLink(PAGE_LOCATION, uri);
  const mediumEcc = {};
  let encodedPayload = null;
  let encodedEcc = null;
  const qrLibrary = {
    QrCode: {
      Ecc: { MEDIUM: mediumEcc },
      encodeText: function (payload, ecc) {
        encodedPayload = payload;
        encodedEcc = ecc;
        return {
          size: 2,
          getModule: function (x, y) { return x === y; }
        };
      }
    }
  };
  const rectangles = [];
  const context = {
    imageSmoothingEnabled: true,
    fillStyle: "",
    fillRect: function (x, y, width, height) {
      rectangles.push({ x: x, y: y, width: width, height: height, color: this.fillStyle });
    }
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: function () { return context; }
  };

  const result = pay.renderQrCode(canvas, shareUrl, qrLibrary);
  assert.equal(encodedPayload, shareUrl);
  assert.equal(encodedEcc, mediumEcc);
  assert.equal(result.payload, shareUrl);
  assert.equal(result.moduleCount, 2);
  assert.equal(canvas.width, 300);
  assert.equal(canvas.height, 300);
  assert.equal(context.imageSmoothingEnabled, false);
  assert.equal(rectangles.length, 3);
  assert.throws(function () {
    pay.renderQrCode(canvas, uri, qrLibrary);
  });
});

test("page loads the local pinned QR generator and keeps QR initially hidden", function () {
  const html = fs.readFileSync(path.join(__dirname, "..", "pay", "index.html"), "utf8");
  const pageScript = fs.readFileSync(path.join(__dirname, "..", "pay", "pay.js"), "utf8");
  assert.match(html, /<script src="\.\/vendor\/qrcodegen\.js\?v=1\.8\.0" defer><\/script>\s*<script src="\.\/pay\.js\?v=20260801-2" defer><\/script>/);
  assert.match(html, /id="copy-link"[^>]*>Copy payment link<\/button>/);
  assert.match(html, /id="qr-panel"[^>]*hidden/);
  assert.doesNotMatch(html, /https?:\/\/[^"']+qrcode[^"']*\.js/i);
  assert.match(pageScript, /addEventListener\("hashchange"/);
  assert.match(pageScript, /root\.location\.reload\(\)/);
});

test("vendored QR generator matches the recorded v1.8.0 build", function () {
  const vendorPath = path.join(__dirname, "..", "pay", "vendor", "qrcodegen.js");
  const vendorSource = fs.readFileSync(vendorPath);
  const digest = crypto.createHash("sha256").update(vendorSource).digest("hex");
  assert.equal(digest, "6e200897a80ff15a652a5d601667856d807cec60cfc81a3a351305d69cc9dbbd");

  const notices = fs.readFileSync(
    path.join(__dirname, "..", "pay", "THIRD_PARTY_NOTICES.md"),
    "utf8"
  );
  assert.match(notices, /v1\.8\.0/);
  assert.match(notices, /7ad95cedd8464a87f82221283612732ae4f3f305/);
  assert.match(notices, /720f62bddb7226106071d4728c292cb1df519ceb/);
  assert.match(notices, /bcc182b1e61d509277569409f125072d887b4b84963403af549db7cae151076f/);
  assert.equal(fs.existsSync(path.join(__dirname, "..", "pay", "vendor", "qrcodegen.LICENSE.txt")), true);
});

test("actual vendored generator renders the canonical HTTPS share link", function () {
  const vendorPath = path.join(__dirname, "..", "pay", "vendor", "qrcodegen.js");
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(vendorPath, "utf8"), sandbox, { filename: vendorPath });

  const shareUrl = pay.makeCurrentShareLink(
    PAGE_LOCATION,
    "discrete:100-1-GS7P-6?amount=1.00&label=donate"
  );
  let paintedModules = 0;
  const context = {
    imageSmoothingEnabled: true,
    fillStyle: "",
    fillRect: function () { paintedModules += 1; }
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: function () { return context; }
  };

  const result = pay.renderQrCode(canvas, shareUrl, sandbox.qrcodegen);
  assert.equal(result.payload, shareUrl);
  assert.ok(result.moduleCount > 0);
  assert.ok(result.pixelSize > result.moduleCount);
  assert.ok(paintedModules > 1);
});
