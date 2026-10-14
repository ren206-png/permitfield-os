import { describe, it, expect } from 'vitest';
import { base64ToBytes, nativeApp, scanFileName } from './app';

describe('scanFileName()', () => {
  it('names scans by local date and time', () => {
    expect(scanFileName(new Date(2026, 9, 14, 9, 5))).toBe('Scan 2026-10-14 09-05.pdf');
  });
});

describe('base64ToBytes()', () => {
  it('decodes a PDF header', () => {
    expect(String.fromCharCode(...base64ToBytes(btoa('%PDF-1.7')))).toBe('%PDF-1.7');
  });
});

describe('nativeApp()', () => {
  it('is null outside the iPhone app', () => {
    expect(nativeApp()).toBeNull();
  });
});
