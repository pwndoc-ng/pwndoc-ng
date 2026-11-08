/*
  Vulnerabilities database, complements of vulnerability.test.js: all the fields, languages, merge, title conflicts, export.
  At the end: no more vulnerability or category created here.
*/

module.exports = function(request, app) {
  var helpers = require('./helpers')(request, app)
  var CVSS = helpers.CVSS

  describe('Vulnerabilities Database Suite Tests', () => {
    var adminCookie, userCookie
    var vulns = async () => (await request(app).get('/api/vulnerabilities').set('Cookie', adminCookie)).body.datas
    var findVuln = async (title) => (await vulns()).find(v => v.details.some(d => d.title === title))
    var create = (list) => request(app).post('/api/vulnerabilities').set('Cookie', adminCookie).send(list)
    var merge = (id, body) => request(app).put(`/api/vulnerabilities/merge/${id}`).set('Cookie', adminCookie).send(body)

    beforeAll(async () => {
      adminCookie = await helpers.login('admin', 'Admin123')
      userCookie = await helpers.login('user2', 'User1234')
    })

    afterAll(async () => {
      for (var title of ['Merge A en', 'Merge B en', 'Full vulnerability']) {
        var vuln = await findVuln(title)
        if (vuln) await request(app).delete(`/api/vulnerabilities/${vuln._id}`).set('Cookie', adminCookie)
      }
      await request(app).delete('/api/data/vulnerability-categories/VulnDB%20Category').set('Cookie', adminCookie)
    })

    it('Create a vulnerability with all its fields', async () => {
      var response = await create([{
        cvssv3: CVSS.high, priority: 3, remediationComplexity: 2, category: 'VulnDB Category',
        details: [
          {locale: 'en', title: 'Full vulnerability', vulnType: 'VulnDB Type', description: '<p>Description</p>', observation: '<p>Observation</p>',
           remediation: '<p>Remediation</p>', references: ['https://example.com/1', 'https://example.com/2']},
          {locale: 'fr', title: 'Vulnérabilité complète', description: '<p>Description FR</p>'},
          {locale: 'de'} // Without title: not saved
        ]
      }])
      expect(response.status).toBe(201)
      expect(response.body.datas).toEqual({created: 1, duplicates: 0})

      var vuln = await findVuln('Full vulnerability')
      expect(vuln).toMatchObject({cvssv3: CVSS.high, priority: 3, remediationComplexity: 2, category: 'VulnDB Category', status: 0, archived: false})
      expect(vuln.details).toHaveLength(2)
      expect(vuln.details[0]).toMatchObject({locale: 'en', title: 'Full vulnerability', vulnType: 'VulnDB Type', description: '<p>Description</p>',
        observation: '<p>Observation</p>', remediation: '<p>Remediation</p>', references: ['https://example.com/1', 'https://example.com/2']})
      expect(vuln.details[1]).toMatchObject({locale: 'fr', title: 'Vulnérabilité complète', description: '<p>Description FR</p>'})
    })

    it('Category and vulnerability type created with the vulnerability', async () => {
      await helpers.eventually(async () => {
        var categories = (await request(app).get('/api/data/vulnerability-categories').set('Cookie', adminCookie)).body.datas
        expect(categories.map(c => c.name)).toContain('VulnDB Category')
        var types = (await request(app).get('/api/data/vulnerability-types').set('Cookie', adminCookie)).body.datas
        expect(types).toContainEqual(expect.objectContaining({name: 'VulnDB Type', locale: 'en'}))
      })
      await request(app).delete('/api/data/vulnerability-types/VulnDB%20Type?locale=en').set('Cookie', adminCookie)
    })

    it('Vulnerabilities by language for the findings', async () => {
      var response = await request(app).get('/api/vulnerabilities/fr').set('Cookie', userCookie)
      expect(response.status).toBe(200)
      var vuln = response.body.datas.find(v => v.detail.title === 'Vulnérabilité complète')
      expect(vuln).toMatchObject({cvssv3: CVSS.high, priority: 3, remediationComplexity: 2, category: 'VulnDB Category', detail: {locale: 'fr', description: '<p>Description FR</p>'}})
      response = await request(app).get('/api/vulnerabilities/de').set('Cookie', userCookie)
      expect(response.body.datas.map(v => v.detail.title)).not.toContain('Full vulnerability')
    })

    it('Export contains the data of the vulnerabilities only', async () => {
      var response = await request(app).get('/api/vulnerabilities/export').set('Cookie', userCookie)
      expect(response.status).toBe(200)
      var vuln = response.body.datas.find(v => v.details.some(d => d.title === 'Full vulnerability'))
      expect(Object.keys(vuln).sort()).toEqual(['archived', 'category', 'cvssv3', 'details', 'priority', 'remediationComplexity'])
    })

    it('Should not create or update vulnerabilities with the title of another one', async () => {
      var response = await create([{details: [{locale: 'it', title: 'Vulnérabilité complète'}]}])
      expect(response.status).toBe(422)
      expect(response.body.datas).toBe('Vulnerability title already exists: Vulnérabilité complète')

      expect((await create([{details: [{locale: 'en', title: 'Merge A en'}]}, {details: [{locale: 'en', title: 'Merge B en'}, {locale: 'fr', title: 'Merge B fr'}]}])).status).toBe(201)
      var vulnA = await findVuln('Merge A en')
      response = await request(app).put(`/api/vulnerabilities/${vulnA._id}`).set('Cookie', adminCookie).send({details: [{locale: 'en', title: 'Merge B en'}]})
      expect(response.status).toBe(422)
      expect(response.body.datas).toBe('Vulnerability title already exists')
      expect((await findVuln('Merge A en'))._id).toBe(vulnA._id)
    })

    it('Update requires a detail with locale and title', async () => {
      var vulnA = await findVuln('Merge A en')
      expect((await request(app).put(`/api/vulnerabilities/${vulnA._id}`).set('Cookie', adminCookie).send({cvssv3: CVSS.low})).status).toBe(422)
      expect((await request(app).put(`/api/vulnerabilities/${vulnA._id}`).set('Cookie', adminCookie).send({details: [{locale: 'en'}]})).status).toBe(422)
      expect((await findVuln('Merge A en')).cvssv3).toBeNull()
    })

    it('Merge the language of a vulnerability into another one', async () => {
      var vulnA = await findVuln('Merge A en')
      var vulnB = await findVuln('Merge B en')
      expect((await merge(vulnA._id, {vulnId: vulnB._id})).status).toBe(422)
      expect((await merge(vulnA._id, {locale: 'fr'})).status).toBe(422)

      var response = await merge(vulnA._id, {vulnId: vulnB._id, locale: 'fr'})
      expect(response.status).toBe(200)
      expect((await vulns()).find(v => v._id === vulnA._id).details.map(d => [d.locale, d.title])).toEqual([['en', 'Merge A en'], ['fr', 'Merge B fr']])
      expect((await vulns()).find(v => v._id === vulnB._id).details.map(d => [d.locale, d.title])).toEqual([['en', 'Merge B en']])
    })

    it('Should not merge a language the vulnerability already has', async () => {
      var vulnA = await findVuln('Merge A en')
      var vulnB = await findVuln('Merge B en')
      var response = await merge(vulnA._id, {vulnId: vulnB._id, locale: 'en'})
      expect(response.status).toBe(422)
      expect(response.body.datas).toBe('Language already exists in this vulnerability')
      expect((await vulns()).find(v => v._id === vulnB._id).details).toHaveLength(1)
      expect((await merge(vulnA._id, {vulnId: 'deadbeefdeadbeefdeadbeef', locale: 'en'})).status).toBe(404)
      expect((await merge('deadbeefdeadbeefdeadbeef', {vulnId: vulnB._id, locale: 'es'})).status).toBe(404)
    })

    it('Merging the last language deletes the merged vulnerability', async () => {
      var vulnA = await findVuln('Merge A en')
      var vulnB = await findVuln('Merge B en')
      var count = (await vulns()).length
      var response = await request(app).put(`/api/vulnerabilities/${vulnB._id}`).set('Cookie', adminCookie).send({details: [{locale: 'es', title: 'Merge B es'}]})
      expect(response.status).toBe(200)
      response = await merge(vulnA._id, {vulnId: vulnB._id, locale: 'es'})
      expect(response.status).toBe(200)
      var list = await vulns()
      expect(list).toHaveLength(count - 1)
      expect(list.map(v => v._id)).not.toContain(vulnB._id)
      expect(list.find(v => v._id === vulnA._id).details.map(d => d.locale)).toEqual(['en', 'fr', 'es'])
    })
  })
}
