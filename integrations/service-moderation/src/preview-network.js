import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { assertPublicHostname, isPublicAddress } from './public-network.js';

export async function pinnedAddress(hostname, resolve = lookup) {
  const host = assertPublicHostname(hostname.replace(/^\[|\]$/g, ''));
  const addresses = await resolve(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(entry => !isPublicAddress(entry.address))) {
    throw new Error('Preview destination must resolve only to public addresses.');
  }
  return addresses.find(entry => entry.family === 4) || addresses[0];
}

export async function publicResource(url, requestHeaders = {}) {
  const target = new URL(url);
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password ||
      (target.port && !['80', '443'].includes(target.port))) throw new Error('Preview resource URL is not allowed.');
  const address = await pinnedAddress(target.hostname);
  // Connect to the address checked above; no second DNS resolution by Chromium.
  const headers = { 'accept-encoding': 'identity' };
  for (const key of ['accept', 'accept-language', 'user-agent']) {
    if (requestHeaders[key]) headers[key] = requestHeaders[key];
  }
  return new Promise((resolve, reject) => {
    const transport = target.protocol === 'https:' ? https : http;
    const request = transport.get(target, {
      headers, agent: false, family: address.family,
      lookup: (_host, options, callback) => options.all
        ? callback(null, [address]) : callback(null, address.address, address.family)
    }, response => {
      const chunks = [];
      let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > 10_000_000) request.destroy(new Error('Preview resource is too large.'));
        else chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => {
        const responseHeaders = {};
        for (const [name, value] of Object.entries(response.headers)) {
          if (value !== undefined && !['connection', 'transfer-encoding', 'content-length', 'set-cookie'].includes(name)) {
            responseHeaders[name] = Array.isArray(value) ? value.join(', ') : value;
          }
        }
        resolve({ status: response.statusCode, headers: responseHeaders, body: Buffer.concat(chunks) });
      });
    });
    const timer = setTimeout(() => request.destroy(new Error('Preview resource timed out.')), 15_000);
    request.on('close', () => clearTimeout(timer));
    request.on('error', reject);
  });
}
