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

// The Expo/Metro toolchain applies tsconfig "paths" during bundling, and this
// app's tsconfig maps "react"/"react-native" to TYPE-ONLY targets
// (@types/react, react-native/types_generated) so tsc can typecheck the
// shared packages under ../../packages. Those targets are not runnable code,
// so Metro must never resolve the bare specifiers through them. Intercept the
// exact specifiers first and resolve them to the real runtime packages;
// everything else (including "react/jsx-runtime" and "react-native/*")
// delegates to the default resolver untouched.
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "react" || moduleName === "react-native") {
    return context.resolveRequest(
      context,
      path.resolve(projectRoot, "node_modules", moduleName),
      platform
    );
  }
  if (typeof defaultResolveRequest === "function") {
    return defaultResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};
