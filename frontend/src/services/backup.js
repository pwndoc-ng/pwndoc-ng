import { api } from 'boot/axios'
import Utils from '@/services/utils'

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

  // Creation or restore in progress on the server, null if none: {type, step, done, total}
  getProgress: function() {
    return api.get('backups/progress')
  },

  // Automatic backups (settings): {enabled, encrypted, nextRun}
  getSchedule: function() {
    return api.get('backups/schedule')
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

  // Address of the archive of a backup, downloaded by the browser: written to the disk while it is received (backups of
  // several GB), authenticated by the session cookie
  downloadUrl: function(backupId) {
    return `${api.defaults.baseURL}/backups/${encodeURIComponent(backupId)}/download`
  },

  // mode: 'replace' (data of the categories replaced) or 'merge' (documents added or updated, nothing deleted)
  restoreBackup: function(backupId, mode, categories, password) {
    return api.post(`backups/${backupId}/restore`, {mode: mode, categories: categories, password: password || undefined}, {timeout: 0})
  },

  deleteBackup: function(backupId) {
    return api.delete(`backups/${backupId}`)
  },

  // Error message of a request (Blob body for the downloads)
  errorMessage(err) {
    return Utils.requestErrorMessage(err)
  }
}
