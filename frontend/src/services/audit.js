import { api } from 'boot/axios'

export default {
  getAudits: function(filters) {
    var queryParams = "?";
    if (filters)
      if (filters.findingTitle)
        queryParams += `findingTitle=${encodeURIComponent(filters.findingTitle)}`;
    return  api.get(`audits${queryParams}`)
  },

  getAudit: function(auditId) {
    return  api.get(`audits/${auditId}`)
  },

  createAudit: function(audit) {
    return  api.post('audits', audit)
  },

  createClonedAudit: function(auditId, newName) {
    return  api.post(`audits/${auditId}/clone`, { name: newName })
  },

  deleteAudit: function(auditId) {
    return  api.delete(`audits/${auditId}`)
  },

  getAuditGeneral: function(auditId) {
    return  api.get(`audits/${auditId}/general`)
  },

  updateAuditGeneral: function(auditId, audit) {
    return  api.put(`audits/${auditId}/general`, audit)
  },

  getAuditNetwork: function(auditId) {
    return  api.get(`audits/${auditId}/network`)
  },

  updateAuditNetwork: function(auditId, audit) {
    return  api.put(`audits/${auditId}/network`, audit)
  },

  createFinding: function(auditId, finding) {
    return  api.post(`audits/${auditId}/findings`, finding)
  },
  
  getFinding: function(auditId, findingId) {
    return  api.get(`audits/${auditId}/findings/${findingId}`)
  },

  updateFinding: function(auditId, findingId, finding) {
    return  api.put(`audits/${auditId}/findings/${findingId}`, finding)
  },

  deleteFinding: function(auditId, findingId) {
    return  api.delete(`audits/${auditId}/findings/${findingId}`)
  },

  getSection: function(auditId, sectionId) {
    return  api.get(`audits/${auditId}/sections/${sectionId}`)
  },

  updateSection: function(auditId, sectionId, section) {
    return  api.put(`audits/${auditId}/sections/${sectionId}`, section)
  },

  getAuditTypes: function() {
    return  api.get(`audits/types`)
  },

  generateAuditReport: function(auditId) {
    return  api.get(`audits/${auditId}/generate`, {responseType: 'blob'})
  },

  updateAuditSortFindings: function(auditId, audit) {
    return  api.put(`audits/${auditId}/sortfindings`, audit)
  },

  updateAuditFindingPosition: function(auditId, audit) {
    return  api.put(`audits/${auditId}/movefinding`, audit)
  },
  
  toggleApproval: function(auditId) {
    return  api.put(`audits/${auditId}/toggleApproval`);
  },

  updateReadyForReview: function(auditId, data) {
    return  api.put(`audits/${auditId}/updateReadyForReview`, data);
  },

  // Review comments (each call returns the updated list of comments of the audit)
  getComments: function(auditId) {
    return api.get(`audits/${auditId}/comments`)
  },

  createComment: function(auditId, comment) {
    return api.post(`audits/${auditId}/comments`, comment)
  },

  replyComment: function(auditId, commentId, text) {
    return api.post(`audits/${auditId}/comments/${commentId}/replies`, {text: text})
  },

  updateComment: function(auditId, commentId, update) {
    return api.put(`audits/${auditId}/comments/${commentId}`, update)
  },

  deleteComment: function(auditId, commentId) {
    return api.delete(`audits/${auditId}/comments/${commentId}`)
  }
}