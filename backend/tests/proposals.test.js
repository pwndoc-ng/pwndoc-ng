/*
  Proposals of vulnerabilities made from findings (creations and updates), complements of vulnerability.test.js:
  field by field review, other languages, custom fields, status of the vulnerabilities, visibility.
  At the end: no more vulnerability nor custom field created here (proposals kept, reviewed).
*/

module.exports = function(request, app) {
  var helpers = require('./helpers')(request, app)
  var CVSS = helpers.CVSS

  describe('Vulnerability Proposals Suite Tests', () => {
    var adminCookie, authorCookie, otherCookie
    var vulnId, customFieldId
    var auditId = '5f1c0c3c2a6b2c00dddddddd'
    var findingId = '5f1c0c3c2a6b2c00eeeeeeee'

    var getVuln = async (id) => (await request(app).get('/api/vulnerabilities').set('Cookie', adminCookie)).body.datas.find(v => v._id === id)
    var findVuln = async (title) => (await request(app).get('/api/vulnerabilities').set('Cookie', adminCookie)).body.datas.find(v => v.details.some(d => d.title === title))
    var propose = (finding, cookie = authorCookie, locale = 'en') => request(app).post(`/api/vulnerabilities/finding/${locale}`).set('Cookie', cookie).send(finding)
    var proposals = async (query, cookie = adminCookie) => (await request(app).get('/api/vulnerability-proposals').query(query).set('Cookie', cookie)).body.datas
    var pendingOf = async (id) => (await proposals({vulnerability: id})).filter(p => p.status === 'pending')
    var accept = (id, fields, cookie = adminCookie) => request(app).put(`/api/vulnerability-proposals/${id}/accept`).set('Cookie', cookie).send(fields === undefined ? {} : {fields: fields})
    var reject = (id, comment, cookie = adminCookie) => request(app).put(`/api/vulnerability-proposals/${id}/reject`).set('Cookie', cookie).send({comment: comment})
    var withdraw = (id, cookie = authorCookie) => request(app).delete(`/api/vulnerability-proposals/${id}`).set('Cookie', cookie)

    var base = {title: 'Proposal base', vulnType: 'Internal', description: '<p>Base</p>', remediation: '<p>Fix</p>', references: ['https://example.com/ref'], cvssv3: CVSS.medium}

    beforeAll(async () => {
      adminCookie = await helpers.login('admin', 'Admin123')
      authorCookie = await helpers.login('user2', 'User1234')
      otherCookie = await helpers.login('tmpuser', 'Tmpuser1')
      var response = await request(app).post('/api/data/custom-fields').set('Cookie', adminCookie)
        .send({fieldType: 'text', label: 'Proposal field', display: 'vulnerability'})
      customFieldId = response.body.datas._id
      response = await request(app).post('/api/vulnerabilities').set('Cookie', adminCookie).send([{
        cvssv3: base.cvssv3,
        details: [{locale: 'en', title: base.title, vulnType: base.vulnType, description: base.description, remediation: base.remediation, references: base.references}]
      }])
      expect(response.status).toBe(201)
      vulnId = (await findVuln(base.title))._id
    })

    afterAll(async () => {
      await request(app).delete(`/api/data/custom-fields/${customFieldId}`).set('Cookie', adminCookie)
    })

    it('Proposal without any change is refused', async () => {
      var response = await propose(base)
      expect(response.status).toBe(422)
      expect(response.body.datas).toBe('No changes from the original vulnerability')
      expect((await getVuln(vulnId)).status).toBe(0)
      expect(await pendingOf(vulnId)).toHaveLength(0)
    })

    it('Proposal of changes: listed with its changed fields', async () => {
      var response = await propose({...base, description: '<p>Better</p>', cvssv3: CVSS.high,
        customFields: [{customField: customFieldId, text: 'Proposed value'}], auditId: auditId, findingId: findingId})
      expect(response.status).toBe(200)
      expect(response.body.datas).toBe('Update proposed for existing vulnerability')
      expect((await getVuln(vulnId)).status).toBe(2)

      response = await request(app).get(`/api/vulnerabilities/updates/${vulnId}`).set('Cookie', adminCookie)
      expect(response.status).toBe(200)
      expect(response.body.datas).toHaveLength(1)
      expect(response.body.datas[0]).toMatchObject({creator: {username: 'user2'}, description: '<p>Better</p>', cvssv3: CVSS.high})

      var proposal = (await pendingOf(vulnId))[0]
      expect(proposal).toMatchObject({kind: 'update', status: 'pending', locale: 'en', title: base.title, source: {audit: auditId, finding: findingId}})
      response = await request(app).get(`/api/vulnerability-proposals/${proposal._id}`).set('Cookie', authorCookie)
      expect(response.status).toBe(200)
      expect(response.body.datas.changedFields.sort()).toEqual(['cvssv3', `customFields.${customFieldId}`, 'description'].sort())
      expect(response.body.datas.proposal.customFields[0].customField).toMatchObject({_id: customFieldId, label: 'Proposal field'})
    })

    it('Accept some fields: vulnerability and custom fields', async () => {
      var proposal = (await pendingOf(vulnId))[0]
      var response = await accept(proposal._id, ['title'])
      expect(response.status).toBe(422) // Not changed by the proposal

      response = await accept(proposal._id, ['cvssv3', `customFields.${customFieldId}`, 'title'])
      expect(response.status).toBe(200)
      expect(response.body.datas.status).toBe('partial')

      var vuln = await getVuln(vulnId)
      expect(vuln.status).toBe(0)
      expect(vuln.cvssv3).toBe(CVSS.high)
      expect(vuln.details[0].description).toBe('<p>Base</p>')
      expect(vuln.details[0].customFields).toEqual([{customField: customFieldId, text: 'Proposed value'}])

      var reviewed = (await proposals({status: 'partial', vulnerability: vulnId}))[0]
      expect(reviewed.acceptedFields).toEqual(['cvssv3', `customFields.${customFieldId}`])
      expect(reviewed.reviewer.username).toBe('admin')
      expect(reviewed.reviewedAt).toBeDefined()

      // Followed from the finding by the author
      response = await request(app).get(`/api/vulnerability-proposals/finding/${findingId}`).set('Cookie', authorCookie)
      expect(response.body.datas).toMatchObject({_id: proposal._id, status: 'partial'})
    })

    it('Reviewed proposal cannot be reviewed nor withdrawn again', async () => {
      var proposal = (await proposals({status: 'partial', vulnerability: vulnId}))[0]
      expect((await accept(proposal._id, ['description'])).status).toBe(404)
      expect((await reject(proposal._id, 'Too late')).status).toBe(404)
      expect((await withdraw(proposal._id)).status).toBe(404)
      expect((await getVuln(vulnId)).details[0].description).toBe('<p>Base</p>')
    })

    it('Accepting a custom field already set replaces its value', async () => {
      expect((await propose({...base, cvssv3: CVSS.high, customFields: [{customField: customFieldId, text: 'Second value'}]})).status).toBe(200)
      var proposal = (await pendingOf(vulnId))[0]
      var response = await accept(proposal._id, [`customFields.${customFieldId}`])
      expect(response.body.datas.status).toBe('accepted')
      expect((await getVuln(vulnId)).details[0].customFields).toEqual([{customField: customFieldId, text: 'Second value'}])
    })

    it('Proposal in another language adds this language to the vulnerability', async () => {
      var response = await propose({title: base.title, vulnType: 'Internal', description: '<p>Base FR</p>', cvssv3: CVSS.high}, authorCookie, 'fr')
      expect(response.status).toBe(200)
      var proposal = (await pendingOf(vulnId))[0]
      expect(proposal.locale).toBe('fr')
      response = await accept(proposal._id, ['title', 'description'])
      expect(response.status).toBe(200)
      expect(response.body.datas.status).toBe('partial') // vulnType not accepted

      var vuln = await getVuln(vulnId)
      expect(vuln.details.find(d => d.locale === 'fr')).toMatchObject({title: base.title, description: '<p>Base FR</p>'})
      expect(vuln.details.find(d => d.locale === 'fr').vulnType).toBeUndefined()
      var french = (await request(app).get('/api/vulnerabilities/fr').set('Cookie', authorCookie)).body.datas
      expect(french.find(v => v._id === vulnId).detail.description).toBe('<p>Base FR</p>')
    })

    it('Withdrawn update proposal: vulnerability validated again', async () => {
      expect((await propose({...base, cvssv3: CVSS.high, remediation: '<p>Other fix</p>'})).status).toBe(200)
      expect((await getVuln(vulnId)).status).toBe(2)
      var proposal = (await pendingOf(vulnId))[0]
      expect((await withdraw(proposal._id, otherCookie)).status).toBe(403)
      expect((await withdraw(proposal._id)).status).toBe(200)
      expect((await getVuln(vulnId)).status).toBe(0)
      expect((await proposals({status: 'all', vulnerability: vulnId})).map(p => p._id)).not.toContain(proposal._id)
    })

    it('Editing a vulnerability keeps its pending proposals', async () => {
      expect((await propose({...base, cvssv3: CVSS.high, observation: '<p>Observed</p>'})).status).toBe(200)
      var vuln = await getVuln(vulnId)
      var response = await request(app).put(`/api/vulnerabilities/${vulnId}`).set('Cookie', adminCookie).send({cvssv3: vuln.cvssv3, details: vuln.details})
      expect(response.status).toBe(200)
      expect((await getVuln(vulnId)).status).toBe(2)
      expect(await pendingOf(vulnId)).toHaveLength(1)
    })

    it('Deleting a vulnerability refuses its pending proposals', async () => {
      var proposal = (await pendingOf(vulnId))[0]
      expect((await request(app).delete(`/api/vulnerabilities/${vulnId}`).set('Cookie', adminCookie)).status).toBe(200)

      var rejected = (await proposals({status: 'rejected', vulnerability: vulnId})).find(p => p._id === proposal._id)
      expect(rejected).toMatchObject({status: 'rejected', reviewComment: 'Vulnerability deleted', reviewer: {username: 'admin'}})
      expect(rejected.vulnerability).toBeNull()

      var response = await request(app).get(`/api/vulnerability-proposals/${proposal._id}`).set('Cookie', authorCookie)
      expect(response.status).toBe(200)
      expect(response.body.datas.vulnerability).toBeNull()
      expect(response.body.datas.changedFields).toEqual([])
    })

    it('Validating a proposed vulnerability accepts its creation proposal', async () => {
      var response = await propose({title: 'Proposed then validated', vulnType: 'Internal', description: '<p>New</p>'})
      expect(response.status).toBe(201)
      var vuln = await findVuln('Proposed then validated')
      expect(vuln.status).toBe(1)
      expect(vuln.creator.username).toBe('user2')

      // Proposals on a vulnerability not validated yet are refused
      response = await propose({title: 'Proposed then validated', description: '<p>Changed</p>'}, otherCookie)
      expect(response.status).toBe(403)

      response = await request(app).put(`/api/vulnerabilities/${vuln._id}`).set('Cookie', adminCookie).send({details: vuln.details})
      expect(response.status).toBe(200)
      expect((await getVuln(vuln._id)).status).toBe(0)
      var creation = (await proposals({status: 'all', vulnerability: vuln._id}))[0]
      expect(creation).toMatchObject({kind: 'creation', status: 'accepted', reviewer: {username: 'admin'}})
      expect((await request(app).delete(`/api/vulnerabilities/${vuln._id}`).set('Cookie', adminCookie)).status).toBe(200)
    })

    it('Proposals are visible to their author and to the reviewers only', async () => {
      var response = await propose({title: 'Private proposal', auditId: auditId, findingId: '5f1c0c3c2a6b2c00ffffffff'})
      expect(response.status).toBe(201)
      var proposal = (await proposals({}, authorCookie)).find(p => p.title === 'Private proposal')

      expect((await request(app).get(`/api/vulnerability-proposals/${proposal._id}`).set('Cookie', otherCookie)).status).toBe(404)
      response = await request(app).get('/api/vulnerability-proposals/finding/5f1c0c3c2a6b2c00ffffffff').set('Cookie', otherCookie)
      expect(response.status).toBe(200)
      expect(response.body.datas).toBeNull()
      expect((await proposals({status: 'all'}, otherCookie)).every(p => p.creator.username === 'tmpuser')).toBe(true)
      // Users cannot see the proposals of the other users even when asking for them
      expect((await proposals({status: 'all', mine: 'false'}, authorCookie)).every(p => p.creator.username === 'user2')).toBe(true)

      response = await request(app).get('/api/vulnerability-proposals/count').set('Cookie', otherCookie)
      expect(response.body.datas.pending).toBe((await proposals({}, otherCookie)).length)
      response = await request(app).get('/api/vulnerability-proposals/count').set('Cookie', authorCookie)
      expect(response.body.datas.pending).toBe((await proposals({}, authorCookie)).length)
      response = await request(app).get('/api/vulnerability-proposals/count').set('Cookie', adminCookie)
      expect(response.body.datas.pending).toBe((await proposals({})).length)
      expect(response.body.datas.pending).toBeGreaterThan(0)

      // Reviewers list their own proposals with mine=true
      expect((await proposals({status: 'all', mine: 'true'})).every(p => p.creator.username === 'admin')).toBe(true)

      expect((await reject(proposal._id, 'Not reusable')).status).toBe(200)
      expect(await findVuln('Private proposal')).toBeUndefined()
    })

    it('Invalid parameters', async () => {
      expect((await request(app).get('/api/vulnerability-proposals?status=unknown').set('Cookie', adminCookie)).status).toBe(422)
      expect((await request(app).get('/api/vulnerability-proposals/not-an-id').set('Cookie', adminCookie)).status).toBe(404)
      expect((await request(app).get('/api/vulnerability-proposals/deadbeefdeadbeefdeadbeef').set('Cookie', adminCookie)).status).toBe(404)
      var response = await request(app).get('/api/vulnerability-proposals/finding/not-an-id').set('Cookie', adminCookie)
      expect(response.status).toBe(200)
      expect(response.body.datas).toBeNull()
      expect((await accept('not-an-id', ['title'])).status).toBe(404)
      expect((await accept('deadbeefdeadbeefdeadbeef', 'title')).status).toBe(422)
      expect((await accept('deadbeefdeadbeefdeadbeef', [1])).status).toBe(422)
      expect((await reject('deadbeefdeadbeefdeadbeef', 'x'.repeat(5001))).status).toBe(422)
      expect((await reject('deadbeefdeadbeefdeadbeef', 'Unknown')).status).toBe(404)
      expect((await withdraw('deadbeefdeadbeefdeadbeef')).status).toBe(404)
    })
  })
}
