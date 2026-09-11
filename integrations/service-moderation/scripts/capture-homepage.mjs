import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { pinnedAddress, publicResource } from "./preview-network.js";

const [requestPath, outputPath] = process.argv.slice(2);
if (!requestPath || !outputPath) throw new Error("Preview request and output paths are required.");

const request = JSON.parse(await readFile(requestPath, "utf8"));
if (!request || typeof request !== "object" || Array.isArray(request) ||
    Object.keys(request).sort().join(",") !== "id,url" ||
    typeof request.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(request.id)) {
  throw new Error("Preview request is invalid.");
}

const target = new URL(request.url);
if (target.protocol !== "https:" || target.username || target.password) {
  throw new Error("Preview URL must use credential-free HTTPS.");
}

await pinnedAddress(target.hostname);

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    ignoreHTTPSErrors: false,
    serviceWorkers: "block"
  });
  let count = 0;
  let totalBytes = 0;
  await context.routeWebSocket('**/*', socket => socket.close());
  await context.route("**/*", async (route) => {
    try {
      if (++count > 200 || totalBytes > 50_000_000 || !['GET', 'HEAD'].includes(route.request().method())) {
        throw new Error('Preview request budget exceeded.');
      }
      const resource = await publicResource(route.request().url(), route.request().headers());
      totalBytes += resource.body.length;
      if (totalBytes > 50_000_000) throw new Error('Preview response budget exceeded.');
      await route.fulfill(resource);
    } catch (_error) {
      await route.abort("blockedbyclient");
    }
  });

  const page = await context.newPage();
  page.on('download', download => download.cancel());
  const response = await page.goto(target.href, { waitUntil: "domcontentloaded", timeout: 30_000 });
  if (!response || response.status() >= 400) throw new Error("Homepage returned an unsuccessful response.");
  const finalUrl = new URL(page.url());
  if (finalUrl.protocol !== "https:") throw new Error("Homepage redirected away from HTTPS.");
  await pinnedAddress(finalUrl.hostname);
  await page.waitForTimeout(2_000);
  await page.screenshot({ path: outputPath, type: "png", fullPage: false });
  await context.close();
} finally {
  await browser.close();
}
