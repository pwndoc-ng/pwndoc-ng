import { Dark } from 'quasar'

function updateDarkMode(dark = null) {
  let darkmode = !!localStorage.getItem('darkmodeEnabled') || false

  if (dark !== null) {
    darkmode = dark
  }

  Dark.set(darkmode)

  if (darkmode) {
    localStorage.setItem('darkmodeEnabled', 'y')
  } else {
    localStorage.removeItem('darkmodeEnabled')
  }
}

// Met à jour dès le chargement
updateDarkMode()

export default ({ app }) => {
  // Définir les propriétés globales
  app.config.globalProperties.$toggleDarkMode = () => {
    updateDarkMode(!Dark.isActive)
  }

  app.config.globalProperties.$updateDarkMode = updateDarkMode
}

export { updateDarkMode }