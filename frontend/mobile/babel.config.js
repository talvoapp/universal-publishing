module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        'module-resolver',
        {
          root: ['./src'],
          alias: {
            '@': './src',
          },
          extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
        },
      ],
      // 'expo-router/babel' is now part of babel-preset-expo in SDK 51+
      // Keeping it here causes a warning but is harmless. Remove it if
      // you're on SDK 51 or later.
      // 'expo-router/babel',
      'react-native-reanimated/plugin',
    ],
  };
};