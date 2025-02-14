import { createRouter, createWebHistory } from 'vue-router'
import routes from './routes'

const Router = createRouter({

  mode: process.env.VUE_ROUTER_MODE,
  base: process.env.VUE_ROUTER_BASE,
  scrollBehavior: () => ({ top: 0 }),
  history: createWebHistory(process.env.VUE_ROUTER_BASE),
  routes
})

export default Router