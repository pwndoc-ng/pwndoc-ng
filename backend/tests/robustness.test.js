/*
  Robustness of the API against malformed requests: bodies refused by the JSON parser, unexpected Content-Type,
  wrong types, NoSQL operators ({"$gt": ""}, {"$where": ...}) in the bodies and query strings, keys __proto__ /
  constructor / prototype, invalid or unknown identifiers in the URL, unicode and huge values.
  Expected: never a 500 nor a crash, a 4xx answer, no data modified or disclosed, the server still answers,
  no prototype pollution.
  Hurried user: creations sent several times, concurrent updates, deletion during an update, review actions repeated
  or out of order, reports generated in parallel (requests sent with Promise.all).
  Users created: rob-user, rob-other, rob-reviewer, rob-double-user (disabled at the end). At the end: no more data
  created here, settings reverted.
*/

module.exports = function(request, app) {
  var helpers = require('./helpers')(request, app)
  var mongoose = require('mongoose')
  var fs = require('fs')
  var path = require('path')

  var acl = require('../src/lib/auth').acl
  var PizZip = require('pizzip')
  var util = require('util')

  var FAKE_ID = 'deadbeefdeadbeefdeadbeef'
  var PASSWORD = 'Rob12345'
  var TEMPLATES_DIR = path.join(__dirname, '..', 'report-templates')
  var DEFAULT_TEMPLATE = fs.readFileSync(path.join(TEMPLATES_DIR, 'Default Template.docx'))
  var PROTO_KEYS = Object.getOwnPropertyNames(Object.prototype).sort()
  var ARRAY_PROTO_KEYS = Object.getOwnPropertyNames(Array.prototype).sort()

  describe('Robustness Suite Tests', () => {
    var cookies = {}
    var ids = {}

    var send = (c) => {
      var cookie = c.cookie === null ? null : cookies[c.cookie || 'admin']
      var url = typeof c.path === 'function' ? c.path() : c.path
      var req = request(app)[c.method](url)
      if (cookie) req = req.set('Cookie', cookie)
      Object.entries(c.headers || {}).forEach(([name, value]) => req = req.set(name, value))
      if (c.raw !== undefined)
        return req.set('Content-Type', c.type || 'application/json').send(c.raw)
      if (c.type) req = req.set('Content-Type', c.type)
      var body = typeof c.body === 'function' ? c.body() : c.body
      if (body !== undefined) req = req.send(body)
      return req
    }
    var get = async (url, cookie = cookies.admin) => (await request(app).get(url).set('Cookie', cookie)).body.datas
    var admin = (method, url, body) => send({method, path: url, body})

    // Status and message of an answer (shown when an expectation fails)
    var answer = (response) => `${response.status} ${JSON.stringify(response.body && response.body.datas)}`.slice(0, 300)
    var expectRefused = (response) => expect(answer(response)).toMatch(/^4\d\d /)
    var expectNoServerError = (response) => expect(answer(response)).toMatch(/^[1-4]\d\d /)

    // State of the data readable through the API (dates excluded) and of the report templates directory
    var strip = (value) => JSON.parse(JSON.stringify(value), (key, v) => ['createdAt', 'updatedAt', '__v'].includes(key) ? undefined : v)
    var world = async () => strip({
      audit: await get(`/api/audits/${ids.audit}`),
      network: await get(`/api/audits/${ids.audit}/network`),
      comments: await get(`/api/audits/${ids.audit}/comments`),
      audits: (await get('/api/audits')).map(a => a._id).sort(),
      users: await get('/api/users'),
      settings: await get('/api/settings'),
      languages: await get('/api/data/languages'),
      auditTypes: await get('/api/data/audit-types'),
      vulnerabilityTypes: await get('/api/data/vulnerability-types'),
      categories: await get('/api/data/vulnerability-categories'),
      sections: await get('/api/data/sections'),
      customFields: await get('/api/data/custom-fields'),
      companies: await get('/api/companies'),
      clients: await get('/api/clients'),
      templates: await get('/api/templates'),
      templateFiles: fs.readdirSync(TEMPLATES_DIR).sort(),
      vulnerabilities: await get('/api/vulnerabilities'),
      proposals: await get('/api/vulnerability-proposals?status=all'),
      images: await mongoose.model('Image').countDocuments(),
      backups: (await get('/api/backups')).length
    })

    beforeAll(async () => {
      cookies.admin = await helpers.login('admin', 'Admin123')
      var response = await admin('post', '/api/users', ['rob-user', 'rob-other'].map(username => ({username, password: PASSWORD, firstname: 'Rob', lastname: username})))
      expect(response.status).toBe(201)
      for (var username of ['rob-user', 'rob-other']) {
        cookies[username] = await helpers.login(username, PASSWORD)
        ids[username] = await helpers.userId(cookies.admin, username)
      }

      expect((await admin('post', '/api/data/languages', {locale: 'rob-lang', language: 'Rob language'})).status).toBe(201)
      expect((await admin('post', '/api/data/sections', {field: 'rob_section', name: 'Rob section'})).status).toBe(201)
      expect((await admin('post', '/api/data/audit-types', {name: 'rob-type', templates: [], sections: ['rob_section']})).status).toBe(201)
      expect((await admin('post', '/api/data/vulnerability-categories', {name: 'rob-category'})).status).toBe(201)
      response = await admin('post', '/api/data/custom-fields', {fieldType: 'text', label: 'rob-field', display: 'finding'})
      expect(response.status).toBe(201)
      ids.customField = response.body.datas._id
      expect((await admin('post', '/api/companies', [{name: 'rob-Company'}])).status).toBe(201)
      ids.company = (await get('/api/companies')).find(c => c.name === 'rob-Company')._id
      expect((await admin('post', '/api/clients', [{email: 'rob-client@example.com', firstname: 'Rob', company: {name: 'rob-Company'}}])).status).toBe(201)
      ids.client = (await get('/api/clients')).find(c => c.email === 'rob-client@example.com')._id
      response = await admin('post', '/api/templates', {name: 'rob-template', ext: 'docx', file: Buffer.from('rob template').toString('base64')})
      expect(response.status).toBe(201)
      ids.template = response.body.datas._id
      response = await admin('post', '/api/vulnerabilities', [
        {cvssv3: helpers.CVSS.high, details: [{locale: 'rob-lang', title: 'rob-vuln', description: 'Rob vulnerability'}]},
        {details: [{locale: 'rob-other-lang', title: 'rob-vuln-2'}]}
      ])
      expect(response.status).toBe(201)
      var vulnerabilities = await get('/api/vulnerabilities')
      ids.vuln = vulnerabilities.find(v => v.details.some(d => d.title === 'rob-vuln'))._id
      ids.vuln2 = vulnerabilities.find(v => v.details.some(d => d.title === 'rob-vuln-2'))._id

      response = await send({cookie: 'rob-user', method: 'post', path: '/api/audits', body: {name: 'rob-audit', language: 'rob-lang', auditType: 'rob-type'}})
      expect(response.status).toBe(201)
      ids.audit = response.body.datas.audit._id
      for (var finding of [{title: 'rob-finding-1', cvssv3: helpers.CVSS.high}, {title: 'rob-finding-2', cvssv3: helpers.CVSS.low}, {title: 'rob-finding-3'}])
        expect((await send({cookie: 'rob-user', method: 'post', path: `/api/audits/${ids.audit}/findings`, body: finding})).status).toBe(200)
      var audit = await get(`/api/audits/${ids.audit}`)
      ids.finding = audit.findings.find(f => f.title === 'rob-finding-1')._id
      ids.section = audit.sections.find(s => s.field === 'rob_section')._id
      response = await admin('post', `/api/audits/${ids.audit}/comments`, {target: {kind: 'general', field: 'name'}, text: 'rob-comment'})
      expect(response.status).toBe(200)
      ids.comment = response.body.datas.find(c => c.text === 'rob-comment')._id
    })

    afterAll(async () => {
      await admin('put', '/api/settings/revert')
      await admin('delete', `/api/audits/${ids.audit}`)
      for (var id of [ids.vuln, ids.vuln2])
        await admin('delete', `/api/vulnerabilities/${id}`)
      await admin('delete', `/api/templates/${ids.template}`)
      await admin('delete', `/api/clients/${ids.client}`)
      await admin('delete', `/api/companies/${ids.company}`)
      await admin('delete', `/api/data/custom-fields/${ids.customField}`)
      await admin('delete', '/api/data/vulnerability-categories/rob-category')
      await admin('delete', '/api/data/audit-types/rob-type')
      await admin('delete', '/api/data/languages/rob-lang')
      await admin('delete', '/api/data/sections/rob_section/rob-lang')
      for (var username of ['rob-user', 'rob-other'])
        await admin('put', `/api/users/${ids[username]}`, {enabled: false})
    })

    // After each request: the server answers and no prototype was polluted
    afterEach(async () => {
      expect(({}).robPolluted).toBeUndefined()
      expect([].robPolluted).toBeUndefined()
      expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(PROTO_KEYS)
      expect(Object.getOwnPropertyNames(Array.prototype).sort()).toEqual(ARRAY_PROTO_KEYS)
      expect((await request(app).get('/api/users/checktoken').set('Cookie', cookies.admin)).status).toBe(200)
    })

    var auditPath = (suffix = '') => () => `/api/audits/${ids.audit}${suffix}`

    var GT = {$gt: ''}
    var NE = {$ne: null}
    var WHERE = {$where: 'sleep(100) || true'}

    // Expected behavior: refused with a 4xx
    var refused = async (name, c) => expectRefused(await send(c))

    describe('Bodies refused by the JSON parser', () => {
      var before
      beforeAll(async () => { before = await world() })

      var CASES = [
        ['Invalid JSON', {method: 'post', path: '/api/audits', raw: '{"name": "rob-invalid",'}],
        ['Invalid JSON without authentication', {method: 'post', path: '/api/users/token', cookie: null, raw: '{"username": '}],
        ['JSON null', {method: 'post', path: '/api/audits', raw: 'null'}],
        ['JSON string', {method: 'put', path: '/api/settings', raw: '"reviews"'}],
        ['JSON number', {method: 'post', path: '/api/users/token', cookie: null, raw: '42'}],
        ['Unsupported charset', {method: 'post', path: '/api/audits', raw: '{}', type: 'application/json; charset=latin1'}],
        ['Invalid gzip content', {method: 'post', path: '/api/audits', raw: '{}', headers: {'Content-Encoding': 'gzip'}}],
        ['Unsupported content encoding', {method: 'post', path: '/api/audits', raw: '{}', headers: {'Content-Encoding': 'rob'}}],
        ['URL encoded body over the limit', {method: 'post', path: '/api/audits', type: 'application/x-www-form-urlencoded', raw: `name=${'a'.repeat(11 * 1024 * 1024)}`}]
      ]

      it.each(CASES)('%s: refused with a 4xx', refused)

      it('Data unchanged', async () => {
        expect(await world()).toEqual(before)
      })
    })

    describe('Bodies ignored by the JSON parser (unexpected Content-Type)', () => {
      var before
      beforeAll(async () => { before = await world() })

      var CASES = [
        ['JSON sent as text/plain', {method: 'post', path: '/api/audits', type: 'text/plain', raw: JSON.stringify({name: 'rob-text', language: 'rob-lang', auditType: 'rob-type'})}],
        ['XML', {method: 'post', path: '/api/audits', type: 'application/xml', raw: '<audit><name>rob-xml</name></audit>'}],
        ['Multipart form', {method: 'post', path: '/api/audits', type: 'multipart/form-data; boundary=rob', raw: '--rob\r\nContent-Disposition: form-data; name="name"\r\n\r\nrob-multipart\r\n--rob--'}],
        ['URL encoded operators on login', {method: 'post', path: '/api/users/token', cookie: null, type: 'application/x-www-form-urlencoded', raw: 'username[$ne]=x&password[$ne]=x'}],
        ['JSON sent as binary data', {method: 'put', path: '/api/settings', type: 'application/octet-stream', raw: '{"reviews": {"enabled": true}}'}]
      ]

      it.each(CASES)('%s: refused with a 4xx or ignored', async (name, c) => {
        expectNoServerError(await send(c))
      })

      it('Login with operators in a URL encoded body is refused', async () => {
        var response = await send(CASES[3][1])
        expect(response.status).toBe(422)
        expect(response.headers['set-cookie']).toBeUndefined()
      })

      it('Data unchanged', async () => {
        expect(await world()).toEqual(before)
      })
    })

    describe('Wrong types and NoSQL operators in the bodies', () => {
      var before
      beforeAll(async () => { before = await world() })

      var CASES = [
        // Audits
        ['POST audit: array body', {method: 'post', path: '/api/audits', body: []}],
        ['POST audit: name operator', {method: 'post', path: '/api/audits', body: {name: GT, language: 'rob-lang', auditType: 'rob-type'}}],
        ['POST audit: name array', {method: 'post', path: '/api/audits', body: {name: ['rob-a', 'rob-b'], language: 'rob-lang', auditType: 'rob-type'}}],
        ['POST audit: language operator', {method: 'post', path: '/api/audits', body: {name: 'rob-x', language: GT, auditType: 'rob-type'}}],
        ['POST audit: audit type operator', {method: 'post', path: '/api/audits', body: {name: 'rob-x', language: 'rob-lang', auditType: NE}}],
        ['POST comment: text operator', {method: 'post', path: auditPath('/comments'), body: {target: {kind: 'general', field: 'name'}, text: GT}}],
        ['POST comment: kind operator', {method: 'post', path: auditPath('/comments'), body: {target: {kind: NE, field: 'name'}, text: 'rob'}}],
        ['POST comment: finding id operator', {method: 'post', path: auditPath('/comments'), body: {target: {kind: 'finding', findingId: NE, field: 'title'}, text: 'rob'}}],
        ['POST comment: target array', {method: 'post', path: auditPath('/comments'), body: {target: ['general', 'name'], text: 'rob'}}],
        ['POST comment: quote string', {method: 'post', path: auditPath('/comments'), body: {target: {kind: 'general', field: 'name'}, quote: 'rob', text: 'rob'}}],
        ['POST comment: image source operator', {method: 'post', path: auditPath('/comments'), body: {target: {kind: 'general', field: 'name'}, image: {src: GT}, text: 'rob'}}],
        ['POST reply: text array', {method: 'post', path: () => `/api/audits/${ids.audit}/comments/${ids.comment}/replies`, body: {text: ['rob']}}],
        ['PUT comment: resolved string', {method: 'put', path: () => `/api/audits/${ids.audit}/comments/${ids.comment}`, body: {resolved: 'true'}}],
        ['PUT comment: text operator', {method: 'put', path: () => `/api/audits/${ids.audit}/comments/${ids.comment}`, body: {text: {$set: 'rob'}}}],
        // Users
        ['PUT profile: new password operator', {cookie: 'rob-user', method: 'put', path: '/api/users/me', body: {currentPassword: PASSWORD, newPassword: GT, confirmPassword: GT}}],
        ['POST TOTP: operators', {cookie: 'rob-user', method: 'post', path: '/api/users/totp', body: {totpToken: GT, totpSecret: GT}}],
        ['POST token: TOTP operator', {cookie: null, method: 'post', path: '/api/users/token', body: {username: 'rob-user', password: PASSWORD, totpToken: GT}}],
        ['POST token: password operator', {cookie: null, method: 'post', path: '/api/users/token', body: {username: 'rob-user', password: NE}}],
        ['POST init: operators', {cookie: null, method: 'post', path: '/api/users/init', body: {username: GT, password: [PASSWORD], firstname: 'Rob', lastname: 'Init'}}],
        // Vulnerabilities, proposals, backups
        ['PUT archive: string flag', {method: 'put', path: () => `/api/vulnerabilities/${ids.vuln}/archive`, body: {archived: 'true'}}],
        ['PUT accept: fields operators', {method: 'put', path: `/api/vulnerability-proposals/${FAKE_ID}/accept`, body: {fields: [GT]}}],
        ['PUT reject: comment operator', {method: 'put', path: `/api/vulnerability-proposals/${FAKE_ID}/reject`, body: {comment: GT}}],
        ['POST backup: name operator', {method: 'post', path: '/api/backups', body: {name: GT}}],
        ['POST backup: password operator', {method: 'post', path: '/api/backups', body: {password: GT}}],
        ['POST restore: password array', {method: 'post', path: '/api/backups/20000101-000000-deadbeef/restore', body: {password: ['rob']}}],
        ['POST backup upload: not a backup file', {method: 'post', path: '/api/backups/upload', type: 'application/octet-stream', raw: 'not a backup'}],
        ['POST backup upload: truncated zip, path in the file name', {method: 'post', path: '/api/backups/upload', type: 'application/octet-stream', raw: 'PK\u0003\u0004rob', headers: {'X-Backup-Filename': '..%2F..%2Fpasswd'}}],
        // Lists mixing valid and invalid entries: nothing created (Data unchanged below)
        ['POST users: valid and invalid users', {method: 'post', path: '/api/users', body: [{username: 'rob-valid', password: PASSWORD, firstname: 'Rob', lastname: 'Valid'}, {username: 'rob-invalid', password: PASSWORD, firstname: 'Rob', lastname: 'Invalid', role: ['admin']}]}],
        ['POST companies: valid and invalid companies', {method: 'post', path: '/api/companies', body: [{name: 'rob-valid-company'}, {name: GT}]}],
        ['POST clients: valid and invalid clients', {method: 'post', path: '/api/clients', body: [{email: 'rob-valid@example.com', company: {name: 'rob-valid-client-company'}}, {email: GT}]}],
        ['POST vulnerabilities: valid and invalid vulnerabilities', {method: 'post', path: '/api/vulnerabilities', body: [{category: 'rob-valid-category', details: [{locale: 'rob-lang', title: 'rob-valid-vuln', vulnType: 'rob-valid-type'}]}, {priority: 9, details: [{locale: 'rob-lang', title: 'rob-invalid-vuln'}]}]}]
      ]
      it.each(CASES)('%s: refused with a 4xx', refused)

      var GENERAL_NOT_ARRAYS = [
        ['PUT general: reviewers string', {method: 'put', path: auditPath('/general'), body: {reviewers: 'rob'}}],
        ['PUT general: collaborators object', {method: 'put', path: auditPath('/general'), body: {collaborators: {_id: FAKE_ID}}}]
      ]
      it.each(GENERAL_NOT_ARRAYS)('%s: refused with a 4xx', refused)

      var GENERAL_CAST = [
        ['PUT general: reviewer id operator', {method: 'put', path: auditPath('/general'), body: {reviewers: [{_id: GT}]}}],
        ['PUT general: collaborator invalid id', {method: 'put', path: auditPath('/general'), body: {collaborators: [{_id: 'not-an-id'}]}}],
        ['PUT general: client operator', {method: 'put', path: auditPath('/general'), body: {client: GT}}],
        ['PUT general: client invalid id', {method: 'put', path: auditPath('/general'), body: {client: 'not-an-id'}}],
        ['PUT general: company id operator', {method: 'put', path: auditPath('/general'), body: {company: {_id: NE}}}],
        ['PUT general: template invalid id', {method: 'put', path: auditPath('/general'), body: {template: 'not-an-id'}}],
        ['PUT general: name operator', {method: 'put', path: auditPath('/general'), body: {name: GT}}],
        ['PUT general: date operator', {method: 'put', path: auditPath('/general'), body: {date: GT}}],
        ['PUT general: language operator', {method: 'put', path: auditPath('/general'), body: {language: GT}}],
        ['PUT general: scope name operator', {method: 'put', path: auditPath('/general'), body: {scope: [{name: GT}]}}],
        ['PUT general: custom fields string', {method: 'put', path: auditPath('/general'), body: {customFields: 'rob'}}]
      ]
      it.each(GENERAL_CAST)('%s: refused with a 4xx', refused)

      it('POST clone: name operator: refused with a 4xx', async () => {
        expectRefused(await admin('post', `/api/audits/${ids.audit}/clone`, {name: GT}))
      })

      var CREATED_NOTHING = [
        ['POST users: object instead of array', {method: 'post', path: '/api/users', body: {username: 'rob-new', password: PASSWORD, firstname: 'Rob', lastname: 'New'}}],
        ['POST users: username operator', {method: 'post', path: '/api/users', body: [{username: GT, password: PASSWORD, firstname: 'Rob', lastname: 'New'}]}],
        ['POST users: role operator', {method: 'post', path: '/api/users', body: [{username: 'rob-new', password: PASSWORD, firstname: 'Rob', lastname: 'New', role: GT}]}],
        ['POST companies: object instead of array', {method: 'post', path: '/api/companies', body: {name: 'rob-Company-x'}}],
        ['POST companies: name operator', {method: 'post', path: '/api/companies', body: [{name: GT}]}],
        ['POST clients: email operator', {method: 'post', path: '/api/clients', body: [{email: GT}]}],
        ['POST vulnerabilities: object instead of array', {method: 'post', path: '/api/vulnerabilities', body: {details: [{locale: 'rob-lang', title: 'rob-vuln-x'}]}}],
        ['POST vulnerabilities: CVSS operator', {method: 'post', path: '/api/vulnerabilities', body: [{cvssv3: GT, details: [{locale: 'rob-lang', title: 'rob-vuln-x'}]}]}]
      ]
      it.each(CREATED_NOTHING)('%s: refused with a 4xx', refused)

      var LIST_TYPES = [
        ['POST users: null user', {method: 'post', path: '/api/users', body: [null]}],
        ['POST companies: null company', {method: 'post', path: '/api/companies', body: [null]}],
        ['POST clients: null client', {method: 'post', path: '/api/clients', body: [null]}],
        ['POST vulnerabilities: null vulnerability', {method: 'post', path: '/api/vulnerabilities', body: [null]}],
        ['POST vulnerabilities: details string', {method: 'post', path: '/api/vulnerabilities', body: [{details: 'rob'}]}],
        ['POST vulnerabilities: null detail', {method: 'post', path: '/api/vulnerabilities', body: [{details: [null]}]}],
        ['PUT vulnerability: details string', {method: 'put', path: () => `/api/vulnerabilities/${ids.vuln}`, body: {details: 'rob'}}],
        ['PUT languages: null entry', {method: 'put', path: '/api/data/languages', body: [null]}],
        ['PUT languages: object instead of array', {method: 'put', path: '/api/data/languages', body: {locale: 'rob-x', language: 'Rob x'}}],
        ['PUT audit types: object instead of array', {method: 'put', path: '/api/data/audit-types', body: {name: 'rob-type-x', templates: []}}],
        ['PUT vulnerability types: object instead of array', {method: 'put', path: '/api/data/vulnerability-types', body: {name: 'rob-x', locale: 'rob-lang'}}],
        ['PUT categories: object instead of array', {method: 'put', path: '/api/data/vulnerability-categories', body: {name: 'rob-category-x'}}],
        ['PUT sections: object instead of array', {method: 'put', path: '/api/data/sections', body: {field: 'rob_x', name: 'Rob x'}}],
        ['PUT custom fields: object instead of array', {method: 'put', path: '/api/data/custom-fields', body: {_id: FAKE_ID, label: 'rob-x', display: 'general'}}]
      ]
      it.each(LIST_TYPES)('%s: refused with a 4xx', refused)

      it('POST users: password array: refused with a 4xx', async () => {
        expectRefused(await admin('post', '/api/users', [{username: 'rob-new', password: [PASSWORD], firstname: 'Rob', lastname: 'New'}]).timeout(5000))
      })

      var USER_CAST = [
        ['PUT user: role operator', {method: 'put', path: () => `/api/users/${ids['rob-other']}`, body: {role: GT}}],
        ['PUT user: username operator', {method: 'put', path: () => `/api/users/${ids['rob-other']}`, body: {username: GT}}],
        ['PUT user: email operator', {method: 'put', path: () => `/api/users/${ids['rob-other']}`, body: {email: GT}}]
      ]
      it.each(USER_CAST)('%s: refused with a 4xx', refused)

      var PROFILE_TYPES = [
        ['PUT profile: current password operator', {cookie: 'rob-user', method: 'put', path: '/api/users/me', body: {currentPassword: GT}}],
        ['PUT profile: current password array', {cookie: 'rob-user', method: 'put', path: '/api/users/me', body: {currentPassword: [PASSWORD]}}],
        ['PUT profile: firstname operator', {cookie: 'rob-user', method: 'put', path: '/api/users/me', body: {currentPassword: PASSWORD, firstname: GT}}]
      ]
      it.each(PROFILE_TYPES)('%s: refused with a 4xx', refused)

      it('DELETE TOTP not enabled: refused with a 4xx', async () => {
        expectRefused(await send({cookie: 'rob-user', method: 'delete', path: '/api/users/totp', body: {totpToken: '123456'}}))
      })

      var CUSTOM_DATA_VALIDATION = [
        ['POST language: locale array', {method: 'post', path: '/api/data/languages', body: {locale: ['rob-x'], language: 'Rob x'}}],
        ['POST language: locale operator', {method: 'post', path: '/api/data/languages', body: {locale: GT, language: 'Rob x'}}],
        ['POST audit type: templates string', {method: 'post', path: '/api/data/audit-types', body: {name: 'rob-type-x', templates: 'rob'}}],
        ['POST audit type: template invalid id', {method: 'post', path: '/api/data/audit-types', body: {name: 'rob-type-x', templates: [{template: 'not-an-id', locale: 'rob-lang'}]}}],
        ['POST vulnerability type: name array', {method: 'post', path: '/api/data/vulnerability-types', body: {name: ['rob-x'], locale: 'rob-lang'}}],
        ['POST category: sort order not allowed', {method: 'post', path: '/api/data/vulnerability-categories', body: {name: 'rob-category-x', sortOrder: 'sideways'}}],
        ['POST category: sortAuto operator', {method: 'post', path: '/api/data/vulnerability-categories', body: {name: 'rob-category-x', sortAuto: GT}}],
        ['POST section: field operator', {method: 'post', path: '/api/data/sections', body: {field: GT, name: 'Rob x'}}],
        ['POST custom field: size not allowed', {method: 'post', path: '/api/data/custom-fields', body: {fieldType: 'text', label: 'rob-x', display: 'general', size: 99}}],
        ['POST custom field: space with display operator', {method: 'post', path: '/api/data/custom-fields', body: {fieldType: 'space', display: GT}}],
        ['POST custom field: options string', {method: 'post', path: '/api/data/custom-fields', body: {fieldType: 'select', label: 'rob-y', display: 'general', options: 'rob'}}],
        ['PUT custom fields: invalid id', {method: 'put', path: '/api/data/custom-fields', body: [{_id: 'not-an-id', label: 'rob-x', display: 'general'}]}],
        ['PUT custom fields: default text string', {method: 'put', path: '/api/data/custom-fields', body: () => [{_id: ids.customField, label: 'rob-field', display: 'finding', text: 'rob'}]}]
      ]
      it.each(CUSTOM_DATA_VALIDATION)('%s: refused with a 4xx', refused)

      var COMPANY_CLIENT_CAST = [
        ['PUT company: name operator', {method: 'put', path: () => `/api/companies/${ids.company}`, body: {name: GT}}],
        ['PUT company: logo operator', {method: 'put', path: () => `/api/companies/${ids.company}`, body: {logo: GT}}],
        ['PUT client: email operator', {method: 'put', path: () => `/api/clients/${ids.client}`, body: {email: GT}}]
      ]
      it.each(COMPANY_CLIENT_CAST)('%s: refused with a 4xx', refused)

      var TEMPLATE_TYPES = [
        ['POST template: file operator', {method: 'post', path: '/api/templates', body: {name: 'rob-template-x', ext: 'docx', file: GT}}],
        ['POST template: name array', {method: 'post', path: '/api/templates', body: {name: ['rob-template-y'], ext: 'docx', file: 'cm9i'}}],
        ['POST template: extension array', {method: 'post', path: '/api/templates', body: {name: 'rob-template-z', ext: ['docx'], file: 'cm9i'}}],
        ['PUT template: name operator', {method: 'put', path: () => `/api/templates/${ids.template}`, body: {name: GT}}],
        ['PUT template: file operator', {method: 'put', path: () => `/api/templates/${ids.template}`, body: {file: GT, ext: 'docx'}}]
      ]
      it.each(TEMPLATE_TYPES)('%s: refused with a 4xx, no template created', async (name, c) => {
        var before = await get('/api/templates')
        expectRefused(await send(c))
        expect(await get('/api/templates')).toEqual(before)
      })

      var IMAGE_TYPES = [
        ['POST image: audit invalid id', {method: 'post', path: '/api/images', body: {value: 'data:image/png;base64,cm9iLWltYWdl', auditId: 'not-an-id'}}],
        ['POST image: name operator', {method: 'post', path: '/api/images', body: {value: 'data:image/png;base64,cm9iLWltYWdlLTI=', name: GT}}]
      ]
      it.each(IMAGE_TYPES)('%s: refused with a 4xx', refused)

      var SETTINGS_TYPES = [
        ['PUT settings: array body', {method: 'put', path: '/api/settings', body: []}],
        ['PUT settings: reviews string', {method: 'put', path: '/api/settings', body: {reviews: 'rob'}}],
        ['PUT settings: boolean not a boolean', {method: 'put', path: '/api/settings', body: {reviews: {enabled: 'maybe', public: {}, private: {}}}}],
        ['PUT settings: number operator', {method: 'put', path: '/api/settings', body: {danger: {enabled: false, public: {nbdaydelete: {$gt: 0}}, private: {}}}}]
      ]
      it.each(SETTINGS_TYPES)('%s: refused with a 4xx', refused)
      it('PUT settings: values of the wrong type do not change the settings', async () => {
        var reviews = {enabled: true, public: {mandatoryReview: true, minReviewers: 3, blockApprovalWithOpenComments: true}, private: {removeApprovalsUponUpdate: true}}
        expect((await admin('put', '/api/settings', {reviews: reviews})).status).toBe(200)
        try {
          for (var [name, c] of SETTINGS_TYPES) {
            await send(c)
            expect([name, (await get('/api/settings')).reviews]).toEqual([name, reviews])
          }
        }
        finally {
          expect((await admin('put', '/api/settings/revert')).status).toBe(200)
        }
      })

      var VULNERABILITY_TYPES = [
        ['POST vulnerabilities: title operator', {method: 'post', path: '/api/vulnerabilities', body: [{details: [{locale: 'rob-lang', title: GT}]}]}],
        ['PUT vulnerability: title operator', {method: 'put', path: () => `/api/vulnerabilities/${ids.vuln}`, body: {details: [{locale: 'rob-lang', title: GT}]}}],
        ['PUT merge: vulnerability id operator', {method: 'put', path: () => `/api/vulnerabilities/merge/${ids.vuln}`, body: {vulnId: GT, locale: 'rob-other-lang'}}],
        ['PUT merge: language missing in the merged vulnerability', {method: 'put', path: () => `/api/vulnerabilities/merge/${ids.vuln}`, body: () => ({vulnId: ids.vuln2, locale: 'rob-missing-lang'})}]
      ]
      it.each(VULNERABILITY_TYPES)('%s: refused with a 4xx', refused)

      it('PUT vulnerability: priority not allowed: refused with a 4xx, not saved', async () => {
        var response = await admin('put', `/api/vulnerabilities/${ids.vuln}`, {cvssv3: helpers.CVSS.high, priority: 9, details: [{locale: 'rob-lang', title: 'rob-vuln', description: 'Rob vulnerability'}]})
        expectRefused(response)
        expect((await get('/api/vulnerabilities')).find(v => v._id === ids.vuln).priority).toBeUndefined()
      })

      var PROPOSAL_TYPES = [
        ['POST proposal: title operator', {cookie: 'rob-user', method: 'post', path: '/api/vulnerabilities/finding/rob-lang', body: {title: NE, description: 'rob'}}],
        ['POST proposal: description operator', {cookie: 'rob-user', method: 'post', path: '/api/vulnerabilities/finding/rob-lang', body: {title: 'rob-vuln', description: GT}}],
        ['POST proposal: custom fields string', {cookie: 'rob-user', method: 'post', path: '/api/vulnerabilities/finding/rob-lang', body: {title: 'rob-proposal-x', customFields: 'rob'}}]
      ]
      it.each(PROPOSAL_TYPES)('%s: refused with a 4xx', refused)

      it('Data unchanged', async () => {
        expect(await world()).toEqual(before)
      })
    })

    describe('NoSQL operator in the company name of a client', () => {
      it('POST client: company name operator refused, no client created', async () => {
        var response = await admin('post', '/api/clients', [{email: 'rob-injection@example.com', company: {name: NE}}])
        expectRefused(response)
        expect((await get('/api/clients')).some(c => c.email === 'rob-injection@example.com')).toBe(false)
      })
      it('PUT client: company name operator refused, company unchanged', async () => {
        var response = await admin('put', `/api/clients/${ids.client}`, {email: 'rob-client@example.com', firstname: 'Rob', company: {name: NE}})
        expectRefused(response)
        expect((await get('/api/clients')).find(c => c._id === ids.client).company.name).toBe('rob-Company')
      })
    })

    describe('Wrong types in the content of an audit', () => {
      // Each request on a new audit: the audit must stay unchanged, readable and editable
      var auditId, findingId, sectionId, initial
      var snapshot = async () => JSON.stringify(strip((await request(app).get(`/api/audits/${auditId}`).set('Cookie', cookies['rob-user'])).body.datas))

      beforeEach(async () => {
        var response = await send({cookie: 'rob-user', method: 'post', path: '/api/audits', body: {name: 'rob-content', language: 'rob-lang', auditType: 'rob-type'}})
        expect(response.status).toBe(201)
        auditId = response.body.datas.audit._id
        for (var finding of [{title: 'rob-content-1', cvssv3: helpers.CVSS.high}, {title: 'rob-content-2', cvssv3: helpers.CVSS.low}])
          expect((await send({cookie: 'rob-user', method: 'post', path: `/api/audits/${auditId}/findings`, body: finding})).status).toBe(200)
        var audit = await get(`/api/audits/${auditId}`, cookies['rob-user'])
        findingId = audit.findings.find(f => f.title === 'rob-content-1')._id
        sectionId = audit.sections[0]._id
        initial = await snapshot()
      })
      afterEach(async () => {
        expect((await send({cookie: 'rob-user', method: 'delete', path: `/api/audits/${auditId}`})).status).toBe(200)
      })

      var general = (body) => () => ({method: 'put', path: `/api/audits/${auditId}/general`, body: body})
      var network = (scope) => () => ({method: 'put', path: `/api/audits/${auditId}/network`, body: {scope: scope}})
      var addFinding = (body) => () => ({method: 'post', path: `/api/audits/${auditId}/findings`, body: {title: 'rob-x', ...body}})
      var updateFinding = (body) => () => ({method: 'put', path: `/api/audits/${auditId}/findings/${findingId}`, body: body})
      var updateFindingRaw = (raw) => () => ({method: 'put', path: `/api/audits/${auditId}/findings/${findingId}`, raw: raw})
      var updateSection = (body) => () => ({method: 'put', path: `/api/audits/${auditId}/sections/${sectionId}`, body: body})
      var sort = (sortFindings) => () => ({method: 'put', path: `/api/audits/${auditId}/sortfindings`, body: {sortFindings: sortFindings}})
      var move = (oldIndex, newIndex) => () => ({method: 'put', path: `/api/audits/${auditId}/movefinding`, body: {oldIndex: oldIndex, newIndex: newIndex}})

      // Answer, audit unchanged, audit still editable (update of a finding)
      var outcome = async (build) => {
        var response = await send({cookie: 'rob-user', ...build()})
        var unchanged = (await snapshot()) === initial
        var editable = (await send({cookie: 'rob-user', method: 'put', path: `/api/audits/${auditId}/findings/${findingId}`, body: {observation: '<p>rob</p>'}})).status
        return `unchanged: ${unchanged}, editable: ${editable}, answer: ${answer(response)}`
      }
      var expectRefusedUnchanged = async (name, build) => {
        expect(await outcome(build)).toMatch(/^unchanged: true, editable: 200, answer: 4\d\d /)
      }

      it.each([
        ['PUT finding: __proto__ key', updateFindingRaw('{"__proto__": {"robPolluted": "yes"}, "title": "rob-content-1"}')],
        ['PUT finding: constructor key', updateFindingRaw('{"constructor": {"prototype": {"robPolluted": "yes"}}}')]
      ])('%s: ignored, audit unchanged and still editable', async (name, build) => {
        expect(await outcome(build)).toMatch(/^unchanged: true, editable: 200, answer: 200 /)
      })

      var NETWORK_CAST = [
        ['PUT network: scope string', network('rob')],
        ['PUT network: hosts string', network([{name: 'rob', hosts: 'rob'}])],
        ['PUT network: service port not a number', network([{name: 'rob', hosts: [{ip: '10.0.0.1', services: [{port: 'http'}]}]}])]
      ]
      it.each(NETWORK_CAST)('%s: refused, audit unchanged and still editable', expectRefusedUnchanged)

      var FINDING_CAST = [
        ['POST finding: title operator', addFinding({title: GT})],
        ['POST finding: title array', addFinding({title: ['rob-a', 'rob-b']})],
        ['POST finding: CVSS operator', addFinding({cvssv3: GT})],
        ['POST finding: remediation complexity not a number', addFinding({remediationComplexity: 'hard'})],
        ['POST finding: custom fields string', addFinding({customFields: 'rob'})],
        ['POST finding: references operator', addFinding({references: GT})]
      ]
      it.each(FINDING_CAST)('%s: refused, audit unchanged and still editable', expectRefusedUnchanged)

      var FINDING_UPDATE_IGNORED = [
        ['PUT finding: title operator', updateFinding({title: GT})],
        ['PUT finding: status not a number', updateFinding({status: 'done'})],
        ['PUT finding: custom fields string', updateFinding({customFields: 'rob'})],
        ['PUT finding: scope operator', updateFinding({scope: GT})]
      ]
      it.each(FINDING_UPDATE_IGNORED)('%s: refused, audit unchanged and still editable', expectRefusedUnchanged)

      var SECTION_SORT_VALIDATION = [
        ['PUT section: custom fields string', updateSection({customFields: 'rob'})],
        ['PUT section: text operator', updateSection({customFields: [], text: GT})],
        ['PUT sort options: string', sort('rob')],
        ['PUT sort options: order not allowed', sort([{category: 'No Category', sortValue: 'cvssScore', sortOrder: 'sideways', sortAuto: true}])],
        ['PUT sort options: category operator', sort([{category: GT}])]
      ]
      it.each(SECTION_SORT_VALIDATION)('%s: refused, audit unchanged and still editable', expectRefusedUnchanged)

      it.each([
        ['PUT network: scope operator', network(GT)],
        ['PUT section: custom fields operator', updateSection({customFields: GT})]
      ])('%s: refused, audit unchanged and still editable', expectRefusedUnchanged)

      it.each([
        ['PUT network: service protocol not allowed', network([{name: 'rob', hosts: [{ip: '10.0.0.1', services: [{port: 80, protocol: 'icmp'}]}]}])],
        ['POST finding: priority not allowed', addFinding({priority: 9})],
        ['POST finding: status not allowed', addFinding({status: 7})],
        ['PUT finding: priority not allowed', updateFinding({priority: 9})]
      ])('%s: refused, audit unchanged and still editable', expectRefusedUnchanged)

      it.each([
        ['PUT general: custom field operator', general({customFields: [{customField: GT, text: WHERE}]})],
        ['PUT general: custom field invalid id', general({customFields: [{customField: 'not-an-id', text: 'rob'}]})],
        ['POST finding: custom field operator', addFinding({customFields: [{customField: GT, text: 'rob'}]})],
        ['POST finding: custom field invalid id', addFinding({customFields: [{customField: 'not-an-id', text: 'rob'}]})],
        ['PUT finding: custom field invalid id', updateFinding({customFields: [{customField: 'not-an-id', text: 'rob'}]})]
      ])('%s: refused, audit unchanged and still editable', expectRefusedUnchanged)

      it.each([
        ['PUT finding position: index not a number', move('rob', 0)],
        ['PUT finding position: index operator', move(GT, 0)],
        ['PUT finding position: index out of range', move(99, 0)],
        ['PUT finding position: negative index', move(-1, 0)],
        ['PUT finding position: __proto__ index', move('__proto__', 0)],
        ['PUT finding position: new index not a number', move(0, 'end')]
      ])('%s: refused, audit unchanged and still editable', expectRefusedUnchanged)
    })

    describe('Invalid identifiers in the URL', () => {
      var before
      beforeAll(async () => {
        // Reviews enabled: the approval and review routes look for the audit
        expect((await admin('put', '/api/settings', {reviews: {enabled: true, public: {mandatoryReview: false, minReviewers: 1, blockApprovalWithOpenComments: true}, private: {removeApprovalsUponUpdate: false}}})).status).toBe(200)
        before = await world()
      })
      afterAll(async () => {
        expect((await admin('put', '/api/settings/revert')).status).toBe(200)
      })

      var BAD = 'not-an-id'
      var audit = (suffix) => () => `/api/audits/${ids.audit}${suffix}`
      var expectNotFoundOrInvalid = async (name, c) => {
        var response = await send(c)
        expectRefused(response)
        expect([403, 404, 422]).toContain(response.status)
      }

      var CASES = [
        // Audit identifier
        ['GET audit', {method: 'get', path: `/api/audits/${BAD}`}],
        ['GET audit (operator)', {method: 'get', path: `/api/audits/${encodeURIComponent('{"$ne":null}')}`}],
        ['GET audit (path traversal)', {method: 'get', path: '/api/audits/..%2F..%2Fconfig'}],
        ['GET audit (emoji)', {method: 'get', path: `/api/audits/${encodeURIComponent('💥')}`}],
        ['GET audit (long identifier)', {method: 'get', path: `/api/audits/${'a'.repeat(5000)}`}],
        ['POST clone', {method: 'post', path: `/api/audits/${BAD}/clone`, body: {name: 'rob-clone'}}],
        ['PUT general', {method: 'put', path: `/api/audits/${BAD}/general`, body: {name: 'rob-x'}}],
        ['PUT network', {method: 'put', path: `/api/audits/${BAD}/network`, body: {scope: []}}],
        ['POST finding', {method: 'post', path: `/api/audits/${BAD}/findings`, body: {title: 'rob-x'}}],
        ['PUT finding', {method: 'put', path: `/api/audits/${BAD}/findings/${FAKE_ID}`, body: {title: 'rob-x'}}],
        ['DELETE finding', {method: 'delete', path: `/api/audits/${BAD}/findings/${FAKE_ID}`}],
        ['PUT section', {method: 'put', path: `/api/audits/${BAD}/sections/${FAKE_ID}`, body: {customFields: []}}],
        ['GET report', {method: 'get', path: `/api/audits/${BAD}/generate`}],
        ['PUT sort options', {method: 'put', path: `/api/audits/${BAD}/sortfindings`, body: {sortFindings: []}}],
        ['PUT finding position', {method: 'put', path: `/api/audits/${BAD}/movefinding`, body: {oldIndex: 0, newIndex: 0}}],
        ['PUT state', {method: 'put', path: `/api/audits/${BAD}/updateReadyForReview`, body: {state: 'REVIEW'}}],
        ['GET comments', {method: 'get', path: `/api/audits/${BAD}/comments`}],
        ['POST comment', {method: 'post', path: `/api/audits/${BAD}/comments`, body: {target: {kind: 'general', field: 'name'}, text: 'rob'}}],
        // Identifiers of the elements of an audit
        ['GET finding (finding identifier)', {method: 'get', path: audit(`/findings/${BAD}`)}],
        ['PUT finding (finding identifier)', {method: 'put', path: audit(`/findings/${BAD}`), body: {title: 'rob-x'}}],
        ['DELETE finding (finding identifier)', {method: 'delete', path: audit(`/findings/${BAD}`)}],
        ['GET section (section identifier)', {method: 'get', path: audit(`/sections/${BAD}`)}],
        ['PUT section (section identifier)', {method: 'put', path: audit(`/sections/${BAD}`), body: {customFields: []}}],
        ['POST reply (comment identifier)', {method: 'post', path: audit(`/comments/${BAD}/replies`), body: {text: 'rob'}}],
        ['PUT comment (comment identifier)', {method: 'put', path: audit(`/comments/${BAD}`), body: {resolved: true}}],
        ['DELETE comment (comment identifier)', {method: 'delete', path: audit(`/comments/${BAD}`)}],
        // Other data
        ['GET user (unknown username with operator characters)', {method: 'get', path: `/api/users/${encodeURIComponent('{"$ne":null}')}`}],
        ['DELETE language (path traversal)', {method: 'delete', path: '/api/data/languages/..%2F..%2Frob'}],
        ['DELETE audit type (operator characters)', {method: 'delete', path: `/api/data/audit-types/${encodeURIComponent('{"$ne":null}')}`}],
        ['DELETE vulnerability type (locale operator in the query)', {method: 'delete', path: '/api/data/vulnerability-types/rob-unknown?locale[$ne]=rob'}],
        ['DELETE category (path traversal)', {method: 'delete', path: '/api/data/vulnerability-categories/..%2F..%2Frob'}],
        ['DELETE section (emoji)', {method: 'delete', path: `/api/data/sections/${encodeURIComponent('💥')}/${encodeURIComponent('💥')}`}],
        ['PUT archive', {method: 'put', path: `/api/vulnerabilities/${BAD}/archive`, body: {archived: true}}],
        ['GET proposal', {method: 'get', path: `/api/vulnerability-proposals/${BAD}`}],
        ['DELETE proposal', {method: 'delete', path: `/api/vulnerability-proposals/${BAD}`}],
        ['GET backup file (path traversal)', {method: 'get', path: '/api/backups/..%2F..%2Fpackage.json/download'}],
        ['DELETE backup (path traversal)', {method: 'delete', path: '/api/backups/..%2Fsrc%2Fapp.js'}],
        ['POST restore (unknown backup)', {method: 'post', path: '/api/backups/20000101-000000-deadbeef/restore', body: {}}]
      ]
      it.each(CASES)('%s: refused with a 4xx', expectNotFoundOrInvalid)

      var AUDIT_IDS = [
        ['DELETE audit', {method: 'delete', path: `/api/audits/${BAD}`}],
        ['GET general', {method: 'get', path: `/api/audits/${BAD}/general`}],
        ['GET network', {method: 'get', path: `/api/audits/${BAD}/network`}],
        ['GET finding', {method: 'get', path: `/api/audits/${BAD}/findings/${FAKE_ID}`}],
        ['GET section', {method: 'get', path: `/api/audits/${BAD}/sections/${FAKE_ID}`}],
        ['PUT approval', {method: 'put', path: `/api/audits/${BAD}/toggleApproval`}]
      ]
      it.each(AUDIT_IDS)('%s: refused with a 4xx', expectNotFoundOrInvalid)

      var DATA_IDS = [
        ['PUT user', {method: 'put', path: `/api/users/${BAD}`, body: {firstname: 'Rob'}}],
        ['DELETE custom field', {method: 'delete', path: `/api/data/custom-fields/${BAD}`}],
        ['PUT company', {method: 'put', path: `/api/companies/${BAD}`, body: {name: 'rob-x'}}],
        ['DELETE company', {method: 'delete', path: `/api/companies/${BAD}`}],
        ['PUT client', {method: 'put', path: `/api/clients/${BAD}`, body: {email: 'rob-x@example.com'}}],
        ['DELETE client', {method: 'delete', path: `/api/clients/${BAD}`}],
        ['PUT template', {method: 'put', path: `/api/templates/${BAD}`, body: {name: 'rob-x'}}],
        ['DELETE template', {method: 'delete', path: `/api/templates/${BAD}`}],
        ['GET template file', {method: 'get', path: `/api/templates/download/${BAD}`}],
        ['GET template file (path traversal)', {method: 'get', path: '/api/templates/download/..%2F..%2Fsrc%2Fconfig%2Fconfig.json'}],
        ['GET image', {method: 'get', path: `/api/images/${BAD}`}],
        ['DELETE image', {method: 'delete', path: `/api/images/${BAD}`}],
        ['GET image file', {method: 'get', path: `/api/images/download/${BAD}`}]
      ]
      it.each(DATA_IDS)('%s: refused with a 4xx', expectNotFoundOrInvalid)

      var VULNERABILITY_IDS = [
        ['PUT vulnerability', {method: 'put', path: `/api/vulnerabilities/${BAD}`, body: {details: [{locale: 'rob-lang', title: 'rob-x'}]}}],
        ['DELETE vulnerability', {method: 'delete', path: `/api/vulnerabilities/${BAD}`}],
        ['GET vulnerability updates', {method: 'get', path: `/api/vulnerabilities/updates/${BAD}`}],
        ['PUT merge (merged into)', {method: 'put', path: `/api/vulnerabilities/merge/${BAD}`, body: () => ({vulnId: ids.vuln2, locale: 'rob-other-lang'})}],
        ['PUT merge (merged)', {method: 'put', path: () => `/api/vulnerabilities/merge/${ids.vuln}`, body: {vulnId: BAD, locale: 'rob-other-lang'}}]
      ]
      it.each(VULNERABILITY_IDS)('%s: refused with a 4xx', expectNotFoundOrInvalid)

      it('Unknown identifiers with a valid format: 404', async () => {
        for (var url of [`/api/audits/${FAKE_ID}`, `/api/audits/${FAKE_ID}/general`, `/api/audits/${FAKE_ID}/network`, `/api/images/${FAKE_ID}`,
                         `/api/templates/download/${FAKE_ID}`, `/api/vulnerability-proposals/${FAKE_ID}`, `/api/users/rob-unknown`])
          expect([url, (await request(app).get(url).set('Cookie', cookies.admin)).status]).toEqual([url, 404])
      })

      it('Data unchanged', async () => {
        expect(await world()).toEqual(before)
      })
    })

    describe('NoSQL operators and prototype keys in the query strings', () => {
      var before
      beforeAll(async () => { before = await world() })

      it.each([
        ['__proto__ key', '/api/audits?__proto__[robPolluted]=yes'],
        ['constructor.prototype key', '/api/audits?constructor[prototype][robPolluted]=yes'],
        ['proposals status operator', '/api/vulnerability-proposals?status[$ne]=rob'],
        ['proposals vulnerability operator', '/api/vulnerability-proposals?vulnerability[$ne]=rob'],
        ['proposals mine operator', '/api/vulnerability-proposals?mine[$ne]=true']
      ])('%s: no server error and no data of other users', async (name, url) => {
        var response = await request(app).get(url).set('Cookie', cookies['rob-other'])
        expectNoServerError(response)
        if (response.status === 200 && url.startsWith('/api/audits'))
          expect(response.body.datas.map(a => a._id)).not.toContain(ids.audit)
      })

      var FINDING_TITLE = [
        ['findingTitle operator', '/api/audits?findingTitle[$ne]=rob'],
        ['findingTitle array', '/api/audits?findingTitle[]=rob-finding-1&findingTitle[]=rob'],
        ['findingTitle regex operator', '/api/audits?findingTitle[$regex]=.*']
      ]
      it.each(FINDING_TITLE)('%s: refused with a 4xx or ignored', async (name, url) => {
        var response = await request(app).get(url).set('Cookie', cookies['rob-other'])
        expectNoServerError(response)
        if (response.status === 200)
          expect(response.body.datas.map(a => a._id)).not.toContain(ids.audit)
      })

      it('Regular expression characters of findingTitle are escaped', async () => {
        expect((await get('/api/audits?findingTitle=rob-finding-1')).map(a => a._id)).toContain(ids.audit)
        expect((await get('/api/audits?findingTitle=.*')).map(a => a._id)).not.toContain(ids.audit)
        expect((await get('/api/audits?findingTitle=rob-finding-.')).map(a => a._id)).not.toContain(ids.audit)
        var start = Date.now()
        expect((await request(app).get(`/api/audits?findingTitle=${encodeURIComponent('(a+)+$' + 'a'.repeat(50))}`).set('Cookie', cookies.admin)).status).toBe(200)
        expect(Date.now() - start).toBeLessThan(2000)
      })

      it('Proposals of other users are not listed with injected parameters', async () => {
        expect((await send({cookie: 'rob-user', method: 'post', path: '/api/vulnerabilities/finding/rob-lang', body: {title: 'rob-vuln', description: 'Proposed by rob-user'}})).status).toBe(200)
        try {
          for (var url of ['/api/vulnerability-proposals?status=all&mine=false', '/api/vulnerability-proposals?status=all&mine[$ne]=true', '/api/vulnerability-proposals?creator=' + ids['rob-user']])
            expect([url, (await get(url, cookies['rob-other'])).filter(p => p.title === 'rob-vuln')]).toEqual([url, []])
          expect((await get('/api/vulnerability-proposals/count', cookies['rob-other'])).pending).toBe(0)
        }
        finally {
          var proposal = (await get('/api/vulnerability-proposals?status=all', cookies['rob-user'])).find(p => p.title === 'rob-vuln')
          expect((await send({cookie: 'rob-user', method: 'delete', path: `/api/vulnerability-proposals/${proposal._id}`})).status).toBe(200)
        }
      })

      it('Data unchanged', async () => {
        expect(await world()).toEqual(before)
      })
    })

    describe('Keys __proto__, constructor and prototype in the bodies', () => {
      var before
      beforeAll(async () => { before = await world() })

      var PROTO = '{"__proto__": {"robPolluted": "yes"}}'
      var CONSTRUCTOR = '{"constructor": {"prototype": {"robPolluted": "yes"}}}'
      var CASES = [
        ['POST token __proto__', {cookie: null, method: 'post', path: '/api/users/token', raw: PROTO}],
        ['POST token constructor', {cookie: null, method: 'post', path: '/api/users/token', raw: '{"username": "rob-user", "password": "x", "constructor": {"prototype": {"robPolluted": "yes"}}}'}],
        ['POST audit __proto__', {method: 'post', path: '/api/audits', raw: PROTO}],
        ['POST audit constructor', {method: 'post', path: '/api/audits', raw: CONSTRUCTOR}],
        ['PUT general __proto__', {method: 'put', path: auditPath('/general'), raw: PROTO}],
        ['PUT general constructor', {method: 'put', path: auditPath('/general'), raw: CONSTRUCTOR}],
        ['PUT network __proto__', {method: 'put', path: auditPath('/network'), raw: PROTO}],
        ['POST comment nested __proto__', {method: 'post', path: auditPath('/comments'), raw: '{"target": {"__proto__": {"kind": "general", "field": "name"}}, "text": "rob"}'}],
        ['PUT settings __proto__', {method: 'put', path: '/api/settings', raw: PROTO}],
        ['PUT settings constructor', {method: 'put', path: '/api/settings', raw: CONSTRUCTOR}],
        ['PUT settings nested __proto__', {method: 'put', path: '/api/settings', raw: '{"danger": {"__proto__": {"robPolluted": "yes"}}}'}],
        ['POST users __proto__', {method: 'post', path: '/api/users', raw: `[${PROTO}]`}],
        ['PUT user __proto__', {method: 'put', path: () => `/api/users/${ids['rob-other']}`, raw: PROTO}],
        ['PUT profile __proto__', {cookie: 'rob-user', method: 'put', path: '/api/users/me', raw: PROTO}],
        ['POST language __proto__', {method: 'post', path: '/api/data/languages', raw: PROTO}],
        ['PUT languages __proto__', {method: 'put', path: '/api/data/languages', raw: `[${PROTO}]`}],
        ['PUT custom fields __proto__', {method: 'put', path: '/api/data/custom-fields', raw: `[${PROTO}]`}],
        ['POST companies __proto__', {method: 'post', path: '/api/companies', raw: `[${PROTO}]`}],
        ['POST clients __proto__', {method: 'post', path: '/api/clients', raw: `[${PROTO}]`}],
        ['POST vulnerabilities __proto__', {method: 'post', path: '/api/vulnerabilities', raw: `[${PROTO}]`}],
        ['POST vulnerabilities nested __proto__', {method: 'post', path: '/api/vulnerabilities', raw: '[{"details": [{"__proto__": {"locale": "rob-lang", "title": "rob-proto"}}]}]'}],
        ['POST proposal __proto__', {cookie: 'rob-user', method: 'post', path: '/api/vulnerabilities/finding/rob-lang', raw: PROTO}],
        ['PUT accept __proto__', {method: 'put', path: `/api/vulnerability-proposals/${FAKE_ID}/accept`, raw: PROTO}],
        ['POST backup __proto__', {method: 'post', path: '/api/backups', raw: '{"name": 1, "__proto__": {"robPolluted": "yes"}}'}]
      ]

      it.each(CASES)('%s: no pollution and no server error', async (name, c) => {
        expectNoServerError(await send(c))
      })

      it('Data unchanged', async () => {
        expect(await world()).toEqual(before)
      })
    })

    describe('Unicode and huge values', () => {
      var TEXT = 'rob-unicode 🔥 漢字 العربية ‮evil‬ Ελληνικά é 👩‍👩‍👧 \u{1F600} ​ a\u0000b'

      it('Unicode audit name, finding and comment kept unchanged', async () => {
        var response = await send({cookie: 'rob-user', method: 'post', path: '/api/audits', body: {name: TEXT, language: 'rob-lang', auditType: 'rob-type'}})
        expect(response.status).toBe(201)
        var id = response.body.datas.audit._id
        try {
          expect((await send({cookie: 'rob-user', method: 'post', path: `/api/audits/${id}/findings`, body: {title: TEXT, description: `<p>${TEXT}</p>`}})).status).toBe(200)
          var audit = await get(`/api/audits/${id}`, cookies['rob-user'])
          expect(audit.name).toBe(TEXT)
          expect(audit.findings[0].title).toBe(TEXT)
          expect(audit.findings[0].description).toBe(`<p>${TEXT}</p>`)
          response = await send({cookie: 'rob-user', method: 'post', path: `/api/audits/${id}/comments`, body: {target: {kind: 'finding', findingId: audit.findings[0]._id, field: 'title'}, quote: {exact: TEXT}, text: TEXT}})
          expect(response.status).toBe(200)
          expect(response.body.datas[0]).toMatchObject({text: TEXT, quote: {exact: TEXT}})
          expect((await get(`/api/audits?findingTitle=${encodeURIComponent('漢字 العربية')}`, cookies['rob-user'])).map(a => a._id)).toContain(id)
        }
        finally {
          expect((await send({cookie: 'rob-user', method: 'delete', path: `/api/audits/${id}`})).status).toBe(200)
        }
      })

      it('Unicode company, client and vulnerability kept unchanged', async () => {
        expect((await admin('post', '/api/clients', [{email: 'rob-unicode@example.com', firstname: TEXT, company: {name: `rob ${TEXT}`}}])).status).toBe(201)
        var client = (await get('/api/clients')).find(c => c.email === 'rob-unicode@example.com')
        expect(client.firstname).toBe(TEXT)
        expect(client.company.name).toBe(`rob ${TEXT}`)
        expect((await admin('delete', `/api/clients/${client._id}`)).status).toBe(200)
        var company = (await get('/api/companies')).find(c => c.name === `rob ${TEXT}`)
        expect((await admin('delete', `/api/companies/${company._id}`)).status).toBe(200)

        expect((await admin('post', '/api/vulnerabilities', [{details: [{locale: 'rob-lang', title: TEXT, description: TEXT}]}])).status).toBe(201)
        var vulnerability = (await get('/api/vulnerabilities/rob-lang')).find(v => v.detail.title === TEXT)
        expect(vulnerability.detail.description).toBe(TEXT)
        expect((await admin('delete', `/api/vulnerabilities/${vulnerability._id}`)).status).toBe(200)
      })

      it('Letters of all the scripts are accepted in the names of the custom data, emoji are refused', async () => {
        for (var name of ['Ελληνικά', '日本語', 'Русский', 'العربية', 'Français (Québec)']) {
          var response = await admin('post', '/api/data/languages', {locale: `rob-${name}`, language: name})
          expect([name, response.status]).toEqual([name, 201])
          expect((await get('/api/data/languages')).find(l => l.locale === `rob-${name}`).language).toBe(name)
          expect((await admin('delete', `/api/data/languages/${encodeURIComponent(`rob-${name}`)}`)).status).toBe(200)
        }
        for (var invalid of ['🔥', 'rob/../x', 'rob<script>', 'rob\u0000']) {
          var response = await admin('post', '/api/data/languages', {locale: invalid, language: invalid})
          expect([invalid, response.status]).toEqual([invalid, 422])
        }
      })

      it('Huge values: 1 MB audit name, 5 MB finding description', async () => {
        var name = 'rob-' + 'N'.repeat(1024 * 1024)
        var response = await send({cookie: 'rob-user', method: 'post', path: '/api/audits', body: {name: name, language: 'rob-lang', auditType: 'rob-type'}})
        expect(response.status).toBe(201)
        var id = response.body.datas.audit._id
        try {
          var description = `<p>${'D'.repeat(5 * 1024 * 1024)}</p>`
          expect((await send({cookie: 'rob-user', method: 'post', path: `/api/audits/${id}/findings`, body: {title: 'rob-huge', description: description}})).status).toBe(200)
          var audit = await get(`/api/audits/${id}`, cookies['rob-user'])
          expect(audit.name).toBe(name)
          expect(audit.findings[0].description).toBe(description)
        }
        finally {
          expect((await send({cookie: 'rob-user', method: 'delete', path: `/api/audits/${id}`})).status).toBe(200)
        }
      }, 30000)

      it('Image over 16 MB (limit of the MongoDB documents) refused with 413', async () => {
        var count = await mongoose.model('Image').countDocuments()
        var response = await send({cookie: 'rob-user', method: 'post', path: '/api/images', body: {value: `data:image/png;base64,${'A'.repeat(17 * 1024 * 1024)}`}})
        expect(answer(response)).toMatch(/^413 /)
        expect(await mongoose.model('Image').countDocuments()).toBe(count)
      }, 30000)

      it('Finding making the audit larger than 16 MB (limit of the MongoDB documents) refused with 413', async () => {
        var before = await get(`/api/audits/${ids.audit}`, cookies['rob-user'])
        var response = await send({cookie: 'rob-user', method: 'post', path: auditPath('/findings'), body: {title: 'rob-too-large', description: `<p>${'D'.repeat(17 * 1024 * 1024)}</p>`}})
        expect(answer(response)).toMatch(/^413 /)
        var after = await get(`/api/audits/${ids.audit}`, cookies['rob-user'])
        expect(after.findings.map(f => f.title)).toEqual(before.findings.map(f => f.title))
      }, 30000)

      it('Findings making the audit grow over 16 MB: the last one refused with 413', async () => {
        var id = (await send({cookie: 'rob-user', method: 'post', path: '/api/audits', body: {name: 'rob-growing', language: 'rob-lang', auditType: 'rob-type'}})).body.datas.audit._id
        try {
          var add = (title) => send({cookie: 'rob-user', method: 'post', path: `/api/audits/${id}/findings`, body: {title: title, description: `<p>${'G'.repeat(9 * 1024 * 1024)}</p>`}})
          expect((await add('rob-first-half')).status).toBe(200)
          expect(answer(await add('rob-second-half'))).toMatch(/^413 /)
          expect((await get(`/api/audits/${id}`, cookies['rob-user'])).findings.map(f => f.title)).toEqual(['rob-first-half'])
        }
        finally {
          await send({cookie: 'rob-user', method: 'delete', path: `/api/audits/${id}`})
        }
      }, 60000)

      it('Huge credentials are refused without error', async () => {
        var response = await request(app).post('/api/users/token').send({username: 'U'.repeat(1024 * 1024), password: 'P'.repeat(1024 * 1024)})
        expect(response.status).toBe(401)
        response = await request(app).get('/api/users/checktoken').set('Cookie', [`token=JWT ${'x'.repeat(8000)}`])
        expect(response.status).toBe(401)
      })

      it('Huge comment is refused', async () => {
        var response = await admin('post', `/api/audits/${ids.audit}/comments`, {target: {kind: 'general', field: 'name'}, text: 'c'.repeat(10001)})
        expect(response.status).toBe(422)
      })
    })

    describe('Hurried user: repeated and concurrent requests', () => {
      // Requests sent in parallel (Promise.all): double or triple clicks, actions chained without waiting for the answers
      var before, templateId
      var cleanups = []
      var later = (fn) => cleanups.push(fn)
      var ITERATIONS = 5
      var parallel = (count, fn) => Promise.all(Array.from({length: count}, (_, i) => fn(i)))
      // Status codes, sorted (message of the server errors)
      var codes = (responses) => responses.map(r => r.status >= 500 ? answer(r) : r.status).sort()
      var as = (cookie, method, url, body) => send({cookie: cookie, method: method, path: url, body: body})
      var auditOf = (id) => get(`/api/audits/${id}`)
      var createAudit = async (name, template) => {
        var response = await as('rob-user', 'post', '/api/audits', {name: name, language: 'rob-lang', auditType: 'rob-type'})
        expect(response.status).toBe(201)
        var id = response.body.datas.audit._id
        later(() => admin('delete', `/api/audits/${id}`))
        if (template)
          expect((await as('rob-user', 'put', `/api/audits/${id}/general`, {template: template})).status).toBe(200)
        return id
      }
      var addFinding = async (auditId, finding) => {
        expect((await as('rob-user', 'post', `/api/audits/${auditId}/findings`, finding)).status).toBe(200)
        return (await auditOf(auditId)).findings.find(f => f.title === finding.title)._id
      }
      var reviews = (minReviewers) => admin('put', '/api/settings', {reviews: {
        enabled: true, public: {mandatoryReview: false, minReviewers: minReviewers, blockApprovalWithOpenComments: false},
        private: {removeApprovalsUponUpdate: false}
      }})

      beforeAll(async () => {
        before = await world()
        acl.roles['rob-reviewer'] = {inherits: ['user'], allows: ['audits:review']}
        expect((await admin('post', '/api/users', [{username: 'rob-reviewer', password: PASSWORD, firstname: 'Rob', lastname: 'Reviewer', role: 'rob-reviewer'}])).status).toBe(201)
        cookies['rob-reviewer'] = await helpers.login('rob-reviewer', PASSWORD)
        ids['rob-reviewer'] = await helpers.userId(cookies.admin, 'rob-reviewer')
        var response = await admin('post', '/api/templates', {name: 'rob-concurrent-template', ext: 'docx', file: DEFAULT_TEMPLATE.toString('base64')})
        expect(response.status).toBe(201)
        templateId = response.body.datas._id
        later(() => admin('delete', `/api/templates/${templateId}`))
      })

      afterAll(async () => {
        for (var fn of cleanups.splice(0).reverse()) {
          try { await fn() } catch (err) {}
        }
        await admin('put', '/api/settings/revert')
        await admin('put', `/api/users/${ids['rob-reviewer']}`, {enabled: false})
        delete acl.roles['rob-reviewer']
      })

      describe('Creations sent several times', () => {
        it('Audit created three times: three audits (creations are not deduplicated)', async () => {
          var responses = await parallel(3, () => as('rob-user', 'post', '/api/audits', {name: 'rob-triple-audit', language: 'rob-lang', auditType: 'rob-type'}))
          responses.filter(r => r.status === 201).forEach(r => later(() => admin('delete', `/api/audits/${r.body.datas.audit._id}`)))
          expect(codes(responses)).toEqual([201, 201, 201])
          expect(new Set(responses.map(r => r.body.datas.audit._id)).size).toBe(3)
        })

        it('Finding added three times: three findings with distinct identifiers', async () => {
          var id = await createAudit('rob-triple-findings')
          var responses = await parallel(3, () => as('rob-user', 'post', `/api/audits/${id}/findings`, {title: 'rob-triple-finding', cvssv3: helpers.CVSS.high}))
          expect(codes(responses)).toEqual([200, 200, 200])
          var findings = (await auditOf(id)).findings
          expect(findings.map(f => f.title)).toEqual(['rob-triple-finding', 'rob-triple-finding', 'rob-triple-finding'])
          expect(findings.map(f => f.identifier).sort()).toEqual([1, 2, 3])
        })

        it('Finding of the vulnerabilities database added three times: three findings with distinct identifiers', async () => {
          var id = await createAudit('rob-triple-database-findings')
          await addFinding(id, {title: 'rob-first-finding'})
          var vuln = (await get('/api/vulnerabilities/rob-lang', cookies['rob-user'])).find(v => v.detail.title === 'rob-vuln')
          var finding = {title: vuln.detail.title, description: vuln.detail.description, cvssv3: vuln.cvssv3, category: vuln.category, customFields: vuln.detail.customFields}
          var responses = await parallel(3, () => as('rob-user', 'post', `/api/audits/${id}/findings`, finding))
          expect(codes(responses)).toEqual([200, 200, 200])
          var findings = (await auditOf(id)).findings
          expect(findings.filter(f => f.title === 'rob-vuln')).toHaveLength(3)
          expect(findings.map(f => f.identifier).sort()).toEqual([1, 2, 3, 4])
        })

        // Data with a unique name: [name, request, number of documents with this name, cleanup]
        var named = (url, filter) => async () => (await get(url)).filter(filter)
        var UNIQUE = [
          ['User', () => admin('post', '/api/users', [{username: 'rob-double-user', password: PASSWORD, firstname: 'Rob', lastname: 'Double'}]),
            named('/api/users', u => u.username === 'rob-double-user'), (u) => admin('put', `/api/users/${u._id}`, {enabled: false})],
          ['Company', () => admin('post', '/api/companies', [{name: 'rob-double-company'}]),
            named('/api/companies', c => c.name === 'rob-double-company'), (c) => admin('delete', `/api/companies/${c._id}`)],
          ['Client', () => as('rob-user', 'post', '/api/clients', [{email: 'rob-double@example.com'}]),
            named('/api/clients', c => c.email === 'rob-double@example.com'), (c) => admin('delete', `/api/clients/${c._id}`)],
          ['Vulnerability', () => admin('post', '/api/vulnerabilities', [{details: [{locale: 'rob-lang', title: 'rob-double-vuln'}]}]),
            named('/api/vulnerabilities', v => v.details.some(d => d.title === 'rob-double-vuln')), (v) => admin('delete', `/api/vulnerabilities/${v._id}`)],
          ['Vulnerability type', () => admin('post', '/api/data/vulnerability-types', {name: 'rob-double-type', locale: 'rob-lang'}),
            named('/api/data/vulnerability-types', t => t.name === 'rob-double-type'), () => admin('delete', '/api/data/vulnerability-types/rob-double-type?locale=rob-lang')],
          ['Vulnerability category', () => admin('post', '/api/data/vulnerability-categories', {name: 'rob-double-category'}),
            named('/api/data/vulnerability-categories', c => c.name === 'rob-double-category'), () => admin('delete', '/api/data/vulnerability-categories/rob-double-category')],
          ['Language', () => admin('post', '/api/data/languages', {locale: 'rob-double', language: 'Rob double'}),
            named('/api/data/languages', l => l.locale === 'rob-double'), () => admin('delete', '/api/data/languages/rob-double')],
          ['Audit type', () => admin('post', '/api/data/audit-types', {name: 'rob-double-audit-type', templates: []}),
            named('/api/data/audit-types', t => t.name === 'rob-double-audit-type'), () => admin('delete', '/api/data/audit-types/rob-double-audit-type')],
          ['Custom field', () => admin('post', '/api/data/custom-fields', {fieldType: 'text', label: 'rob-double-field', display: 'general'}),
            named('/api/data/custom-fields', f => f.label === 'rob-double-field'), (f) => admin('delete', `/api/data/custom-fields/${f._id}`)],
          ['Section', () => admin('post', '/api/data/sections', {field: 'rob_double', name: 'Rob double'}),
            named('/api/data/sections', s => s.field === 'rob_double'), () => admin('delete', '/api/data/sections/rob_double/rob-lang')],
          ['Template', () => admin('post', '/api/templates', {name: 'rob-double-template', ext: 'docx', file: Buffer.from('rob').toString('base64')}),
            named('/api/templates', t => t.name === 'rob-double-template'), (t) => admin('delete', `/api/templates/${t._id}`)]
        ]

        it.each(UNIQUE)('%s created three times: one created, the others refused with a 4xx', async (name, create, documents, remove) => {
          var responses = await parallel(3, create)
          ;(await documents()).forEach(document => later(() => remove(document)))
          expect([codes(responses), (await documents()).length]).toEqual([[201, 422, 422], 1])
        })

        it('Template created three times: its file is written', async () => {
          expect(fs.readFileSync(path.join(TEMPLATES_DIR, 'rob-double-template.docx')).toString()).toBe('rob')
        })

        it('Clone and comment sent three times: three clones, three comments (not deduplicated)', async () => {
          var id = await createAudit('rob-triple-clone')
          var responses = await parallel(3, () => as('rob-user', 'post', `/api/audits/${id}/clone`, {name: 'rob-triple-clone-copy'}))
          responses.filter(r => r.status === 201).forEach(r => later(() => admin('delete', `/api/audits/${r.body.datas.audit._id}`)))
          expect(codes(responses)).toEqual([201, 201, 201])
          responses = await parallel(3, () => as('rob-user', 'post', `/api/audits/${id}/comments`, {target: {kind: 'general', field: 'name'}, text: 'rob-triple-comment'}))
          expect(codes(responses)).toEqual([200, 200, 200])
          expect((await get(`/api/audits/${id}/comments`)).filter(c => c.text === 'rob-triple-comment')).toHaveLength(3)
        })

        it('Same image uploaded three times: one image, the same identifier returned', async () => {
          var value = `data:image/png;base64,${Buffer.concat([Buffer.from(helpers.PNG_BASE64, 'base64'), Buffer.from('rob-triple')]).toString('base64')}`
          var count = await mongoose.model('Image').countDocuments()
          var responses = await parallel(3, () => as('rob-user', 'post', '/api/images', {value: value}))
          var images = await mongoose.model('Image').find({value: value}).lean()
          images.forEach(image => later(() => admin('delete', `/api/images/${image._id}`)))
          expect(images).toHaveLength(1)
          expect(await mongoose.model('Image').countDocuments()).toBe(count + 1)
          expect([codes(responses), new Set(responses.map(r => r.body.datas._id)).size]).toEqual([[201, 201, 201], 1])
        })

        it('Backup requested three times: no error, every backup answered 201 is stored', async () => {
          var responses = await parallel(3, () => admin('post', '/api/backups', {name: 'rob-concurrent-backup', categories: ['languages']}))
          var stored = (await get('/api/backups')).filter(b => b.name === 'rob-concurrent-backup')
          stored.forEach(backup => later(() => admin('delete', `/api/backups/${backup.id}`)))
          expect(responses.every(r => [201, 422].includes(r.status))).toBe(true)
          expect(stored.map(b => b.id).sort()).toEqual(responses.filter(r => r.status === 201).map(r => r.body.datas.id).sort())
          // Observed: one creation at a time, the others refused while it is in progress
          responses.filter(r => r.status === 422).forEach(r => expect(r.body.datas).toBe('A backup creation is already in progress'))
        })

        it('New vulnerability proposed three times from a finding: one vulnerability, one proposal, the others refused', async () => {
          var responses = await parallel(3, () => as('rob-user', 'post', '/api/vulnerabilities/finding/rob-lang', {title: 'rob-double-proposal'}))
          // Cleanups run in reverse order: proposals withdrawn (deletes their vulnerability), then remaining vulnerabilities deleted
          var vulns = (await get('/api/vulnerabilities')).filter(v => v.details.some(d => d.title === 'rob-double-proposal'))
          vulns.forEach(v => later(() => admin('delete', `/api/vulnerabilities/${v._id}`)))
          var proposals = (await get('/api/vulnerability-proposals?status=all', cookies['rob-user'])).filter(p => p.title === 'rob-double-proposal')
          proposals.forEach(p => later(() => as('rob-user', 'delete', `/api/vulnerability-proposals/${p._id}`)))
          var refused = responses.filter(r => r.status >= 400 && r.status < 500).length
          expect([codes(responses)[0], refused, proposals.length, vulns.length]).toEqual([201, 2, 1, 1])
        })

        it('Update of a vulnerability proposed three times: three pending proposals (not deduplicated)', async () => {
          var responses = await parallel(3, () => as('rob-user', 'post', '/api/vulnerabilities/finding/rob-lang', {title: 'rob-vuln', description: 'rob-triple-update', cvssv3: helpers.CVSS.high}))
          var proposals = (await get('/api/vulnerability-proposals?status=pending', cookies['rob-user'])).filter(p => p.title === 'rob-vuln')
          proposals.forEach(p => later(() => as('rob-user', 'delete', `/api/vulnerability-proposals/${p._id}`)))
          expect(codes(responses)).toEqual([200, 200, 200])
          expect(proposals).toHaveLength(3)
        })
      })

      describe('Concurrent updates', () => {
        it('General information: the last request wins, the fields are not mixed', async () => {
          var id = await createAudit('rob-concurrent-general')
          var responses = await parallel(6, i => as('rob-user', 'put', `/api/audits/${id}/general`, {name: `rob-name-${i}`, date: `rob-date-${i}`, date_end: `rob-end-${i}`}))
          expect(codes(responses)).toEqual([200, 200, 200, 200, 200, 200])
          var audit = await auditOf(id)
          var i = audit.name.split('-').pop()
          expect([audit.date, audit.date_end]).toEqual([`rob-date-${i}`, `rob-end-${i}`])
        })

        it('Same finding: the last request wins, the fields are not mixed', async () => {
          var id = await createAudit('rob-concurrent-finding')
          var findingId = await addFinding(id, {title: 'rob-concurrent'})
          await addFinding(id, {title: 'rob-other-finding'})
          for (var k = 0; k < ITERATIONS; k++) {
            var responses = await parallel(4, i => as('rob-user', 'put', `/api/audits/${id}/findings/${findingId}`, {title: `rob-title-${k}-${i}`, description: `<p>rob-description-${k}-${i}</p>`}))
            var finding = (await auditOf(id)).findings.find(f => f._id === findingId)
            var i = finding.title.split('-').pop()
            expect([k, codes(responses), finding.description]).toEqual([k, [200, 200, 200, 200], `<p>rob-description-${k}-${i}</p>`])
          }
        })

        it('Two findings of the same audit: both updates kept', async () => {
          var id = await createAudit('rob-concurrent-findings')
          var first = await addFinding(id, {title: 'rob-first'})
          var second = await addFinding(id, {title: 'rob-second'})
          for (var i = 0; i < ITERATIONS; i++) {
            var responses = await Promise.all([
              as('rob-user', 'put', `/api/audits/${id}/findings/${first}`, {description: `<p>first-${i}</p>`}),
              as('rob-user', 'put', `/api/audits/${id}/findings/${second}`, {description: `<p>second-${i}</p>`})
            ])
            var findings = (await auditOf(id)).findings
            expect([i, codes(responses), findings.find(f => f._id === first).description, findings.find(f => f._id === second).description])
              .toEqual([i, [200, 200], `<p>first-${i}</p>`, `<p>second-${i}</p>`])
          }
        })

        it('Scope names (general) and network import at the same time: imported hosts kept', async () => {
          var id = await createAudit('rob-concurrent-scope')
          for (var i = 0; i < ITERATIONS; i++) {
            var network = (ip) => as('rob-user', 'put', `/api/audits/${id}/network`, {scope: [{name: 'rob-net', hosts: [{ip: ip}]}]})
            expect((await network('10.0.0.1')).status).toBe(200)
            var responses = await Promise.all([
              as('rob-user', 'put', `/api/audits/${id}/general`, {scope: ['rob-net', 'rob-other']}),
              network(`10.0.1.${i}`)
            ])
            var scope = (await get(`/api/audits/${id}/network`)).scope
            expect([i, codes(responses), scope.find(e => e.name === 'rob-net').hosts.map(h => h.ip)]).toEqual([i, [200, 200], [`10.0.1.${i}`]])
          }
        })

        it('Sort options and finding updated at the same time: both kept', async () => {
          var id = await createAudit('rob-concurrent-sort')
          var findingId = await addFinding(id, {title: 'rob-sorted-a', cvssv3: helpers.CVSS.low})
          await addFinding(id, {title: 'rob-sorted-b', cvssv3: helpers.CVSS.high})
          for (var i = 0; i < ITERATIONS; i++) {
            var order = i % 2 ? 'asc' : 'desc'
            var responses = await Promise.all([
              as('rob-user', 'put', `/api/audits/${id}/sortfindings`, {sortFindings: [{category: 'No Category', sortValue: 'title', sortOrder: order, sortAuto: true}]}),
              as('rob-user', 'put', `/api/audits/${id}/findings/${findingId}`, {description: `<p>sorted-${i}</p>`})
            ])
            var audit = await auditOf(id)
            expect([i, codes(responses), audit.sortFindings.find(o => o.category === 'No Category').sortOrder, audit.findings.find(f => f._id === findingId).description])
              .toEqual([i, [200, 200], order, `<p>sorted-${i}</p>`])
          }
        })

        it('Settings: the final settings are those of one of the requests', async () => {
          var A = {enabled: true, public: {mandatoryReview: false, minReviewers: 3, blockApprovalWithOpenComments: false}, private: {removeApprovalsUponUpdate: false}}
          var B = {enabled: false, public: {mandatoryReview: true, minReviewers: 1, blockApprovalWithOpenComments: false}, private: {removeApprovalsUponUpdate: false}}
          try {
            for (var i = 0; i < ITERATIONS; i++) {
              expect((await admin('put', '/api/settings/revert')).status).toBe(200)
              var responses = await Promise.all([admin('put', '/api/settings', {reviews: A}), admin('put', '/api/settings', {reviews: B})])
              var final = (await get('/api/settings')).reviews
              expect([i, codes(responses), [A, B].some(expected => util.isDeepStrictEqual(expected, final)) ? 'A or B' : final])
                .toEqual([i, [200, 200], 'A or B'])
            }
          }
          finally {
            expect((await admin('put', '/api/settings/revert')).status).toBe(200)
          }
        })
      })

      describe('Deletion during an update', () => {
        it('Finding deleted while it is updated: 404, no finding recreated', async () => {
          var id = await createAudit('rob-delete-finding')
          await addFinding(id, {title: 'rob-kept'})
          for (var i = 0; i < ITERATIONS; i++) {
            var findingId = await addFinding(id, {title: `rob-doomed-${i}`})
            var responses = await Promise.all([
              as('rob-user', 'put', `/api/audits/${id}/findings/${findingId}`, {title: `rob-doomed-${i}-updated`, description: '<p>updated</p>'}),
              as('rob-user', 'delete', `/api/audits/${id}/findings/${findingId}`)
            ])
            var titles = (await auditOf(id)).findings.map(f => f.title)
            expect([i, [200, 404].includes(responses[0].status), responses[1].status, titles]).toEqual([i, true, 200, ['rob-kept']])
          }
        })

        it('Audit deleted while it is updated: 404, no audit recreated', async () => {
          for (var i = 0; i < ITERATIONS; i++) {
            var id = await createAudit(`rob-doomed-audit-${i}`)
            var findingId = await addFinding(id, {title: 'rob-doomed'})
            var responses = await Promise.all([
              as('rob-user', 'put', `/api/audits/${id}/general`, {name: `rob-doomed-audit-${i}-updated`}),
              as('rob-user', 'post', `/api/audits/${id}/findings`, {title: 'rob-late-finding'}),
              as('rob-user', 'put', `/api/audits/${id}/findings/${findingId}`, {description: '<p>late</p>'}),
              as('rob-user', 'delete', `/api/audits/${id}`)
            ])
            var answers = responses.slice(0, 3).map(r => [200, 404].includes(r.status) ? 'ok' : answer(r))
            expect([i, answers, responses[3].status, (await request(app).get(`/api/audits/${id}`).set('Cookie', cookies.admin)).status])
              .toEqual([i, ['ok', 'ok', 'ok'], 200, 404])
            expect((await get('/api/audits')).some(a => a._id === id || a.name.startsWith(`rob-doomed-audit-${i}`))).toBe(false)
          }
        })
      })

      describe('Review actions sent several times or out of order', () => {
        var auditId
        var state = async () => {
          var audit = await auditOf(auditId)
          return {state: audit.state, approvals: audit.approvals.map(a => a.username).sort()}
        }
        var reset = (values) => mongoose.model('Audit').updateOne({_id: auditId}, values)
        var toggle = (cookie) => as(cookie, 'put', `/api/audits/${auditId}/toggleApproval`)
        var setState = (value) => as('rob-user', 'put', `/api/audits/${auditId}/updateReadyForReview`, {state: value})

        beforeAll(async () => {
          // Two approvals needed
          expect((await reviews(2)).status).toBe(200)
          auditId = await createAudit('rob-concurrent-review')
          expect((await as('rob-user', 'put', `/api/audits/${auditId}/general`, {reviewers: [{_id: ids['rob-reviewer']}]})).status).toBe(200)
        })

        it('Review requested three times: in review', async () => {
          var responses = await parallel(3, () => setState('REVIEW'))
          expect(codes(responses)).toEqual([200, 200, 200])
          expect(await state()).toEqual({state: 'REVIEW', approvals: []})
        })

        it('Review requested and cancelled at the same time: one of the two states', async () => {
          for (var i = 0; i < ITERATIONS; i++) {
            await reset({state: 'EDIT', approvals: []})
            var responses = await Promise.all([setState('REVIEW'), setState('EDIT')])
            expect([i, codes(responses), ['EDIT', 'REVIEW'].includes((await state()).state)]).toEqual([i, [200, 200], true])
          }
        })

        it('Approval clicked twice by the same reviewer: never counted twice', async () => {
          for (var i = 0; i < ITERATIONS; i++) {
            await reset({state: 'REVIEW', approvals: []})
            var responses = await Promise.all([toggle('rob-reviewer'), toggle('rob-reviewer')])
            var current = await state()
            expect([i, codes(responses), current.state, current.approvals.length <= 1]).toEqual([i, [200, 200], 'REVIEW', true])
          }
        })

        it('Approval set with {approved}: double click keeps the approval, removal idempotent', async () => {
          var approve = (approved) => as('rob-reviewer', 'put', `/api/audits/${auditId}/toggleApproval`, {approved: approved})
          for (var i = 0; i < ITERATIONS; i++) {
            await reset({state: 'REVIEW', approvals: []})
            var responses = await Promise.all([approve(true), approve(true)])
            expect([i, codes(responses), await state()]).toEqual([i, [200, 200], {state: 'REVIEW', approvals: ['rob-reviewer']}])
            responses = await Promise.all([approve(false), approve(false)])
            expect([i, codes(responses), await state()]).toEqual([i, [200, 200], {state: 'REVIEW', approvals: []}])
          }
          expect((await approve('yes')).status).toBe(422)
        })

        it('Two reviewers approve at the same time: both approvals kept, audit approved', async () => {
          for (var i = 0; i < ITERATIONS; i++) {
            await reset({state: 'REVIEW', approvals: []})
            var responses = await Promise.all([toggle('rob-reviewer'), toggle('admin')])
            expect([i, codes(responses), await state()]).toEqual([i, [200, 200], {state: 'APPROVED', approvals: ['admin', 'rob-reviewer']}])
          }
        })

        it('Approval and back to edition at the same time: state consistent with the answers', async () => {
          for (var i = 0; i < ITERATIONS; i++) {
            await reset({state: 'REVIEW', approvals: []})
            var [approval, edition] = await Promise.all([toggle('rob-reviewer'), setState('EDIT')])
            // Approval before the edition: edition with the approval kept, approval after the edition: refused
            var expected = {state: 'EDIT', approvals: approval.status === 200 ? ['rob-reviewer'] : []}
            expect([i, edition.status, [200, 403].includes(approval.status), await state()]).toEqual([i, 200, true, expected])
          }
        })
      })

      describe('Reports generated in parallel', () => {
        var documentXml = (response) => new PizZip(response.body).file('word/document.xml').asText()
        var generate = (id) => request(app).get(`/api/audits/${id}/generate`).set('Cookie', cookies['rob-user']).buffer(true).parse(helpers.binary)

        it('Same audit generated three times at the same time: three valid reports', async () => {
          var id = await createAudit('rob-parallel-report', templateId)
          await addFinding(id, {title: 'rob-parallel-finding', cvssv3: helpers.CVSS.high, description: '<p>rob-parallel-description</p>'})
          var responses = await parallel(3, () => generate(id))
          expect(responses.map(r => [r.status, r.status === 200 ? '' : r.body.toString()])).toEqual([[200, ''], [200, ''], [200, '']])
          for (var response of responses) {
            var xml = documentXml(response)
            expect(xml).toContain('rob-parallel-finding')
            expect(xml).toContain('rob-parallel-description')
          }
        }, 60000)

        it('Two audits generated at the same time: each report contains its own audit', async () => {
          var alpha = await createAudit('rob-report-alpha', templateId)
          await addFinding(alpha, {title: 'rob-finding-alpha', cvssv3: helpers.CVSS.high, description: '<p>rob-description-alpha</p>'})
          var beta = await createAudit('rob-report-beta', templateId)
          await addFinding(beta, {title: 'rob-finding-beta', cvssv3: helpers.CVSS.low, description: '<p>rob-description-beta</p>'})
          var responses = await Promise.all([generate(alpha), generate(beta), generate(alpha), generate(beta)])
          expect(codes(responses)).toEqual([200, 200, 200, 200])
          responses.forEach((response, i) => {
            var [own, other] = i % 2 ? ['beta', 'alpha'] : ['alpha', 'beta']
            var xml = documentXml(response)
            expect(xml).toContain(`rob-description-${own}`)
            expect(xml).not.toContain(`rob-description-${other}`)
          })
        }, 60000)
      })

      it('Data put back after the repeated requests', async () => {
        for (var fn of cleanups.splice(0).reverse())
          await fn()
        expect((await admin('put', '/api/settings/revert')).status).toBe(200)
        expect((await get('/api/users')).filter(u => u.username === 'rob-double-user')).toHaveLength(1)
        // Users created by this group cannot be deleted (disabled)
        var withoutUsers = (state) => ({...state, users: undefined})
        expect(withoutUsers(await world())).toEqual(withoutUsers(before))
      })
    })

    describe('Access to the images of the audits', () => {
      var auditId, otherAuditId, imageId
      var png = (text) => `data:image/png;base64,${Buffer.concat([Buffer.from(helpers.PNG_BASE64, 'base64'), Buffer.from(text)]).toString('base64')}`
      var status = async (cookie, id = imageId) => [
        (await request(app).get(`/api/images/${id}`).set('Cookie', cookie)).status,
        (await request(app).get(`/api/images/download/${id}`).set('Cookie', cookie)).status
      ]
      var withImage = (id) => `<p>Proof</p><img src="${id}" alt="proof">`

      beforeAll(async () => {
        auditId = (await send({cookie: 'rob-user', method: 'post', path: '/api/audits', body: {name: 'rob-images', language: 'rob-lang', auditType: 'rob-type'}})).body.datas.audit._id
        otherAuditId = (await send({cookie: 'rob-other', method: 'post', path: '/api/audits', body: {name: 'rob-images-other', language: 'rob-lang', auditType: 'rob-type'}})).body.datas.audit._id
        var response = await send({cookie: 'rob-user', method: 'post', path: '/api/images', body: {value: png('rob-image-access'), auditId: auditId}})
        expect(response.status).toBe(201)
        imageId = response.body.datas._id
        expect((await send({cookie: 'rob-user', method: 'post', path: `/api/audits/${auditId}/findings`, body: {title: 'rob-image-finding', description: withImage(imageId)}})).status).toBe(200)
      })
      afterAll(async () => {
        for (var [username, id] of [['rob-user', auditId], ['rob-other', otherAuditId]])
          await send({cookie: username, method: 'delete', path: `/api/audits/${id}`})
        await admin('delete', `/api/images/${imageId}`)
      })

      it('Image of an audit: readable by its users and the users allowed to read all the audits only', async () => {
        expect(await status(cookies['rob-user'])).toEqual([200, 200])
        expect(await status(cookies.admin)).toEqual([200, 200])
        expect(await status(cookies['rob-other'])).toEqual([404, 404])
      })

      it('Referencing the identifier of an image in an audit or a proposal does not give access to it', async () => {
        expect((await send({cookie: 'rob-other', method: 'post', path: `/api/audits/${otherAuditId}/findings`, body: {title: 'rob-stolen', description: withImage(imageId)}})).status).toBe(200)
        var response = await send({cookie: 'rob-other', method: 'post', path: '/api/vulnerabilities/finding/rob-lang', body: {title: 'rob-stolen-image', description: withImage(imageId)}})
        expect(response.status).toBe(201)
        expect(await status(cookies['rob-other'])).toEqual([404, 404])
        var proposal = (await get('/api/vulnerability-proposals?status=all', cookies['rob-other'])).find(p => p.title === 'rob-stolen-image')
        expect((await send({cookie: 'rob-other', method: 'delete', path: `/api/vulnerability-proposals/${proposal._id}`})).status).toBe(200)
      })

      it('Copy of the audit (clone) and content copied to another audit: readable by their users', async () => {
        var response = await send({cookie: 'rob-user', method: 'post', path: `/api/audits/${auditId}/clone`, body: {name: 'rob-images-clone'}})
        expect(response.status).toBe(201)
        var cloneId = response.body.datas.audit._id
        var copyId = (await send({cookie: 'rob-user', method: 'post', path: '/api/audits', body: {name: 'rob-images-copy', language: 'rob-lang', auditType: 'rob-type'}})).body.datas.audit._id
        try {
          expect((await send({cookie: 'rob-user', method: 'post', path: `/api/audits/${copyId}/findings`, body: {title: 'rob-copied', description: withImage(imageId)}})).status).toBe(200)
          for (var id of [cloneId, copyId]) {
            expect(await status(cookies['rob-other'])).toEqual([404, 404])
            expect((await send({cookie: 'rob-user', method: 'put', path: `/api/audits/${id}/general`, body: {collaborators: [{_id: ids['rob-other']}]}})).status).toBe(200)
            expect(await status(cookies['rob-other'])).toEqual([200, 200])
            expect((await send({cookie: 'rob-user', method: 'put', path: `/api/audits/${id}/general`, body: {collaborators: []}})).status).toBe(200)
          }
        }
        finally {
          for (var id of [cloneId, copyId])
            await send({cookie: 'rob-user', method: 'delete', path: `/api/audits/${id}`})
        }
      })

      it('Same image uploaded in another audit: readable by the users of this audit', async () => {
        var response = await send({cookie: 'rob-other', method: 'post', path: '/api/images', body: {value: png('rob-image-access'), auditId: otherAuditId}})
        expect(response.body.datas._id).toBe(imageId)
        expect(await status(cookies['rob-other'])).toEqual([200, 200])
        expect(await status(cookies['rob-user'])).toEqual([200, 200])
      })

      it('Image of a vulnerability created from a finding: shared with all the users', async () => {
        var response = await send({cookie: 'rob-user', method: 'post', path: '/api/images', body: {value: png('rob-image-shared'), auditId: auditId}})
        var sharedId = response.body.datas._id
        try {
          expect(await status(cookies['rob-other'], sharedId)).toEqual([404, 404])
          response = await send({cookie: 'rob-user', method: 'post', path: '/api/vulnerabilities/finding/rob-lang', body: {title: 'rob-shared-image', description: withImage(sharedId)}})
          expect(response.status).toBe(201)
          expect(await status(cookies['rob-other'], sharedId)).toEqual([200, 200])
        }
        finally {
          var proposal = (await get('/api/vulnerability-proposals?status=all', cookies['rob-user'])).find(p => p.title === 'rob-shared-image')
          if (proposal) await send({cookie: 'rob-user', method: 'delete', path: `/api/vulnerability-proposals/${proposal._id}`})
          await admin('delete', `/api/images/${sharedId}`)
        }
      })
    })

    describe('Migration of the images stored before their access control', () => {
      var migrations = mongoose.connection.collection('migrations')
      var MIGRATION = 'image-access-from-references'
      var runMigrations = require('../src/lib/migrations').runMigrations
      var auditId, legacyCopyId, vulnId, proposalId
      var imageIds = {}
      var png = (text) => `data:image/png;base64,${Buffer.concat([Buffer.from(helpers.PNG_BASE64, 'base64'), Buffer.from(text)]).toString('base64')}`
      var withImage = (id) => `<p>Proof</p><img src="${id}" alt="proof">`
      var status = async (id) => (await request(app).get(`/api/images/download/${id}`).set('Cookie', cookies['rob-other'])).status

      beforeAll(async () => {
        auditId = (await send({cookie: 'rob-user', method: 'post', path: '/api/audits', body: {name: 'rob-legacy', language: 'rob-lang', auditType: 'rob-type'}})).body.datas.audit._id
        for (var name of ['copy', 'vulnerability', 'proposal', 'planted'])
          imageIds[name] = (await send({cookie: 'rob-user', method: 'post', path: '/api/images', body: {value: png(`rob-legacy-${name}`), auditId: auditId}})).body.datas._id
        // Data written before the upgrade (no grant): copy of the audit (clone or copied content) of another user...
        legacyCopyId = (await send({cookie: 'rob-other', method: 'post', path: '/api/audits', body: {name: 'rob-legacy-copy', language: 'rob-lang', auditType: 'rob-type'}})).body.datas.audit._id
        await mongoose.model('Audit').updateOne({_id: legacyCopyId}, {$push: {findings: {title: 'rob-legacy-copied', description: withImage(imageIds.copy)}}})
        // ... vulnerability created from a finding...
        vulnId = (await mongoose.model('Vulnerability').collection.insertOne({status: 0, details: [{locale: 'rob-lang', title: 'rob-legacy-vuln', description: withImage(imageIds.vulnerability)}]})).insertedId
        // ... pending proposal made from a finding (update of a vulnerability: images not shared until accepted)
        expect((await send({cookie: 'rob-user', method: 'post', path: '/api/vulnerabilities/finding/rob-lang', body: {title: 'rob-vuln', description: withImage(imageIds.proposal)}})).status).toBe(200)
        proposalId = (await get('/api/vulnerability-proposals?status=pending', cookies['rob-user'])).find(p => p.title === 'rob-vuln')._id
      })
      afterAll(async () => {
        await send({cookie: 'rob-user', method: 'delete', path: `/api/vulnerability-proposals/${proposalId}`})
        await admin('delete', `/api/vulnerabilities/${vulnId}`)
        for (var [username, id] of [['rob-user', auditId], ['rob-other', legacyCopyId]])
          await send({cookie: username, method: 'delete', path: `/api/audits/${id}`})
        for (var id of Object.values(imageIds))
          await admin('delete', `/api/images/${id}`)
      })

      it('Before the migration: images of the audit referenced elsewhere not readable', async () => {
        for (var name of ['copy', 'vulnerability', 'proposal'])
          expect([name, await status(imageIds[name])]).toEqual([name, 404])
      })

      it('Migration run once at the start: accesses of the references present at the upgrade granted', async () => {
        await migrations.deleteMany({name: MIGRATION}) // Done at the start of the test server on the empty database
        await runMigrations()
        expect(await migrations.countDocuments({name: MIGRATION})).toBe(1)
        for (var name of ['copy', 'vulnerability', 'proposal'])
          expect([name, await status(imageIds[name])]).toEqual([name, 200])
        // Image referenced by its own audit only: unchanged
        expect(await status(imageIds.planted)).toBe(404)
      })

      it('Reference planted after the migration: not granted, the migration does not run again', async () => {
        expect((await send({cookie: 'rob-other', method: 'post', path: `/api/audits/${legacyCopyId}/findings`, body: {title: 'rob-planted', description: withImage(imageIds.planted)}})).status).toBe(200)
        await runMigrations()
        expect(await status(imageIds.planted)).toBe(404)
        expect(await migrations.countDocuments({name: MIGRATION})).toBe(1)
      })
    })

    describe('Restore of a backup made before the access control of the images', () => {
      var migrations = mongoose.connection.collection('migrations')
      var MIGRATION = require('../src/lib/migrations').IMAGE_ACCESS
      var auditId, copyId, imageIds = {}, backups = [], doneAt
      var png = (text) => `data:image/png;base64,${Buffer.concat([Buffer.from(helpers.PNG_BASE64, 'base64'), Buffer.from(text)]).toString('base64')}`
      var withImage = (id) => `<p>Proof</p><img src="${id}" alt="proof">`
      var status = async (id) => (await request(app).get(`/api/images/download/${id}`).set('Cookie', cookies['rob-other'])).status
      // Backup of the audits and their images, restored in merge mode (the other data is kept)
      var backupAndRestore = async () => {
        var response = await admin('post', '/api/backups', {name: 'rob-image-access', categories: ['audits']})
        expect(response.status).toBe(201)
        backups.push(response.body.datas.id)
        response = await admin('post', `/api/backups/${response.body.datas.id}/restore`, {mode: 'merge', categories: ['audits', 'images']})
        expect(answer(response)).toMatch(/^200 /)
      }

      beforeAll(async () => {
        if (!await migrations.findOne({name: MIGRATION}))
          await require('../src/lib/migrations').runMigrations()
        doneAt = (await migrations.findOne({name: MIGRATION})).date
        auditId = (await send({cookie: 'rob-user', method: 'post', path: '/api/audits', body: {name: 'rob-restore', language: 'rob-lang', auditType: 'rob-type'}})).body.datas.audit._id
        for (var name of ['legacy', 'planted'])
          imageIds[name] = (await send({cookie: 'rob-user', method: 'post', path: '/api/images', body: {value: png(`rob-restore-${name}`), auditId: auditId}})).body.datas._id
        copyId = (await send({cookie: 'rob-other', method: 'post', path: '/api/audits', body: {name: 'rob-restore-copy', language: 'rob-lang', auditType: 'rob-type'}})).body.datas.audit._id
      })
      afterAll(async () => {
        await migrations.updateOne({name: MIGRATION}, {$set: {date: doneAt}})
        for (var id of backups)
          await admin('delete', `/api/backups/${id}`)
        for (var [username, id] of [['rob-user', auditId], ['rob-other', copyId]])
          await send({cookie: username, method: 'delete', path: `/api/audits/${id}`})
        for (var id of Object.values(imageIds))
          await admin('delete', `/api/images/${id}`)
      })

      it('Backup made before the update: accesses of its references granted', async () => {
        // Copy made before the update (reference without grant), backup dated before the migration of the update
        await mongoose.model('Audit').updateOne({_id: copyId}, {$push: {findings: {title: 'rob-legacy-copied', description: withImage(imageIds.legacy)}}})
        await migrations.updateOne({name: MIGRATION}, {$set: {date: new Date(Date.now() + 24 * 3600 * 1000)}})
        expect(await status(imageIds.legacy)).toBe(404)
        await backupAndRestore()
        expect(await status(imageIds.legacy)).toBe(200)
      }, 60000)

      it('Backup made after the update: a planted reference grants nothing', async () => {
        await migrations.updateOne({name: MIGRATION}, {$set: {date: doneAt}})
        expect((await send({cookie: 'rob-other', method: 'post', path: `/api/audits/${copyId}/findings`, body: {title: 'rob-planted', description: withImage(imageIds.planted)}})).status).toBe(200)
        await backupAndRestore()
        expect(await status(imageIds.planted)).toBe(404)
        expect(await status(imageIds.legacy)).toBe(200)
      }, 60000)
    })

    describe('Accounts: password, two-factor authentication, logout', () => {
      it('Empty password in the update of a user: password unchanged (never saved without hash)', async () => {
        expect((await admin('put', `/api/users/${ids['rob-other']}`, {password: '', firstname: 'Rob'})).status).toBe(200)
        expect((await request(app).post('/api/users/token').send({username: 'rob-other', password: PASSWORD})).status).toBe(200)
        expect((await admin('put', `/api/users/${ids['rob-other']}`, {password: ['Rob54321']})).status).toBe(422)
        var stored = await mongoose.model('User').findById(ids['rob-other']).select('password').lean()
        expect(stored.password).toMatch(/^\$2[aby]\$10\$/)
      })

      it('Two-factor authentication enabled: the QR code shown again is the one of the configured secret', async () => {
        var OTPAuth = require('otpauth')
        expect((await admin('post', '/api/users', [{username: 'rob-totp', password: PASSWORD, firstname: 'Rob', lastname: 'Totp'}])).status).toBe(201)
        var cookie = await helpers.login('rob-totp', PASSWORD)
        try {
          // Before the setup: the same secret proposed on each request (also to concurrent requests)
          var proposed = (await Promise.all([get('/api/users/totp', cookie), get('/api/users/totp', cookie)])).map(datas => datas.totpSecret)
          var secret = (await get('/api/users/totp', cookie)).totpSecret
          expect(proposed).toEqual([secret, secret])
          var code =new OTPAuth.TOTP({algorithm: 'SHA1', digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secret)}).generate()
          expect((await request(app).post('/api/users/totp').set('Cookie', cookie).send({totpToken: code, totpSecret: secret})).status).toBe(200)
          for (var i = 0; i < 2; i++)
            expect((await get('/api/users/totp', cookie)).totpSecret).toBe(secret)
          // Enabled twice: refused
          expect((await request(app).post('/api/users/totp').set('Cookie', cookie).send({totpToken: code, totpSecret: secret})).status).toBe(422)
        }
        finally {
          await admin('put', `/api/users/${await helpers.userId(cookies.admin, 'rob-totp')}`, {enabled: false})
        }
      })

      it('Logout clears the refresh token cookie (same path as when it was set)', async () => {
        var login = await request(app).post('/api/users/token').send({username: 'rob-user', password: PASSWORD})
        var refreshCookie = login.headers['set-cookie'].find(c => c.startsWith('refreshToken='))
        expect(refreshCookie).toContain('Path=/api/users/refreshtoken')
        var response = await request(app).delete('/api/users/refreshtoken').set('Cookie', [refreshCookie.split(';')[0]])
        expect(response.status).toBe(200)
        var cleared = response.headers['set-cookie'].find(c => c.startsWith('refreshToken='))
        expect(cleared).toMatch(/^refreshToken=;/)
        expect(cleared).toContain('Path=/api/users/refreshtoken')
        expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/)
      })
    })

    describe('Editing sessions when the reviews are enabled or disabled', () => {
      var original, calls

      beforeAll(() => {
        original = app.get('resetCollaborationSessions')
        app.set('resetCollaborationSessions', (...args) => calls.push(args))
      })
      afterAll(async () => {
        app.set('resetCollaborationSessions', original)
        await admin('put', '/api/settings/revert')
      })
      beforeEach(() => { calls = [] })

      var reviews = (enabled) => ({enabled: enabled, public: {mandatoryReview: false, minReviewers: 1, blockApprovalWithOpenComments: false}, private: {removeApprovalsUponUpdate: false}})

      it('Sessions of all the documents reset when the reviews are enabled, not when another setting changes', async () => {
        expect((await admin('put', '/api/settings', {reviews: reviews(true)})).status).toBe(200)
        expect(calls).toEqual([[]])
        calls = []
        expect((await admin('put', '/api/settings', {reviews: {...reviews(true), public: {...reviews(true).public, minReviewers: 2}}})).status).toBe(200)
        expect(calls).toEqual([])
      })

      it('Sessions reset when the reviews are disabled (update or default settings)', async () => {
        expect((await admin('put', '/api/settings/revert')).status).toBe(200)
        expect(calls).toEqual([[]])
        calls = []
        expect((await admin('put', '/api/settings/revert')).status).toBe(200)
        expect(calls).toEqual([])
      })
    })

    describe('Server state after the malformed requests', () => {
      it('Server still answers and the audit is intact', async () => {
        expect((await request(app).get('/api/users/init')).status).toBe(200)
        var response = await request(app).get(`/api/audits/${ids.audit}`).set('Cookie', cookies['rob-user'])
        expect(answer(response)).toMatch(/^200 /)
        var audit = response.body.datas
        expect(audit.name).toBe('rob-audit')
        expect(audit.findings.map(f => f.title).sort()).toEqual(['rob-finding-1', 'rob-finding-2', 'rob-finding-3'])
        expect(audit.findings.every(f => f._id && f.title)).toBe(true)
      })

      it('No prototype pollution', () => {
        expect(({}).robPolluted).toBeUndefined()
        expect(Object.prototype.robPolluted).toBeUndefined()
        expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(PROTO_KEYS)
      })
    })
  })
}
