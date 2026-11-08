// Unit / component tests of the frontend (Vitest + @vue/test-utils + jsdom)
// Run: npm test (or npx vitest run)
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { quasar, transformAssetUrls } from '@quasar/vite-plugin'

const src = (path = '') => fileURLToPath(new URL(`./src/${path}`, import.meta.url))

// Node >= 25 defines its own localStorage global (undefined without --localstorage-file) which hides the jsdom one
const nodeWebStorage = process.allowedNodeEnvironmentFlags.has('--experimental-webstorage')

export default defineConfig({
  plugins: [
    vue({ template: { transformAssetUrls } }),
    // Compiles the Quasar components used in the templates (the app uses stylus, no sass variables)
    quasar({ sassVariables: false })
  ],
  resolve: {
    // Same aliases as @quasar/app-webpack (quasar.config.cjs adds '@')
    alias: {
      '@': src(),
      src: src(),
      app: fileURLToPath(new URL('./', import.meta.url)),
      boot: src('boot'),
      components: src('components'),
      layouts: src('layouts'),
      pages: src('pages'),
      assets: src('assets')
    },
    // Imports without extension of .vue files ('components/breadcrumb', 'pages/audits'...)
    extensions: ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json', '.vue']
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.spec.js'],
    setupFiles: ['test/setup.js'],
    execArgv: nodeWebStorage ? ['--no-experimental-webstorage'] : [],
    restoreMocks: true,
    unstubGlobals: true
  }
})
