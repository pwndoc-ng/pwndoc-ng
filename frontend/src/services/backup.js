import { api } from 'boot/axios'

// Global backup of the instance data (export / full restore)
export default {
  // Zip archive (encrypted when a password is given), returned as a Blob
  exportBackup: function(password, onDownloadProgress) {
    return api.post('backup/export', {password: password || undefined}, {responseType: 'blob', timeout: 0, onDownloadProgress})
  },

  // Replaces all the data of the instance by the backup file
  importBackup: function(file, password, onUploadProgress) {
    var headers = {'Content-Type': 'application/octet-stream'}
    if (password) // Base64: the header only accepts ASCII characters
      headers['X-Backup-Password'] = btoa(String.fromCharCode(...new TextEncoder().encode(password)))
    return api.post('backup/import', file, {headers, timeout: 0, onUploadProgress})
  },

  // Error message of a request (Blob body for the export)
  async errorMessage(err) {
    var data = err.response && err.response.data
    if (data instanceof Blob) {
      try { data = JSON.parse(await data.text()) } catch (e) { data = null }
    }
    return (data && data.datas) || err.message
  }
}
