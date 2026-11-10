/*
  Permission matrix of the API.
  1. Every route of src/routes/*.js for every role: anonymous, user, report (src/config/roles.json), admin,
     custom role defined by this suite (perm-viewer, restricted) and role not defined (permissions of the user role).
     Expected answer: 401 without token, 403 'Insufficient privileges' when the role lacks the permission given to
     acl.hasPermission() by the route, otherwise the answer of the route itself (requests built not to change the data:
     unknown identifiers, missing parameters; the deletions of whole collections are undone).
  2. Audits of other users: creator, collaborator, reviewer, user without link, report role (audits:read-all),
     custom role allowed to update and delete all the audits (perm-auditor), admin.
  3. Vulnerability proposals of other users.
  Users created: perm-* (disabled at the end). Custom roles removed and settings reverted at the end,
  no more audit, audit type, section or proposal created here.
*/

module.exports = function(request, app) {
  var helpers = require('./helpers')(request, app)
  var acl = require('../src/lib/auth').acl
  var mongoose = require('mongoose')

  var FAKE_ID = 'deadbeefdeadbeefdeadbeef'
  var FAKE_BACKUP = '20000101-000000-deadbeef'
  var PASSWORD = 'Perm1234'

  // Permissions of the roles, as defined in src/lib/auth.js (built-in roles) and src/config/roles.json
  var USER_PERMISSIONS = [
    'audits:create', 'audits:read', 'audits:update', 'audits:delete',
    'images:create', 'images:read',
    'clients:create', 'clients:read', 'clients:update', 'clients:delete',
    'companies:create', 'companies:read', 'companies:update', 'companies:delete',
    'languages:read', 'audit-types:read', 'vulnerability-types:read', 'vulnerability-categories:read', 'sections:read',
    'templates:read', 'users:read', 'roles:read', 'vulnerabilities:read', 'vulnerability-updates:create',
    'custom-fields:read', 'settings:read-public'
  ]
  // Custom roles defined by this suite (same as roles of src/config/roles.json)
  var CUSTOM_ROLES = {
    // Restricted role, without inheritance
    'perm-viewer': {allows: ['audits:read', 'vulnerabilities:read', 'languages:read', 'settings:read-public']},
    // Reviewer of the audits it is assigned to
    'perm-reviewer': {inherits: ['user'], allows: ['audits:review']},
    // Manager of all the audits, without review permission
    'perm-auditor': {inherits: ['user'], allows: ['audits:read-all', 'audits:update-all', 'audits:delete-all']}
  }
  var PERMISSIONS = {
    user: USER_PERMISSIONS,
    report: [...USER_PERMISSIONS, 'audits:read-all'],
    admin: '*',
    'perm-viewer': CUSTOM_ROLES['perm-viewer'].allows,
    'perm-undefined-role': USER_PERMISSIONS // Role not defined: permissions of the user role
  }
  var hasPermission = (role, permission) => PERMISSIONS[role] === '*' || PERMISSIONS[role].includes(permission)

  var USERS = [
    {username: 'perm-user', role: 'user'},
    {username: 'perm-report', role: 'report'},
    {username: 'perm-viewer', role: 'perm-viewer'},
    {username: 'perm-norole', role: 'perm-undefined-role'},
    {username: 'perm-collab', role: 'user'},
    {username: 'perm-reviewer', role: 'perm-reviewer'},
    {username: 'perm-other', role: 'user'},
    {username: 'perm-auditor', role: 'perm-auditor'}
  ]
  var cookies = {}
  var ids = {}

  var call = (method, path, cookie, body, type) => {
    var req = request(app)[method](path)
    if (cookie) req = req.set('Cookie', cookie)
    if (type) req = req.set('Content-Type', type)
    if (body !== undefined) req = req.send(body)
    return req
  }
  var admin = (method, path, body) => call(method, path, cookies.admin, body)

  // Reviews enabled (approvals and review states reachable), other review settings at their default value
  var enableReviews = () => admin('put', '/api/settings', {reviews: {
    enabled: true,
    public: {mandatoryReview: false, minReviewers: 1, blockApprovalWithOpenComments: false},
    private: {removeApprovalsUponUpdate: false}
  }})

  // Runs fn and puts back the documents of the collection if their number changed (deletion of all the documents)
  var keepCollection = async (modelName, fn) => {
    var collection = mongoose.model(modelName).collection
    var documents = await collection.find({}).toArray()
    try {
      return await fn()
    }
    finally {
      if (await collection.countDocuments() !== documents.length) {
        await collection.deleteMany({})
        if (documents.length > 0)
          await collection.insertMany(documents)
      }
    }
  }

  describe('Permission Matrix Suite Tests', () => {
    beforeAll(async () => {
      Object.keys(CUSTOM_ROLES).forEach(role => acl.roles[role] = CUSTOM_ROLES[role])
      cookies.admin = await helpers.login('admin', 'Admin123')
      var response = await admin('post', '/api/users', USERS.map(u => ({username: u.username, password: PASSWORD, firstname: 'Perm', lastname: u.username, role: u.role})))
      expect(response.status).toBe(201)
      for (var user of USERS) {
        cookies[user.username] = await helpers.login(user.username, PASSWORD)
        ids[user.username] = await helpers.userId(cookies.admin, user.username)
      }
      expect((await enableReviews()).status).toBe(200)
    })

    afterAll(async () => {
      await admin('put', '/api/settings/revert')
      for (var user of USERS)
        await admin('put', `/api/users/${ids[user.username]}`, {enabled: false})
      Object.keys(CUSTOM_ROLES).forEach(role => delete acl.roles[role])
    })

    describe('Routes and roles', () => {
      var counts = async () => ({
        Company: await mongoose.model('Company').countDocuments(),
        Client: await mongoose.model('Client').countDocuments(),
        Vulnerability: await mongoose.model('Vulnerability').countDocuments()
      })
      var countsBefore
      beforeAll(async () => { countsBefore = await counts() })


      describe('Roles of the matrix', () => {
        it('Built-in and configuration roles have the expected permissions', () => {
          expect([...acl.getRoles('user')].sort()).toEqual([...USER_PERMISSIONS].sort())
          expect([...acl.getRoles('report')].sort()).toEqual([...PERMISSIONS.report].sort())
          expect(acl.getRoles('admin')).toBe('*')
          expect([...acl.getRoles('perm-undefined-role')].sort()).toEqual([...USER_PERMISSIONS].sort())
        })

        it.each(USERS.map(u => [u.username, u.role]))('Access token of %s contains the permissions of the role %s', async (username, role) => {
          var response = await request(app).post('/api/users/token').send({username: username, password: PASSWORD})
          expect(response.status).toBe(200)
          var payload = helpers.jwtPayload(response.body.datas.token)
          expect(payload.role).toBe(role)
          expect([...payload.roles].sort()).toEqual([...acl.getRoles(role)].sort())
        })
      })

      /*
        Routes: [method, path, permission given to acl.hasPermission (null: public route), answer when allowed, options]
        options: body, type (Content-Type), keep (model of the collection put back after the request), after (function run after)
      */
      var ROUTES = [
        // Users (src/routes/user.js)
        ['get', '/api/users/checktoken', 'validtoken', 200],
        ['get', '/api/users/refreshtoken', null, 401], // No refresh token cookie
        ['delete', '/api/users/refreshtoken', null, 401],
        ['post', '/api/users/token', null, 422, {body: {}}],
        ['get', '/api/users/init', null, 200],
        ['post', '/api/users/init', null, 403, {body: {username: 'perm-init', password: PASSWORD, firstname: 'Perm', lastname: 'Init'}}],
        ['get', '/api/users', 'users:read', 200],
        ['get', '/api/users/export', 'users:read-all', 200],
        ['get', '/api/users/reviewers', 'users:read', 200],
        ['get', '/api/users/me', 'validtoken', 200],
        ['get', '/api/users/totp', 'validtoken', 200],
        ['post', '/api/users/totp', 'validtoken', 422, {body: {}}],
        ['delete', '/api/users/totp', 'validtoken', 422, {body: {}}],
        ['get', '/api/users/admin', 'users:read', 200],
        ['post', '/api/users', 'users:create', 422, {body: [{}]}],
        ['put', '/api/users/me', 'validtoken', 422, {body: {}}],
        ['put', `/api/users/${FAKE_ID}`, 'users:update', 404, {body: {}}],

        // Custom data (src/routes/data.js)
        ['get', '/api/data/roles', 'roles:read', 200],
        ['get', '/api/data/languages', 'languages:read', 200],
        ['post', '/api/data/languages', 'languages:create', 422, {body: {}}],
        ['put', '/api/data/languages', 'languages:update', 422, {body: [{}]}],
        ['delete', '/api/data/languages/perm-unknown', 'languages:delete', 404],
        ['get', '/api/data/audit-types', 'audit-types:read', 200],
        ['post', '/api/data/audit-types', 'audit-types:create', 422, {body: {}}],
        ['put', '/api/data/audit-types', 'audit-types:update', 422, {body: [{}]}],
        ['delete', '/api/data/audit-types/perm-unknown', 'audit-types:delete', 404],
        ['get', '/api/data/vulnerability-types', 'vulnerability-types:read', 200],
        ['post', '/api/data/vulnerability-types', 'vulnerability-types:create', 422, {body: {}}],
        ['put', '/api/data/vulnerability-types', 'vulnerability-types:update', 422, {body: [{}]}],
        ['delete', '/api/data/vulnerability-types/perm-unknown', 'vulnerability-types:delete', 404],
        ['get', '/api/data/vulnerability-categories', 'vulnerability-categories:read', 200],
        ['post', '/api/data/vulnerability-categories', 'vulnerability-categories:create', 422, {body: {}}],
        ['put', '/api/data/vulnerability-categories', 'vulnerability-categories:update', 422, {body: [{}]}],
        ['delete', '/api/data/vulnerability-categories/perm-unknown', 'vulnerability-categories:delete', 404],
        ['get', '/api/data/sections', 'sections:read', 200],
        ['post', '/api/data/sections', 'sections:create', 422, {body: {}}],
        ['put', '/api/data/sections', 'sections:update', 422, {body: [{}]}],
        ['delete', '/api/data/sections/perm_unknown/en', 'sections:delete', 404],
        ['get', '/api/data/custom-fields', 'custom-fields:read', 200],
        ['post', '/api/data/custom-fields', 'custom-fields:create', 422, {body: {}}],
        ['put', '/api/data/custom-fields', 'custom-fields:update', 422, {body: [{}]}],
        ['delete', `/api/data/custom-fields/${FAKE_ID}`, 'custom-fields:delete', 404],

        // Companies (src/routes/company.js)
        ['get', '/api/companies', 'companies:read', 200],
        ['get', '/api/companies/export', 'companies:read', 200],
        ['post', '/api/companies', 'companies:create', 422, {body: [{}]}],
        ['put', `/api/companies/${FAKE_ID}`, 'companies:update', 404, {body: {}}],
        ['delete', `/api/companies/${FAKE_ID}`, 'companies:delete', 404],
        ['delete', '/api/companies', 'companies:delete', 200, {keep: 'Company'}],

        // Clients (src/routes/client.js)
        ['get', '/api/clients', 'clients:read', 200],
        ['get', '/api/clients/export', 'clients:read', 200],
        ['post', '/api/clients', 'clients:create', 422, {body: [{}]}],
        ['put', `/api/clients/${FAKE_ID}`, 'clients:update', 404, {body: {}}],
        ['delete', `/api/clients/${FAKE_ID}`, 'clients:delete', 404],
        ['delete', '/api/clients', 'clients:delete', 200, {keep: 'Client'}],

        // Templates (src/routes/template.js)
        ['get', '/api/templates', 'templates:read', 200],
        ['post', '/api/templates', 'templates:create', 422, {body: {}}],
        ['put', `/api/templates/${FAKE_ID}`, 'templates:update', 404, {body: {}}],
        ['delete', `/api/templates/${FAKE_ID}`, 'templates:delete', 404],
        ['get', `/api/templates/download/${FAKE_ID}`, 'templates:read', 404],

        // Images (src/routes/image.js)
        ['get', `/api/images/${FAKE_ID}`, 'images:read', 404],
        ['post', '/api/images', 'images:create', 422, {body: {}}],
        ['delete', `/api/images/${FAKE_ID}`, 'images:delete', 404],
        ['get', `/api/images/download/${FAKE_ID}`, 'images:read', 404],

        // Settings (src/routes/settings.js)
        ['get', '/api/settings', 'settings:read', 200],
        ['get', '/api/settings/public', 'settings:read-public', 200],
        ['put', '/api/settings', 'settings:update', 200, {body: {}}],
        ['put', '/api/settings/revert', 'settings:update', 200, {after: enableReviews}],
        ['get', '/api/settings/export', 'settings:read', 200],

        // Vulnerabilities and proposals (src/routes/vulnerability.js)
        ['get', '/api/vulnerabilities', 'vulnerabilities:read', 200],
        ['get', '/api/vulnerabilities/export', 'vulnerabilities:read', 200],
        ['post', '/api/vulnerabilities', 'vulnerabilities:create', 422, {body: [{}]}],
        ['put', `/api/vulnerabilities/${FAKE_ID}`, 'vulnerabilities:update', 404, {body: {details: [{locale: 'en', title: 'perm-unknown'}]}}],
        ['put', `/api/vulnerabilities/${FAKE_ID}/archive`, 'vulnerabilities:update', 404, {body: {archived: true}}],
        ['delete', `/api/vulnerabilities/${FAKE_ID}`, 'vulnerabilities:delete', 404],
        ['delete', '/api/vulnerabilities', 'vulnerabilities:delete-all', 200, {keep: 'Vulnerability'}],
        ['get', '/api/vulnerabilities/en', 'vulnerabilities:read', 200],
        ['post', '/api/vulnerabilities/finding/en', 'vulnerability-updates:create', 422, {body: {}}],
        ['get', `/api/vulnerabilities/updates/${FAKE_ID}`, 'vulnerabilities:update', 200],
        ['put', `/api/vulnerabilities/merge/${FAKE_ID}`, 'vulnerabilities:update', 422, {body: {}}],
        ['get', '/api/vulnerability-proposals', 'vulnerabilities:read', 200],
        ['get', '/api/vulnerability-proposals/count', 'vulnerabilities:read', 200],
        ['get', `/api/vulnerability-proposals/finding/${FAKE_ID}`, 'vulnerabilities:read', 200],
        ['get', `/api/vulnerability-proposals/${FAKE_ID}`, 'vulnerabilities:read', 404],
        ['put', `/api/vulnerability-proposals/${FAKE_ID}/accept`, 'vulnerabilities:update', 404, {body: {}}],
        ['put', `/api/vulnerability-proposals/${FAKE_ID}/reject`, 'vulnerabilities:update', 404, {body: {comment: 'Refused'}}],
        ['delete', `/api/vulnerability-proposals/${FAKE_ID}`, 'vulnerability-updates:create', 404],

        // Audits (src/routes/audit.js): access to the audit itself is checked in the next part
        ['get', '/api/audits', 'audits:read', 200],
        ['post', '/api/audits', 'audits:create', 422, {body: {}}],
        ['post', `/api/audits/${FAKE_ID}/clone`, 'audits:create', 404, {body: {name: 'perm-clone'}}],
        ['delete', `/api/audits/${FAKE_ID}`, 'audits:delete', 404],
        ['get', `/api/audits/${FAKE_ID}`, 'audits:read', 404],
        ['get', `/api/audits/${FAKE_ID}/general`, 'audits:read', 404],
        ['put', `/api/audits/${FAKE_ID}/general`, 'audits:update', 404, {body: {}}],
        ['get', `/api/audits/${FAKE_ID}/network`, 'audits:read', 404],
        ['put', `/api/audits/${FAKE_ID}/network`, 'audits:update', 404, {body: {}}],
        ['post', `/api/audits/${FAKE_ID}/findings`, 'audits:update', 404, {body: {title: 'perm-finding'}}],
        ['get', `/api/audits/${FAKE_ID}/findings/${FAKE_ID}`, 'audits:read', 404],
        ['put', `/api/audits/${FAKE_ID}/findings/${FAKE_ID}`, 'audits:update', 404, {body: {}}],
        ['delete', `/api/audits/${FAKE_ID}/findings/${FAKE_ID}`, 'audits:update', 404],
        ['get', `/api/audits/${FAKE_ID}/sections/${FAKE_ID}`, 'audits:read', 404],
        ['put', `/api/audits/${FAKE_ID}/sections/${FAKE_ID}`, 'audits:update', 404, {body: {customFields: []}}],
        ['get', `/api/audits/${FAKE_ID}/generate`, 'audits:read', 404],
        ['put', `/api/audits/${FAKE_ID}/sortfindings`, 'audits:update', 404, {body: {}}],
        ['put', `/api/audits/${FAKE_ID}/movefinding`, 'audits:update', 404, {body: {oldIndex: 0, newIndex: 0}}],
        ['put', `/api/audits/${FAKE_ID}/toggleApproval`, 'audits:review', 404],
        ['put', `/api/audits/${FAKE_ID}/updateReadyForReview`, 'audits:update', 404, {body: {state: 'REVIEW'}}],
        ['get', `/api/audits/${FAKE_ID}/comments`, 'audits:read', 404],
        ['post', `/api/audits/${FAKE_ID}/comments`, 'audits:read', 404, {body: {target: {kind: 'general', field: 'name'}, text: 'Comment'}}],
        ['post', `/api/audits/${FAKE_ID}/comments/${FAKE_ID}/replies`, 'audits:read', 404, {body: {text: 'Reply'}}],
        ['put', `/api/audits/${FAKE_ID}/comments/${FAKE_ID}`, 'audits:read', 404, {body: {resolved: true}}],
        ['delete', `/api/audits/${FAKE_ID}/comments/${FAKE_ID}`, 'audits:read', 404],

        // Backups (src/routes/backup.js)
        ['get', '/api/backups', 'backups:read', 200],
        ['post', '/api/backups', 'backups:create', 422, {body: {name: 1}}],
        ['post', '/api/backups/upload', 'backups:create', 422, {type: 'application/octet-stream'}],
        ['get', `/api/backups/${FAKE_BACKUP}/download`, 'backups:read', 404],
        ['delete', `/api/backups/${FAKE_BACKUP}`, 'backups:delete', 404],
        ['post', `/api/backups/${FAKE_BACKUP}/restore`, 'backups:restore', 404, {body: {}}],

        // Unknown route (src/app.js)
        ['get', '/api/perm-unknown-route', null, 404]
      ]

      var ROLES = [
        ['anonymous', null],
        ['user', 'perm-user'],
        ['report', 'perm-report'],
        ['admin', 'admin'],
        ['perm-viewer', 'perm-viewer'],
        ['perm-undefined-role', 'perm-norole']
      ]

      // Answer class: rejected by the authentication, by the permission check, or answer of the route
      var answerOf = (response) => {
        var datas = response.body && response.body.datas
        if (datas === 'No token provided') return `${response.status} unauthenticated`
        if (datas === 'Insufficient privileges') return `${response.status} denied`
        return `${response.status} handled`
      }
      var expectedAnswer = (role, permission, allowed) => {
        if (permission === null) return `${allowed} handled`
        if (role === 'anonymous') return '401 unauthenticated'
        if (permission === 'validtoken' || hasPermission(role, permission)) return `${allowed} handled`
        return '403 denied'
      }

      var CASES = []
      ROUTES.forEach(([method, path, permission, allowed, options = {}]) => {
        ROLES.forEach(([role, username]) => {
          var expected = expectedAnswer(role, permission, allowed)
          CASES.push([`${method.toUpperCase()} ${path}`, role, expected, {method, path, username, options}])
        })
      })

      it.each(CASES)('%s as %s: %s', async (name, role, expected, {method, path, username, options}) => {
        var cookie = username ? cookies[username] : null
        var send = () => call(method, path, cookie, options.body, options.type)
        var response = options.keep ? await keepCollection(options.keep, send) : await send()
        if (options.after)
          await options.after()
        expect(answerOf(response)).toBe(expected)
      })

      it('Collections deleted by the matrix were put back, settings kept', async () => {
        expect(await counts()).toEqual(countsBefore)
        expect((await admin('get', '/api/settings')).body.datas.reviews.enabled).toBe(true)
      })
    })

    describe('Audits of other users', () => {
      var RELATIONS = [
        ['creator', 'perm-user'],
        ['collaborator', 'perm-collab'],
        ['reviewer', 'perm-reviewer'],
        ['other', 'perm-other'],
        ['report', 'perm-report'],
        ['auditor', 'perm-auditor'],
        ['admin', 'admin']
      ]
      var codes = (creator, collaborator, reviewer, other, report, auditor, admin) => ({creator, collaborator, reviewer, other, report, auditor, admin})
      // Read access: creator, collaborators, reviewers, audits:read-all
      var READ = codes(200, 200, 200, 404, 200, 200, 200)
      // Write access: creator, collaborators, audits:update-all (the reviewers and audits:read-all can read the audit)
      var WRITE = codes(200, 200, 404, 404, 404, 200, 200)

      var auditId, findingId, sectionId, commentId
      var getAudit = async (id = auditId) => (await admin('get', `/api/audits/${id}`)).body.datas

      // Audit of perm-user with perm-collab as collaborator and perm-reviewer as reviewer
      var createAudit = async (name) => {
        var response = await call('post', '/api/audits', cookies['perm-user'], {name: name, language: 'en', auditType: 'perm-type'})
        expect(response.status).toBe(201)
        var id = response.body.datas.audit._id
        response = await call('put', `/api/audits/${id}/general`, cookies['perm-user'], {collaborators: [{_id: ids['perm-collab']}], reviewers: [{_id: ids['perm-reviewer']}]})
        expect(response.status).toBe(200)
        return id
      }
      var deleteAudit = (id) => admin('delete', `/api/audits/${id}`)
      var addComment = async (cookie, text) => {
        var response = await call('post', `/api/audits/${auditId}/comments`, cookie, {target: {kind: 'general', field: 'name'}, text: text})
        expect(response.status).toBe(200)
        return response.body.datas.find(c => c.text === text)._id
      }

      beforeAll(async () => {
        expect((await admin('post', '/api/data/sections', {field: 'perm_section', name: 'Perm section'})).status).toBe(201)
        expect((await admin('post', '/api/data/audit-types', {name: 'perm-type', templates: [], sections: ['perm_section']})).status).toBe(201)
        auditId = await createAudit('perm-shared')
        expect((await call('post', `/api/audits/${auditId}/findings`, cookies['perm-user'], {title: 'perm-finding'})).status).toBe(200)
        var audit = await getAudit()
        findingId = audit.findings.find(f => f.title === 'perm-finding')._id
        sectionId = audit.sections.find(s => s.field === 'perm_section')._id
        commentId = await addComment(cookies['perm-reviewer'], 'perm-comment')
      })

      afterAll(async () => {
        await deleteAudit(auditId)
        await admin('delete', '/api/data/audit-types/perm-type')
        await admin('delete', '/api/data/sections/perm_section/en')
      })

      /*
        [name, expected codes by relation, function(relation, cookie) returning the response, check(relation, allowed)]
      */
      var ROUTES = [
        ['GET audit', READ, (r, cookie) => call('get', `/api/audits/${auditId}`, cookie)],
        ['GET general', READ, (r, cookie) => call('get', `/api/audits/${auditId}/general`, cookie)],
        ['GET network', READ, (r, cookie) => call('get', `/api/audits/${auditId}/network`, cookie)],
        ['GET finding', READ, (r, cookie) => call('get', `/api/audits/${auditId}/findings/${findingId}`, cookie)],
        ['GET section', READ, (r, cookie) => call('get', `/api/audits/${auditId}/sections/${sectionId}`, cookie)],
        ['GET comments', READ, (r, cookie) => call('get', `/api/audits/${auditId}/comments`, cookie)],
        // Access granted: the generation fails on the missing template only
        ['Generate the report', codes(422, 422, 422, 404, 422, 422, 422), (r, cookie) => call('get', `/api/audits/${auditId}/generate`, cookie)],

        ['PUT general', WRITE, (r, cookie) => call('put', `/api/audits/${auditId}/general`, cookie, {date: `perm-${r}`}),
          async (r, allowed) => expect((await getAudit()).date === `perm-${r}`).toBe(allowed)],
        ['PUT network', WRITE, (r, cookie) => call('put', `/api/audits/${auditId}/network`, cookie, {scope: [{name: 'perm-scope', hosts: [{ip: '10.0.0.1', hostname: `perm-${r}`}]}]}),
          async (r, allowed) => expect((await getAudit()).scope[0]?.hosts[0]?.hostname === `perm-${r}`).toBe(allowed)],
        ['POST finding', WRITE, (r, cookie) => call('post', `/api/audits/${auditId}/findings`, cookie, {title: `perm-finding-${r}`}),
          async (r, allowed) => expect((await getAudit()).findings.some(f => f.title === `perm-finding-${r}`)).toBe(allowed)],
        ['PUT finding', WRITE, (r, cookie) => call('put', `/api/audits/${auditId}/findings/${findingId}`, cookie, {description: `perm-${r}`}),
          async (r, allowed) => expect((await getAudit()).findings.find(f => f._id === findingId).description === `perm-${r}`).toBe(allowed)],
        ['DELETE finding', WRITE, async (r, cookie) => {
          expect((await call('post', `/api/audits/${auditId}/findings`, cookies['perm-user'], {title: `perm-delete-${r}`})).status).toBe(200)
          var id = (await getAudit()).findings.find(f => f.title === `perm-delete-${r}`)._id
          return call('delete', `/api/audits/${auditId}/findings/${id}`, cookie)
        }, async (r, allowed) => expect((await getAudit()).findings.some(f => f.title === `perm-delete-${r}`)).toBe(!allowed)],
        ['PUT section', WRITE, (r, cookie) => call('put', `/api/audits/${auditId}/sections/${sectionId}`, cookie, {customFields: [], text: `perm-${r}`}),
          async (r, allowed) => expect((await getAudit()).sections.find(s => s._id === sectionId).text === `perm-${r}`).toBe(allowed)],
        ['PUT sort options', WRITE, (r, cookie) => call('put', `/api/audits/${auditId}/sortfindings`, cookie, {sortFindings: [{category: 'No Category', sortValue: 'cvssScore', sortOrder: 'desc', sortAuto: true}]})],
        ['PUT finding position', WRITE, (r, cookie) => call('put', `/api/audits/${auditId}/movefinding`, cookie, {oldIndex: 0, newIndex: 0})],
        ['PUT state EDIT', WRITE, (r, cookie) => call('put', `/api/audits/${auditId}/updateReadyForReview`, cookie, {state: 'EDIT'})],

        ['Clone', codes(201, 201, 201, 404, 201, 201, 201), async (r, cookie) => {
          var response = await call('post', `/api/audits/${auditId}/clone`, cookie, {name: `perm-clone-${r}`})
          if (response.status === 201) {
            expect(response.body.datas.audit.creator).toBe(r === 'admin' ? await helpers.userId(cookies.admin, 'admin') : ids[RELATIONS.find(e => e[0] === r)[1]])
            expect((await call('delete', `/api/audits/${response.body.datas.audit._id}`, cookie)).status).toBe(200)
          }
          return response
        }],
        ['DELETE audit', codes(200, 404, 404, 404, 404, 200, 200), async (r, cookie) => {
          var id = await createAudit(`perm-delete-${r}`)
          var response = await call('delete', `/api/audits/${id}`, cookie)
          var exists = (await admin('get', `/api/audits/${id}`)).status === 200
          expect(exists).toBe(response.status !== 200)
          if (exists)
            expect((await deleteAudit(id)).status).toBe(200)
          return response
        }],
        // Permission audits:review (perm-reviewer role) or audits:review-all (admin), creator and collaborators excluded
        ['Approve', codes(403, 403, 200, 403, 403, 403, 200), async (r, cookie) => {
          var id = await createAudit(`perm-approve-${r}`)
          expect((await call('put', `/api/audits/${id}/updateReadyForReview`, cookies['perm-user'], {state: 'REVIEW'})).status).toBe(200)
          var response = await call('put', `/api/audits/${id}/toggleApproval`, cookie)
          var audit = await getAudit(id)
          expect(audit.state).toBe(response.status === 200 ? 'APPROVED' : 'REVIEW')
          expect(audit.approvals.length).toBe(response.status === 200 ? 1 : 0)
          expect((await deleteAudit(id)).status).toBe(200)
          return response
        }],

        ['POST comment', READ, (r, cookie) => call('post', `/api/audits/${auditId}/comments`, cookie, {target: {kind: 'finding', findingId: findingId, field: 'title'}, text: `perm-comment-${r}`})],
        ['POST reply', READ, (r, cookie) => call('post', `/api/audits/${auditId}/comments/${commentId}/replies`, cookie, {text: `perm-reply-${r}`})],
        // Resolve: author of the comment (perm-reviewer) or users allowed to edit the audit
        ['Resolve comment of the reviewer', codes(200, 200, 200, 404, 403, 200, 200), (r, cookie) => call('put', `/api/audits/${auditId}/comments/${commentId}`, cookie, {resolved: true})],
        // Edit text: author only
        ['Edit comment of the reviewer', codes(403, 403, 200, 404, 403, 403, 403), (r, cookie) => call('put', `/api/audits/${auditId}/comments/${commentId}`, cookie, {text: `perm-edited-${r}`}),
          async (r, allowed) => expect((await call('get', `/api/audits/${auditId}/comments`, cookies.admin)).body.datas.find(c => c._id === commentId).text === `perm-edited-${r}`).toBe(allowed)],
        // Delete: author or audits:update-all
        ['Delete comment of the reviewer', codes(403, 403, 200, 404, 403, 200, 200), async (r, cookie) => {
          var id = await addComment(cookies['perm-reviewer'], `perm-to-delete-${r}`)
          return call('delete', `/api/audits/${auditId}/comments/${id}`, cookie)
        }, async (r, allowed) => expect((await call('get', `/api/audits/${auditId}/comments`, cookies.admin)).body.datas.some(c => c.text === `perm-to-delete-${r}`)).toBe(!allowed)]
      ]

      var CASES = []
      ROUTES.forEach(([name, expected, run, check]) => {
        RELATIONS.forEach(([relation, username]) => CASES.push([name, relation, expected[relation], {username, run, check}]))
      })

      it.each(CASES)('%s as %s: %s', async (name, relation, expected, {username, run, check}) => {
        var response = await run(relation, cookies[username])
        expect(response.status).toBe(expected)
        if (expected === 403 && ['perm-user', 'perm-collab', 'perm-other', 'perm-report', 'perm-auditor'].includes(username) && name === 'Approve')
          expect(response.body.datas).toBe('Insufficient privileges')
        if (check)
          await check(relation, response.status < 300)
      })

      it.each(RELATIONS.map(([relation, username]) => [relation, READ[relation] === 200, username]))('Audit listed for %s: %s', async (relation, listed, username) => {
        var response = await call('get', '/api/audits', cookies[username])
        expect(response.status).toBe(200)
        expect(response.body.datas.some(a => a._id === auditId)).toBe(listed)
      })
    })

    describe('Vulnerability proposals of other users', () => {
      var proposalId
      var proposals = async (cookie) => (await call('get', '/api/vulnerability-proposals?status=all', cookie)).body.datas

      beforeAll(async () => {
        var response = await call('post', '/api/vulnerabilities/finding/en', cookies['perm-user'], {title: 'perm-proposal', description: 'Proposed by perm-user'})
        expect(response.status).toBe(201)
        proposalId = (await proposals(cookies['perm-user'])).find(p => p.title === 'perm-proposal')._id
      })

      afterAll(async () => {
        // Withdrawn by its author: the vulnerability not validated yet is deleted
        expect((await call('delete', `/api/vulnerability-proposals/${proposalId}`, cookies['perm-user'])).status).toBe(200)
        expect((await call('get', '/api/vulnerabilities', cookies.admin)).body.datas.some(v => v.details.some(d => d.title === 'perm-proposal'))).toBe(false)
      })

      it.each([
        ['author', 'perm-user', 200], ['other user', 'perm-other', 404], ['report role', 'perm-report', 404], ['admin', 'admin', 200]
      ])('Proposal detail read by %s: %s', async (name, username, expected) => {
        expect((await call('get', `/api/vulnerability-proposals/${proposalId}`, cookies[username])).status).toBe(expected)
      })

      it.each([
        ['author', 'perm-user', true], ['other user', 'perm-other', false], ['admin', 'admin', true]
      ])('Proposal listed for %s: %s', async (name, username, listed) => {
        expect((await proposals(cookies[username])).some(p => p._id === proposalId)).toBe(listed)
      })

      it('Proposal count of a user without review permission: own proposals only', async () => {
        expect((await call('get', '/api/vulnerability-proposals/count', cookies['perm-user'])).body.datas.pending).toBe(1)
        expect((await call('get', '/api/vulnerability-proposals/count', cookies['perm-other'])).body.datas.pending).toBe(0)
      })

      it.each([
        ['other user', 'perm-other', 403], ['admin', 'admin', 403]
      ])('Proposal withdrawn by %s: %s', async (name, username, expected) => {
        var response = await call('delete', `/api/vulnerability-proposals/${proposalId}`, cookies[username])
        expect(response.status).toBe(expected)
        expect(response.body.datas).toBe('Only the author can withdraw a proposal')
      })

      it.each([
        ['author', 'perm-user', 403], ['report role', 'perm-report', 403], ['custom role without review permission', 'perm-auditor', 403]
      ])('Proposal accepted or refused by %s: %s', async (name, username, expected) => {
        expect((await call('put', `/api/vulnerability-proposals/${proposalId}/accept`, cookies[username], {})).status).toBe(expected)
        expect((await call('put', `/api/vulnerability-proposals/${proposalId}/reject`, cookies[username], {comment: 'No'})).status).toBe(expected)
        expect((await proposals(cookies.admin)).find(p => p._id === proposalId).status).toBe('pending')
      })
    })
  })
}
