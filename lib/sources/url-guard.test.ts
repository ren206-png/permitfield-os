import { describe, expect, it } from 'vitest';
import { guardedLookup } from './fetch-source';
import { isPublicIpAddress, validateSourceUrl } from './url-guard';

describe('isPublicIpAddress', () => {
  it.each([
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1',
    '0.0.0.0', '224.0.0.1', '255.255.255.255', '198.18.0.1', '192.0.2.10',
    '::', '::1', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', '2001:db8::1',
    '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:7f00:1', '64:ff9b::a9fe:a9fe', '2002:c0a8:0101::1', 'fe80::1%en0',
  ])('blocks %s', (ip) => {
    expect(isPublicIpAddress(ip)).toBe(false);
  });

  it.each(['8.8.8.8', '142.250.72.14', '172.32.0.1', '2607:f8b0:4005:80b::200e', '::ffff:8.8.8.8'])('allows %s', (ip) => {
    expect(isPublicIpAddress(ip)).toBe(true);
  });

  it('rejects things that are not addresses', () => {
    expect(isPublicIpAddress('example.com')).toBe(false);
    expect(isPublicIpAddress('')).toBe(false);
  });
});

describe('validateSourceUrl', () => {
  it('accepts a normal https URL', () => {
    expect(validateSourceUrl('https://www.toronto.ca/services-payments/building-construction/').ok).toBe(true);
  });

  it.each([
    ['http://www.toronto.ca/', 'scheme_not_allowed'],
    ['file:///etc/passwd', 'scheme_not_allowed'],
    ['ftp://example.com/', 'scheme_not_allowed'],
    ['https://user:pass@example.com/', 'credentials_in_url'],
    ['https://example.com:8443/', 'port_not_allowed'],
    ['https://127.0.0.1/', 'address_not_public'],
    ['https://[::1]/', 'address_not_public'],
    ['https://169.254.169.254/latest/meta-data/', 'address_not_public'],
    ['https://localhost/', 'address_not_public'],
    ['https://localhost./', 'address_not_public'],
    ['https://metadata.google.internal/', 'address_not_public'],
    ['not a url', 'invalid_url'],
  ])('blocks %s (%s)', (url, code) => {
    const result = validateSourceUrl(url);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(code);
  });
});

describe('guardedLookup (checked at connect time, defeats DNS rebinding)', () => {
  it('refuses a name that resolves to loopback', async () => {
    const error = await new Promise<NodeJS.ErrnoException | null>((resolve) => guardedLookup('localhost', {}, (err) => resolve(err)));
    expect(error).not.toBeNull();
    expect((error as { code?: string }).code).toBe('address_not_public');
  });
});
