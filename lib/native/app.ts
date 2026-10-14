import { useSyncExternalStore } from 'react';

// The iPhone app (ios/App, capacitor.config.ts) loads this site inside a
// native shell. Capacitor injects window.Capacitor there, with the app's own
// plugins (ios/App/App/DocumentScannerPlugin.swift). Nothing here runs or
// changes on the website in a normal browser.

export type DocumentScanResult = { base64?: string; pageCount?: number; byteSize?: number; cancelled?: boolean };
export type AppleSignInResult = { identityToken?: string; nonce?: string; givenName?: string; familyName?: string; cancelled?: boolean };

type CapacitorGlobal = {
  isNativePlatform?: () => boolean;
  Plugins?: {
    DocumentScanner?: {
      isAvailable: () => Promise<{ available: boolean }>;
      scan: () => Promise<DocumentScanResult>;
    };
    AppleSignIn?: {
      signIn: () => Promise<AppleSignInResult>;
    };
  };
};

export function nativeApp(): CapacitorGlobal | null {
  if (typeof window === 'undefined') return null;
  const capacitor = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
  return capacitor?.isNativePlatform?.() ? capacitor : null;
}

const subscribe = () => () => {};

// False on the server and during hydration, so the HTML matches; true once
// running inside the app.
export function useIsNativeApp(): boolean {
  return useSyncExternalStore(subscribe, () => nativeApp() !== null, () => false);
}

// "Scan 2026-10-14 10-32.pdf" -- the name the upload list and AI see.
export function scanFileName(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `Scan ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}-${pad(date.getMinutes())}.pdf`;
}

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
