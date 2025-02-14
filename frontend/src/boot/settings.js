import { boot } from 'quasar/wrappers'
import Settings from '@/services/settings'

export default boot(async ({ app }) => {
  const settingsData = {}

  try {
    const response = await Settings.getPublicSettings()
    Object.assign(settingsData, response.data.datas)
  } catch (err) {
    console.error('Failed to load settings:', err)
  }

  // Ajout de la méthode `refresh`
  settingsData.refresh = async () => {
    try {
      const response = await Settings.getPublicSettings()
      Object.assign(settingsData, response.data.datas)
    } catch (err) {
      console.error('Failed to refresh settings:', err)
    }
  }

  // Ajoute `$settings` dans l'app (Vue 3)
  app.config.globalProperties.$settings = settingsData
})
