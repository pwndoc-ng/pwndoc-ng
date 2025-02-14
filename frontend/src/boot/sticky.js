import { boot } from 'quasar/wrappers'
import Sticky from 'vue3-sticky-directive'

export default boot(({ app }) => {
  app.use(Sticky)
})