/*
  Custom data: languages, audit types, vulnerability categories, sections and custom fields, and their use in the audits.
  At the end the custom data is the same as at the start (data.test.js): every element created here is removed.
*/

module.exports = function(request, app) {
  var helpers = require('./helpers')(request, app)

  describe('Custom Data Suite Tests', () => {
    var adminCookie, userCookie
    var get = (route) => request(app).get(route).set('Cookie', adminCookie)
    var post = (route, body) => request(app).post(route).set('Cookie', adminCookie).send(body)
    var put = (route, body) => request(app).put(route).set('Cookie', adminCookie).send(body)
    var del = (route) => request(app).delete(route).set('Cookie', adminCookie)

    beforeAll(async () => {
      adminCookie = await helpers.login('admin', 'Admin123')
      userCookie = await helpers.login('user2', 'User1234')
    })

    describe('Languages', () => {
      var initialLanguages

      beforeAll(async () => {
        initialLanguages = (await get('/api/data/languages')).body.datas
      })

      it('Should not create a language with invalid characters', async () => {
        expect((await post('/api/data/languages', {locale: 'en/../x', language: 'Path'})).status).toBe(422)
        expect((await post('/api/data/languages', {locale: 'de', language: '<b>German</b>'})).status).toBe(422)
        expect((await post('/api/data/languages', {locale: 'de'})).status).toBe(422)
        expect((await get('/api/data/languages')).body.datas).toEqual(initialLanguages)
      })

      it('Should not update languages with invalid entries', async () => {
        var response = await put('/api/data/languages', [...initialLanguages, {locale: 'de'}])
        expect(response.status).toBe(422)
        response = await put('/api/data/languages', [...initialLanguages, {locale: 'de', language: 'Ger{man}'}])
        expect(response.status).toBe(422)
        expect((await get('/api/data/languages')).body.datas).toEqual(initialLanguages)
      })

      it('Update languages (order and list)', async () => {
        var languages = [{locale: 'fr', language: 'French'}, {locale: 'de', language: 'German'}, {locale: 'en', language: 'English'}]
        var response = await put('/api/data/languages', languages)
        expect(response.status).toBe(201)
        // The insertion is not awaited before answering (see the skipped test below)
        await helpers.eventually(async () => expect((await get('/api/data/languages')).body.datas).toEqual(languages))

        response = await put('/api/data/languages', initialLanguages)
        expect(response.status).toBe(201)
        await helpers.eventually(async () => expect((await get('/api/data/languages')).body.datas).toEqual(initialLanguages))
      })

      it('Update languages with an invalid list is refused and keeps the languages', async () => {
        var response = await put('/api/data/languages', [{locale: 'en', language: 'English'}, {locale: 'en', language: 'English 2'}])
        expect(response.status).toBe(422)
        await helpers.sleep(500)
        expect((await get('/api/data/languages')).body.datas).toEqual(initialLanguages)
      })
    })

    describe('Audit types', () => {
      var initialAuditTypes

      beforeAll(async () => {
        initialAuditTypes = (await get('/api/data/audit-types')).body.datas
      })

      it('Should not create an audit type with missing or invalid parameters', async () => {
        expect((await post('/api/data/audit-types', {name: 'No templates'})).status).toBe(422)
        expect((await post('/api/data/audit-types', {name: 'Bad/name', templates: []})).status).toBe(422)
        expect((await put('/api/data/audit-types', [...initialAuditTypes, {name: 'Without templates'}])).status).toBe(422)
        expect((await get('/api/data/audit-types')).body.datas).toEqual(initialAuditTypes)
      })

      it('Update audit types with duplicate names is refused and keeps the audit types', async () => {
        var current = (await get('/api/data/audit-types')).body.datas
        expect(current.length).toBeGreaterThan(0)
        var duplicate = current.map(({name, templates, sections, hidden, stage}) => ({name, templates, sections, hidden, stage}))
        var response = await put('/api/data/audit-types', [...duplicate, duplicate[0]])
        expect(response.status).toBe(422)
        expect((await get('/api/data/audit-types')).body.datas).toEqual(current)
      })

      it('Create an audit type with sections, hidden pages and templates per language', async () => {
        var template = (await get('/api/templates')).body.datas[0]
        var response = await post('/api/data/audit-types', {
          name: 'Mobile', templates: [{template: template._id, locale: 'en'}], sections: ['goal'], hidden: ['network']
        })
        expect(response.status).toBe(201)
        response = await get('/api/data/audit-types')
        expect(response.body.datas.find(t => t.name === 'Mobile')).toEqual({
          name: 'Mobile', templates: [{template: template._id, locale: 'en'}], sections: ['goal'], hidden: ['network']
        })
      })

      it('Audits get the template of their language and the sections of their type', async () => {
        var response = await post('/api/audits', {name: 'Mobile audit', language: 'en', auditType: 'Mobile'})
        expect(response.status).toBe(201)
        var audit = response.body.datas.audit
        var template = (await get('/api/templates')).body.datas[0]
        expect(audit.template).toBe(template._id)
        expect(audit.sections.map(s => ({field: s.field, name: s.name}))).toEqual([{field: 'goal', name: 'But'}])
        expect((await del(`/api/audits/${audit._id}`)).status).toBe(200)

        response = await post('/api/audits', {name: 'Mobile audit fr', language: 'fr', auditType: 'Mobile'})
        expect(response.status).toBe(201)
        expect(response.body.datas.audit.template).toBeUndefined()
        expect((await del(`/api/audits/${response.body.datas.audit._id}`)).status).toBe(200)
      })

      it('Update audit types', async () => {
        var auditTypes = (await get('/api/data/audit-types')).body.datas
        var mobile = auditTypes.find(t => t.name === 'Mobile')
        mobile.hidden = ['network', 'findings']
        mobile.sections = ['goal', 'attack_scenario']
        var response = await put('/api/data/audit-types', auditTypes)
        expect(response.status).toBe(201)
        await helpers.eventually(async () => {
          var updated = (await get('/api/data/audit-types')).body.datas
          expect(updated.find(t => t.name === 'Mobile')).toMatchObject({hidden: ['network', 'findings'], sections: ['goal', 'attack_scenario']})
          expect(updated.find(t => t.name === 'Web')).toEqual(initialAuditTypes.find(t => t.name === 'Web'))
        })
      })

      it('Delete audit type', async () => {
        expect((await del('/api/data/audit-types/Mobile')).status).toBe(200)
        expect((await del('/api/data/audit-types/Mobile')).status).toBe(404)
        expect((await get('/api/data/audit-types')).body.datas).toEqual(initialAuditTypes)
      })
    })

    describe('Vulnerability types', () => {
      it('Should not create or update vulnerability types with invalid parameters', async () => {
        expect((await post('/api/data/vulnerability-types', {name: 'Mobile'})).status).toBe(422)
        expect((await post('/api/data/vulnerability-types', {name: 'Mob*ile', locale: 'en'})).status).toBe(422)
        var types = (await get('/api/data/vulnerability-types')).body.datas
        expect((await put('/api/data/vulnerability-types', [...types, {name: 'Mobile', locale: 'en', description: 42}])).status).toBe(422)
        expect((await put('/api/data/vulnerability-types', [...types, {name: 'Mobile'}])).status).toBe(422)
        expect((await get('/api/data/vulnerability-types')).body.datas).toEqual(types)
      })

      it('Same name in several languages', async () => {
        expect((await post('/api/data/vulnerability-types', {name: 'Physical', locale: 'en'})).status).toBe(201)
        expect((await post('/api/data/vulnerability-types', {name: 'Physical', locale: 'fr'})).status).toBe(201)
        expect((await post('/api/data/vulnerability-types', {name: 'Physical', locale: 'fr'})).status).toBe(422)
        expect((await del('/api/data/vulnerability-types/Physical?locale=de')).status).toBe(404)
        expect((await del('/api/data/vulnerability-types/Physical?locale=fr')).status).toBe(200)
        expect((await del('/api/data/vulnerability-types/Physical?locale=en')).status).toBe(200)
        expect((await get('/api/data/vulnerability-types')).body.datas.filter(t => t.name === 'Physical')).toHaveLength(0)
      })
    })

    describe('Vulnerability categories', () => {
      it('Create categories with default and custom sort options', async () => {
        var response = await post('/api/data/vulnerability-categories', {name: 'Network'})
        expect(response.status).toBe(201)
        response = await post('/api/data/vulnerability-categories', {name: 'Web Application', sortValue: 'priority', sortOrder: 'asc', sortAuto: false})
        expect(response.status).toBe(201)

        response = await get('/api/data/vulnerability-categories')
        expect(response.status).toBe(200)
        expect(response.body.datas.map(({name, sortValue, sortOrder, sortAuto}) => ({name, sortValue, sortOrder, sortAuto}))).toEqual([
          {name: 'Network', sortValue: 'cvssScore', sortOrder: 'desc', sortAuto: true},
          {name: 'Web Application', sortValue: 'priority', sortOrder: 'asc', sortAuto: false}
        ])
      })

      it('Update categories with duplicate names is refused and keeps the categories', async () => {
        var current = (await get('/api/data/vulnerability-categories')).body.datas
        var response = await put('/api/data/vulnerability-categories', [{name: 'Duplicate'}, {name: 'Duplicate'}])
        expect(response.status).toBe(422)
        expect((await get('/api/data/vulnerability-categories')).body.datas).toEqual(current)
      })

      it('Should not create categories with missing, existing or invalid values', async () => {
        expect((await post('/api/data/vulnerability-categories', {})).status).toBe(422)
        expect((await post('/api/data/vulnerability-categories', {name: 'Network'})).status).toBe(422)
        expect((await post('/api/data/vulnerability-categories', {name: 'Net<work>'})).status).toBe(422)
        expect((await post('/api/data/vulnerability-categories', {name: 'Bad order', sortOrder: 'up'})).status).toBeGreaterThanOrEqual(400)
        expect((await get('/api/data/vulnerability-categories')).body.datas).toHaveLength(2)
      })

      it('New audits get the sort options of the categories', async () => {
        var response = await post('/api/audits', {name: 'Categories audit', language: 'en', auditType: 'Web'})
        expect(response.status).toBe(201)
        expect(response.body.datas.audit.sortFindings).toEqual([
          {category: 'Network', sortValue: 'cvssScore', sortOrder: 'desc', sortAuto: true},
          {category: 'Web Application', sortValue: 'priority', sortOrder: 'asc', sortAuto: false}
        ])
        expect((await del(`/api/audits/${response.body.datas.audit._id}`)).status).toBe(200)
      })

      it('Update categories (order and sort options)', async () => {
        var response = await put('/api/data/vulnerability-categories', [
          {name: 'Web Application', sortValue: 'cvssScore', sortOrder: 'desc', sortAuto: true},
          {name: 'Network', sortValue: 'remediationComplexity', sortOrder: 'asc', sortAuto: true}
        ])
        expect(response.status).toBe(201)
        await helpers.eventually(async () => {
          var categories = (await get('/api/data/vulnerability-categories')).body.datas
          expect(categories.map(({name, sortValue, sortOrder}) => ({name, sortValue, sortOrder}))).toEqual([
            {name: 'Web Application', sortValue: 'cvssScore', sortOrder: 'desc'},
            {name: 'Network', sortValue: 'remediationComplexity', sortOrder: 'asc'}
          ])
        })
        expect((await put('/api/data/vulnerability-categories', [{sortValue: 'cvssScore'}])).status).toBe(422)
      })

      it('Delete categories', async () => {
        expect((await del('/api/data/vulnerability-categories/Network')).status).toBe(200)
        expect((await del('/api/data/vulnerability-categories/Web%20Application')).status).toBe(200)
        expect((await del('/api/data/vulnerability-categories/Network')).status).toBe(404)
        expect((await get('/api/data/vulnerability-categories')).body.datas).toHaveLength(0)
      })
    })

    describe('Sections', () => {
      var initialSections

      beforeAll(async () => {
        initialSections = (await get('/api/data/sections')).body.datas
      })

      it('Should not create sections with invalid parameters', async () => {
        expect((await post('/api/data/sections', {name: 'Conclusion'})).status).toBe(422)
        expect((await post('/api/data/sections', {name: 'Conclusion', field: 'con/clusion'})).status).toBe(422)
        expect((await put('/api/data/sections', [...initialSections, {name: 'Conclusion'}])).status).toBe(422)
        expect((await get('/api/data/sections')).body.datas).toEqual(initialSections)
      })

      it('Create a section with an icon', async () => {
        var response = await post('/api/data/sections', {name: 'Conclusion', field: 'conclusion', icon: 'flag'})
        expect(response.status).toBe(201)
        response = await get('/api/data/sections')
        expect(response.body.datas).toContainEqual({name: 'Conclusion', field: 'conclusion', icon: 'flag'})
      })

      it('Update sections (order, icons and removal)', async () => {
        var sections = [{name: 'Conclusion', field: 'conclusion', icon: 'done'}, ...initialSections.map(s => ({...s, icon: s.icon || ''}))]
        var response = await put('/api/data/sections', sections)
        expect(response.status).toBe(201)
        await helpers.eventually(async () => expect((await get('/api/data/sections')).body.datas).toEqual(sections))

        // Removal of the new section: list of the other ones
        response = await put('/api/data/sections', initialSections)
        expect(response.status).toBe(201)
        await helpers.eventually(async () => {
          var current = (await get('/api/data/sections')).body.datas
          expect(current.map(s => s.field)).toEqual(initialSections.map(s => s.field))
        })
      })

      it('Update sections with duplicate fields is refused and keeps the sections', async () => {
        var current = (await get('/api/data/sections')).body.datas
        var response = await put('/api/data/sections', [{name: 'First', field: 'duplicate'}, {name: 'Second', field: 'duplicate'}])
        expect(response.status).toBe(422)
        expect((await get('/api/data/sections')).body.datas).toEqual(current)
      })

      it('Delete a section', async () => {
        expect((await post('/api/data/sections', {name: 'To delete', field: 'to_delete'})).status).toBe(201)
        expect((await del('/api/data/sections/to_delete/en')).status).toBe(200)
        expect((await get('/api/data/sections')).body.datas.map(s => s.field)).not.toContain('to_delete')
      })
    })

    describe('Custom fields', () => {
      var assetId, environmentId, spaceId, scenarioId

      it('Should not create custom fields with missing or invalid parameters', async () => {
        expect((await post('/api/data/custom-fields', {fieldType: 'text', label: 'Asset'})).status).toBe(422)
        expect((await post('/api/data/custom-fields', {fieldType: 'text', display: 'finding'})).status).toBe(422)
        expect((await post('/api/data/custom-fields', {fieldType: 'text', label: 'As$et', display: 'finding'})).status).toBe(422)
        expect((await get('/api/data/custom-fields')).body.datas).toHaveLength(0)
      })

      it('Create custom fields', async () => {
        var response = await post('/api/data/custom-fields', {
          fieldType: 'text', label: 'Asset', display: 'finding', position: 2, size: 6, offset: 1, required: true,
          description: 'Affected asset', text: [{locale: 'en', value: '<p>Default asset</p>'}]
        })
        expect(response.status).toBe(201)
        assetId = response.body.datas._id

        response = await post('/api/data/custom-fields', {
          fieldType: 'select', label: 'Environment', display: 'general', position: 1,
          options: [{locale: 'en', value: 'Production'}, {locale: 'en', value: 'Staging'}], text: [{locale: 'en', value: 'Production'}]
        })
        expect(response.status).toBe(201)
        environmentId = response.body.datas._id

        // Space: no label, never required
        response = await post('/api/data/custom-fields', {fieldType: 'space', display: 'general', size: 6, required: true, position: 3})
        expect(response.status).toBe(201)
        spaceId = response.body.datas._id
        expect(response.body.datas.required).toBe(false)

        response = await post('/api/data/custom-fields', {
          fieldType: 'text', label: 'Scenario details', display: 'section', displaySub: 'Attack Scenario', position: 4,
          text: [{locale: 'en', value: '<p>Default scenario</p>'}, {locale: 'fr', value: '<p>Scénario par défaut</p>'}]
        })
        expect(response.status).toBe(201)
        scenarioId = response.body.datas._id
      })

      it('Should not create a custom field with the same label at the same place', async () => {
        var response = await post('/api/data/custom-fields', {fieldType: 'input', label: 'Asset', display: 'finding'})
        expect(response.status).toBe(422)
        // Same label elsewhere
        response = await post('/api/data/custom-fields', {fieldType: 'input', label: 'Asset', display: 'vulnerability'})
        expect(response.status).toBe(201)
        expect((await del(`/api/data/custom-fields/${response.body.datas._id}`)).status).toBe(200)
      })

      it('Custom fields are sorted by position', async () => {
        var response = await request(app).get('/api/data/custom-fields').set('Cookie', userCookie)
        expect(response.status).toBe(200)
        expect(response.body.datas.map(f => f._id)).toEqual([environmentId, assetId, spaceId, scenarioId])
        expect(response.body.datas[1]).toMatchObject({
          fieldType: 'text', label: 'Asset', display: 'finding', displaySub: '', size: 6, offset: 1, required: true,
          description: 'Affected asset', text: [{locale: 'en', value: '<p>Default asset</p>'}]
        })
        expect(response.body.datas[0].options).toEqual([{locale: 'en', value: 'Production'}, {locale: 'en', value: 'Staging'}])
      })

      it('New audits get the general and section custom fields with their default value', async () => {
        var response = await post('/api/data/audit-types', {name: 'With sections', templates: [], sections: ['attack_scenario', 'goal']})
        expect(response.status).toBe(201)

        response = await post('/api/audits', {name: 'Custom fields audit', language: 'en', auditType: 'With sections'})
        expect(response.status).toBe(201)
        var audit = response.body.datas.audit
        expect(audit.customFields.map(f => [f.customField._id, f.text])).toEqual([[environmentId, 'Production'], [spaceId, '']])
        var scenario = audit.sections.find(s => s.field === 'attack_scenario')
        expect(scenario.name).toBe('Attack Scenario')
        expect(scenario.customFields.map(f => [f.customField._id, f.text])).toEqual([[scenarioId, '<p>Default scenario</p>']])
        expect(audit.sections.find(s => s.field === 'goal').customFields).toEqual([])

        response = await post('/api/audits', {name: 'Custom fields audit fr', language: 'fr', auditType: 'With sections'})
        var auditFr = response.body.datas.audit
        expect(auditFr.customFields.find(f => f.customField._id === environmentId).text).toBe('') // No default value in French
        expect(auditFr.sections.find(s => s.field === 'attack_scenario').customFields[0].text).toBe('<p>Scénario par défaut</p>')

        // General custom fields in the general information
        response = await get(`/api/audits/${audit._id}/general`)
        expect(response.body.datas.customFields.find(f => f.customField._id === environmentId).text).toBe('Production')

        expect((await del(`/api/audits/${audit._id}`)).status).toBe(200)
        expect((await del(`/api/audits/${auditFr._id}`)).status).toBe(200)
        expect((await del('/api/data/audit-types/With%20sections')).status).toBe(200)
      })

      it('Update custom fields (labels, options, positions)', async () => {
        var fields = (await get('/api/data/custom-fields')).body.datas
        var environment = fields.find(f => f._id === environmentId)
        environment.label = 'Target environment'
        environment.options.push({locale: 'en', value: 'Development'})
        environment.position = 5
        var response = await put('/api/data/custom-fields', fields.map(f => ({...f, position: f._id === environmentId ? 5 : fields.indexOf(f)})))
        expect(response.status).toBe(201)

        fields = (await get('/api/data/custom-fields')).body.datas
        expect(fields[fields.length - 1]._id).toBe(environmentId)
        expect(fields[fields.length - 1].label).toBe('Target environment')
        expect(fields[fields.length - 1].options.map(o => o.value)).toEqual(['Production', 'Staging', 'Development'])

        expect((await put('/api/data/custom-fields', [{label: 'No id', display: 'general'}])).status).toBe(422)
      })

      it('Deleting a custom field removes it from the vulnerabilities', async () => {
        var response = await post('/api/vulnerabilities', [{details: [
          {locale: 'en', title: 'Vulnerability with custom field', customFields: [{customField: assetId, text: 'Web server'}]}
        ]}])
        expect(response.status).toBe(201)
        var vulns = (await get('/api/vulnerabilities')).body.datas
        var vuln = vulns.find(v => v.details.some(d => d.title === 'Vulnerability with custom field'))
        expect(vuln.details[0].customFields).toEqual([{customField: assetId, text: 'Web server'}])

        response = await del(`/api/data/custom-fields/${assetId}`)
        expect(response.status).toBe(200)
        expect(response.body.datas).toEqual({msg: 'Custom Field deleted successfully', vulnCount: 1})

        vulns = (await get('/api/vulnerabilities')).body.datas
        expect(vulns.find(v => v._id === vuln._id).details[0].customFields).toEqual([])
        expect((await del(`/api/vulnerabilities/${vuln._id}`)).status).toBe(200)
      })

      it('Delete custom fields', async () => {
        for (var id of [environmentId, spaceId, scenarioId])
          expect((await del(`/api/data/custom-fields/${id}`)).status).toBe(200)
        var response = await del(`/api/data/custom-fields/${assetId}`)
        expect(response.status).toBe(404)
        expect((await get('/api/data/custom-fields')).body.datas).toHaveLength(0)
      })
    })
  })
}
