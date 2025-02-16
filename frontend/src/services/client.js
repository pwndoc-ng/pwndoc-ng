import { api } from 'boot/axios'

export default {
  getClients: function() {
    return  api.get(`clients`)
  },

  exportClients: function() {
    return  api.get(`clients/export`)
  },

  createClients: function(client) {
    return  api.post('clients', client)
  },

  updateClient: function(clientId, client) {
    return  api.put(`clients/${clientId}`, client)
  },

  deleteClient: function(clientId) {
    return  api.delete(`clients/${clientId}`)
  },

  deleteAllClients: function() {
    return  api.delete(`clients`)
  }
}