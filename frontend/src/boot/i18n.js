import { createI18n } from 'vue-i18n'
import messages from '@/i18n'

let language = localStorage.getItem('system_language')
if (!language) {
  language = 'en-US'
  localStorage.setItem('system_language', language)
}

const i18n = createI18n({
  legacy: false, // IMPORTANT : Pour utiliser la Composition API
  locale: language,
  fallbackLocale: 'en-US',
  messages,
  globalInjection: true, // Pour pouvoir utiliser $t dans les templates sans setup()
})

export default ({ app }) => {
  app.use(i18n)
}

export { i18n }

// Fonction utilitaire équivalente à $t() dans les fichiers JS purs
export const $t = (...params) => i18n.global.t(...params)