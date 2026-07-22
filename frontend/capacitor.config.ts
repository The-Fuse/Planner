import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.kr1da.planner',
  appName: 'UPSC',
  webDir: 'dist',
  backgroundColor: '#060808',
  ios: {
    contentInset: 'never',
    backgroundColor: '#060808',
  },
};

export default config;
