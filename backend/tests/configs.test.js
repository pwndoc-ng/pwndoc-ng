/*
  Review workflow of the audits and its settings (reviews.enabled, mandatoryReview, minReviewers,
  removeApprovalsUponUpdate), validation of the settings.
  The role 'reviewer' (not defined in the configuration) is defined during this suite as a custom role
  allowed to review the audits (audits:review, without audits:review-all).
  At the end: settings reverted to the defaults, no more audit created here, role 'reviewer' not defined.
*/

module.exports = function(request, app) {
  var helpers = require('./helpers')(request, app)
  var acl = require('../src/lib/auth').acl

  describe('Review Workflow Suite Tests', () => {
    var adminCookie, creatorCookie, collaboratorCookie, reviewerCookie
    var reviewerId, auditId

    var getAudit = async (id = auditId) => (await request(app).get(`/api/audits/${id}`).set('Cookie', adminCookie)).body.datas
    var setState = (state, cookie = creatorCookie, id = auditId) => request(app).put(`/api/audits/${id}/updateReadyForReview`).set('Cookie', cookie).send({state: state})
    var toggleApproval = (cookie, id = auditId) => request(app).put(`/api/audits/${id}/toggleApproval`).set('Cookie', cookie)
    var settings = (body) => request(app).put('/api/settings').set('Cookie', adminCookie).send(body)
    var getSettings = async () => (await request(app).get('/api/settings').set('Cookie', adminCookie)).body.datas
    // Changes of the review settings, the other ones being kept (the whole 'reviews' object is sent, see the skipped test)
    var setReviews = async (changes) => {
      var current = (await getSettings()).reviews
      return settings({reviews: {
        enabled: changes.enabled !== undefined ? changes.enabled : current.enabled,
        public: {...current.public, ...(changes.public || {})},
        private: {...current.private, ...(changes.private || {})}
      }})
    }

    beforeAll(async () => {
      acl.roles.reviewer = {inherits: ['user'], allows: ['audits:review']}
      adminCookie = await helpers.login('admin', 'Admin123')
      creatorCookie = await helpers.login('user2', 'User1234')
      collaboratorCookie = await helpers.login('tmpuser', 'Tmpuser1')
      reviewerCookie = await helpers.login('reviewer', 'Reviewer123')
      reviewerId = await helpers.userId(adminCookie, 'reviewer')
      var collaboratorId = await helpers.userId(adminCookie, 'tmpuser')

      var response = await request(app).post('/api/audits').set('Cookie', creatorCookie).send({name: 'Review audit', language: 'en', auditType: 'Web'})
      auditId = response.body.datas.audit._id
      response = await request(app).put(`/api/audits/${auditId}/general`).set('Cookie', creatorCookie)
        .send({collaborators: [{_id: collaboratorId}], reviewers: [{_id: reviewerId}]})
      expect(response.status).toBe(200)
    })

    afterAll(async () => {
      delete acl.roles.reviewer
      await request(app).put('/api/settings/revert').set('Cookie', adminCookie)
      await request(app).delete(`/api/audits/${auditId}`).set('Cookie', creatorCookie)
    })

    describe('Settings', () => {
      it('Invalid settings are refused and not saved', async () => {
        var before = await getSettings()
        var invalid = [
          {reviews: {public: {minReviewers: 0}}},
          {reviews: {public: {minReviewers: 1.5}}},
          {reviews: {public: {minReviewers: 101}}},
          {report: {public: {cvssColors: {highColor: 'red'}}}},
          {report: {private: {imageBorderColor: '#12345'}}},
          {report: {public: {imageDefaultWidth: 'huge'}}},
          {report: {public: {findingSidebarTemplate: 'x'.repeat(501)}}},
          {danger: {public: {nbdaydelete: 366}}},
          {danger: {public: {nbdaydelete: 0}}}
        ]
        for (var body of invalid) {
          var response = await settings(body)
          expect([JSON.stringify(body), response.status >= 400]).toEqual([JSON.stringify(body), true])
        }
        expect(await getSettings()).toEqual(before)
      })

      it('Unknown settings are ignored', async () => {
        var before = await getSettings()
        var response = await settings({unknown: true, reviews: {...before.reviews, unknown: 1}})
        expect(response.status).toBe(200)
        expect(await getSettings()).toEqual(before)
      })

      it('Partial update keeps the other settings of the same section', async () => {
        expect((await setReviews({enabled: true, public: {minReviewers: 3}})).status).toBe(200)
        expect((await settings({reviews: {private: {removeApprovalsUponUpdate: true}}})).status).toBe(200)
        var reviews = (await getSettings()).reviews
        expect(reviews).toEqual({enabled: true, public: {mandatoryReview: false, minReviewers: 3, blockApprovalWithOpenComments: false}, private: {removeApprovalsUponUpdate: true}})
        expect((await request(app).put('/api/settings/revert').set('Cookie', adminCookie)).status).toBe(200)
      })

      it('Public settings do not contain the private settings', async () => {
        var response = await request(app).get('/api/settings/public').set('Cookie', creatorCookie)
        expect(response.status).toBe(200)
        expect(Object.keys(response.body.datas).sort()).toEqual(['danger', 'qa', 'report', 'reviews'])
        expect(Object.keys(response.body.datas.qa)).toEqual(['public']) // Checks enabled only
        expect(response.body.datas.report.private).toBeUndefined()
        expect(response.body.datas.reviews.private).toBeUndefined()
        expect(response.body.datas.reviews.public).toEqual({mandatoryReview: false, minReviewers: 1, blockApprovalWithOpenComments: false})
      })

      it('Exported settings are the current settings', async () => {
        var response = await request(app).get('/api/settings/export').set('Cookie', adminCookie)
        expect(response.status).toBe(200)
        expect(response.headers['content-disposition']).toBe('attachment; filename="app-settings.json"')
        expect(response.body).toEqual(await getSettings())
      })
    })

    describe('Automatic deletion of the old audits (danger zone)', () => {
      it('Deletes the audits created before the number of days', async () => {
        var Audit = require('mongoose').model('Audit')
        var create = async (name) => (await request(app).post('/api/audits').set('Cookie', creatorCookie).send({name: name, language: 'en', auditType: 'Web'})).body.datas.audit._id
        var oldId = await create('Old audit')
        var recentId = await create('Recent audit')
        var day = 24 * 3600 * 1000
        // createdAt is immutable for mongoose: changed with the driver
        await Audit.collection.updateOne({_id: new (require('mongoose').Types.ObjectId)(oldId)}, {$set: {createdAt: new Date(Date.now() - 40 * day)}})
        await Audit.collection.updateOne({_id: new (require('mongoose').Types.ObjectId)(recentId)}, {$set: {createdAt: new Date(Date.now() - 10 * day)}})
        var count = await Audit.countDocuments()

        await Audit.deleteOutdatedReportAutomation(30)
        expect(await Audit.countDocuments({_id: oldId})).toBe(0)
        expect(await Audit.countDocuments({_id: recentId})).toBe(1)
        expect(await Audit.countDocuments()).toBe(count - 1)
        expect((await request(app).delete(`/api/audits/${recentId}`).set('Cookie', creatorCookie)).status).toBe(200)
      })
    })

    describe('Reviews disabled', () => {
      it('Review actions are refused', async () => {
        var response = await setState('REVIEW')
        expect(response.status).toBe(403)
        expect(response.body.datas).toBe('Audit reviews are not enabled.')
        response = await toggleApproval(reviewerCookie)
        expect(response.status).toBe(403)
        expect((await getAudit()).state).toBe('EDIT')
      })

      it('The state of the audit does not block the edition', async () => {
        await require('mongoose').model('Audit').updateOne({_id: auditId}, {state: 'REVIEW'})
        expect((await request(app).put(`/api/audits/${auditId}/general`).set('Cookie', creatorCookie).send({date: '2026-03-01'})).status).toBe(200)
        await require('mongoose').model('Audit').updateOne({_id: auditId}, {state: 'EDIT'})
      })
    })

    describe('Reviews enabled', () => {
      beforeAll(async () => {
        var response = await setReviews({enabled: true, public: {mandatoryReview: true, minReviewers: 2}, private: {removeApprovalsUponUpdate: false}})
        expect(response.status).toBe(200)
        expect((await getSettings()).reviews).toEqual({enabled: true, public: {mandatoryReview: true, minReviewers: 2, blockApprovalWithOpenComments: false}, private: {removeApprovalsUponUpdate: false}})
      })

      it('Users allowed to review are listed as reviewers', async () => {
        var response = await request(app).get('/api/users/reviewers').set('Cookie', creatorCookie)
        var usernames = response.body.datas.map(u => u.username)
        expect(usernames).toContain('reviewer')
        expect(usernames).toContain('admin')
        expect(usernames).not.toContain('user2')
      })

      it('Audit in edition cannot be approved', async () => {
        var response = await toggleApproval(reviewerCookie)
        expect(response.status).toBe(403)
        expect(response.body.datas).toBe('The audit is not approvable in the current state.')
      })

      it('Report generation requires an approved audit', async () => {
        var response = await request(app).get(`/api/audits/${auditId}/generate`).set('Cookie', creatorCookie)
        expect(response.status).toBe(403)
        expect(response.body.datas).toBe('Audit was not approved therefore cannot be exported.')
      })

      it('Only the editors submit the audit for review', async () => {
        expect((await setState('REVIEW', reviewerCookie)).status).toBe(404)
        expect((await getAudit()).state).toBe('EDIT')
        expect((await setState('REVIEW', collaboratorCookie)).status).toBe(200)
        expect((await getAudit()).state).toBe('REVIEW')
      })

      it('Audit in review cannot be edited', async () => {
        var forbidden = [
          ['put', `/api/audits/${auditId}/general`, {name: 'Changed'}],
          ['put', `/api/audits/${auditId}/network`, {scope: []}],
          ['post', `/api/audits/${auditId}/findings`, {title: 'New finding'}],
          ['put', `/api/audits/${auditId}/sortfindings`, {sortFindings: []}],
          ['put', `/api/audits/${auditId}/movefinding`, {oldIndex: 0, newIndex: 0}]
        ]
        for (var [method, route, body] of forbidden) {
          var response = await request(app)[method](route).set('Cookie', creatorCookie).send(body)
          expect([route, response.status]).toEqual([route, 403])
        }
        var audit = await getAudit()
        expect(audit.name).toBe('Review audit')
        expect(audit.findings).toHaveLength(0)
        // Comments are still allowed
        var response = await request(app).post(`/api/audits/${auditId}/comments`).set('Cookie', reviewerCookie)
          .send({target: {kind: 'general', field: 'name'}, text: 'Name to change'})
        expect(response.status).toBe(200)
      })

      it('Creators and collaborators cannot approve their own audit', async () => {
        // Collaborator without review permission
        expect((await toggleApproval(collaboratorCookie)).status).toBe(403)
        // Creator allowed to review all audits
        var response = await request(app).post('/api/audits').set('Cookie', adminCookie).send({name: 'Admin review audit', language: 'en', auditType: 'Web'})
        var adminAuditId = response.body.datas.audit._id
        expect((await setState('REVIEW', adminCookie, adminAuditId)).status).toBe(200)
        expect((await toggleApproval(adminCookie, adminAuditId)).status).toBe(404)
        // Reviewer not assigned to the audit
        expect((await toggleApproval(reviewerCookie, adminAuditId)).status).toBe(404)
        expect((await getAudit(adminAuditId)).approvals).toEqual([])
        expect((await request(app).delete(`/api/audits/${adminAuditId}`).set('Cookie', adminCookie)).status).toBe(200)
      })

      it('Audit approved when the minimum number of reviewers is reached', async () => {
        var response = await toggleApproval(reviewerCookie)
        expect(response.status).toBe(200)
        var audit = await getAudit()
        expect(audit.state).toBe('REVIEW')
        expect(audit.approvals.map(a => a.username)).toEqual(['reviewer'])

        // Reviewer of all the audits, not assigned
        response = await toggleApproval(adminCookie)
        expect(response.status).toBe(200)
        audit = await getAudit()
        expect(audit.state).toBe('APPROVED')
        expect(audit.approvals.map(a => a.username).sort()).toEqual(['admin', 'reviewer'])

        response = await request(app).get('/api/audits').set('Cookie', creatorCookie)
        expect(response.body.datas.find(a => a._id === auditId).state).toBe('APPROVED')
      })

      it('Approved audit can be exported', async () => {
        // Passes the review check: fails on the missing template only
        var response = await request(app).get(`/api/audits/${auditId}/generate`).set('Cookie', creatorCookie)
        expect(response.status).toBe(422)
        expect(response.body.datas).toBe('Template not defined')
      })

      it('Approved audit cannot go back to edition directly', async () => {
        var response = await setState('EDIT')
        expect(response.status).toBe(403)
        expect(response.body.datas).toBe('The audit is not in the proper state for this action.')
        expect((await request(app).put(`/api/audits/${auditId}/general`).set('Cookie', creatorCookie).send({name: 'Changed'})).status).toBe(403)
      })

      it('Removing an approval puts the audit back in review', async () => {
        var response = await toggleApproval(adminCookie)
        expect(response.status).toBe(200)
        var audit = await getAudit()
        expect(audit.state).toBe('REVIEW')
        expect(audit.approvals.map(a => a.username)).toEqual(['reviewer'])
      })

      it('Back to edition keeps the approvals of the reviewers', async () => {
        expect((await setState('APPROVED')).status).toBe(200) // Unknown target state: ignored
        expect((await getAudit()).state).toBe('REVIEW')
        expect((await setState('EDIT')).status).toBe(200)
        var audit = await getAudit()
        expect(audit.state).toBe('EDIT')
        expect(audit.approvals.map(a => a.username)).toEqual(['reviewer'])
        expect((await request(app).put(`/api/audits/${auditId}/general`).set('Cookie', creatorCookie).send({date: '2026-03-02'})).status).toBe(200)
        expect((await getAudit()).approvals).toHaveLength(1)
      })

      it('Approvals removed upon update when enabled', async () => {
        expect((await setReviews({private: {removeApprovalsUponUpdate: true}})).status).toBe(200)
        expect((await request(app).put(`/api/audits/${auditId}/general`).set('Cookie', creatorCookie).send({date: '2026-03-03'})).status).toBe(200)
        var audit = await getAudit()
        expect(audit.approvals).toEqual([])
        expect(audit.date).toBe('2026-03-03')
      })

      it('Approval blocked by open comments, minimum of one reviewer', async () => {
        expect((await setReviews({public: {minReviewers: 1, blockApprovalWithOpenComments: true}})).status).toBe(200)
        expect((await getSettings()).reviews).toMatchObject({enabled: true, public: {mandatoryReview: true}, private: {removeApprovalsUponUpdate: true}})
        expect((await setState('REVIEW')).status).toBe(200)
        var response = await toggleApproval(reviewerCookie)
        expect(response.status).toBe(403)
        expect(response.body.datas).toBe('Open comments must be resolved before approving the audit.')

        var comments = (await request(app).get(`/api/audits/${auditId}/comments`).set('Cookie', reviewerCookie)).body.datas
        for (var comment of comments)
          expect((await request(app).put(`/api/audits/${auditId}/comments/${comment._id}`).set('Cookie', reviewerCookie).send({resolved: true})).status).toBe(200)
        expect((await toggleApproval(reviewerCookie)).status).toBe(200)
        expect((await getAudit()).state).toBe('APPROVED')
      })

      it('Approval of an unknown audit', async () => {
        expect((await toggleApproval(adminCookie, 'deadbeefdeadbeefdeadbeef')).status).toBe(404)
      })
    })
  })
}
