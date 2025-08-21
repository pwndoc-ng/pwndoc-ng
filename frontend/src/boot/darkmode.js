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

// Update as soon as loading
updateDarkMode()

export default ({ app }) => {
  // Define global properties
  app.config.globalProperties.$toggleDarkMode = () => {
    updateDarkMode(!Dark.isActive)
  }

  app.config.globalProperties.$updateDarkMode = updateDarkMode
}

export { updateDarkMode }