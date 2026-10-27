module.exports = {
  preset: '@react-native/jest-preset',
  setupFiles: ['./jest.setup.js'],
  testMatch: ['<rootDir>/src/**/*.test.tsx', '<rootDir>/src/**/*.test.ts'],
  // Preset default only transforms react-native/@react-native(-community) packages; these
  // third-party RN-ecosystem deps ship untranspiled ESM/Flow too and need babel-jest as well.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-navigation|@react-native-async-storage|react-native-screens|react-native-safe-area-context)/)',
  ],
};
