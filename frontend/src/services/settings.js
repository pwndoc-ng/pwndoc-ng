import { api } from 'boot/axios'

export default {
  getSettings() {
    return api.get(`settings`)
  },

  getPublicSettings() {
    return api.get(`settings/public`)
  },

  updateSettings(params) {
    return api.put(`settings`, params)
  },

  exportSettings() {
    return api.get(`settings/export`)
  },

  revertDefaults() {
    return api.put(`settings/revert`)
  }
}