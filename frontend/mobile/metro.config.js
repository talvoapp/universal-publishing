const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Enable symlinks for monorepo support (if needed)
config.resolver.unstable_enableSymlinks = true;

module.exports = config;