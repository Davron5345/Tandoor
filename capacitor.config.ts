import type { CapacitorConfig } from '@capacitor/cli';

const serverUrl = process.env.CAPACITOR_SERVER_URL?.trim();

const config: CapacitorConfig = {
  appId: 'com.tandoor.snab',
  appName: 'Mahalla Снабжение',
  webDir: 'client/dist',
  android: {
    useLegacyBridge: true,
  },
  ...(serverUrl ? {
    server: {
      url: `${serverUrl.replace(/\/$/, '')}/warehouse/orders`,
      cleartext: false,
    },
  } : {}),
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
