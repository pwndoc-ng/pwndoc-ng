// Global setup of the tests: Quasar (with the plugins of quasar.config.cjs) and vue-i18n
import { createApp } from 'vue'
import { config } from '@vue/test-utils'
import { Quasar, Cookies, Dialog, Loading, Notify, Dark } from 'quasar'

import { i18n } from '@/boot/i18n'

// Plugins installed once, as in the application: Notify.create, Dialog.create... are defined by their installation.
// They are not installed again for each mounted component, which would replace the spies of the tests
// (the sources call Notify.create / Dialog.create, never this.$q.notify / this.$q.dialog).
createApp({}).use(Quasar, { plugins: { Cookies, Dialog, Loading, Notify, Dark } })

// Browser APIs missing in jsdom, used by some Quasar components (QScrollArea...)
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

// Mounted components: Quasar (components compiled by @quasar/vite-plugin) and the translations
config.global.plugins = [[Quasar, {}], i18n]
