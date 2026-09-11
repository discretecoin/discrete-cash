"use strict";

(function (root, factory) {
  const catalog = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = catalog;
  }

  if (root) {
    root.DiscreteServiceCatalog = catalog;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  return Object.freeze([]);
});
