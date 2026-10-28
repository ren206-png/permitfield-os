import { isIP } from 'node:net';

// Gate 6.3: outbound-request guard for source checks (master prompt §10,
// §19 SSRF). A registered source URL is fetched by a background job, so a
// bad URL -- typed by an admin or planted in the registry -- must not be
// able to reach the platform's own network: loopback, private ranges, link-
// local (cloud metadata at 169.254.169.254), CGNAT, multicast, or IPv6
// equivalents. The address check runs on the address actually connected to
// (see fetch-source.ts), not only on a pre-resolution, so DNS rebinding
// between check and connect does not get through.

export type UrlGuardResult = { ok: true; url: URL } | { ok: false; code: UrlBlockCode; message: string };
export type UrlBlockCode = 'invalid_url' | 'scheme_not_allowed' | 'credentials_in_url' | 'port_not_allowed' | 'address_not_public';

export function validateSourceUrl(raw: string): UrlGuardResult {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, code: 'invalid_url', message: 'Not a valid URL.' };
  }
  if (url.protocol !== 'https:') {
    return { ok: false, code: 'scheme_not_allowed', message: 'Only https:// sources are fetched.' };
  }
  if (url.username || url.password) {
    return { ok: false, code: 'credentials_in_url', message: 'URLs with credentials are not fetched.' };
  }
  if (url.port && url.port !== '443') {
    return { ok: false, code: 'port_not_allowed', message: 'Only the default https port is fetched.' };
  }
  // "localhost." (trailing dot) is the same host as "localhost".
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (isIP(host) && !isPublicIpAddress(host)) {
    return { ok: false, code: 'address_not_public', message: 'The address is not a public internet address.' };
  }
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return { ok: false, code: 'address_not_public', message: 'The host is not a public internet host.' };
  }
  return { ok: true, url };
}

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, octet) => acc * 256 + Number(octet), 0);
}

const BLOCKED_V4: [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

function isPublicIpv4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  return !BLOCKED_V4.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return ((value & mask) >>> 0) === ((ipv4ToInt(base) & mask) >>> 0);
  });
}

function expandIpv6(ip: string): number[] | null {
  let address = ip.toLowerCase();
  const zone = address.indexOf('%');
  if (zone >= 0) address = address.slice(0, zone);
  // Trailing dotted IPv4 (e.g. ::ffff:10.0.0.1).
  const v4 = address.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const n = ipv4ToInt(v4[1]);
    address = `${address.slice(0, -v4[1].length)}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [head, tail] = address.split('::');
  const headParts = head ? head.split(':') : [];
  const tailParts = tail !== undefined && tail ? tail.split(':') : [];
  const fill = tail !== undefined ? 8 - headParts.length - tailParts.length : 0;
  const parts = [...headParts, ...Array(Math.max(fill, 0)).fill('0'), ...tailParts];
  if (parts.length !== 8) return null;
  const words = parts.map((p) => parseInt(p, 16));
  return words.some((w) => Number.isNaN(w) || w < 0 || w > 0xffff) ? null : words;
}

function isPublicIpv6(ip: string): boolean {
  const w = expandIpv6(ip);
  if (!w) return false;
  if (w.every((x) => x === 0)) return false; // ::
  if (w.slice(0, 7).every((x) => x === 0) && w[7] === 1) return false; // ::1
  // IPv4-mapped / IPv4-compatible / NAT64: judge the embedded IPv4 address.
  const embedded = `${w[6] >> 8}.${w[6] & 0xff}.${w[7] >> 8}.${w[7] & 0xff}`;
  if (w.slice(0, 5).every((x) => x === 0) && (w[5] === 0xffff || w[5] === 0)) return isPublicIpv4(embedded);
  if (w[0] === 0x64 && w[1] === 0xff9b) return isPublicIpv4(embedded);
  if ((w[0] & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
  if ((w[0] & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
  if ((w[0] & 0xffc0) === 0xfec0) return false; // fec0::/10 site-local (deprecated)
  if ((w[0] & 0xff00) === 0xff00) return false; // ff00::/8 multicast
  if (w[0] === 0x2001 && w[1] === 0x0db8) return false; // documentation
  if (w[0] === 0x2002) return isPublicIpv4(`${w[1] >> 8}.${w[1] & 0xff}.${w[2] >> 8}.${w[2] & 0xff}`); // 6to4
  return true;
}

export function isPublicIpAddress(ip: string): boolean {
  const family = isIP(ip.replace(/%.*$/, ''));
  if (family === 4) return isPublicIpv4(ip);
  if (family === 6) return isPublicIpv6(ip);
  return false;
}
