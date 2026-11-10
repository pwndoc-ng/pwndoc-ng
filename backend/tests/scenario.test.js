/*
  End-to-end mission of a pentest firm through the API, every step checked with the state returned by the API and
  the access of each user:
  - the admin prepares the custom data (languages, audit type, vulnerability types and categories, custom fields,
    section), the users of each role, the company and its client, the report template, the settings of the reviews
    and a vulnerabilities database in two languages;
  - a pentester creates the audit, fills the general information, imports a network scan, adds findings from the
    database and by hand, with custom fields, sorts them; a collaborator contributes;
  - review: comments of the reviewers, corrections, approvals until the APPROVED state, then report generation;
  - the vulnerabilities database is updated from the findings (proposals reviewed by the admin);
  - the audit is cloned for the next mission, findings and audits are deleted.
  Users created: scn-* (disabled at the end). At the end: no more data created here, settings reverted, custom role removed.
*/

module.exports = function(request, app) {
  var helpers = require('./helpers')(request, app)
  var CVSS = helpers.CVSS
  var acl = require('../src/lib/auth').acl
  var mongoose = require('mongoose')
  var fs = require('fs')
  var path = require('path')
  var PizZip = require('pizzip')

  var DEFAULT_TEMPLATE = fs.readFileSync(path.join(__dirname, '..', 'report-templates', 'Default Template.docx'))
  var PASSWORD = 'Scenario1'

  describe('Scenario Suite Tests: pentest mission', () => {
    var cookies = {}
    var ids = {}
    var auditId, cloneId

    var call = (username, method, url, body) => {
      var req = request(app)[method](url).set('Cookie', cookies[username])
      return body === undefined ? req : req.send(body)
    }
    var admin = (method, url, body) => call('admin', method, url, body)
    var pentester = (method, url, body) => call('scn-pentester', method, url, body)
    var getAudit = async (username = 'scn-pentester', id = auditId) => {
      var response = await call(username, 'get', `/api/audits/${id}`)
      expect(response.status).toBe(200)
      return response.body.datas
    }
    var findingIdOf = async (title) => (await getAudit()).findings.find(f => f.title === title)._id
    var titles = async (id = auditId) => (await getAudit('scn-pentester', id)).findings.map(f => f.title)
    var setState = (username, state) => call(username, 'put', `/api/audits/${auditId}/updateReadyForReview`, {state: state})
    var generate = (username) => request(app).get(`/api/audits/${auditId}/generate`).set('Cookie', cookies[username]).buffer(true).parse(helpers.binary)
    var comments = async (username = 'scn-pentester') => (await call(username, 'get', `/api/audits/${auditId}/comments`)).body.datas

    // Users of the firm: username, role
    var USERS = [
      ['scn-pentester', 'user'],
      ['scn-collab', 'user'],
      ['scn-reviewer', 'scn-reviewer'],
      ['scn-manager', 'report'],
      ['scn-lead', 'admin'],
      ['scn-outsider', 'user']
    ]
    var SCN_REVIEWER_ROLE = {inherits: ['user'], allows: ['audits:review']}

    // Who can open the audit: expected 200 / 404 for each user
    var expectVisibility = async (expected) => {
      var result = {}
      for (var username of Object.keys(expected)) {
        var response = await call(username, 'get', `/api/audits/${auditId}`)
        var listed = (await call(username, 'get', '/api/audits')).body.datas.some(a => a._id === auditId)
        result[username] = `${response.status}${listed ? ' listed' : ''}`
      }
      expect(result).toEqual(expected)
    }

    beforeAll(async () => {
      acl.roles['scn-reviewer'] = SCN_REVIEWER_ROLE
      cookies.admin = await helpers.login('admin', 'Admin123')
    })

    afterAll(async () => {
      await admin('put', '/api/settings/revert')
      for (var id of [auditId, cloneId])
        if (id) await admin('delete', `/api/audits/${id}`)
      for (var title of ['scn-SQL injection', 'scn-Reflected XSS', 'scn-Missing security headers', 'scn-Default credentials on the database']) {
        var vuln = (await admin('get', '/api/vulnerabilities')).body.datas.find(v => v.details.some(d => d.title === title))
        if (vuln) await admin('delete', `/api/vulnerabilities/${vuln._id}`)
      }
      if (ids.image) await admin('delete', `/api/images/${ids.image}`)
      if (ids.template) await admin('delete', `/api/templates/${ids.template}`)
      await admin('delete', '/api/data/audit-types/scn-Pentest')
      for (var field of ['context', 'asset', 'exploitation', 'summary'])
        if (ids[field]) await admin('delete', `/api/data/custom-fields/${ids[field]}`)
      for (var category of ['scn-Infrastructure', 'scn-Application'])
        await admin('delete', `/api/data/vulnerability-categories/${category}`)
      await admin('delete', '/api/data/vulnerability-types/scn-Web?locale=scn-en')
      await admin('delete', '/api/data/vulnerability-types/scn-Web?locale=scn-fr')
      for (var locale of ['scn-en', 'scn-fr'])
        await admin('delete', `/api/data/languages/${locale}`)
      if (ids.client) await admin('delete', `/api/clients/${ids.client}`)
      if (ids.company) await admin('delete', `/api/companies/${ids.company}`)
      await admin('delete', '/api/data/sections/scn_conclusion/scn-en')
      for (var [username] of USERS)
        if (ids[username]) await admin('put', `/api/users/${ids[username]}`, {enabled: false})
      delete acl.roles['scn-reviewer']
    })

    describe('Preparation by the admin', () => {
      it('Creates the users of each role', async () => {
        var response = await admin('post', '/api/users', USERS.map(([username, role]) => ({
          username: username, password: PASSWORD, firstname: username.split('-')[1], lastname: 'Firm', email: `${username}@firm.example`, role: role
        })))
        expect(response.status).toBe(201)
        for (var [username, role] of USERS) {
          cookies[username] = await helpers.login(username, PASSWORD)
          ids[username] = await helpers.userId(cookies.admin, username)
          expect((await call(username, 'get', '/api/users/me')).body.datas).toMatchObject({username: username, role: role, enabled: true})
        }
        // Reviewers selectable for the audits: users allowed to review
        var reviewers = (await call('scn-pentester', 'get', '/api/users/reviewers')).body.datas.map(u => u.username)
        expect(reviewers).toEqual(expect.arrayContaining(['scn-reviewer', 'scn-lead']))
        expect(reviewers).not.toContain('scn-pentester')
        expect(reviewers).not.toContain('scn-manager')
      })

      it('Only the admins prepare the custom data', async () => {
        expect((await pentester('post', '/api/data/languages', {locale: 'scn-en', language: 'Scenario English'})).status).toBe(403)
        expect((await call('scn-manager', 'post', '/api/data/audit-types', {name: 'scn-Pentest', templates: []})).status).toBe(403)
        expect((await call('scn-reviewer', 'post', '/api/vulnerabilities', [{details: [{locale: 'scn-en', title: 'scn-Reviewer vuln'}]}])).status).toBe(403)
      })

      it('Creates the languages, the report template and the audit type', async () => {
        expect((await admin('post', '/api/data/languages', {locale: 'scn-en', language: 'Scenario English'})).status).toBe(201)
        // A second admin of the firm
        expect((await call('scn-lead', 'post', '/api/data/languages', {locale: 'scn-fr', language: 'Scénario Français'})).status).toBe(201)
        var languages = (await pentester('get', '/api/data/languages')).body.datas
        expect(languages.filter(l => l.locale.startsWith('scn-'))).toEqual([{locale: 'scn-en', language: 'Scenario English'}, {locale: 'scn-fr', language: 'Scénario Français'}])

        var response = await admin('post', '/api/templates', {name: 'scn-Template', ext: 'docx', file: DEFAULT_TEMPLATE.toString('base64')})
        expect(response.status).toBe(201)
        ids.template = response.body.datas._id

        expect((await admin('post', '/api/data/sections', {field: 'scn_conclusion', name: 'Scenario conclusion', icon: 'flag'})).status).toBe(201)
        response = await admin('post', '/api/data/audit-types', {
          name: 'scn-Pentest',
          templates: [{template: ids.template, locale: 'scn-en'}, {template: ids.template, locale: 'scn-fr'}],
          sections: ['scn_conclusion']
        })
        expect(response.status).toBe(201)
        var auditType = (await pentester('get', '/api/data/audit-types')).body.datas.find(t => t.name === 'scn-Pentest')
        expect(auditType.sections).toEqual(['scn_conclusion'])
        expect(auditType.templates.map(t => [t.locale, t.template])).toEqual([['scn-en', ids.template], ['scn-fr', ids.template]])
      })

      it('Creates the vulnerability types and categories', async () => {
        expect((await admin('post', '/api/data/vulnerability-types', {name: 'scn-Web', locale: 'scn-en', description: 'Web applications'})).status).toBe(201)
        expect((await admin('post', '/api/data/vulnerability-types', {name: 'scn-Web', locale: 'scn-fr', description: 'Applications web'})).status).toBe(201)
        // Same name in the same language: refused
        expect((await admin('post', '/api/data/vulnerability-types', {name: 'scn-Web', locale: 'scn-en'})).status).toBe(422)
        expect((await admin('post', '/api/data/vulnerability-categories', {name: 'scn-Infrastructure'})).status).toBe(201)
        expect((await admin('post', '/api/data/vulnerability-categories', {name: 'scn-Application', sortValue: 'priority', sortOrder: 'asc', sortAuto: true})).status).toBe(201)
        var categories = (await pentester('get', '/api/data/vulnerability-categories')).body.datas.filter(c => c.name.startsWith('scn-'))
        expect(categories.map(c => [c.name, c.sortValue, c.sortOrder, c.sortAuto])).toEqual([
          ['scn-Infrastructure', 'cvssScore', 'desc', true], ['scn-Application', 'priority', 'asc', true]
        ])
      })

      it('Creates the custom fields of the audits, findings, vulnerabilities and sections', async () => {
        var create = async (field) => {
          var response = await admin('post', '/api/data/custom-fields', field)
          expect(response.status).toBe(201)
          return response.body.datas._id
        }
        ids.context = await create({fieldType: 'text', label: 'scn-Context', display: 'general', text: [{locale: 'scn-en', value: '<p>Default context</p>'}, {locale: 'scn-fr', value: '<p>Contexte par défaut</p>'}]})
        ids.asset = await create({fieldType: 'input', label: 'scn-Asset', display: 'finding', required: true})
        ids.exploitation = await create({fieldType: 'select', label: 'scn-Exploitation', display: 'vulnerability', options: [{locale: 'scn-en', value: 'Easy'}, {locale: 'scn-en', value: 'Hard'}, {locale: 'scn-fr', value: 'Facile'}]})
        ids.summary = await create({fieldType: 'text', label: 'scn-Summary', display: 'section', displaySub: 'Scenario conclusion', text: [{locale: 'scn-en', value: '<p>Summary to write</p>'}]})
        var fields = (await pentester('get', '/api/data/custom-fields')).body.datas.filter(f => f.label.startsWith('scn-'))
        expect(fields.map(f => [f.label, f.display, f.fieldType]).sort()).toEqual([
          ['scn-Asset', 'finding', 'input'], ['scn-Context', 'general', 'text'], ['scn-Exploitation', 'vulnerability', 'select'], ['scn-Summary', 'section', 'text']
        ])
        expect(fields.find(f => f.label === 'scn-Asset').required).toBe(true)
      })

      it('Creates the company and its client', async () => {
        expect((await admin('post', '/api/companies', [{name: 'scn-Bank', shortName: 'SB', address: '1 rue de la Paix', postalCode: '75002', city: 'Paris'}])).status).toBe(201)
        ids.company = (await pentester('get', '/api/companies')).body.datas.find(c => c.name === 'scn-Bank')._id
        // Clients are managed by the pentesters too
        expect((await pentester('post', '/api/clients', [{email: 'ciso@scn-bank.example', firstname: 'Claire', lastname: 'Ciso', title: 'CISO', company: {name: 'scn-Bank'}}])).status).toBe(201)
        var client = (await pentester('get', '/api/clients')).body.datas.find(c => c.email === 'ciso@scn-bank.example')
        expect(client).toMatchObject({firstname: 'Claire', lastname: 'Ciso', title: 'CISO', company: {name: 'scn-Bank'}})
        ids.client = client._id
      })

      it('Fills the vulnerabilities database in two languages', async () => {
        var exploitation = (text) => [{customField: ids.exploitation, text: text}]
        var response = await admin('post', '/api/vulnerabilities', [
          {cvssv3: CVSS.critical, priority: 4, remediationComplexity: 1, category: 'scn-Infrastructure', details: [
            {locale: 'scn-en', title: 'scn-SQL injection', vulnType: 'scn-Web', description: '<p>SQL injection</p>', remediation: '<p>Use prepared statements</p>', references: ['https://owasp.org/www-community/attacks/SQL_Injection'], customFields: exploitation('Easy')},
            {locale: 'scn-fr', title: 'scn-Injection SQL', vulnType: 'scn-Web', description: '<p>Injection SQL</p>', remediation: '<p>Utiliser des requêtes préparées</p>', customFields: exploitation('Facile')}
          ]},
          {cvssv3: CVSS.medium, priority: 2, remediationComplexity: 2, category: 'scn-Application', details: [
            {locale: 'scn-en', title: 'scn-Reflected XSS', vulnType: 'scn-Web', description: '<p>Reflected XSS</p>', remediation: '<p>Encode the outputs</p>'},
            {locale: 'scn-fr', title: 'scn-XSS réfléchie', vulnType: 'scn-Web', description: '<p>XSS réfléchie</p>'}
          ]},
          {cvssv3: CVSS.low, details: [{locale: 'scn-en', title: 'scn-Missing security headers', description: '<p>Missing headers</p>'}]}
        ])
        expect(response.status).toBe(201)

        var english = (await pentester('get', '/api/vulnerabilities/scn-en')).body.datas.filter(v => v.detail.title.startsWith('scn-'))
        expect(english.map(v => v.detail.title).sort()).toEqual(['scn-Missing security headers', 'scn-Reflected XSS', 'scn-SQL injection'])
        var french = (await pentester('get', '/api/vulnerabilities/scn-fr')).body.datas.filter(v => v.detail.title.startsWith('scn-'))
        expect(french.map(v => v.detail.title).sort()).toEqual(['scn-Injection SQL', 'scn-XSS réfléchie'])
        // Validated vulnerabilities (status 0)
        var all = (await pentester('get', '/api/vulnerabilities')).body.datas.filter(v => v.details.some(d => d.title.startsWith('scn-')))
        expect(all.map(v => v.status)).toEqual([0, 0, 0])
        ids.sqli = english.find(v => v.detail.title === 'scn-SQL injection')._id
      })

      it('Enables the reviews: mandatory, two approvals, open comments block the approval', async () => {
        expect((await call('scn-lead', 'put', '/api/settings', {reviews: {
          enabled: true,
          public: {mandatoryReview: true, minReviewers: 2, blockApprovalWithOpenComments: true},
          private: {removeApprovalsUponUpdate: false}
        }})).status).toBe(200)
        expect((await pentester('get', '/api/settings/public')).body.datas.reviews).toEqual({enabled: true, public: {mandatoryReview: true, minReviewers: 2, blockApprovalWithOpenComments: true}})
        expect((await pentester('put', '/api/settings', {reviews: {enabled: false}})).status).toBe(403)
      })
    })

    describe('Audit creation and general information', () => {
      it('The pentester creates the audit: template, sections and custom fields of the audit type', async () => {
        var response = await pentester('post', '/api/audits', {name: 'scn-Mission Bank 2026', language: 'scn-en', auditType: 'scn-Pentest'})
        expect(response.status).toBe(201)
        auditId = response.body.datas.audit._id
        var audit = await getAudit()
        expect(audit).toMatchObject({name: 'scn-Mission Bank 2026', language: 'scn-en', auditType: 'scn-Pentest', state: 'EDIT', findings: [], approvals: []})
        expect(audit.creator).toMatchObject({_id: ids['scn-pentester'], username: 'scn-pentester'})
        expect(audit.template._id).toBe(ids.template)
        var section = audit.sections.find(s => s.field === 'scn_conclusion')
        expect(section.name).toBe('Scenario conclusion')
        expect(section.customFields.map(f => [f.customField._id, f.text])).toEqual([[ids.summary, '<p>Summary to write</p>']])
        expect(audit.customFields.find(f => f.customField._id === ids.context).text).toBe('<p>Default context</p>')
        // Sort options of the categories
        expect(audit.sortFindings.find(o => o.category === 'scn-Application')).toEqual({category: 'scn-Application', sortValue: 'priority', sortOrder: 'asc', sortAuto: true})
      })

      it('An audit in the other language gets its template, default texts and vulnerabilities', async () => {
        var response = await call('scn-collab', 'post', '/api/audits', {name: 'scn-Mission FR', language: 'scn-fr', auditType: 'scn-Pentest'})
        expect(response.status).toBe(201)
        var id = response.body.datas.audit._id
        try {
          var audit = await getAudit('scn-collab', id)
          expect(audit.template._id).toBe(ids.template)
          expect(audit.customFields.find(f => f.customField._id === ids.context).text).toBe('<p>Contexte par défaut</p>')
          expect(audit.sections[0].customFields.map(f => f.text)).toEqual(['']) // No default text in French
          var vuln = (await call('scn-collab', 'get', '/api/vulnerabilities/scn-fr')).body.datas.find(v => v.detail.title === 'scn-Injection SQL')
          response = await call('scn-collab', 'post', `/api/audits/${id}/findings`, {title: vuln.detail.title, description: vuln.detail.description, cvssv3: vuln.cvssv3, category: vuln.category, customFields: vuln.detail.customFields})
          expect(response.status).toBe(200)
          var finding = (await getAudit('scn-collab', id)).findings[0]
          expect(finding).toMatchObject({title: 'scn-Injection SQL', description: '<p>Injection SQL</p>', category: 'scn-Infrastructure'})
          expect(finding.customFields.map(f => f.text)).toEqual(['Facile'])
          // Not visible to the pentester of the other audit
          expect((await pentester('get', `/api/audits/${id}`)).status).toBe(404)
        }
        finally {
          expect((await call('scn-collab', 'delete', `/api/audits/${id}`)).status).toBe(200)
        }
      })

      it('Only the creator and the users allowed to read all the audits see it', async () => {
        await expectVisibility({
          'scn-pentester': '200 listed', 'scn-collab': '404', 'scn-reviewer': '404', 'scn-manager': '200 listed',
          'scn-lead': '200 listed', 'scn-outsider': '404'
        })
      })

      it('Reviewers cannot be collaborators', async () => {
        var response = await pentester('put', `/api/audits/${auditId}/general`, {collaborators: [{_id: ids['scn-collab']}], reviewers: [{_id: ids['scn-collab']}]})
        expect(response.status).toBe(422)
        response = await pentester('put', `/api/audits/${auditId}/general`, {reviewers: [{_id: ids['scn-pentester']}]})
        expect(response.status).toBe(422)
        expect((await getAudit()).reviewers).toEqual([])
      })

      it('Fills the general information: dates, client, company, scope, team, custom field', async () => {
        var response = await pentester('put', `/api/audits/${auditId}/general`, {
          date: '2026-11-09', date_start: '2026-11-02', date_end: '2026-11-06',
          client: ids.client, company: {_id: ids.company},
          scope: ['10.0.0.0/24', 'bank.example'],
          collaborators: [{_id: ids['scn-collab']}],
          reviewers: [{_id: ids['scn-reviewer']}, {_id: ids['scn-lead']}],
          customFields: [{customField: ids.context, text: '<p>Internal pentest of the bank network</p>'}]
        })
        expect(response.status).toBe(200)

        var general = (await pentester('get', `/api/audits/${auditId}/general`)).body.datas
        expect(general).toMatchObject({name: 'scn-Mission Bank 2026', date: '2026-11-09', date_start: '2026-11-02', date_end: '2026-11-06', language: 'scn-en', scope: ['10.0.0.0/24', 'bank.example']})
        expect(general.client).toMatchObject({email: 'ciso@scn-bank.example', firstname: 'Claire', company: {name: 'scn-Bank'}})
        expect(general.company).toMatchObject({_id: ids.company, name: 'scn-Bank', city: 'Paris'})
        expect(general.collaborators.map(u => u.username)).toEqual(['scn-collab'])
        expect(general.reviewers.map(u => u.username)).toEqual(['scn-reviewer', 'scn-lead'])
        expect(general.customFields).toEqual([{customField: ids.context, text: '<p>Internal pentest of the bank network</p>'}])
      })

      it('The team now sees the audit', async () => {
        await expectVisibility({
          'scn-pentester': '200 listed', 'scn-collab': '200 listed', 'scn-reviewer': '200 listed', 'scn-manager': '200 listed',
          'scn-lead': '200 listed', 'scn-outsider': '404'
        })
        var listed = (await call('scn-collab', 'get', '/api/audits')).body.datas.find(a => a._id === auditId)
        expect(listed).toMatchObject({name: 'scn-Mission Bank 2026', state: 'EDIT', creator: {username: 'scn-pentester'}, company: {name: 'scn-Bank'}})
        expect(listed.collaborators.map(u => u.username)).toEqual(['scn-collab'])
        expect(listed.reviewers.map(u => u.username)).toEqual(['scn-reviewer', 'scn-lead'])
      })

      it('Users outside the team cannot change the audit', async () => {
        expect((await call('scn-outsider', 'put', `/api/audits/${auditId}/general`, {name: 'Hijacked'})).status).toBe(404)
        expect((await call('scn-reviewer', 'put', `/api/audits/${auditId}/general`, {name: 'Changed by reviewer'})).status).toBe(404)
        expect((await call('scn-manager', 'put', `/api/audits/${auditId}/general`, {name: 'Changed by manager'})).status).toBe(404)
        expect((await getAudit()).name).toBe('scn-Mission Bank 2026')
      })
    })

    describe('Network scan import', () => {
      var SCAN = [
        {name: '10.0.0.0/24', hosts: [
          {hostname: 'db.bank.example', ip: '10.0.0.5', os: 'Linux', services: [
            {port: 5432, protocol: 'tcp', name: 'postgresql', product: 'PostgreSQL', version: '16.2'},
            {port: 22, protocol: 'tcp', name: 'ssh', product: 'OpenSSH', version: '9.6'}
          ]},
          {hostname: 'web.bank.example', ip: '10.0.0.10', os: 'Linux', services: [
            {port: 443, protocol: 'tcp', name: 'https', product: 'nginx', version: '1.27'},
            {port: 161, protocol: 'udp', name: 'snmp'}
          ]}
        ]},
        {name: 'bank.example', hosts: []}
      ]

      it('Hosts and services of the scan are saved in the scope', async () => {
        expect((await pentester('put', `/api/audits/${auditId}/network`, {scope: SCAN})).status).toBe(200)
        var network = (await call('scn-collab', 'get', `/api/audits/${auditId}/network`)).body.datas
        expect(network.scope).toEqual(SCAN.map(scope => ({...scope, hosts: scope.hosts.map(host => ({...host, _id: expect.any(String), services: host.services.map(s => ({...s, _id: expect.any(String)}))}))})))
        // General information: names of the scope only
        expect((await pentester('get', `/api/audits/${auditId}/general`)).body.datas.scope).toEqual(['10.0.0.0/24', 'bank.example'])
      })

      it('Editing the scope names keeps the hosts of the remaining scopes', async () => {
        expect((await pentester('put', `/api/audits/${auditId}/general`, {scope: ['10.0.0.0/24', 'bank.example', 'api.bank.example']})).status).toBe(200)
        var scope = (await pentester('get', `/api/audits/${auditId}/network`)).body.datas.scope
        expect(scope.map(s => [s.name, s.hosts.map(h => h.ip)])).toEqual([['10.0.0.0/24', ['10.0.0.5', '10.0.0.10']], ['bank.example', []], ['api.bank.example', []]])
      })

      it('Reviewers read the network but cannot change it', async () => {
        expect((await call('scn-reviewer', 'get', `/api/audits/${auditId}/network`)).status).toBe(200)
        expect((await call('scn-reviewer', 'put', `/api/audits/${auditId}/network`, {scope: []})).status).toBe(404)
        expect((await call('scn-outsider', 'get', `/api/audits/${auditId}/network`)).status).toBe(404)
        expect((await pentester('get', `/api/audits/${auditId}/network`)).body.datas.scope).toHaveLength(3)
      })
    })

    describe('Findings', () => {
      // Finding added from the vulnerabilities database, as done by the frontend
      var fromDatabase = async (title) => {
        var vuln = (await pentester('get', '/api/vulnerabilities/scn-en')).body.datas.find(v => v.detail.title === title)
        return pentester('post', `/api/audits/${auditId}/findings`, {
          title: vuln.detail.title, vulnType: vuln.detail.vulnType, description: vuln.detail.description,
          observation: vuln.detail.observation, remediation: vuln.detail.remediation, remediationComplexity: vuln.remediationComplexity,
          priority: vuln.priority, references: vuln.detail.references, cvssv3: vuln.cvssv3, category: vuln.category,
          customFields: vuln.detail.customFields
        })
      }

      it('Adds findings from the vulnerabilities database', async () => {
        expect((await fromDatabase('scn-Reflected XSS')).status).toBe(200)
        expect((await fromDatabase('scn-SQL injection')).status).toBe(200)
        expect((await fromDatabase('scn-Missing security headers')).status).toBe(200)
        var sqli = (await getAudit()).findings.find(f => f.title === 'scn-SQL injection')
        expect(sqli).toMatchObject({
          vulnType: 'scn-Web', description: '<p>SQL injection</p>', remediation: '<p>Use prepared statements</p>',
          cvssv3: CVSS.critical, priority: 4, remediationComplexity: 1, category: 'scn-Infrastructure', status: 1,
          references: ['https://owasp.org/www-community/attacks/SQL_Injection']
        })
        expect(sqli.customFields.map(f => [f.customField.label, f.text])).toEqual([['scn-Exploitation', 'Easy']])
      })

      it('Adds a finding by hand with its custom fields and a screenshot', async () => {
        // PNG of this scenario only (bytes after the end of the image): an identical image would be shared with other audits
        var png = Buffer.concat([Buffer.from(helpers.PNG_BASE64, 'base64'), Buffer.from('scn-psql')]).toString('base64')
        var response = await pentester('post', '/api/images', {value: `data:image/png;base64,${png}`, name: 'psql.png', auditId: auditId})
        expect(response.status).toBe(201)
        ids.image = response.body.datas._id
        response = await pentester('post', `/api/audits/${auditId}/findings`, {
          title: 'scn-Default credentials on the database', vulnType: 'scn-Web', category: 'scn-Infrastructure', cvssv3: CVSS.high,
          description: '<p>The database accepts the default credentials.</p>',
          poc: `<p>psql -U postgres</p><img src="${ids.image}" alt="psql">`, scope: '10.0.0.5:5432',
          remediation: '<p>Change the password</p>', remediationComplexity: 1, priority: 3,
          customFields: [{customField: ids.asset, text: 'db.bank.example'}, {customField: ids.exploitation, text: 'Easy'}]
        })
        expect(response.status).toBe(200)
        var finding = (await getAudit()).findings.find(f => f.title === 'scn-Default credentials on the database')
        expect(finding).toMatchObject({scope: '10.0.0.5:5432', priority: 3, status: 1})
        expect(finding.customFields.map(f => [f.customField.label, f.text])).toEqual([['scn-Asset', 'db.bank.example'], ['scn-Exploitation', 'Easy']])
      })

      it('Findings are numbered in order of creation', async () => {
        var audit = await getAudit()
        var identifiers = {}
        audit.findings.forEach(f => identifiers[f.title] = f.identifier)
        expect(identifiers).toEqual({'scn-Reflected XSS': 1, 'scn-SQL injection': 2, 'scn-Missing security headers': 3, 'scn-Default credentials on the database': 4})
      })

      it('Findings are sorted by category then by the sort option of the category', async () => {
        // scn-Infrastructure (CVSS score, descending), scn-Application, then the findings without category
        expect(await titles()).toEqual(['scn-SQL injection', 'scn-Default credentials on the database', 'scn-Reflected XSS', 'scn-Missing security headers'])
      })

      it('The collaborator adds a finding and writes the conclusion', async () => {
        var response = await call('scn-collab', 'post', `/api/audits/${auditId}/findings`, {title: 'scn-Weak TLS configuration', category: 'scn-Infrastructure', cvssv3: CVSS.low})
        expect(response.status).toBe(200)
        expect(await titles()).toEqual(['scn-SQL injection', 'scn-Default credentials on the database', 'scn-Weak TLS configuration', 'scn-Reflected XSS', 'scn-Missing security headers'])
        expect((await getAudit()).findings.find(f => f.title === 'scn-Weak TLS configuration').identifier).toBe(5)

        // As the frontend: the section is read, its custom fields are changed and sent back
        var sectionId = (await getAudit()).sections.find(s => s.field === 'scn_conclusion')._id
        var section = (await call('scn-collab', 'get', `/api/audits/${auditId}/sections/${sectionId}`)).body.datas
        section.customFields[0].text = '<p>The network is exposed.</p>'
        response = await call('scn-collab', 'put', `/api/audits/${auditId}/sections/${sectionId}`, {customFields: section.customFields})
        expect(response.status).toBe(200)
        response = await pentester('get', `/api/audits/${auditId}/sections/${sectionId}`)
        expect(response.body.datas.customFields.map(f => [f.customField._id, f.customField.label, f.text])).toEqual([[ids.summary, 'scn-Summary', '<p>The network is exposed.</p>']])
      })

      it('The reviewer reads the findings but cannot add or change them', async () => {
        var id = await findingIdOf('scn-SQL injection')
        expect((await call('scn-reviewer', 'get', `/api/audits/${auditId}/findings/${id}`)).body.datas.title).toBe('scn-SQL injection')
        expect((await call('scn-reviewer', 'post', `/api/audits/${auditId}/findings`, {title: 'scn-Reviewer finding'})).status).toBe(404)
        expect((await call('scn-reviewer', 'put', `/api/audits/${auditId}/findings/${id}`, {title: 'Changed'})).status).toBe(404)
        expect((await call('scn-reviewer', 'delete', `/api/audits/${auditId}/findings/${id}`)).status).toBe(404)
        expect((await call('scn-outsider', 'get', `/api/audits/${auditId}/findings/${id}`)).status).toBe(404)
        expect(await titles()).toHaveLength(5)
      })

      it('Updates a finding: observation, status, custom fields', async () => {
        var id = await findingIdOf('scn-SQL injection')
        var response = await pentester('put', `/api/audits/${auditId}/findings/${id}`, {
          observation: '<p>The parameter <code>user</code> of /login is injectable.</p>', status: 0,
          customFields: [{customField: ids.asset, text: 'web.bank.example'}, {customField: ids.exploitation, text: 'Easy'}]
        })
        expect(response.status).toBe(200)
        var finding = (await pentester('get', `/api/audits/${auditId}/findings/${id}`)).body.datas
        expect(finding).toMatchObject({title: 'scn-SQL injection', observation: '<p>The parameter <code>user</code> of /login is injectable.</p>', status: 0, identifier: 2})
        expect(finding.customFields.map(f => f.text)).toEqual(['web.bank.example', 'Easy'])
      })

      it('Sort option of a category: by title ascending', async () => {
        var options = (await getAudit()).sortFindings.map(o => o.category === 'scn-Infrastructure' ? {...o, sortValue: 'title', sortOrder: 'asc'} : o)
        expect((await pentester('put', `/api/audits/${auditId}/sortfindings`, {sortFindings: options})).status).toBe(200)
        expect(await titles()).toEqual(['scn-Default credentials on the database', 'scn-SQL injection', 'scn-Weak TLS configuration', 'scn-Reflected XSS', 'scn-Missing security headers'])
      })

      it('Manual order of a category: finding moved', async () => {
        var options = (await getAudit()).sortFindings.map(o => o.category === 'scn-Infrastructure' ? {...o, sortAuto: false} : o)
        expect((await pentester('put', `/api/audits/${auditId}/sortfindings`, {sortFindings: options})).status).toBe(200)
        expect((await pentester('put', `/api/audits/${auditId}/movefinding`, {oldIndex: 2, newIndex: 0})).status).toBe(200)
        expect(await titles()).toEqual(['scn-Weak TLS configuration', 'scn-Default credentials on the database', 'scn-SQL injection', 'scn-Reflected XSS', 'scn-Missing security headers'])
        // Finding of the category updated: manual order kept
        var id = await findingIdOf('scn-SQL injection')
        expect((await pentester('put', `/api/audits/${auditId}/findings/${id}`, {category: 'scn-Infrastructure', cvssv3: CVSS.critical})).status).toBe(200)
        expect((await titles()).slice(0, 3)).toEqual(['scn-Weak TLS configuration', 'scn-Default credentials on the database', 'scn-SQL injection'])
      })

      it('Manual order of a category kept when a finding of another category changes', async () => {
        var id = await findingIdOf('scn-Missing security headers')
        expect((await pentester('put', `/api/audits/${auditId}/findings/${id}`, {description: '<p>Missing HSTS</p>'})).status).toBe(200)
        expect((await titles()).slice(0, 3)).toEqual(['scn-Weak TLS configuration', 'scn-Default credentials on the database', 'scn-SQL injection'])
      })

      it('Deletes a finding', async () => {
        expect((await call('scn-collab', 'post', `/api/audits/${auditId}/findings`, {title: 'scn-False positive'})).status).toBe(200)
        var id = await findingIdOf('scn-False positive')
        expect((await call('scn-collab', 'delete', `/api/audits/${auditId}/findings/${id}`)).status).toBe(200)
        expect(await titles()).not.toContain('scn-False positive')
        expect((await pentester('get', `/api/audits/${auditId}/findings/${id}`)).status).toBe(404)
        expect((await call('scn-collab', 'delete', `/api/audits/${auditId}/findings/${id}`)).status).toBe(404)
        expect(await titles()).toHaveLength(5)
      })
    })

    describe('Review', () => {
      var sqliId, commentId

      beforeAll(async () => {
        sqliId = await findingIdOf('scn-SQL injection')
      })

      it('The report cannot be generated before the approval', async () => {
        var response = await generate('scn-pentester')
        expect(response.status).toBe(403)
        expect(JSON.parse(response.body.toString()).datas).toBe('Audit was not approved therefore cannot be exported.')
      })

      it('An audit in edition cannot be approved', async () => {
        var response = await call('scn-reviewer', 'put', `/api/audits/${auditId}/toggleApproval`)
        expect(response.status).toBe(403)
        expect(response.body.datas).toBe('The audit is not approvable in the current state.')
      })

      it('The pentester asks for the review: the audit cannot be edited anymore', async () => {
        expect((await call('scn-reviewer', 'put', `/api/audits/${auditId}/updateReadyForReview`, {state: 'REVIEW'})).status).toBe(404)
        expect((await setState('scn-pentester', 'REVIEW')).status).toBe(200)
        expect((await getAudit()).state).toBe('REVIEW')
        expect((await call('scn-reviewer', 'get', '/api/audits')).body.datas.find(a => a._id === auditId).state).toBe('REVIEW')
        for (var [username, method, url, body] of [
          ['scn-pentester', 'put', `/api/audits/${auditId}/general`, {name: 'Changed'}],
          ['scn-collab', 'post', `/api/audits/${auditId}/findings`, {title: 'scn-Late finding'}],
          ['scn-pentester', 'put', `/api/audits/${auditId}/findings/${sqliId}`, {description: 'Changed'}],
          ['scn-pentester', 'delete', `/api/audits/${auditId}/findings/${sqliId}`],
          ['scn-collab', 'put', `/api/audits/${auditId}/network`, {scope: []}]
        ]) {
          var response = await call(username, method, url, body)
          expect([url, response.status]).toEqual([url, 403])
        }
        expect(await titles()).toHaveLength(5)
      })

      it('The reviewers comment: a passage of a finding and a field of the general information', async () => {
        var response = await call('scn-reviewer', 'post', `/api/audits/${auditId}/comments`, {
          target: {kind: 'finding', findingId: sqliId, field: 'description'},
          quote: {exact: 'SQL injection', prefix: '', suffix: ''},
          text: 'Explain how the injection was found'
        })
        expect(response.status).toBe(200)
        commentId = response.body.datas.find(c => c.text === 'Explain how the injection was found')._id
        response = await call('scn-lead', 'post', `/api/audits/${auditId}/comments`, {target: {kind: 'general', field: 'date_end'}, text: 'Check the end date'})
        expect(response.status).toBe(200)

        var list = await comments()
        expect(list.map(c => [c.author.username, c.target.kind, c.resolved])).toEqual([['scn-reviewer', 'finding', false], ['scn-lead', 'general', false]])
        expect(list[0]).toMatchObject({target: {findingId: sqliId, field: 'description'}, quote: {exact: 'SQL injection'}})
        // Not visible outside the team
        expect((await call('scn-outsider', 'get', `/api/audits/${auditId}/comments`)).status).toBe(404)
        expect((await call('scn-outsider', 'post', `/api/audits/${auditId}/comments`, {target: {kind: 'general', field: 'name'}, text: 'Spam'})).status).toBe(404)
      })

      it('Open comments block the approval', async () => {
        var response = await call('scn-reviewer', 'put', `/api/audits/${auditId}/toggleApproval`)
        expect(response.status).toBe(403)
        expect(response.body.datas).toBe('Open comments must be resolved before approving the audit.')
        expect((await getAudit()).approvals).toEqual([])
      })

      it('The pentester answers, goes back to edition, fixes the finding and resolves the comments', async () => {
        expect((await pentester('post', `/api/audits/${auditId}/comments/${commentId}/replies`, {text: 'Error-based, on the user parameter'})).status).toBe(200)
        // Only the author edits the text of a comment
        expect((await pentester('put', `/api/audits/${auditId}/comments/${commentId}`, {text: 'Rewritten'})).status).toBe(403)

        expect((await setState('scn-pentester', 'EDIT')).status).toBe(200)
        expect((await pentester('put', `/api/audits/${auditId}/findings/${sqliId}`, {description: '<p>SQL injection (error-based) on the user parameter</p>'})).status).toBe(200)
        expect((await pentester('put', `/api/audits/${auditId}/general`, {date_end: '2026-11-07'})).status).toBe(200)
        for (var comment of await comments())
          expect((await pentester('put', `/api/audits/${auditId}/comments/${comment._id}`, {resolved: true})).status).toBe(200)

        var list = await comments('scn-reviewer')
        expect(list.map(c => [c.resolved, c.resolvedBy.username])).toEqual([[true, 'scn-pentester'], [true, 'scn-pentester']])
        expect(list[0].replies.map(r => [r.author.username, r.text])).toEqual([['scn-pentester', 'Error-based, on the user parameter']])
        expect((await setState('scn-collab', 'REVIEW')).status).toBe(200)
      })

      it('Approvals: users without review permission, then the two reviewers', async () => {
        for (var username of ['scn-pentester', 'scn-collab', 'scn-manager', 'scn-outsider'])
          expect([username, (await call(username, 'put', `/api/audits/${auditId}/toggleApproval`)).status]).toEqual([username, 403])

        expect((await call('scn-reviewer', 'put', `/api/audits/${auditId}/toggleApproval`)).status).toBe(200)
        var audit = await getAudit()
        expect(audit.state).toBe('REVIEW') // 1 approval of 2
        expect(audit.approvals.map(a => a.username)).toEqual(['scn-reviewer'])

        expect((await call('scn-lead', 'put', `/api/audits/${auditId}/toggleApproval`)).status).toBe(200)
        audit = await getAudit()
        expect(audit.state).toBe('APPROVED')
        expect(audit.approvals.map(a => a.username).sort()).toEqual(['scn-lead', 'scn-reviewer'])
        expect((await call('scn-manager', 'get', '/api/audits')).body.datas.find(a => a._id === auditId).state).toBe('APPROVED')
      })

      it('An approved audit cannot go back to edition', async () => {
        var response = await setState('scn-pentester', 'EDIT')
        expect(response.status).toBe(403)
        expect((await pentester('put', `/api/audits/${auditId}/findings/${sqliId}`, {title: 'Changed'})).status).toBe(403)
        expect((await getAudit()).state).toBe('APPROVED')
      })
    })

    describe('Report', () => {
      it('The team and the users allowed to read all the audits generate the report', async () => {
        for (var username of ['scn-pentester', 'scn-collab', 'scn-reviewer', 'scn-manager']) {
          var response = await generate(username)
          expect([username, response.status, response.status === 200 ? '' : response.body.toString()]).toEqual([username, 200, ''])
          expect(response.headers['content-disposition']).toBe(`attachment; filename="${encodeURIComponent('scn-Mission Bank 2026.docx')}"`)
          expect(response.body.subarray(0, 2).toString()).toBe('PK')
          var zip = new PizZip(response.body)
          expect(zip.file('word/document.xml')).not.toBeNull()
          expect(zip.file('[Content_Types].xml')).not.toBeNull()
        }
      }, 60000)

      it('Users outside the team cannot generate it', async () => {
        expect((await generate('scn-outsider')).status).toBe(404)
      })

      it('Report generated with a section custom field given by its identifier', async () => {
        // Format accepted by PUT section (and used for the custom fields of the general information and findings), set
        // in the database: the approved audit cannot be edited
        var mongooseAudit = mongoose.model('Audit')
        var audit = await mongooseAudit.findById(auditId)
        var previous = audit.sections[0].customFields.map(f => ({customField: f.customField, text: f.text}))
        await mongooseAudit.updateOne({_id: auditId, 'sections.field': 'scn_conclusion'}, {$set: {'sections.$.customFields': [{customField: ids.summary, text: '<p>The network is exposed.</p>'}]}})
        try {
          var response = await generate('scn-pentester')
          expect([response.status, response.status === 200 ? '' : response.body.toString()]).toEqual([200, ''])
        }
        finally {
          await mongooseAudit.updateOne({_id: auditId, 'sections.field': 'scn_conclusion'}, {$set: {'sections.$.customFields': previous}})
        }
      })

      it('Report generated after the deletion of a custom field used by the findings', async () => {
        expect((await admin('delete', `/api/data/custom-fields/${ids.asset}`)).status).toBe(200)
        ids.asset = null
        var response = await generate('scn-pentester')
        expect([response.status, response.status === 200 ? '' : response.body.toString()]).toEqual([200, ''])
      })

      it('Report generated after the deletion of a custom field of the general information', async () => {
        expect((await admin('delete', `/api/data/custom-fields/${ids.context}`)).status).toBe(200)
        ids.context = null
        var response = await generate('scn-pentester')
        expect([response.status, response.status === 200 ? '' : response.body.toString()]).toEqual([200, ''])
      })
    })

    describe('Vulnerabilities database updated from the findings', () => {
      var updateId, creationId, credentialsFindingId

      var propose = async (title, changes = {}) => {
        var finding = (await getAudit()).findings.find(f => f.title === title)
        return pentester('post', '/api/vulnerabilities/finding/scn-en', {
          title: finding.title, vulnType: finding.vulnType, description: finding.description, observation: finding.observation,
          remediation: finding.remediation, remediationComplexity: finding.remediationComplexity, priority: finding.priority,
          references: finding.references, cvssv3: finding.cvssv3, category: finding.category,
          customFields: finding.customFields.filter(f => f.customField && f.customField._id === ids.exploitation).map(f => ({customField: f.customField._id, text: f.text})),
          auditId: auditId, findingId: finding._id, ...changes
        })
      }
      var proposals = async (username = 'admin', query = 'status=all') => (await call(username, 'get', `/api/vulnerability-proposals?${query}`)).body.datas

      it('The pentester proposes the update of a vulnerability and a new vulnerability', async () => {
        var response = await propose('scn-SQL injection')
        expect(response.status).toBe(200)
        expect(response.body.datas).toBe('Update proposed for existing vulnerability')
        response = await propose('scn-Default credentials on the database')
        expect(response.status).toBe(201)
        expect(response.body.datas).toBe('Finding created as new Vulnerability')
        credentialsFindingId = await findingIdOf('scn-Default credentials on the database')

        var mine = await proposals('scn-pentester')
        updateId = mine.find(p => p.title === 'scn-SQL injection')._id
        creationId = mine.find(p => p.title === 'scn-Default credentials on the database')._id
        expect(mine.find(p => p._id === updateId)).toMatchObject({kind: 'update', status: 'pending', locale: 'scn-en', source: {audit: auditId}})
        expect(mine.find(p => p._id === creationId)).toMatchObject({kind: 'creation', status: 'pending', source: {audit: auditId, finding: credentialsFindingId}})
        expect((await call('scn-pentester', 'get', '/api/vulnerability-proposals/count')).body.datas.pending).toBe(2)
      })

      it('Proposals are visible to their author and the reviewers of the database only', async () => {
        expect((await proposals('scn-outsider')).filter(p => [updateId, creationId].includes(p._id))).toEqual([])
        expect((await call('scn-outsider', 'get', `/api/vulnerability-proposals/${updateId}`)).status).toBe(404)
        expect((await call('scn-lead', 'get', `/api/vulnerability-proposals/${updateId}`)).status).toBe(200)
        var response = await call('scn-pentester', 'get', `/api/vulnerability-proposals/finding/${credentialsFindingId}`)
        expect(response.body.datas).toMatchObject({_id: creationId, status: 'pending'})
        expect((await call('scn-outsider', 'get', `/api/vulnerability-proposals/finding/${credentialsFindingId}`)).body.datas).toBeNull()
        // The vulnerability proposed for creation is not validated yet
        var vulns = (await pentester('get', '/api/vulnerabilities')).body.datas
        expect(vulns.find(v => v.details.some(d => d.title === 'scn-Default credentials on the database')).status).toBe(1)
        expect(vulns.find(v => v._id === ids.sqli).status).toBe(2)
      })

      it('The admin accepts the description of the update', async () => {
        var detail = (await admin('get', `/api/vulnerability-proposals/${updateId}`)).body.datas
        expect(detail.changedFields).toContain('description')
        expect(detail.changedFields).toContain('observation')
        expect(detail.changedFields).not.toContain('title')
        var response = await admin('put', `/api/vulnerability-proposals/${updateId}/accept`, {fields: ['description']})
        expect(response.status).toBe(200)
        expect(response.body.datas.status).toBe('partial')
        var vuln = (await pentester('get', '/api/vulnerabilities')).body.datas.find(v => v._id === ids.sqli)
        expect(vuln.status).toBe(0)
        expect(vuln.details.find(d => d.locale === 'scn-en').description).toBe('<p>SQL injection (error-based) on the user parameter</p>')
        expect(vuln.details.find(d => d.locale === 'scn-en').observation).toBeFalsy()
        // Other language unchanged
        expect(vuln.details.find(d => d.locale === 'scn-fr').description).toBe('<p>Injection SQL</p>')
      })

      it('The admin refuses the new vulnerability: deleted, the reason is given to the pentester', async () => {
        expect((await admin('put', `/api/vulnerability-proposals/${creationId}/reject`, {comment: ''})).status).toBe(422)
        expect((await admin('put', `/api/vulnerability-proposals/${creationId}/reject`, {comment: 'Too specific to this client'})).status).toBe(200)
        var response = await call('scn-pentester', 'get', `/api/vulnerability-proposals/finding/${credentialsFindingId}`)
        expect(response.body.datas).toMatchObject({status: 'rejected', reviewComment: 'Too specific to this client', reviewer: {username: 'admin'}})
        expect((await pentester('get', '/api/vulnerabilities')).body.datas.some(v => v.details.some(d => d.title === 'scn-Default credentials on the database'))).toBe(false)
        expect((await call('scn-pentester', 'get', '/api/vulnerability-proposals/count')).body.datas.pending).toBe(0)
      })

      it('A reviewed proposal cannot be reviewed again', async () => {
        expect((await admin('put', `/api/vulnerability-proposals/${creationId}/accept`, {})).status).toBe(404)
        expect((await admin('put', `/api/vulnerability-proposals/${updateId}/reject`, {comment: 'Too late'})).status).toBe(404)
        expect((await pentester('delete', `/api/vulnerability-proposals/${updateId}`)).status).toBe(404)
      })
    })

    describe('Next mission and deletions', () => {
      it('Users without access cannot clone the audit', async () => {
        expect((await call('scn-outsider', 'post', `/api/audits/${auditId}/clone`, {name: 'scn-Stolen'})).status).toBe(404)
      })

      it('The pentester clones the approved audit for the next mission', async () => {
        var response = await pentester('post', `/api/audits/${auditId}/clone`, {name: 'scn-Mission Bank 2027'})
        expect(response.status).toBe(201)
        cloneId = response.body.datas.audit._id
        var clone = await getAudit('scn-pentester', cloneId)
        var original = await getAudit()
        expect(clone).toMatchObject({name: 'scn-Mission Bank 2027', state: 'EDIT', approvals: [], language: 'scn-en', auditType: 'scn-Pentest'})
        expect(clone.creator.username).toBe('scn-pentester')
        expect(clone.template._id).toBe(ids.template)
        expect(clone.findings.map(f => [f.title, f.identifier])).toEqual(original.findings.map(f => [f.title, f.identifier]))
        expect(clone.collaborators.map(u => u.username)).toEqual(['scn-collab'])
        expect(clone.reviewers.map(u => u.username)).toEqual(['scn-reviewer', 'scn-lead'])
        expect(clone.scope.map(s => s.name)).toEqual(original.scope.map(s => s.name))
        // Comments are not copied
        expect((await call('scn-pentester', 'get', `/api/audits/${cloneId}/comments`)).body.datas).toEqual([])
      })

      it('The clone is edited independently of the original audit', async () => {
        var findings = (await getAudit('scn-pentester', cloneId)).findings
        var id = findings.find(f => f.title === 'scn-Reflected XSS')._id
        expect((await call('scn-collab', 'delete', `/api/audits/${cloneId}/findings/${id}`)).status).toBe(200)
        expect((await pentester('put', `/api/audits/${cloneId}/general`, {date_start: '2027-11-01'})).status).toBe(200)
        expect(await titles(cloneId)).not.toContain('scn-Reflected XSS')
        expect(await titles()).toContain('scn-Reflected XSS')
        expect((await pentester('get', `/api/audits/${auditId}/general`)).body.datas.date_start).toBe('2026-11-02')
      })

      it('The manager (all audits readable) clones the audit too: the copy belongs to the manager', async () => {
        var response = await call('scn-manager', 'post', `/api/audits/${auditId}/clone`, {name: 'scn-Manager copy'})
        expect(response.status).toBe(201)
        var id = response.body.datas.audit._id
        expect(response.body.datas.audit.creator).toBe(ids['scn-manager'])
        expect((await call('scn-pentester', 'delete', `/api/audits/${id}`)).status).toBe(404)
        expect((await call('scn-manager', 'delete', `/api/audits/${id}`)).status).toBe(200)
      })

      it('Findings of an approved audit cannot be deleted', async () => {
        var id = await findingIdOf('scn-Missing security headers')
        expect((await pentester('delete', `/api/audits/${auditId}/findings/${id}`)).status).toBe(403)
        expect(await titles()).toContain('scn-Missing security headers')
      })

      it('Only the creator (or the users allowed to delete all the audits) deletes the audit', async () => {
        for (var username of ['scn-collab', 'scn-reviewer', 'scn-manager', 'scn-outsider'])
          expect([username, (await call(username, 'delete', `/api/audits/${auditId}`)).status]).toEqual([username, 404])
        expect((await getAudit()).name).toBe('scn-Mission Bank 2026')

        expect((await pentester('delete', `/api/audits/${cloneId}`)).status).toBe(200)
        expect((await pentester('delete', `/api/audits/${auditId}`)).status).toBe(200)
        for (var username of ['scn-pentester', 'scn-collab', 'scn-manager', 'scn-lead'])
          expect([username, (await call(username, 'get', `/api/audits/${auditId}`)).status]).toEqual([username, 404])
        expect((await call('scn-lead', 'get', '/api/audits')).body.datas.some(a => [auditId, cloneId].includes(a._id))).toBe(false)
        expect((await call('scn-lead', 'get', `/api/audits/${auditId}/comments`)).status).toBe(404)
        auditId = null
        cloneId = null
      })
    })
  })
}
