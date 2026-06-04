 

import base44 from "@base44/vite-plugin"
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const useLocalBackend = env.VITE_USE_LOCAL_BACKEND === "true";
  const localTarget = env.VITE_LOCAL_BACKEND_URL || "http://localhost:3001";
  const legacySDKImportsRaw = env.BASE44_LEGACY_SDK_IMPORTS ?? process.env.BASE44_LEGACY_SDK_IMPORTS ?? "";
  const legacySDKImports = String(legacySDKImportsRaw).trim() === "true";

  return {
    logLevel: 'error', // Suppress warnings, only show errors
    plugins: [
      ...(useLocalBackend
        ? []
        : [
            base44({
              // Support for legacy code that imports the base44 SDK with @/integrations, @/entities, etc.
              // can be removed if the code has been updated to use the new SDK imports from @base44/sdk
              legacySDKImports,
              hmrNotifier: true,
              navigationNotifier: true,
              analyticsTracker: true,
              visualEditAgent: true
            })
          ]),
      react(),
    ],
    resolve: {
      alias: {
        "@": path.resolve("./src")
      }
    },
    server: useLocalBackend
      ? {
          watch: {
            ignored: ["**/backend/**", "**/dist/**", "**/.docker/**", "**/.npm-cache/**", "**/uploads/**"]
          },
          proxy: {
            "/api": localTarget,
            "/auth": localTarget,
            "/integrations": localTarget,
            "/uploads": localTarget
          }
        }
      : {
          watch: {
            ignored: ["**/backend/**", "**/dist/**", "**/.docker/**", "**/.npm-cache/**", "**/uploads/**"]
          }
        }
  };
});
