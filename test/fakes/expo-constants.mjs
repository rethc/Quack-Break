// Fake 'expo-constants': just the app config the services read.
const Constants = {
  expoConfig: {
    name: 'Quack Break',
    slug: 'quack-break',
    android: { package: 'com.chesd.quackbreak' },
    ios: { bundleIdentifier: 'com.chesd.quackbreak' },
  },
};

export default Constants;
