import { isIP } from "node:net";

function publicIpv4(address) {
  const bytes = address.split(".").map(Number);
  if (bytes.length !== 4 || bytes.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return false;
  const [a, b, c] = bytes;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function ipv6Parts(address) {
  let normalized = address.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  const dotted = normalized.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const bytes = dotted[1].split(".").map(Number);
    if (bytes.length !== 4 || bytes.some((value) => value < 0 || value > 255)) return null;
    normalized = normalized.slice(0, -dotted[1].length) +
      ((bytes[0] << 8) | bytes[1]).toString(16) + ":" + ((bytes[2] << 8) | bytes[3]).toString(16);
  }
  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const parts = [...left, ...Array(missing).fill("0"), ...right];
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  return parts.map((part) => Number.parseInt(part, 16));
}

function publicIpv6(address) {
  const parts = ipv6Parts(address);
  if (!parts) return false;
  if (parts.every((part) => part === 0) || parts.slice(0, 7).every((part) => part === 0) && parts[7] === 1) return false;
  if ((parts[0] & 0xfe00) === 0xfc00) return false;
  if ((parts[0] & 0xffc0) === 0xfe80 || (parts[0] & 0xffc0) === 0xfec0) return false;
  if ((parts[0] & 0xff00) === 0xff00) return false;
  if (parts[0] === 0x2001 && parts[1] === 0x0db8) return false;
  const ipv4Mapped = parts.slice(0, 5).every((part) => part === 0) && parts[5] === 0xffff;
  const ipv4Compatible = parts.slice(0, 6).every((part) => part === 0);
  if (ipv4Mapped || ipv4Compatible) {
    const ipv4 = [parts[6] >> 8, parts[6] & 0xff, parts[7] >> 8, parts[7] & 0xff].join(".");
    return publicIpv4(ipv4);
  }
  return true;
}

export function isPublicAddress(address) {
  const family = isIP(address);
  if (family === 4) return publicIpv4(address);
  if (family === 6) return publicIpv6(address);
  return false;
}

export function assertPublicHostname(hostname) {
  const normalized = String(hostname || "").toLowerCase().replace(/\.$/, "");
  if (!normalized || normalized === "localhost" || normalized.endsWith(".localhost") ||
      normalized.endsWith(".local") || normalized.endsWith(".internal") ||
      normalized.endsWith(".home.arpa") || normalized.endsWith(".onion")) {
    throw new Error("Preview hostname is not public.");
  }
  if (isIP(normalized) && !isPublicAddress(normalized)) {
    throw new Error("Preview address is not public.");
  }
  return normalized;
}
