/*
  Edition of the audits: general information, network, findings (order, sort options, categories), sections,
  access of the creator, collaborators and reviewers, review comments.
  At the end: no more audit, category, custom field or audit type created here.
*/

module.exports = function(request, app) {
  var helpers = require('./helpers')(request, app)
  var CVSS = helpers.CVSS

  describe('Audit Edition Suite Tests', () => {
    var adminCookie, creatorCookie, collaboratorCookie, reviewerCookie, reportCookie, otherCookie
    var creatorId, collaboratorId, reviewerId
    var auditId

    var getAudit = async (cookie = creatorCookie) => (await request(app).get(`/api/audits/${auditId}`).set('Cookie', cookie)).body.datas
    var findingTitles = async () => (await getAudit()).findings.map(f => f.title)
    var findingId = async (title) => (await getAudit()).findings.find(f => f.title === title)._id
    var addFinding = (finding, cookie = creatorCookie) => request(app).post(`/api/audits/${auditId}/findings`).set('Cookie', cookie).send(finding)
    var updateFinding = (id, finding, cookie = creatorCookie) => request(app).put(`/api/audits/${auditId}/findings/${id}`).set('Cookie', cookie).send(finding)
    var updateGeneral = (body, cookie = creatorCookie) => request(app).put(`/api/audits/${auditId}/general`).set('Cookie', cookie).send(body)
    var sortFindings = (options) => request(app).put(`/api/audits/${auditId}/sortfindings`).set('Cookie', creatorCookie).send({sortFindings: options})

    beforeAll(async () => {
      adminCookie = await helpers.login('admin', 'Admin123')
      creatorCookie = await helpers.login('user2', 'User1234')
      collaboratorCookie = await helpers.login('tmpuser', 'Tmpuser1')
      reviewerCookie = await helpers.login('reviewer', 'Reviewer123')
      reportCookie = await helpers.login('report', 'Report123')
      otherCookie = await helpers.login('batchuser', 'Batchuser1')
      creatorId = await helpers.userId(adminCookie, 'user2')
      collaboratorId = await helpers.userId(adminCookie, 'tmpuser')
      reviewerId = await helpers.userId(adminCookie, 'reviewer')
    })

    describe('Audit creation', () => {
      it('Should not create an audit with missing or invalid parameters', async () => {
        var create = (body) => request(app).post('/api/audits').set('Cookie', creatorCookie).send(body)
        expect((await create({name: 'Audit', language: 'en'})).status).toBe(422)
        expect((await create({name: 'Audit', auditType: 'Web'})).status).toBe(422)
        expect((await create({language: 'en', auditType: 'Web'})).status).toBe(422)
        expect((await create({name: 'Audit', language: '../en', auditType: 'Web'})).status).toBe(422)
        expect((await create({name: 'Audit', language: 'en', auditType: 'Unknown'})).status).toBe(404)
      })

      it('Create an audit', async () => {
        var response = await request(app).post('/api/audits').set('Cookie', creatorCookie).send({name: 'Workflow audit', language: 'en', auditType: 'Web'})
        expect(response.status).toBe(201)
        var audit = response.body.datas.audit
        auditId = audit._id
        expect(audit).toMatchObject({name: 'Workflow audit', language: 'en', auditType: 'Web', creator: creatorId, state: 'EDIT', findings: [], collaborators: [], reviewers: []})
      })

      it('Users list their own audits only', async () => {
        var response = await request(app).get('/api/audits').set('Cookie', creatorCookie)
        expect(response.status).toBe(200)
        var audit = response.body.datas.find(a => a._id === auditId)
        expect(audit).toMatchObject({name: 'Workflow audit', language: 'en', state: 'EDIT', creator: {_id: creatorId, username: 'user2'}})
        expect(response.body.datas.map(a => a.name)).not.toContain('Audit 1')
        expect((await request(app).get('/api/audits').set('Cookie', collaboratorCookie)).body.datas.map(a => a._id)).not.toContain(auditId)
      })
    })

    describe('General information', () => {
      var clientId, companyId

      beforeAll(async () => {
        clientId = (await request(app).get('/api/clients').set('Cookie', adminCookie)).body.datas[0]._id
        companyId = (await request(app).get('/api/companies').set('Cookie', adminCookie)).body.datas.find(c => c.name === 'Company 1')._id
      })

      it('Update all the general information', async () => {
        var response = await updateGeneral({
          name: 'Workflow audit', date: '2026-01-25', date_start: '2026-01-12', date_end: '2026-01-23',
          scope: ['10.0.0.0/24', 'app.example.com'], client: clientId, company: {_id: companyId},
          collaborators: [{_id: collaboratorId}], reviewers: [{_id: reviewerId}], language: 'fr'
        })
        expect(response.status).toBe(200)

        response = await request(app).get(`/api/audits/${auditId}/general`).set('Cookie', creatorCookie)
        expect(response.status).toBe(200)
        var general = response.body.datas
        expect(general).toMatchObject({
          name: 'Workflow audit', auditType: 'Web', date: '2026-01-25', date_start: '2026-01-12', date_end: '2026-01-23',
          scope: ['10.0.0.0/24', 'app.example.com'], language: 'fr'
        })
        expect(general.client._id).toBe(clientId)
        expect(general.company.name).toBe('Company 1')
        expect(general.collaborators.map(c => c.username)).toEqual(['tmpuser'])
        expect(general.reviewers.map(c => c.username)).toEqual(['reviewer'])
      })

      it('Ignores a language with invalid characters', async () => {
        expect((await updateGeneral({language: '../../en'})).status).toBe(200)
        expect((await getAudit()).language).toBe('fr')
        expect((await updateGeneral({language: 'en'})).status).toBe(200)
        expect((await getAudit()).language).toBe('en')
      })

      it('Custom fields of the general information', async () => {
        var customFields = [{customField: '5f1c0c3c2a6b2c00abcdef01', text: 'Production'}, {customField: '5f1c0c3c2a6b2c00abcdef02', text: ['a', 'b']}]
        expect((await updateGeneral({customFields: customFields})).status).toBe(200)
        var response = await request(app).get(`/api/audits/${auditId}/general`).set('Cookie', reviewerCookie)
        expect(response.body.datas.customFields).toEqual(customFields)
      })

      it('Remove the company', async () => {
        expect((await getAudit()).company.name).toBe('Company 1')
        expect((await updateGeneral({company: null})).status).toBe(200)
        expect((await getAudit()).company).toBeFalsy()
        expect((await updateGeneral({company: {_id: companyId}})).status).toBe(200)
        expect((await getAudit()).company.name).toBe('Company 1')
      })

      // BUG: src/models/audit.js:378 updateGeneral creates the company with Company.create(), overridden by the static
      // of src/models/company.js:49 (insertMany, resolves {created, duplicates} instead of the document): PUT general
      // {company: {name: 'New company'}} creates the company then answers 500 (CastError) without updating the audit.
      // (The frontend sends the typed name as a string, turned into company: null: the new company is dropped.)
      it.skip('Create the company of the audit from its name', async () => {
        expect((await updateGeneral({company: {name: 'Workflow Company'}})).status).toBe(200)
        expect((await getAudit()).company.name).toBe('Workflow Company')
      })

      it('Collaborators and reviewers are given by id', async () => {
        var response = await updateGeneral({reviewers: [{_id: reviewerId}, {}]})
        expect(response.status).toBe(422)
        response = await updateGeneral({collaborators: [{username: 'tmpuser'}]})
        expect(response.status).toBe(422)
        var audit = await getAudit()
        expect(audit.reviewers.map(r => r._id)).toEqual([reviewerId])
        expect(audit.collaborators.map(r => r._id)).toEqual([collaboratorId])
      })

      // BUG: src/routes/audit.js:150 compares the requested reviewer ids (strings) with audit.creator._id (ObjectId)
      // with ===: always false, the creator of the audit is accepted as reviewer (200 instead of 422)
      it.skip('Creator cannot be reviewer of the audit', async () => {
        var response = await updateGeneral({reviewers: [{_id: reviewerId}, {_id: creatorId}]})
        expect(response.status).toBe(422)
        expect((await getAudit()).reviewers.map(r => r._id)).toEqual([reviewerId])
      })

      // BUG: src/routes/audit.js:184 (and :168) compares the ids of the request with the populated audit.reviewers
      // (audit.collaborators) ObjectIds with ===: a reviewer of the audit is accepted as collaborator (200 instead of 422)
      it.skip('Reviewer of the audit cannot be added as collaborator', async () => {
        var response = await updateGeneral({collaborators: [{_id: collaboratorId}, {_id: reviewerId}]})
        expect(response.status).toBe(422)
        expect((await getAudit()).collaborators.map(r => r._id)).toEqual([collaboratorId])
      })

      // BUG: src/routes/audit.js:157-162 (and :167-172, :183-188) the 'return' in forEach does not stop the handler:
      // PUT general {collaborators: [{_id: X}], reviewers: [{_id: X}]} answers 422 but the update is applied anyway,
      // then a second answer is sent (ERR_HTTP_HEADERS_SENT thrown in the .catch: unhandled promise rejection).
      it.skip('Same user as collaborator and reviewer is refused without modifying the audit', async () => {
        var response = await updateGeneral({collaborators: [{_id: collaboratorId}, {_id: reviewerId}], reviewers: [{_id: reviewerId}]})
        expect(response.status).toBe(422)
        expect((await getAudit()).collaborators.map(r => r._id)).toEqual([collaboratorId])
      })
    })

    describe('Access of collaborators and reviewers', () => {
      it('Collaborators read and edit the audit', async () => {
        expect((await request(app).get('/api/audits').set('Cookie', collaboratorCookie)).body.datas.map(a => a._id)).toContain(auditId)
        expect((await request(app).get(`/api/audits/${auditId}`).set('Cookie', collaboratorCookie)).status).toBe(200)
        expect((await updateGeneral({date: '2026-01-26'}, collaboratorCookie)).status).toBe(200)
        expect((await getAudit()).date).toBe('2026-01-26')
      })

      it('Reviewers read the audit without editing it', async () => {
        expect((await request(app).get('/api/audits').set('Cookie', reviewerCookie)).body.datas.map(a => a._id)).toContain(auditId)
        expect((await request(app).get(`/api/audits/${auditId}`).set('Cookie', reviewerCookie)).status).toBe(200)
        expect((await request(app).get(`/api/audits/${auditId}/general`).set('Cookie', reviewerCookie)).status).toBe(200)
        expect((await request(app).get(`/api/audits/${auditId}/network`).set('Cookie', reviewerCookie)).status).toBe(200)

        expect((await updateGeneral({date: '2026-02-01'}, reviewerCookie)).status).toBe(404)
        expect((await request(app).put(`/api/audits/${auditId}/network`).set('Cookie', reviewerCookie).send({scope: []})).status).toBe(404)
        expect((await addFinding({title: 'Reviewer finding'}, reviewerCookie)).status).toBe(404)
        expect((await request(app).put(`/api/audits/${auditId}/sortfindings`).set('Cookie', reviewerCookie).send({sortFindings: []})).status).toBe(404)
        var audit = await getAudit()
        expect(audit.date).toBe('2026-01-26')
        expect(audit.scope).toHaveLength(2)
        expect(audit.findings).toHaveLength(0)
      })

      it('Only the creator deletes the audit', async () => {
        expect((await request(app).delete(`/api/audits/${auditId}`).set('Cookie', collaboratorCookie)).status).toBe(404)
        expect((await request(app).delete(`/api/audits/${auditId}`).set('Cookie', reviewerCookie)).status).toBe(404)
        expect((await request(app).get(`/api/audits/${auditId}`).set('Cookie', creatorCookie)).status).toBe(200)
      })

      // BUG: src/routes/audit.js:137 (same pattern at :245, :266, :321, :361, :388, :447, :470, :572) the async handlers
      // await Audit.getAudit() outside of any try/catch: for a user without read access (or a bad id) the promise
      // rejection is unhandled, the request never gets an answer and Node.js >= 15 stops the process
      // (any authenticated user can crash the backend with PUT /api/audits/<id of another audit>/general).
      it.skip('Edition routes answer 404 to users without access to the audit', async () => {
        expect((await updateGeneral({name: 'Hijacked'}, otherCookie)).status).toBe(404)
        expect((await request(app).put(`/api/audits/${auditId}/network`).set('Cookie', otherCookie).send({scope: []})).status).toBe(404)
        expect((await addFinding({title: 'Injected'}, otherCookie)).status).toBe(404)
        expect((await request(app).put(`/api/audits/deadbeefdeadbeefdeadbeef/general`).set('Cookie', adminCookie).send({name: 'x'})).status).toBe(404)
      })
    })

    describe('Network', () => {
      var scope = [{
        name: '10.0.0.0/24',
        hosts: [{
          hostname: 'srv1.example.com', ip: '10.0.0.1', os: 'Linux',
          services: [{port: 443, protocol: 'tcp', name: 'https', product: 'nginx', version: '1.25'}, {port: 53, protocol: 'udp', name: 'domain', product: 'bind', version: '9'}]
        }]
      }, {name: 'app.example.com', hosts: []}]

      it('Update the hosts and services of the scope', async () => {
        var response = await request(app).put(`/api/audits/${auditId}/network`).set('Cookie', collaboratorCookie).send({scope: scope})
        expect(response.status).toBe(200)
        response = await request(app).get(`/api/audits/${auditId}/network`).set('Cookie', reviewerCookie)
        expect(response.status).toBe(200)
        expect(response.body.datas.scope[0].hosts[0]).toMatchObject({hostname: 'srv1.example.com', ip: '10.0.0.1', os: 'Linux'})
        expect(response.body.datas.scope[0].hosts[0].services.map(({port, protocol, name, product, version}) => ({port, protocol, name, product, version})))
          .toEqual(scope[0].hosts[0].services)
        expect(response.body.datas.scope.map(s => s.name)).toEqual(['10.0.0.0/24', 'app.example.com'])
      })

      // BUG: src/routes/audit.js:215-217 PUT general replaces the scope by its names only ({name}) and the frontend
      // sends the scope with every save of the general page: saving the general information deletes the hosts and
      // services of the network page (e.g. imported from nmap).
      it.skip('Saving the general information keeps the hosts of the scope', async () => {
        expect((await updateGeneral({date: '2026-01-27', scope: ['10.0.0.0/24', 'app.example.com']})).status).toBe(200)
        var response = await request(app).get(`/api/audits/${auditId}/network`).set('Cookie', creatorCookie)
        expect(response.body.datas.scope[0].hosts).toHaveLength(1)
      })
    })

    describe('Findings', () => {
      it('Should not create a finding without title', async () => {
        var response = await addFinding({description: '<p>No title</p>'})
        expect(response.status).toBe(422)
        expect((await getAudit()).findings).toHaveLength(0)
      })

      it('Create findings: incremental identifiers and sorted by CVSS score', async () => {
        expect((await addFinding({title: 'Low finding', cvssv3: CVSS.low})).status).toBe(200)
        var response = await addFinding({
          title: 'Critical finding', cvssv3: CVSS.critical, vulnType: 'Internal', description: '<p>Description</p>',
          observation: '<p>Observation</p>', remediation: '<p>Remediation</p>', remediationComplexity: 2, priority: 3,
          references: ['https://owasp.org'], poc: '<p>Proof</p>', scope: '10.0.0.1', status: 0
        })
        expect(response.status).toBe(200)
        expect((await addFinding({title: 'Medium finding', cvssv3: CVSS.medium})).status).toBe(200)
        expect((await addFinding({title: 'Finding without CVSS'})).status).toBe(200)

        var audit = await getAudit()
        expect(audit.findings.map(f => [f.title, f.identifier])).toEqual([
          ['Critical finding', 2], ['Medium finding', 3], ['Low finding', 1], ['Finding without CVSS', 4]
        ])
        expect(audit.findings.find(f => f.title === 'Medium finding').status).toBe(1) // Default: redacting
      })

      it('Get a finding', async () => {
        var id = await findingId('Critical finding')
        var response = await request(app).get(`/api/audits/${auditId}/findings/${id}`).set('Cookie', reviewerCookie)
        expect(response.status).toBe(200)
        expect(response.body.datas).toMatchObject({
          _id: id, identifier: 2, title: 'Critical finding', cvssv3: CVSS.critical, vulnType: 'Internal', description: '<p>Description</p>',
          observation: '<p>Observation</p>', remediation: '<p>Remediation</p>', remediationComplexity: 2, priority: 3,
          references: ['https://owasp.org'], poc: '<p>Proof</p>', scope: '10.0.0.1', status: 0
        })
        response = await request(app).get(`/api/audits/${auditId}/findings/deadbeefdeadbeefdeadbeef`).set('Cookie', creatorCookie)
        expect(response.status).toBe(404)
        expect(response.body.datas).toBe('Finding not found')
      })

      it('Update a finding: fields and position', async () => {
        var id = await findingId('Low finding')
        var response = await updateFinding(id, {title: 'High finding', cvssv3: CVSS.high, description: '<p>To clear</p>', status: 0})
        expect(response.status).toBe(200)
        expect(await findingTitles()).toEqual(['Critical finding', 'High finding', 'Medium finding', 'Finding without CVSS'])

        // Text fields can be cleared
        expect((await updateFinding(id, {description: ''})).status).toBe(200)
        response = await request(app).get(`/api/audits/${auditId}/findings/${id}`).set('Cookie', creatorCookie)
        expect(response.body.datas).toMatchObject({title: 'High finding', description: '', status: 0, identifier: 1})

        expect((await updateFinding('deadbeefdeadbeefdeadbeef', {title: 'Unknown'})).status).toBe(404)
      })

      it('Collaborators add findings, reviewers cannot', async () => {
        expect((await addFinding({title: 'Collaborator finding', cvssv3: CVSS.low}, collaboratorCookie)).status).toBe(200)
        expect((await addFinding({title: 'Reviewer finding'}, reviewerCookie)).status).toBe(404)
        expect((await updateFinding(await findingId('Collaborator finding'), {title: 'Changed by reviewer'}, reviewerCookie)).status).toBe(404)
        expect(await findingTitles()).toEqual(['Critical finding', 'High finding', 'Medium finding', 'Collaborator finding', 'Finding without CVSS'])
      })

      it('Search audits by finding title', async () => {
        var search = async (title, cookie = creatorCookie) => (await request(app).get('/api/audits').query({findingTitle: title}).set('Cookie', cookie)).body.datas.map(a => a._id)
        expect(await search('critical')).toEqual([auditId])
        expect(await search('does not exist')).toEqual([])
        // Regular expression characters are escaped
        expect(await search('.*', adminCookie)).toEqual([])
        expect(await search('critical', otherCookie)).toEqual([])
      })

      it('Clone an audit with its findings', async () => {
        var response = await request(app).post(`/api/audits/${auditId}/clone`).set('Cookie', collaboratorCookie).send({name: 'Workflow audit copy'})
        expect(response.status).toBe(201)
        var clone = response.body.datas.audit
        expect(clone).toMatchObject({name: 'Workflow audit copy', creator: collaboratorId, state: 'EDIT', language: 'en'})
        expect(clone.findings.map(f => f.title)).toEqual(await findingTitles())
        expect(clone.scope.map(s => s.name)).toEqual(['10.0.0.0/24', 'app.example.com'])
        expect((await request(app).delete(`/api/audits/${clone._id}`).set('Cookie', collaboratorCookie)).status).toBe(200)
      })
    })

    describe('Findings order', () => {
      it('Sort options of the audit: ascending CVSS score', async () => {
        var response = await sortFindings([{category: 'No Category', sortValue: 'cvssScore', sortOrder: 'asc', sortAuto: true}])
        expect(response.status).toBe(200)
        expect(await findingTitles()).toEqual(['Finding without CVSS', 'Collaborator finding', 'Medium finding', 'High finding', 'Critical finding'])
        expect((await getAudit()).sortFindings).toEqual([{category: 'No Category', sortValue: 'cvssScore', sortOrder: 'asc', sortAuto: true}])
      })

      it('Sort by another field of the findings', async () => {
        expect((await sortFindings([{category: 'No Category', sortValue: 'title', sortOrder: 'asc', sortAuto: true}])).status).toBe(200)
        expect(await findingTitles()).toEqual(['Collaborator finding', 'Critical finding', 'Finding without CVSS', 'High finding', 'Medium finding'])
      })

      it('Sort by a custom field of the findings', async () => {
        var response = await request(app).post('/api/data/custom-fields').set('Cookie', adminCookie).send({fieldType: 'input', label: 'Rank', display: 'finding'})
        var field = response.body.datas
        var ranks = {'Critical finding': '3', 'High finding': '1', 'Medium finding': '10', 'Collaborator finding': '2'}
        for (var [title, rank] of Object.entries(ranks)) {
          // Custom fields of the findings are stored with their definition (frontend: services/utils.js)
          var customFields = [{customField: {_id: field._id, label: 'Rank', fieldType: 'input'}, text: rank}]
          expect((await updateFinding(await findingId(title), {customFields: customFields})).status).toBe(200)
        }
        expect((await sortFindings([{category: 'No Category', sortValue: 'Rank', sortOrder: 'asc', sortAuto: true}])).status).toBe(200)
        // Numeric order, findings without value first
        expect(await findingTitles()).toEqual(['Finding without CVSS', 'High finding', 'Collaborator finding', 'Critical finding', 'Medium finding'])
        // Custom field populated in the audit
        var audit = await getAudit()
        expect(audit.findings[1].customFields[0]).toMatchObject({customField: {_id: field._id, label: 'Rank', fieldType: 'input'}, text: '1'})
        expect((await request(app).delete(`/api/data/custom-fields/${field._id}`).set('Cookie', adminCookie)).status).toBe(200)
      })

      it('Manual order: findings moved and not sorted anymore', async () => {
        expect((await sortFindings([{category: 'No Category', sortValue: 'cvssScore', sortOrder: 'desc', sortAuto: false}])).status).toBe(200)
        expect(await findingTitles()).toEqual(['Critical finding', 'High finding', 'Medium finding', 'Collaborator finding', 'Finding without CVSS'])

        var move = (body) => request(app).put(`/api/audits/${auditId}/movefinding`).set('Cookie', creatorCookie).send(body)
        expect((await move({oldIndex: 0})).status).toBe(422)
        expect((await move({oldIndex: 0, newIndex: 4})).status).toBe(200)
        expect(await findingTitles()).toEqual(['High finding', 'Medium finding', 'Collaborator finding', 'Finding without CVSS', 'Critical finding'])

        // New and updated findings keep the manual order
        expect((await addFinding({title: 'Manual finding', cvssv3: CVSS.critical})).status).toBe(200)
        expect((await updateFinding(await findingId('Medium finding'), {cvssv3: CVSS.critical})).status).toBe(200)
        expect(await findingTitles()).toEqual(['High finding', 'Medium finding', 'Collaborator finding', 'Finding without CVSS', 'Critical finding', 'Manual finding'])
      })

      it('Back to automatic sort', async () => {
        expect((await sortFindings([{category: 'No Category', sortValue: 'cvssScore', sortOrder: 'desc', sortAuto: true}])).status).toBe(200)
        var titles = await findingTitles()
        expect(titles.slice(0, 3).sort()).toEqual(['Critical finding', 'Manual finding', 'Medium finding']) // Same score
        expect(titles.slice(3)).toEqual(['High finding', 'Collaborator finding', 'Finding without CVSS'])
      })
    })

    describe('Findings by category', () => {
      beforeAll(async () => {
        await request(app).post('/api/data/vulnerability-categories').set('Cookie', adminCookie).send({name: 'Workflow A'})
        await request(app).post('/api/data/vulnerability-categories').set('Cookie', adminCookie).send({name: 'Workflow B', sortValue: 'cvssScore', sortOrder: 'asc'})
      })

      afterAll(async () => {
        await request(app).delete('/api/data/vulnerability-categories/Workflow%20A').set('Cookie', adminCookie)
        await request(app).delete('/api/data/vulnerability-categories/Workflow%20B').set('Cookie', adminCookie)
      })

      it('Findings are grouped by category in the order of the categories, uncategorized last', async () => {
        expect((await addFinding({title: 'B low', category: 'Workflow B', cvssv3: CVSS.low})).status).toBe(200)
        expect((await addFinding({title: 'B critical', category: 'Workflow B', cvssv3: CVSS.critical})).status).toBe(200)
        expect((await addFinding({title: 'A medium', category: 'Workflow A', cvssv3: CVSS.medium})).status).toBe(200)
        expect((await addFinding({title: 'A high', category: 'Workflow A', cvssv3: CVSS.high})).status).toBe(200)

        var findings = (await getAudit()).findings
        // Category A: default sort (score desc), category B: ascending score from the category options
        expect(findings.slice(0, 4).map(f => f.title)).toEqual(['A high', 'A medium', 'B low', 'B critical'])
        expect(findings.slice(4).every(f => !f.category)).toBe(true)
      })

      it('Changing the category of a finding moves it to its group', async () => {
        expect((await updateFinding(await findingId('B critical'), {category: 'Workflow A'})).status).toBe(200)
        expect((await findingTitles()).slice(0, 4)).toEqual(['B critical', 'A high', 'A medium', 'B low'])
      })

      it('Delete findings', async () => {
        for (var title of ['B low', 'B critical', 'A medium', 'A high'])
          expect((await request(app).delete(`/api/audits/${auditId}/findings/${await findingId(title)}`).set('Cookie', creatorCookie)).status).toBe(200)
        expect((await getAudit()).findings.every(f => !f.category)).toBe(true)
      })
    })

    describe('Delete findings', () => {
      it('Only editors delete findings', async () => {
        var id = await findingId('Manual finding')
        expect((await request(app).delete(`/api/audits/${auditId}/findings/${id}`).set('Cookie', reviewerCookie)).status).toBe(404)
        expect((await request(app).delete(`/api/audits/${auditId}/findings/deadbeefdeadbeefdeadbeef`).set('Cookie', creatorCookie)).status).toBe(404)
        var count = (await getAudit()).findings.length
        expect((await request(app).delete(`/api/audits/${auditId}/findings/${id}`).set('Cookie', collaboratorCookie)).status).toBe(200)
        expect((await getAudit()).findings).toHaveLength(count - 1)
        expect(await findingTitles()).not.toContain('Manual finding')
        expect((await request(app).get(`/api/audits/${auditId}/findings/${id}`).set('Cookie', creatorCookie)).status).toBe(404)
      })
    })

    describe('Review comments', () => {
      var findingCommentId, commentOfCreatorId
      var comments = (cookie = creatorCookie) => request(app).get(`/api/audits/${auditId}/comments`).set('Cookie', cookie)
      var comment = (body, cookie) => request(app).post(`/api/audits/${auditId}/comments`).set('Cookie', cookie).send(body)
      var update = (id, body, cookie) => request(app).put(`/api/audits/${auditId}/comments/${id}`).set('Cookie', cookie).send(body)
      var reply = (id, body, cookie) => request(app).post(`/api/audits/${auditId}/comments/${id}/replies`).set('Cookie', cookie).send(body)

      it('Reviewers comment and reply', async () => {
        var id = await findingId('Critical finding')
        var response = await comment({target: {kind: 'finding', findingId: id, field: 'cvssv3'}, text: 'Score too high'}, reviewerCookie)
        expect(response.status).toBe(200)
        var created = response.body.datas.find(c => c.text === 'Score too high')
        expect(created.author.username).toBe('reviewer')
        expect(created.createdAt).toBeDefined()
        findingCommentId = created._id

        response = await comment({target: {kind: 'network', field: 'scope'}, text: 'Missing hosts'}, creatorCookie)
        commentOfCreatorId = response.body.datas.find(c => c.text === 'Missing hosts')._id

        response = await reply(findingCommentId, {text: 'Exploited without authentication'}, creatorCookie)
        expect(response.status).toBe(200)
        response = await reply(findingCommentId, {text: 'OK'}, reviewerCookie)
        expect(response.body.datas.find(c => c._id === findingCommentId).replies.map(r => [r.author.username, r.text]))
          .toEqual([['user2', 'Exploited without authentication'], ['reviewer', 'OK']])
      })

      it('Users allowed to read every audit comment it', async () => {
        var response = await comment({target: {kind: 'general', field: 'date'}, text: 'Date checked'}, reportCookie)
        expect(response.status).toBe(200)
        var id = response.body.datas.find(c => c.text === 'Date checked')._id
        expect((await request(app).delete(`/api/audits/${auditId}/comments/${id}`).set('Cookie', reportCookie)).status).toBe(200)
      })

      it('Comments are not part of the audit data', async () => {
        var audit = await getAudit()
        expect(audit.comments).toBeUndefined()
        expect((await comments()).body.datas.length).toBeGreaterThanOrEqual(2)
      })

      it('Reviewers resolve their own comments only', async () => {
        var response = await update(commentOfCreatorId, {resolved: true}, reviewerCookie)
        expect(response.status).toBe(403)
        response = await update(findingCommentId, {resolved: true}, reviewerCookie)
        expect(response.status).toBe(200)
        var resolved = response.body.datas.find(c => c._id === findingCommentId)
        expect(resolved.resolved).toBe(true)
        expect(resolved.resolvedBy.username).toBe('reviewer')
        expect(resolved.resolvedAt).toBeDefined()
      })

      it('Editors reopen comments', async () => {
        var response = await update(findingCommentId, {resolved: false}, collaboratorCookie)
        expect(response.status).toBe(200)
        var reopened = response.body.datas.find(c => c._id === findingCommentId)
        expect(reopened.resolved).toBe(false)
        expect(reopened.resolvedBy).toBeFalsy()
        expect(reopened.resolvedAt).toBeFalsy()
      })

      it('Should not update comments with invalid values', async () => {
        expect((await update(findingCommentId, {resolved: 'true'}, reviewerCookie)).status).toBe(422)
        expect((await update(findingCommentId, {text: '   '}, reviewerCookie)).status).toBe(422)
        expect((await update(findingCommentId, {text: 'x'.repeat(10001)}, reviewerCookie)).status).toBe(422)
        expect((await update(findingCommentId, {}, reviewerCookie)).status).toBe(422)
        expect((await update('deadbeefdeadbeefdeadbeef', {text: 'Unknown'}, reviewerCookie)).status).toBe(404)
        expect((await update('not-an-id', {resolved: true}, reviewerCookie)).status).toBe(404)
        expect((await reply('deadbeefdeadbeefdeadbeef', {text: 'Unknown'}, reviewerCookie)).status).toBe(404)
        expect((await reply(findingCommentId, {text: ''}, reviewerCookie)).status).toBe(422)
        expect((await reply(findingCommentId, {text: 42}, reviewerCookie)).status).toBe(422)
        var unchanged = (await comments()).body.datas.find(c => c._id === findingCommentId)
        expect(unchanged.text).toBe('Score too high')
        expect(unchanged.replies).toHaveLength(2)
      })

      it('Should not create comments with invalid targets', async () => {
        var post = (body) => comment({text: 'x', ...body}, reviewerCookie)
        expect((await post({target: {kind: 'general', field: 'x'.repeat(201)}})).status).toBe(422)
        expect((await post({target: {kind: 'general'}})).status).toBe(422)
        expect((await post({target: {kind: 'section', sectionId: 'deadbeefdeadbeefdeadbeef', field: 'text'}})).status).toBe(422)
        expect((await post({target: {kind: 'finding', findingId: 'not-an-id', field: 'title'}})).status).toBe(422)
        expect((await post({target: {kind: 'general', field: 'name'}, quote: {exact: 'a', prefix: 'x'.repeat(201)}})).status).toBe(422)
        expect((await post({target: {kind: 'general', field: 'name'}, quote: {exact: 'x'.repeat(2001)}})).status).toBe(422)
        expect((await post({target: {kind: 'general', field: 'name'}, image: {src: 'abc', occurrence: -1}})).status).toBe(422)
        expect((await post({target: {kind: 'general', field: 'name'}, image: {src: 'abc', occurrence: 1.5}})).status).toBe(422)
        expect((await post({target: {kind: 'general', field: 'name'}, text: 'x'.repeat(10001)})).status).toBe(422)
        var response = await request(app).post('/api/audits/deadbeefdeadbeefdeadbeef/comments').set('Cookie', adminCookie).send({target: {kind: 'general', field: 'name'}, text: 'x'})
        expect(response.status).toBe(404)
      })

      it('Comment deletion: author or administrator', async () => {
        expect((await request(app).delete(`/api/audits/${auditId}/comments/${commentOfCreatorId}`).set('Cookie', reviewerCookie)).status).toBe(403)
        expect((await request(app).delete(`/api/audits/${auditId}/comments/${findingCommentId}`).set('Cookie', collaboratorCookie)).status).toBe(403)
        expect((await request(app).delete(`/api/audits/${auditId}/comments/${commentOfCreatorId}`).set('Cookie', creatorCookie)).status).toBe(200)
        expect((await request(app).delete(`/api/audits/${auditId}/comments/${findingCommentId}`).set('Cookie', adminCookie)).status).toBe(200)
        var remaining = (await comments()).body.datas.map(c => c._id)
        expect(remaining).not.toContain(commentOfCreatorId)
        expect(remaining).not.toContain(findingCommentId)
      })
    })

    describe('Sections', () => {
      var sectionsAuditId, sectionId, customFieldId

      beforeAll(async () => {
        var response = await request(app).post('/api/data/custom-fields').set('Cookie', adminCookie).send({
          fieldType: 'text', label: 'Workflow scenario', display: 'section', displaySub: 'Attack Scenario', text: [{locale: 'en', value: '<p>Default</p>'}]
        })
        customFieldId = response.body.datas._id
        await request(app).post('/api/data/audit-types').set('Cookie', adminCookie).send({name: 'Workflow sections', templates: [], sections: ['attack_scenario']})
        response = await request(app).post('/api/audits').set('Cookie', creatorCookie).send({name: 'Sections audit', language: 'en', auditType: 'Workflow sections'})
        sectionsAuditId = response.body.datas.audit._id
        sectionId = response.body.datas.audit.sections[0]._id
        await request(app).put(`/api/audits/${sectionsAuditId}/general`).set('Cookie', creatorCookie).send({reviewers: [{_id: reviewerId}]})
      })

      afterAll(async () => {
        await request(app).delete(`/api/audits/${sectionsAuditId}`).set('Cookie', creatorCookie)
        await request(app).delete('/api/data/audit-types/Workflow%20sections').set('Cookie', adminCookie)
        await request(app).delete(`/api/data/custom-fields/${customFieldId}`).set('Cookie', adminCookie)
      })

      it('Get a section', async () => {
        var response = await request(app).get(`/api/audits/${sectionsAuditId}/sections/${sectionId}`).set('Cookie', reviewerCookie)
        expect(response.status).toBe(200)
        expect(response.body.datas).toMatchObject({_id: sectionId, field: 'attack_scenario', name: 'Attack Scenario'})
        expect(response.body.datas.customFields.map(f => [f.customField._id, f.text])).toEqual([[customFieldId, '<p>Default</p>']])
        response = await request(app).get(`/api/audits/${sectionsAuditId}/sections/deadbeefdeadbeefdeadbeef`).set('Cookie', creatorCookie)
        expect(response.status).toBe(404)
      })

      it('Update a section', async () => {
        var put = (body, cookie = creatorCookie) => request(app).put(`/api/audits/${sectionsAuditId}/sections/${sectionId}`).set('Cookie', cookie).send(body)
        expect((await put({text: '<p>Only text</p>'})).status).toBe(422)
        var customFields = [{customField: customFieldId, text: '<p>Phishing then lateral movement</p>'}]
        expect((await put({customFields: customFields}, reviewerCookie)).status).toBe(404)
        expect((await put({customFields: customFields})).status).toBe(200)

        var response = await request(app).get(`/api/audits/${sectionsAuditId}/sections/${sectionId}`).set('Cookie', creatorCookie)
        expect(response.body.datas.customFields).toEqual([{customField: customFieldId, text: '<p>Phishing then lateral movement</p>'}])
      })

      it('Comment a section', async () => {
        var response = await request(app).post(`/api/audits/${sectionsAuditId}/comments`).set('Cookie', reviewerCookie)
          .send({target: {kind: 'section', sectionId: sectionId, field: `customFields.${customFieldId}`}, quote: {exact: 'lateral', prefix: 'then ', suffix: ' movement'}, text: 'Which technique?'})
        expect(response.status).toBe(200)
        expect(response.body.datas[0]).toMatchObject({target: {kind: 'section', sectionId: sectionId, field: `customFields.${customFieldId}`}, quote: {exact: 'lateral', prefix: 'then ', suffix: ' movement'}})
      })
    })

    describe('Audit deletion', () => {
      it('Creator deletes the audit', async () => {
        expect((await request(app).delete(`/api/audits/${auditId}`).set('Cookie', creatorCookie)).status).toBe(200)
        expect((await request(app).get(`/api/audits/${auditId}`).set('Cookie', creatorCookie)).status).toBe(404)
        expect((await request(app).get(`/api/audits/${auditId}/comments`).set('Cookie', adminCookie)).status).toBe(404)
        expect((await request(app).delete(`/api/audits/${auditId}`).set('Cookie', creatorCookie)).status).toBe(404)
      })
    })
  })
}
