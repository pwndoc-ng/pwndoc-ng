import { api } from 'boot/axios'

// Backups of the instance data, stored on the server
export default {
  // Data that can be selected in a backup (keys of the server), grouped for the selection tree
  CATEGORY_GROUPS: [
    { key: 'audits', categories: ['audits'] },
    { key: 'vulnerabilities', categories: ['vulnerabilities'] },
    { key: 'images', categories: ['images'] },
    { key: 'users', categories: ['users'] },
    { key: 'customers', categories: ['companies', 'clients'] },
    { key: 'templates', categories: ['templates'] },
    { key: 'customData', categories: ['languages', 'auditTypes', 'vulnerabilityTypes', 'vulnerabilityCategories', 'customFields', 'customSections'] },
    { key: 'settings', categories: ['settings'] },
  ],
  // Categories always saved with another one (same rules as the server)
  DEPENDENCIES: { audits: ['images'], vulnerabilities: ['images'], clients: ['companies'] },

  getBackups: function() {
    return api.get('backups')
  },

  // Backup of all the data (categories not given) or of the selected categories, encrypted when a password is given
  createBackup: function(name, categories, password) {
    return api.post('backups', {name: name, categories: categories || undefined, password: password || undefined}, {timeout: 0})
  },

  // Adds a backup file to the backups of the server
  uploadBackup: function(file, onUploadProgress) {
    var headers = {'Content-Type': 'application/octet-stream', 'X-Backup-Filename': encodeURIComponent(file.name)}
    return api.post('backups/upload', file, {headers, timeout: 0, onUploadProgress})
  },

  // Archive of a backup, returned as a Blob
  downloadBackup: function(backupId, onDownloadProgress) {
    return api.get(`backups/${backupId}/download`, {responseType: 'blob', timeout: 0, onDownloadProgress})
  },

  // mode: 'replace' (data of the categories replaced) or 'merge' (documents added or updated, nothing deleted)
  restoreBackup: function(backupId, mode, categories, password) {
    return api.post(`backups/${backupId}/restore`, {mode: mode, categories: categories, password: password || undefined}, {timeout: 0})
  },

  deleteBackup: function(backupId) {
    return api.delete(`backups/${backupId}`)
  },

  // Error message of a request (Blob body for the downloads)
  async errorMessage(err) {
    var data = err.response && err.response.data
    if (data instanceof Blob) {
      try { data = JSON.parse(await data.text()) } catch (e) { data = null }
    }
    return (data && data.datas) || err.message
  }
}
