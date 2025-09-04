import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.wallex.app',
  appName: 'Wallex',
  webDir: 'out',
  server: {
    androidScheme: 'https'
  }
};

export default config;
