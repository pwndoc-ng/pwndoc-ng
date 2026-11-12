/*
  Texts highlighted with the warning colors (setting of the reports, generic texts to replace): detection
  (lib/highlights.js), places of an audit listed by GET /api/audits/:auditId/highlights, setting validation, access to
  the audit. Data prefixed with "hlw" deleted at the end, settings reverted.
*/

module.exports = function(request, app) {
  var helpers = require('./helpers')(request, app)
  var highlights = require('../src/lib/highlights')

  var YELLOW = '#ffff00'
  var GREEN = '#00ff00'
  // Highlight written by the editor (TipTap Highlight, multicolor)
  var mark = (color, text) => `<mark data-color="${color}" style="background-color: ${color}; color: inherit">${text}</mark>`

  describe('Highlight warning detection', () => {
    it('Finds the texts highlighted with the colors only, as plain text on one line, with their color', () => {
      var html = `<p>Contact ${mark(YELLOW, '<strong>CLIENT</strong> &amp; co')} then ${mark(GREEN, 'green')} and ${mark('#FFFF00', 'upper\n case')}</p>`
      expect(highlights.highlightsIn(html, [YELLOW])).toEqual([{text: 'CLIENT & co', color: YELLOW}, {text: 'upper case', color: YELLOW}])
      expect(highlights.highlightsIn(html, GREEN)).toEqual([{text: 'green', color: GREEN}])
      expect(highlights.highlightsIn(html, [GREEN, YELLOW])).toEqual([{text: 'CLIENT & co', color: YELLOW}, {text: 'green', color: GREEN}, {text: 'upper case', color: YELLOW}])
      expect(highlights.highlightsIn(html, ['#fe0000'])).toEqual([])
      expect(highlights.highlightsIn(html, [])).toEqual([])
    })

    it('Ignores the values without highlight, the empty highlights and the values that are not text', () => {
      expect(highlights.highlightsIn('<p>No mark</p>', [YELLOW])).toEqual([])
      expect(highlights.highlightsIn(`<p>${mark(YELLOW, '  ')}</p>`, [YELLOW])).toEqual([])
      expect(highlights.highlightsIn('<p><mark>no color</mark></p>', [YELLOW])).toEqual([])
      for (var value of [undefined, null, 12, ['<mark data-color="#ffff00">x</mark>'], {}])
        expect(highlights.highlightsIn(value, [YELLOW])).toEqual([])
    })

    it('Shortens the long texts', () => {
      var [{text}] = highlights.highlightsIn(`<p>${mark(YELLOW, 'x'.repeat(300))}</p>`, [YELLOW])
      expect(text).toHaveLength(100)
      expect(text.endsWith('…')).toBe(true)
    })

    it('Lists the places of the audit: summary, custom fields, findings fields, sections', () => {
      var audit = {
        name: 'Audit',
        summary: `<p>${mark(YELLOW, 'summary')}</p>`,
        customFields: [{customField: {_id: 'g1', label: 'Context', fieldType: 'text'}, text: `<p>${mark(YELLOW, 'context')}</p>`},
          {customField: {_id: 'g2', label: 'Ref', fieldType: 'input'}, text: `<mark data-color="${YELLOW}">input</mark>`}, // Not an editor
          {customField: null, text: `<p>${mark(YELLOW, 'deleted')}</p>`}], // Deleted custom field
        findings: [{_id: 'f1', title: 'SQLi', description: `<p>${mark(YELLOW, 'desc')}</p>`, remediation: `<p>${mark(GREEN, 'other color')}</p>`,
          poc: `<p>${mark(YELLOW, 'poc 1')} ${mark(YELLOW, 'poc 2')}</p>`, scope: `<p>${mark(YELLOW, 'host')}</p>`,
          customFields: [{customField: {_id: 'c1', label: 'Impact', fieldType: 'text'}, text: `<p>${mark(YELLOW, 'impact')}</p>`}]}],
        sections: [{_id: 's1', name: 'Synthesis', text: `<p>${mark(YELLOW, 'legacy')}</p>`,
          customFields: [{customField: {_id: 'c2', label: 'Body', fieldType: 'text'}, text: `<p>${mark(YELLOW, 'body')}</p>`}]}]
      }
      expect(highlights.auditHighlights(audit, [YELLOW])).toEqual([
        {kind: 'general', id: null, name: 'Audit', field: 'summary', label: null, texts: [{text: 'summary', color: YELLOW}]},
        {kind: 'general', id: null, name: 'Audit', field: 'customFields.g1', label: 'Context', texts: [{text: 'context', color: YELLOW}]},
        {kind: 'finding', id: 'f1', name: 'SQLi', field: 'description', label: null, texts: [{text: 'desc', color: YELLOW}]},
        {kind: 'finding', id: 'f1', name: 'SQLi', field: 'poc', label: null, texts: [{text: 'poc 1', color: YELLOW}, {text: 'poc 2', color: YELLOW}]},
        {kind: 'finding', id: 'f1', name: 'SQLi', field: 'scope', label: null, texts: [{text: 'host', color: YELLOW}]},
        {kind: 'finding', id: 'f1', name: 'SQLi', field: 'customFields.c1', label: 'Impact', texts: [{text: 'impact', color: YELLOW}]},
        {kind: 'section', id: 's1', name: 'Synthesis', field: 'text', label: null, texts: [{text: 'legacy', color: YELLOW}]},
        {kind: 'section', id: 's1', name: 'Synthesis', field: 'customFields.c2', label: 'Body', texts: [{text: 'body', color: YELLOW}]}
      ])
      expect(highlights.auditHighlights({name: 'Empty'}, [YELLOW])).toEqual([])
      expect(highlights.auditHighlights(audit, [GREEN])).toEqual([{kind: 'finding', id: 'f1', name: 'SQLi', field: 'remediation', label: null, texts: [{text: 'other color', color: GREEN}]}])
    })
  })

  describe('Highlight warning Suite Tests', () => {
    var adminCookie, userCookie, otherCookie, auditId, findingId, customFieldId
    var setWarning = (values) => request(app).put('/api/settings').set('Cookie', adminCookie).send({report: {public: values}})
    var get = (cookie = userCookie, id = auditId) => request(app).get(`/api/audits/${id}/highlights`).set('Cookie', cookie)

    beforeAll(async () => {
      adminCookie = await helpers.login('admin', 'Admin123')
      userCookie = await helpers.login('user2', 'User1234')
      otherCookie = await helpers.login('tmpuser', 'Tmpuser1')
      var response = await request(app).post('/api/data/custom-fields').set('Cookie', adminCookie).send({fieldType: 'text', label: 'hlw Notes', display: 'finding'})
      expect(response.status).toBe(201)
      customFieldId = response.body.datas._id
      response = await request(app).post('/api/audits').set('Cookie', userCookie).send({name: 'hlw Audit', language: 'en', auditType: 'Web'})
      expect(response.status).toBe(201)
      auditId = response.body.datas.audit._id
      response = await request(app).post(`/api/audits/${auditId}/findings`).set('Cookie', userCookie).send({
        title: 'hlw <Finding> & co',
        description: `<p>Contact ${mark(YELLOW, '[CLIENT NAME]')} for ${mark(GREEN, 'green note')}</p>`,
        customFields: [{customField: customFieldId, text: `<p>${mark(YELLOW, 'to complete')}</p>`}]
      })
      expect(response.status).toBe(200)
      await request(app).post(`/api/audits/${auditId}/findings`).set('Cookie', userCookie).send({title: 'hlw Clean', description: '<p>Nothing</p>'})
      var audit = (await request(app).get(`/api/audits/${auditId}`).set('Cookie', userCookie)).body.datas
      findingId = audit.findings.find(f => f.title === 'hlw <Finding> & co')._id
    })

    afterAll(async () => {
      await request(app).delete(`/api/audits/${auditId}`).set('Cookie', userCookie)
      await request(app).delete(`/api/data/custom-fields/${customFieldId}`).set('Cookie', adminCookie)
      await setWarning({highlightWarning: false, highlightWarningColors: [YELLOW]})
    })

    it('Disabled by default: nothing listed', async () => {
      var response = await get()
      expect(response.status).toBe(200)
      expect(response.body.datas).toEqual({enabled: false, colors: [YELLOW], items: []})
    })

    it('Enabled: the places of the audit with texts highlighted in the colors of the settings (yellow by default)', async () => {
      expect((await setWarning({highlightWarning: true})).status).toBe(200)
      var response = await get()
      expect(response.status).toBe(200)
      expect(response.body.datas).toEqual({enabled: true, colors: [YELLOW], items: [
        {kind: 'finding', id: findingId, name: 'hlw <Finding> & co', field: 'description', label: null, texts: [{text: '[CLIENT NAME]', color: YELLOW}]},
        {kind: 'finding', id: findingId, name: 'hlw <Finding> & co', field: `customFields.${customFieldId}`, label: 'hlw Notes', texts: [{text: 'to complete', color: YELLOW}]}
      ]})
    })

    it('Uses the colors chosen in the settings, several at once', async () => {
      expect((await setWarning({highlightWarningColors: [GREEN]})).status).toBe(200)
      expect((await get()).body.datas).toEqual({enabled: true, colors: [GREEN], items: [
        {kind: 'finding', id: findingId, name: 'hlw <Finding> & co', field: 'description', label: null, texts: [{text: 'green note', color: GREEN}]}
      ]})
      expect((await setWarning({highlightWarningColors: [GREEN, YELLOW]})).status).toBe(200)
      var {colors, items} = (await get()).body.datas
      expect(colors).toEqual([GREEN, YELLOW])
      expect(items[0].texts).toEqual([{text: '[CLIENT NAME]', color: YELLOW}, {text: 'green note', color: GREEN}]) // Order of the text
      expect(items).toHaveLength(2)
      expect((await request(app).get('/api/settings/public').set('Cookie', userCookie)).body.datas.report.public)
        .toMatchObject({highlightWarning: true, highlightWarningColors: [GREEN, YELLOW]})
      // No color chosen: nothing listed
      expect((await setWarning({highlightWarningColors: []})).status).toBe(200)
      expect((await get()).body.datas).toEqual({enabled: true, colors: [], items: []})
    })

    it('Refuses the colors that are not highlight colors of the editors, and the repeated colors', async () => {
      expect((await setWarning({highlightWarningColors: [GREEN]})).status).toBe(200)
      for (var colors of [['#123456'], [YELLOW, 'yellow'], ['#FFFF00'], [''], [YELLOW, YELLOW], [{$ne: ''}]])
        expect((await setWarning({highlightWarningColors: colors})).status).toBe(422)
      expect((await request(app).get('/api/settings').set('Cookie', adminCookie)).body.datas.report.public.highlightWarningColors).toEqual([GREEN])
    })

    it('Readable by the users of the audit only', async () => {
      expect((await get(otherCookie)).status).toBe(404)
      expect((await get(adminCookie)).status).toBe(200) // Read all
      expect((await get(userCookie, 'deadbeefdeadbeefdeadbeef')).status).toBe(404)
      expect((await request(app).get(`/api/audits/${auditId}/highlights`)).status).toBe(401)
    })
  })
}
