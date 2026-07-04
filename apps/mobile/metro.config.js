// Metro config for a pnpm monorepo: watch the workspace root so
// @kloop/shared (TS source) resolves and hot-reloads.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

// @kloop/shared uses NodeNext-style ".js" extensions on relative imports of
// .ts files. Metro resolves extensions literally, so on failure retry without
// the extension and let sourceExts (.ts/.tsx) resolution take over.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  try {
    return context.resolveRequest(context, moduleName, platform);
  } catch (error) {
    if (moduleName.startsWith(".") && moduleName.endsWith(".js")) {
      return context.resolveRequest(context, moduleName.replace(/\.js$/, ""), platform);
    }
    throw error;
  }
};

module.exports = config;
