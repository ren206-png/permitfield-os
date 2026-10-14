import type { CapacitorConfig } from '@capacitor/cli';

// iOS app (ios/App): a native shell around the live site, so web releases
// reach the app without an App Store update. Native extras live in
// ios/App/App (document scanner plugin). mobile/www is only the offline
// fallback page Capacitor requires as webDir.
const config: CapacitorConfig = {
  appId: 'com.rennerkargbo.permitfieldos',
  appName: 'PermitField OS',
  webDir: 'mobile/www',
  server: {
    url: 'https://www.permitfieldos.com/applications',
    cleartext: false,
    errorPath: 'index.html',
    // Only our own site navigates inside the app; any other link opens in
    // Safari.
    allowNavigation: ['www.permitfieldos.com', 'permitfieldos.com'],
  },
  // Lets the site tell it's running in the app (hides Google/Microsoft
  // sign-in, which Google blocks inside apps; shows "Scan with camera").
  appendUserAgent: 'PermitFieldiOS',
  ios: {
    contentInset: 'automatic',
    backgroundColor: '#fafafa',
    limitsNavigationsToAppBoundDomains: false,
    allowsLinkPreview: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      launchAutoHide: true,
      backgroundColor: '#fafafa',
      showSpinner: false,
    },
    StatusBar: {
      style: 'LIGHT',
      backgroundColor: '#ffffff',
      overlaysWebView: false,
    },
  },
};

export default config;
