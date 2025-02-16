import { api } from 'boot/axios'

export default {
  getCompanies: function() {
    return  api.get(`companies`)
  },

  exportCompanies: function() {
    return  api.get(`companies/export`)
  },

  createCompanies: function(company) {
    return  api.post('companies', company)
  },

  updateCompany: function(companyId, company) {
    return  api.put(`companies/${companyId}`, company)
  },

  deleteCompany: function(companyId) {
    return  api.delete(`companies/${companyId}`)
  },

  deleteAllCompanies: function() {
    return  api.delete(`companies`)
  }
}