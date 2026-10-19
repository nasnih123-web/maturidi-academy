/**
 * apps/mobile — metro.config.js
 *
 * The shared packages (@maturidi/ui-native, @maturidi/design-tokens) are
 * linked via `file:` dependencies (npm symlinks). Until the repo gains
 * proper monorepo tooling with hoisted dependencies, this config:
 *
 *  1. watches ../../packages so Metro rebuilds when the shared UI kit changes;
 *  2. forces `react` / `react-native` to resolve to the app's single copy
 *     (two React copies = broken hooks — the classic symlinked-monorepo bug).
 */
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [path.resolve(workspaceRoot, "packages")];

config.resolver.nodeModulesPaths = [path.resolve(projectRoot, "node_modules")];

config.resolver.extraNodeModules = {
  react: path.resolve(projectRoot, "node_modules/react"),
  "react-native": path.resolve(projectRoot, "node_modules/react-native"),
};

module.exports = config;
