/*
  Permissions of the built-in roles (user, admin), of the role of the configuration (report: user + audits:read-all)
  and of custom roles. Users from user.test.js: admin (admin), user2 (user), report (report), reviewer (role 'reviewer'
  not defined: permissions of the user role).
  At the end: 1 more user 'customrole' (disabled), roles unchanged.
*/

module.exports = function(request, app) {
  var helpers = require('./helpers')(request, app)
  var acl = require('../src/lib/auth').acl
  var FAKE_ID = 'deadbeefdeadbeefdeadbeef'

  describe('Roles and Permissions Suite Tests', () => {
    var adminCookie, userCookie, reportCookie, reviewerCookie
    var audit1Id

    beforeAll(async () => {
      adminCookie = await helpers.login('admin', 'Admin123')
      userCookie = await helpers.login('user2', 'User1234')
      reportCookie = await helpers.login('report', 'Report123')
      reviewerCookie = await helpers.login('reviewer', 'Reviewer123')
      var response = await request(app).get('/api/audits').set('Cookie', adminCookie)
      audit1Id = response.body.datas.find(a => a.name === 'Audit 1')._id
    })

    describe('Roles definition', () => {
      it('Lists the built-in roles and the roles of the configuration', async () => {
        var response = await request(app).get('/api/data/roles').set('Cookie', userCookie)
        expect(response.status).toBe(200)
        expect(response.body.datas).toEqual(expect.arrayContaining(['user', 'admin', 'report']))
        expect(response.body.datas).not.toContain('reviewer')
      })

      it('Access token contains the permissions of the role, inherited ones included', async () => {
        var login = async (username, password) => (await request(app).post('/api/users/token').send({username, password})).body.datas.token

        var user = helpers.jwtPayload(await login('user2', 'User1234'))
        expect(user).toMatchObject({username: 'user2', role: 'user'})
        expect(user.roles).toEqual(expect.arrayContaining(['audits:read', 'audits:create', 'vulnerability-updates:create', 'settings:read-public', 'spellcheck-words:read', 'spellcheck-words:create']))
        expect(user.roles).not.toContain('audits:read-all')
        expect(user.roles).not.toContain('vulnerabilities:create')

        var report = helpers.jwtPayload(await login('report', 'Report123'))
        expect(report.role).toBe('report')
        expect(report.roles).toEqual(expect.arrayContaining(['audits:read-all', 'audits:read', 'clients:read']))

        var admin = helpers.jwtPayload(await login('admin', 'Admin123'))
        expect(admin.roles).toBe('*')

        // Unknown role: permissions of the user role
        var reviewer = helpers.jwtPayload(await login('reviewer', 'Reviewer123'))
        expect(reviewer.role).toBe('reviewer')
        expect(reviewer.roles.sort()).toEqual(user.roles.sort())
      })
    })

    describe('User role', () => {
      var readRoutes = [
        '/api/data/roles', '/api/data/languages', '/api/data/audit-types', '/api/data/vulnerability-types',
        '/api/data/vulnerability-categories', '/api/data/sections', '/api/data/custom-fields',
        '/api/templates', '/api/vulnerabilities', '/api/vulnerabilities/en', '/api/vulnerabilities/export',
        '/api/companies', '/api/companies/export', '/api/clients', '/api/clients/export',
        '/api/users', '/api/users/reviewers', '/api/users/admin', '/api/users/me', '/api/users/checktoken',
        '/api/settings/public', '/api/audits', '/api/vulnerability-proposals', '/api/vulnerability-proposals/count'
      ]

      var forbiddenRoutes = [
        ['post', '/api/templates'], ['put', `/api/templates/${FAKE_ID}`], ['delete', `/api/templates/${FAKE_ID}`],
        ['post', '/api/data/languages'], ['put', '/api/data/languages'], ['delete', '/api/data/languages/en'],
        ['post', '/api/data/audit-types'], ['put', '/api/data/audit-types'], ['delete', '/api/data/audit-types/Web'],
        ['post', '/api/data/vulnerability-types'], ['put', '/api/data/vulnerability-types'], ['delete', '/api/data/vulnerability-types/Internal'],
        ['post', '/api/data/vulnerability-categories'], ['put', '/api/data/vulnerability-categories'], ['delete', '/api/data/vulnerability-categories/Web'],
        ['post', '/api/data/sections'], ['put', '/api/data/sections'], ['delete', '/api/data/sections/goal/en'],
        ['post', '/api/data/custom-fields'], ['put', '/api/data/custom-fields'], ['delete', `/api/data/custom-fields/${FAKE_ID}`],
        ['post', '/api/vulnerabilities'], ['delete', '/api/vulnerabilities'], ['put', `/api/vulnerabilities/${FAKE_ID}`],
        ['delete', `/api/vulnerabilities/${FAKE_ID}`], ['put', `/api/vulnerabilities/${FAKE_ID}/archive`],
        ['put', `/api/vulnerabilities/merge/${FAKE_ID}`], ['get', `/api/vulnerabilities/updates/${FAKE_ID}`],
        ['put', `/api/vulnerability-proposals/${FAKE_ID}/accept`], ['put', `/api/vulnerability-proposals/${FAKE_ID}/reject`],
        ['get', '/api/settings'], ['put', '/api/settings'], ['put', '/api/settings/revert'], ['get', '/api/settings/export'],
        ['post', '/api/users'], ['put', `/api/users/${FAKE_ID}`], ['get', '/api/users/export'],
        ['delete', `/api/images/${FAKE_ID}`],
        ['put', `/api/audits/${FAKE_ID}/toggleApproval`],
        ['get', '/api/backups'], ['post', '/api/backups']
      ]

      it('Reads the reference data', async () => {
        for (var route of readRoutes) {
          var response = await request(app).get(route).set('Cookie', userCookie)
          expect([route, response.status]).toEqual([route, 200])
        }
      })

      it('Cannot modify the reference data, the settings and the users', async () => {
        for (var [method, route] of forbiddenRoutes) {
          var response = await request(app)[method](route).set('Cookie', userCookie).send({})
          expect([method, route, response.status]).toEqual([method, route, 403])
          expect(response.body.datas).toBe('Insufficient privileges')
        }
      })

      it('Forbidden requests do not modify the data', async () => {
        var before = (await request(app).get('/api/vulnerabilities').set('Cookie', adminCookie)).body.datas.length
        await request(app).delete('/api/vulnerabilities').set('Cookie', userCookie)
        await request(app).put('/api/settings').set('Cookie', userCookie).send({reviews: {enabled: true}})
        expect((await request(app).get('/api/vulnerabilities').set('Cookie', adminCookie)).body.datas).toHaveLength(before)
        expect((await request(app).get('/api/settings').set('Cookie', adminCookie)).body.datas.reviews.enabled).toBe(false)
      })

      it('Only sees the audits where the user is creator, collaborator or reviewer', async () => {
        var response = await request(app).get('/api/audits').set('Cookie', userCookie)
        expect(response.status).toBe(200)
        expect(response.body.datas.map(a => a.name)).not.toContain('Audit 1')

        for (var route of [`/api/audits/${audit1Id}`, `/api/audits/${audit1Id}/general`, `/api/audits/${audit1Id}/network`,
                           `/api/audits/${audit1Id}/generate`, `/api/audits/${audit1Id}/comments`]) {
          response = await request(app).get(route).set('Cookie', userCookie)
          expect([route, response.status]).toEqual([route, 404])
        }
        response = await request(app).delete(`/api/audits/${audit1Id}`).set('Cookie', userCookie)
        expect(response.status).toBe(404)
        response = await request(app).post(`/api/audits/${audit1Id}/clone`).set('Cookie', userCookie).send({name: 'Copy'})
        expect(response.status).toBe(404)
      })

      it('Users connected to the audits are only listed for allowed roles', async () => {
        var response = await request(app).get('/api/audits').set('Cookie', adminCookie)
        expect(response.body.datas.find(a => a._id === audit1Id).connected).toEqual(expect.any(Array))
        response = await request(app).get('/api/audits').set('Cookie', reportCookie)
        expect(response.body.datas.find(a => a._id === audit1Id).connected).toBeUndefined()
      })
    })

    describe('Report role (configuration: user + audits:read-all)', () => {
      it('Reads every audit', async () => {
        var response = await request(app).get('/api/audits').set('Cookie', reportCookie)
        expect(response.status).toBe(200)
        expect(response.body.datas.map(a => a.name)).toContain('Audit 1')

        response = await request(app).get(`/api/audits/${audit1Id}`).set('Cookie', reportCookie)
        expect(response.status).toBe(200)
        expect(response.body.datas.name).toBe('Audit 1')
        response = await request(app).get(`/api/audits/${audit1Id}/general`).set('Cookie', reportCookie)
        expect(response.status).toBe(200)
        response = await request(app).get(`/api/audits/${audit1Id}/network`).set('Cookie', reportCookie)
        expect(response.status).toBe(200)
        response = await request(app).get(`/api/audits/${audit1Id}/comments`).set('Cookie', reportCookie)
        expect(response.status).toBe(200)
        // Access granted: the generation fails on the missing template only
        response = await request(app).get(`/api/audits/${audit1Id}/generate`).set('Cookie', reportCookie)
        expect(response.status).toBe(422)
        expect(response.body.datas).toBe('Template not defined')
      })

      it('Cannot modify nor delete the audits of other users', async () => {
        var response = await request(app).put(`/api/audits/${audit1Id}/general`).set('Cookie', reportCookie).send({name: 'Renamed by report'})
        expect(response.status).toBe(404)
        response = await request(app).put(`/api/audits/${audit1Id}/network`).set('Cookie', reportCookie).send({scope: []})
        expect(response.status).toBe(404)
        response = await request(app).post(`/api/audits/${audit1Id}/findings`).set('Cookie', reportCookie).send({title: 'Added by report'})
        expect(response.status).toBe(404)
        response = await request(app).delete(`/api/audits/${audit1Id}`).set('Cookie', reportCookie)
        expect(response.status).toBe(404)

        response = await request(app).get(`/api/audits/${audit1Id}`).set('Cookie', adminCookie)
        expect(response.body.datas.name).toBe('Audit 1')
        expect(response.body.datas.scope).toHaveLength(2)
        expect(response.body.datas.findings.map(f => f.title)).not.toContain('Added by report')
      })

      it('Can clone the audits it can read', async () => {
        var response = await request(app).post(`/api/audits/${audit1Id}/clone`).set('Cookie', reportCookie).send({name: 'Audit 1 report copy'})
        expect(response.status).toBe(201)
        var clone = response.body.datas.audit
        expect(clone.creator).toBe(await helpers.userId(adminCookie, 'report'))
        expect((await request(app).delete(`/api/audits/${clone._id}`).set('Cookie', reportCookie)).status).toBe(200)
      })

      it('Cannot approve audits', async () => {
        var response = await request(app).put(`/api/audits/${audit1Id}/toggleApproval`).set('Cookie', reportCookie)
        expect(response.status).toBe(403)
      })
    })

    describe('Role not defined', () => {
      it('Gets the permissions of the user role', async () => {
        expect((await request(app).get('/api/settings/public').set('Cookie', reviewerCookie)).status).toBe(200)
        expect((await request(app).get('/api/settings').set('Cookie', reviewerCookie)).status).toBe(403)
        expect((await request(app).put(`/api/audits/${audit1Id}/toggleApproval`).set('Cookie', reviewerCookie)).status).toBe(403)

        var response = await request(app).post('/api/audits').set('Cookie', reviewerCookie).send({name: 'Reviewer audit', language: 'en', auditType: 'Web'})
        expect(response.status).toBe(201)
        expect((await request(app).delete(`/api/audits/${response.body.datas.audit._id}`).set('Cookie', reviewerCookie)).status).toBe(200)
      })

      it('Is not listed as reviewer', async () => {
        var response = await request(app).get('/api/users/reviewers').set('Cookie', userCookie)
        expect(response.status).toBe(200)
        var usernames = response.body.datas.map(u => u.username)
        expect(usernames).toContain('admin')
        expect(usernames).not.toContain('reviewer')
        expect(usernames).not.toContain('user2')
        expect(usernames).not.toContain('report')
      })
    })

    describe('Admin role', () => {
      it('Exports the users with their password hash', async () => {
        var response = await request(app).get('/api/users/export').set('Cookie', adminCookie)
        expect(response.status).toBe(200)
        var admin = response.body.datas.find(u => u.username === 'admin')
        expect(admin.password).toMatch(/^\$2[aby]\$10\$/)
        expect(admin._id).toBeUndefined()
        expect(JSON.stringify(response.body.datas)).not.toContain('refreshTokens')
        expect(JSON.stringify(response.body.datas)).not.toContain('totpSecret')
      })

      it('Reads the private settings', async () => {
        var response = await request(app).get('/api/settings').set('Cookie', adminCookie)
        expect(response.status).toBe(200)
        expect(response.body.datas.reviews.private).toBeDefined()
      })
    })

    describe('Custom role', () => {
      var ROLE = 'test-vuln-editor'
      var customCookie, customUserId, vulnId

      beforeAll(async () => {
        // Same as a role of the configuration file (src/config/roles.json)
        acl.roles[ROLE] = {inherits: ['user'], allows: ['vulnerabilities:create', 'vulnerabilities:update', 'settings:read']}
        var response = await request(app).post('/api/users').set('Cookie', adminCookie)
          .send([{username: 'customrole', password: 'Customrole1', firstname: 'Custom', lastname: 'Role', role: ROLE}])
        expect(response.status).toBe(201)
        customUserId = await helpers.userId(adminCookie, 'customrole')
        customCookie = await helpers.login('customrole', 'Customrole1')
      })

      afterAll(async () => {
        delete acl.roles[ROLE]
        await request(app).put(`/api/users/${customUserId}`).set('Cookie', adminCookie).send({enabled: false})
        if (vulnId)
          await request(app).delete(`/api/vulnerabilities/${vulnId}`).set('Cookie', adminCookie)
      })

      it('Is listed with the other roles', async () => {
        var response = await request(app).get('/api/data/roles').set('Cookie', customCookie)
        expect(response.body.datas).toContain(ROLE)
      })

      it('Grants its own permissions and the inherited ones', async () => {
        var response = await request(app).post('/api/vulnerabilities').set('Cookie', customCookie)
          .send([{details: [{locale: 'en', title: 'Vulnerability from custom role'}]}])
        expect(response.status).toBe(201)
        vulnId = (await request(app).get('/api/vulnerabilities').set('Cookie', customCookie)).body.datas
          .find(v => v.details.some(d => d.title === 'Vulnerability from custom role'))._id

        response = await request(app).put(`/api/vulnerabilities/${vulnId}/archive`).set('Cookie', customCookie).send({archived: false})
        expect(response.status).toBe(200)
        expect((await request(app).get('/api/settings').set('Cookie', customCookie)).status).toBe(200)
        // Inherited from user
        expect((await request(app).get('/api/clients').set('Cookie', customCookie)).status).toBe(200)
      })

      it('Does not grant the other permissions', async () => {
        expect((await request(app).delete(`/api/vulnerabilities/${vulnId}`).set('Cookie', customCookie)).status).toBe(403)
        expect((await request(app).put('/api/settings').set('Cookie', customCookie).send({})).status).toBe(403)
        expect((await request(app).get('/api/users/export').set('Cookie', customCookie)).status).toBe(403)
      })

      it('Permissions are checked at each request: a removed role falls back to the user role', async () => {
        var permissions = acl.roles[ROLE]
        delete acl.roles[ROLE]
        try {
          var response = await request(app).post('/api/vulnerabilities').set('Cookie', customCookie)
            .send([{details: [{locale: 'en', title: 'Vulnerability after role removal'}]}])
          expect(response.status).toBe(403)
          expect((await request(app).get('/api/clients').set('Cookie', customCookie)).status).toBe(200)
        }
        finally {
          acl.roles[ROLE] = permissions
        }
      })
    })
  })
}
