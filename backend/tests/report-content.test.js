/*
  Content of the generated reports: rich audit built through the API (findings of several categories and CVSS
  severities, custom fields, custom section, scope, uploaded images, rich text of the editors, XML special characters),
  report generated with the Default Template and with small templates built here for the template filters.
  The documents are unzipped and their XML checked. All the data created here is prefixed with "rpt" and deleted at the end.
*/

module.exports = function(request, app) {
  var helpers = require('./helpers')(request, app)
  var CVSS = helpers.CVSS
  var fs = require('fs')
  var path = require('path')
  var zlib = require('zlib')
  var PizZip = require('pizzip')

  var TEMPLATES_DIR = path.join(__dirname, '..', 'report-templates')
  var DEFAULT_TEMPLATE = fs.readFileSync(path.join(TEMPLATES_DIR, 'Default Template.docx'))

  // PNG image of a given size and color (distinct images: the report must contain each of them)
  var png = (width, height, color) => {
    var chunk = (type, data) => {
      var length = Buffer.alloc(4)
      length.writeUInt32BE(data.length)
      var body = Buffer.concat([Buffer.from(type), data])
      var crc = Buffer.alloc(4)
      crc.writeUInt32BE(zlib.crc32(body))
      return Buffer.concat([length, body, crc])
    }
    var header = Buffer.alloc(13)
    header.writeUInt32BE(width, 0)
    header.writeUInt32BE(height, 4)
    header[8] = 8 // Bit depth
    header[9] = 2 // RGB
    var row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(width).fill(color).flat())])
    var data = zlib.deflateSync(Buffer.concat(Array(height).fill(row)))
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', data), chunk('IEND', Buffer.alloc(0))])
  }
  var dataUri = (buffer) => `data:image/png;base64,${buffer.toString('base64')}`
  var IMAGE_A = png(40, 20, [255, 0, 0])
  var IMAGE_B = png(20, 40, [0, 255, 0])
  var LOGO = png(30, 30, [0, 0, 255])

  // Template made of the given paragraphs (one template tag or text per paragraph), with the styles, numbering
  // definitions, headers and page setup of the Default Template
  var templateWith = (paragraphs) => {
    var zip = new PizZip(DEFAULT_TEMPLATE)
    var xml = zip.file('word/document.xml').asText()
    var sectPr = xml.substring(xml.lastIndexOf('<w:sectPr'), xml.lastIndexOf('</w:body>'))
    var escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    var body = paragraphs.map(text => `<w:p><w:r><w:t xml:space="preserve">${escape(text)}</w:t></w:r></w:p>`).join('')
    zip.file('word/document.xml', xml.substring(0, xml.indexOf('<w:body>')) + `<w:body>${body}${sectPr}</w:body></w:document>`)
    return zip.generate({type: 'nodebuffer'})
  }

  // Paragraph texts of the body of a document
  var bodyParagraphs = (xml) => helpers.ooxmlParagraphs(xml.substring(xml.indexOf('<w:body>'))).map(helpers.ooxmlText)

  // Tags of the editors HTML that must not be left as text in a report
  var HTML_TEXT = /<\/?(p|strong|em|u|s|ul|ol|li|table|tbody|tr|td|th|pre|code|mark|legend|img|figure|h[1-6]|br|a)(\s[^>]*)?\/?>/

  describe('Report content Suite Tests', () => {
    var adminCookie, creatorCookie
    var auditId, defaultTemplateId, miniTemplateId, companyId, clientId, imageAId, imageBId, sectionId, sectionFields
    var customFieldIds = {}
    var findingTitles = {
      critical: 'rpt SQL injection in <login> & "search"',
      high: 'rpt Default credentials',
      medium: 'rpt Stored XSS',
      low: 'rpt Weak TLS ciphers',
      none: 'rpt Headers {title} {#findings}{/findings} {@description}'
    }

    var generate = () => request(app).get(`/api/audits/${auditId}/generate`).set('Cookie', creatorCookie).buffer(true).parse(helpers.binary)
    var setTemplate = async (templateId) =>
      expect((await request(app).put(`/api/audits/${auditId}/general`).set('Cookie', creatorCookie).send({template: templateId})).status).toBe(200)

    // Report generated with a template made of the given paragraphs: {zip, xml (document.xml), paragraphs}
    var generateWith = async (paragraphs) => {
      var response = await request(app).put(`/api/templates/${miniTemplateId}`).set('Cookie', adminCookie)
        .send({file: templateWith(paragraphs).toString('base64'), ext: 'docx'})
      expect(response.status).toBe(200)
      await setTemplate(miniTemplateId)
      response = await generate()
      expect(response.status).toBe(200)
      var zip = new PizZip(response.body)
      var xml = zip.file('word/document.xml').asText()
      expect(helpers.xmlErrors(xml)).toEqual([])
      return {zip, xml, paragraphs: bodyParagraphs(xml)}
    }

    // Paragraphs between two marker paragraphs
    var between = (paragraphs, start, end) => paragraphs.slice(paragraphs.indexOf(start) + 1, paragraphs.indexOf(end))

    var RICH_DESCRIPTION = () =>
      '<h2>Context &amp; impact</h2>' +
      '<p>The <strong>username</strong> field of <em>/login</em> is <u>injectable</u>, <s>not filtered</s>, ' +
        '<mark data-color="#ffff00" style="background-color: rgb(255, 255, 0); color: inherit;">confirmed</mark>: ' +
        '&lt;script&gt; &amp; "quotes" \'single\' é 中文 😀</p>' +
      '<ul><li><p>Bullet A</p><ul><li><p>Bullet A.1</p></li></ul></li><li><p>Bullet B</p></li></ul>' +
      '<ol><li><p>Step one</p></li><li><p>Step two</p><ol><li><p>Step two.a</p></li></ol></li></ol>' +
      '<p>Between the lists</p>' +
      '<ol><li><p>Restart one</p></li><li><p>Restart two</p></li></ol>' +
      '<table style="min-width: 50px;"><colgroup><col style="min-width: 25px;"><col style="width: 300px;"></colgroup><tbody>' +
        '<tr><th><p>Parameter</p></th><th><p>Payload</p></th></tr>' +
        '<tr><td><p>username</p></td><td colwidth="300"><p><code>\' OR 1=1 --</code></p></td></tr>' +
      '</tbody></table>' +
      '<pre><code class="language-sql">SELECT * FROM users\nWHERE name = \'\' OR 1=1 -- \';</code></pre>' +
      '<legend label="Listing" alt="Injected query"></legend>' +
      '<p>See <a target="_blank" rel="noopener noreferrer nofollow" href="https://owasp.org/www-community/attacks/SQL_Injection">OWASP</a></p>' +
      `<img class="custom-image" src="${imageAId}" alt="Burp &amp; request" data-width="medium">` +
      '<legend label="Figure" alt="Burp request"></legend>' +
      '<p>After the image</p>' +
      `<img class="custom-image" src="${imageBId}" alt="Second capture" data-width="small">`

    beforeAll(async () => {
      adminCookie = await helpers.login('admin', 'Admin123')
      expect((await request(app).put('/api/settings/revert').set('Cookie', adminCookie)).status).toBe(200)
      var response = await request(app).post('/api/users').set('Cookie', adminCookie)
        .send([{username: 'rpt-creator', password: 'Report2026!', firstname: 'Rpt', lastname: 'Creator', role: 'user', email: 'rpt-creator@example.com', phone: '+33 1 23 45 67 89'}])
      expect(response.status).toBe(201)
      creatorCookie = await helpers.login('rpt-creator', 'Report2026!')

      // Templates: Default Template and the template of the filters tests
      response = await request(app).post('/api/templates').set('Cookie', adminCookie).send({name: 'rpt Default', ext: 'docx', file: DEFAULT_TEMPLATE.toString('base64')})
      expect(response.status).toBe(201)
      defaultTemplateId = response.body.datas._id
      response = await request(app).post('/api/templates').set('Cookie', adminCookie).send({name: 'rpt Mini', ext: 'docx', file: templateWith(['empty']).toString('base64')})
      expect(response.status).toBe(201)
      miniTemplateId = response.body.datas._id

      // Categories, custom section, custom fields, audit type
      for (var category of ['rpt Web', 'rpt Infra'])
        expect((await request(app).post('/api/data/vulnerability-categories').set('Cookie', adminCookie).send({name: category})).status).toBe(201)
      expect((await request(app).post('/api/data/sections').set('Cookie', adminCookie).send({field: 'rpt_summary', name: 'Rpt Summary', locale: 'en'})).status).toBe(201)
      var fields = {
        notes: {fieldType: 'text', label: 'Rpt Notes', display: 'general'},
        impact: {fieldType: 'text', label: 'Rpt Impact', display: 'finding'},
        owner: {fieldType: 'input', label: 'Rpt Owner', display: 'finding'},
        body: {fieldType: 'text', label: 'Rpt Body', display: 'section', displaySub: 'Rpt Summary', text: [{locale: 'en', value: '<p>Default body</p>'}]}
      }
      for (var key of Object.keys(fields)) {
        response = await request(app).post('/api/data/custom-fields').set('Cookie', adminCookie).send(fields[key])
        expect(response.status).toBe(201)
        customFieldIds[key] = response.body.datas._id
      }
      expect((await request(app).post('/api/data/audit-types').set('Cookie', adminCookie)
        .send({name: 'rpt Type', templates: [{template: defaultTemplateId, locale: 'en'}], sections: ['rpt_summary']})).status).toBe(201)

      // Company with a logo, images of the findings
      response = await request(app).post('/api/companies').set('Cookie', adminCookie).send([{name: 'rpt Company & Sons <Ltd> "Q"', logo: dataUri(LOGO)}])
      expect(response.status).toBe(201)
      companyId = (await request(app).get('/api/companies').set('Cookie', adminCookie)).body.datas.find(c => c.name === 'rpt Company & Sons <Ltd> "Q"')._id
      response = await request(app).post('/api/clients').set('Cookie', adminCookie)
        .send([{email: 'rpt-client@example.com', firstname: 'Rpt', lastname: "O'Client & <Co>", title: 'CISO', phone: '+33 1 00 00 00 01', cell: '+33 6 00 00 00 01'}])
      expect(response.status).toBe(201)
      clientId = (await request(app).get('/api/clients').set('Cookie', adminCookie)).body.datas.find(c => c.email === 'rpt-client@example.com')._id

      // Audit
      response = await request(app).post('/api/audits').set('Cookie', creatorCookie).send({name: 'rpt Rich audit', language: 'en', auditType: 'rpt Type'})
      expect(response.status).toBe(201)
      auditId = response.body.datas.audit._id
      imageAId = (await request(app).post('/api/images').set('Cookie', creatorCookie).send({value: dataUri(IMAGE_A), name: 'rpt-a.png', auditId: auditId})).body.datas._id
      imageBId = (await request(app).post('/api/images').set('Cookie', creatorCookie).send({value: dataUri(IMAGE_B), name: 'rpt-b.png', auditId: auditId})).body.datas._id

      response = await request(app).put(`/api/audits/${auditId}/general`).set('Cookie', creatorCookie).send({
        company: {_id: companyId}, client: clientId,
        date: '2026-03-16', date_start: '2026-03-02', date_end: '2026-03-13',
        scope: ['rpt.example.com', '10.0.0.0/24 & <internal>'],
        customFields: [{customField: customFieldIds.notes, text: '<p>General <strong>notes</strong> &amp; more</p>'}]
      })
      expect(response.status).toBe(200)

      var findings = [
        {title: findingTitles.critical, cvssv3: CVSS.critical, category: 'rpt Web', description: RICH_DESCRIPTION(),
          remediation: '<p>Use <strong>prepared statements</strong></p>', scope: 'app.example.com & api',
          references: ['https://owasp.org/a?b=1&c=2', 'CWE-89'],
          customFields: [{customField: customFieldIds.impact, text: '<p>Impact <em>high</em></p>'}, {customField: customFieldIds.owner, text: 'Team <A&B>'}]},
        {title: findingTitles.medium, cvssv3: CVSS.medium, category: 'rpt Web', references: ['https://owasp.org/xss'],
          description: '<ol><li><p>Open the page</p></li><li><p>Post the payload</p></li></ol><p>Then</p><ol><li><p>Reload</p></li></ol>'},
        {title: findingTitles.low, cvssv3: CVSS.low, category: 'rpt Infra', description: '<p>TLS 1.0 enabled</p>'},
        {title: findingTitles.high, cvssv3: CVSS.high, description: '<p>admin/admin</p>'},
        {title: findingTitles.none, description: '<p>Informational {title}</p>'}
      ]
      for (var finding of findings)
        expect((await request(app).post(`/api/audits/${auditId}/findings`).set('Cookie', creatorCookie).send(finding)).status).toBe(200)

      // Section: custom fields sent back as read by the editor (custom field stored with the section)
      var audit = (await request(app).get(`/api/audits/${auditId}`).set('Cookie', creatorCookie)).body.datas
      sectionId = audit.sections.find(s => s.field === 'rpt_summary')._id
      var section = (await request(app).get(`/api/audits/${auditId}/sections/${sectionId}`).set('Cookie', creatorCookie)).body.datas
      sectionFields = section.customFields
      expect(sectionFields.map(field => [field.customField.label, field.text])).toEqual([['Rpt Body', '<p>Default body</p>']])
      sectionFields[0].text = '<p>Section <em>body</em> &lt;b&gt;</p><ol><li><p>Section item</p></li></ol>'
      response = await request(app).put(`/api/audits/${auditId}/sections/${sectionId}`).set('Cookie', creatorCookie).send({customFields: sectionFields})
      expect(response.status).toBe(200)
    })

    afterAll(async () => {
      await request(app).delete(`/api/audits/${auditId}`).set('Cookie', creatorCookie)
      for (var id of [imageAId, imageBId])
        await request(app).delete(`/api/images/${id}`).set('Cookie', adminCookie)
      await request(app).delete(`/api/clients/${clientId}`).set('Cookie', adminCookie)
      await request(app).delete(`/api/companies/${companyId}`).set('Cookie', adminCookie)
      await request(app).delete('/api/data/audit-types/rpt%20Type').set('Cookie', adminCookie)
      for (var id of Object.values(customFieldIds))
        await request(app).delete(`/api/data/custom-fields/${id}`).set('Cookie', adminCookie)
      await request(app).delete('/api/data/sections/rpt_summary/en').set('Cookie', adminCookie)
      for (var category of ['rpt Web', 'rpt Infra'])
        await request(app).delete(`/api/data/vulnerability-categories/${encodeURIComponent(category)}`).set('Cookie', adminCookie)
      for (var id of [defaultTemplateId, miniTemplateId])
        await request(app).delete(`/api/templates/${id}`).set('Cookie', adminCookie)
    })

    describe('Default Template', () => {
      var zip, xml, text

      beforeAll(async () => {
        await setTemplate(defaultTemplateId)
        var response = await generate()
        expect(response.status).toBe(200)
        zip = new PizZip(response.body)
        xml = zip.file('word/document.xml').asText()
        text = helpers.ooxmlText(xml)
      })

      it('Every XML part of the document is well-formed', () => {
        var parts = Object.keys(zip.files).filter(name => /\.(xml|rels)$/.test(name) && !zip.files[name].dir)
        expect(parts).toEqual(expect.arrayContaining(['[Content_Types].xml', 'word/document.xml', 'word/_rels/document.xml.rels', 'word/numbering.xml', 'word/styles.xml']))
        parts.forEach(name => {
          var errors = helpers.xmlErrors(zip.file(name).asText())
          if (errors.length > 0) throw new Error(`${name}: ${errors.slice(0, 3).join('; ')}`)
        })
        expect(xml.startsWith('<?xml')).toBe(true)
        expect(xml.match(/<w:body>/g)).toHaveLength(1)
      })

      it('No template tag and no HTML left', () => {
        expect(text).not.toMatch(/\{[#/@%^-]?\s*(title|findings|description|text|images|image|caption|scope|cvss|affected|remediation|references|value|collaborators|company|creator|date)\b/)
        expect(text).not.toMatch(HTML_TEXT)
        expect(xml).not.toContain('_|link|_')
        expect(xml).not.toMatch(/>undefined</)
      })

      it('XML special characters and unicode of the audit data are escaped', () => {
        expect(text).toContain(findingTitles.critical)
        expect(text).toContain('rpt Company & Sons <Ltd> "Q"')
        expect(text).toContain('10.0.0.0/24 & <internal>')
        expect(text).toContain('<script> & "quotes" \'single\' é 中文 😀')
        expect(text).toContain('app.example.com & api') // Affected assets
        expect(text).toContain("Rpt O'Client & <Co>") // Client
      })

      it('Findings sorted by CVSS score, findings without score left out, numbered from VULN-1', () => {
        // Detailed findings: VULN-n bookmark before the details of the finding
        var bookmarks = [...xml.matchAll(/<w:bookmarkStart w:id="(\d+)" w:name="(VULN_\d+)"\/>/g)]
        expect(bookmarks.map(b => b[2])).toEqual(['VULN_1', 'VULN_2', 'VULN_3', 'VULN_4'])
        expect(new Set(bookmarks.map(b => b[1])).size).toBe(4) // Distinct identifiers
        var detailTitles = bookmarks.map((bookmark, i) => {
          var end = i + 1 < bookmarks.length ? bookmarks[i + 1].index : xml.length
          var details = helpers.ooxmlText(xml.substring(bookmark.index, end))
          return Object.values(findingTitles).find(title => details.includes(title))
        })
        expect(detailTitles).toEqual([findingTitles.critical, findingTitles.high, findingTitles.medium, findingTitles.low])
        expect(text).not.toContain(findingTitles.none)
        // Every reference to a finding has its bookmark
        var references = [...xml.matchAll(/<w:instrText xml:space="preserve"> REF (\S+) \\h <\/w:instrText>/g)].map(m => m[1])
        expect(references.length).toBeGreaterThanOrEqual(8) // Summary and remediation tables
        expect([...new Set(references)].sort()).toEqual(['VULN_1', 'VULN_2', 'VULN_3', 'VULN_4'])
      })

      // The p filter puts OOXML input (bookmarks, fields) directly in the paragraph: a w:t only contains text
      it('Bookmarks and references to the findings are not inside the text of a run', () => {
        expect(xml).not.toMatch(/<w:t(?:\s[^>]*)?>(?:(?!<\/w:t>)[^])*<w:bookmarkStart/)
        expect(xml).not.toMatch(/<w:t(?:\s[^>]*)?>[^<]*<w:r>/)
        expect(xml).toMatch(/<w:p><w:pPr><w:pStyle w:val="VulnDef"\/><\/w:pPr><w:bookmarkStart w:id="\d+" w:name="VULN_1"\/><w:bookmarkEnd w:id="\d+"\/><\/w:p>/)
      })

      it('Severity colors of the CVSS cells (default settings)', () => {
        var colors = {[findingTitles.critical]: '212121', [findingTitles.high]: 'fe0000', [findingTitles.medium]: 'f9a009', [findingTitles.low]: '008000'}
        var bookmarks = [...xml.matchAll(/<w:bookmarkStart w:id="\d+" w:name="VULN_\d+"\/>/g)]
        bookmarks.forEach((bookmark, i) => {
          var end = i + 1 < bookmarks.length ? bookmarks[i + 1].index : xml.length
          var details = xml.substring(bookmark.index, end)
          var title = Object.keys(colors).find(t => helpers.ooxmlText(details).includes(t))
          var fill = details.match(/<w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="([0-9a-fA-F]{6})"\/><\/w:tcPr>/)
          expect([title, fill && fill[1]]).toEqual([title, colors[title]])
        })
        // Summary of the audit: number of findings of each severity
        expect(text).toMatch(/of 1 vulnerability qualified as «\s*critical\s*»/)
        expect(text).toMatch(/of 1 vulnerability qualified as «\s*high\s*»/)
      })

      it('CVSS score with a link to the calculator', () => {
        expect(xml).toContain(`HYPERLINK "https://www.first.org/cvss/calculator/3.1#${CVSS.critical}"`)
        expect(text).toContain('CVSS 9.8')
        expect(text).toContain('CVSS 3.7')
      })

      it('Rich text of the findings: headings, marks, lists, table, code block, captions', () => {
        var paragraphs = helpers.ooxmlParagraphs(xml)
        var paragraph = (content) => paragraphs.find(p => helpers.ooxmlText(p) === content)
        expect(helpers.ooxmlValues(paragraph('Context & impact'), 'w:pStyle', 'w:val')).toEqual(['Heading2'])
        var marks = paragraphs.find(p => helpers.ooxmlText(p).startsWith('The username field'))
        expect(marks).toMatch(/<w:rPr><w:b\/><w:bCs\/><\/w:rPr><w:t xml:space="preserve">username<\/w:t>/)
        expect(marks).toMatch(/<w:rPr><w:i\/><w:iCs\/><\/w:rPr><w:t xml:space="preserve">\/login<\/w:t>/)
        expect(marks).toMatch(/<w:rPr><w:u w:val="single"\/><\/w:rPr><w:t xml:space="preserve">injectable<\/w:t>/)
        expect(marks).toMatch(/<w:rPr><w:strike\/><\/w:rPr><w:t xml:space="preserve">not filtered<\/w:t>/)
        expect(marks).toMatch(/<w:rPr><w:highlight w:val="yellow"\/><\/w:rPr><w:t xml:space="preserve">confirmed<\/w:t>/)
        // Bullets: numbering of the template, nested level
        expect(helpers.ooxmlValues(paragraph('Bullet A'), 'w:numId', 'w:val')).toEqual(['1'])
        expect(helpers.ooxmlValues(paragraph('Bullet A.1'), 'w:ilvl', 'w:val')).toEqual(['1'])
        // Table of the editor with its header row
        var position = xml.indexOf('>Parameter<') // Table of the editor: nested in a table of the template
        var table = xml.substring(xml.lastIndexOf('<w:tbl>', position), xml.indexOf('</w:tbl>', position) + '</w:tbl>'.length)
        expect(helpers.ooxmlText(table)).toBe('ParameterPayloadusername\' OR 1=1 --')
        expect(table).toContain('<w:tblHeader/>')
        // Code block with its lines
        var code = paragraphs.find(p => helpers.ooxmlText(p).startsWith('SELECT * FROM users'))
        expect(helpers.ooxmlValues(code, 'w:pStyle', 'w:val')).toEqual(['Code'])
        expect(helpers.ooxmlText(code)).toBe('SELECT * FROM usersWHERE name = \'\' OR 1=1 -- \';')
        // Captions of the editor: SEQ fields numbered by Word
        expect(xml).toContain('<w:fldSimple w:instr="SEQ Listing">')
        expect(xml).toContain('<w:fldSimple w:instr="SEQ Figure">')
        expect(text).toContain(' - Injected query')
        // Link of the editor
        expect(xml).toContain('HYPERLINK "https://owasp.org/www-community/attacks/SQL_Injection"')
      })

      it('Images of the findings in word/media, referenced by the document, with their width and caption', () => {
        var rels = zip.file('word/_rels/document.xml.rels').asText()
        // Drawings of the document: relationship -> media file
        var drawings = (xml.match(/<w:drawing>[\s\S]*?<\/w:drawing>/g) || []).map(drawing => {
          var embed = (drawing.match(/r:embed="([^"]+)"/) || [])[1]
          var target = (rels.match(new RegExp(`<Relationship [^>]*Id="${embed}"[^>]*/>`)) || [''])[0].match(/Target="([^"]+)"/)
          var file = target && zip.file(`word/${target[1]}`)
          return {cx: parseInt((drawing.match(/<wp:extent cx="(\d+)"/) || [])[1], 10), content: file && file.asNodeBuffer()}
        })
        var drawingOf = (image) => drawings.find(d => d.content && d.content.equals(image))
        expect(drawingOf(IMAGE_A)).toBeDefined()
        expect(drawingOf(IMAGE_B)).toBeDefined()
        expect(drawingOf(LOGO)).toBeDefined() // Company logo
        // Width chosen in the editor: medium (75% of the text width) and small (50%)
        expect(drawingOf(IMAGE_A).cx / drawingOf(IMAGE_B).cx).toBeCloseTo(1.5, 1)
        // Media files: type declared for the extension
        var contentTypes = zip.file('[Content_Types].xml').asText()
        Object.keys(zip.files).filter(name => name.startsWith('word/media/')).forEach(name => {
          var extension = name.split('.').pop()
          expect(contentTypes).toMatch(new RegExp(`Extension="${extension}"|PartName="/${name}"`, 'i'))
        })
        // Captions of the images (alt text)
        expect(text).toContain('Burp & request')
        expect(text).toContain('Second capture')
        expect(text).toContain('After the image')
      })

      it('Audit without findings, scope, company nor client: report generated', async () => {
        var response = await request(app).post('/api/audits').set('Cookie', creatorCookie).send({name: 'rpt Empty audit', language: 'en', auditType: 'rpt Type'})
        expect(response.status).toBe(201)
        var emptyId = response.body.datas.audit._id
        try {
          response = await request(app).get(`/api/audits/${emptyId}/generate`).set('Cookie', creatorCookie).buffer(true).parse(helpers.binary)
          expect(response.status).toBe(200)
          var emptyXml = new PizZip(response.body).file('word/document.xml').asText()
          expect(helpers.xmlErrors(emptyXml)).toEqual([])
          expect(emptyXml).not.toMatch(/w:name="VULN_\d+"/)
          expect(helpers.ooxmlText(emptyXml)).not.toMatch(/\{[#/@%^-]?\s*(title|findings|description|text|scope|cvss)\b/)
          expect(helpers.ooxmlText(emptyXml)).not.toContain('rpt SQL injection')
        }
        finally {
          expect((await request(app).delete(`/api/audits/${emptyId}`).set('Cookie', creatorCookie)).status).toBe(200)
        }
      })

      it('Image deleted from the database: report generated with a placeholder', async () => {
        var response = await request(app).post('/api/images').set('Cookie', creatorCookie).send({value: dataUri(png(2, 2, [1, 2, 3])), name: 'rpt-deleted.png', auditId: auditId})
        var deletedId = response.body.datas._id
        var findingId = (await request(app).get(`/api/audits/${auditId}`).set('Cookie', creatorCookie)).body.datas.findings.find(f => f.title === findingTitles.low)._id
        response = await request(app).put(`/api/audits/${auditId}/findings/${findingId}`).set('Cookie', creatorCookie)
          .send({description: `<p>TLS 1.0 enabled</p><img class="custom-image" src="${deletedId}" alt="Deleted capture">`})
        expect(response.status).toBe(200)
        expect((await request(app).delete(`/api/images/${deletedId}`).set('Cookie', adminCookie)).status).toBe(200)
        response = await generate()
        expect(response.status).toBe(200)
        expect(helpers.ooxmlText(new PizZip(response.body).file('word/document.xml').asText())).toContain('Deleted capture')
        response = await request(app).put(`/api/audits/${auditId}/findings/${findingId}`).set('Cookie', creatorCookie).send({description: '<p>TLS 1.0 enabled</p>'})
        expect(response.status).toBe(200)
      })

      // Numbering instances of the lists converted by convertHTML declared after the rendering (ordered list of the template)
      it('Numbered lists: their numbering identifiers are defined in numbering.xml (decimal, restart at 1)', () => {
        var numbering = zip.file('word/numbering.xml').asText()
        var defined = new Set(helpers.ooxmlValues(numbering, 'w:num', 'w:numId'))
        var used = [...new Set(helpers.ooxmlValues(xml, 'w:numId', 'w:val'))]
        expect(used.filter(id => !defined.has(id))).toEqual([])
        var step = helpers.ooxmlParagraphs(xml).find(p => helpers.ooxmlText(p) === 'Step one')
        var numId = helpers.ooxmlValues(step, 'w:numId', 'w:val')[0]
        var num = numbering.match(new RegExp(`<w:num w:numId="${numId}"[^>]*>[\\s\\S]*?</w:num>`))[0]
        var abstractId = helpers.ooxmlValues(num, 'w:abstractNumId', 'w:val')[0]
        var abstract = numbering.match(new RegExp(`<w:abstractNum [^>]*w:abstractNumId="${abstractId}"[^>]*>[\\s\\S]*?</w:abstractNum>`))[0]
        expect(abstract).toMatch(/<w:lvl w:ilvl="0"[^>]*>[\s\S]*?<w:numFmt w:val="decimal"\/>/)
        expect(num).toMatch(/<w:startOverride w:val="1"\/>|<w:start w:val="1"\/>/)
        // Ordered list of the template (numId 2, docs/docxtemplate.md)
        expect(abstractId).toBe(numbering.match(/<w:num w:numId="2"[^>]*>\s*<w:abstractNumId w:val="(\d+)"/)[1])
      })

      it('Bullet lists use a numbering defined in numbering.xml', () => {
        var numbering = zip.file('word/numbering.xml').asText()
        var bullet = helpers.ooxmlParagraphs(xml).find(p => helpers.ooxmlText(p) === 'Bullet A')
        var numId = helpers.ooxmlValues(bullet, 'w:numId', 'w:val')[0]
        expect(helpers.ooxmlValues(numbering, 'w:num', 'w:numId')).toContain(numId)
      })

      // Styles of the converted HTML (Heading1-6, Caption, ListParagraph, CodeChar, PwndocLink) defined in the Default Template,
      // whose own styles have French identifiers (Titre1, Lgende...)
      it('Styles used by the converted HTML are defined in the template', () => {
        var styles = zip.file('word/styles.xml').asText()
        var defined = new Set(helpers.ooxmlValues(styles, 'w:style', 'w:styleId'))
        var used = new Set([...helpers.ooxmlValues(xml, 'w:pStyle', 'w:val'), ...helpers.ooxmlValues(xml, 'w:rStyle', 'w:val')])
        expect([...used].filter(style => !defined.has(style))).toEqual([])
      })

      it('Paragraph and character styles of the template used by the report are defined', () => {
        var styles = zip.file('word/styles.xml').asText()
        var defined = new Set(helpers.ooxmlValues(styles, 'w:style', 'w:styleId'))
        ;['Normal10', 'Contenudetableau', 'ContenudeTableauSmall', 'Code', 'CVSS', 'VulnRef', 'VulnDef', 'reflink'].forEach(style => expect(defined.has(style)).toBe(true))
      })
    })

    describe('Template filters', () => {
      it('$index in loops and nested loops', async () => {
        var {paragraphs} = await generateWith([
          'START',
          '{#findings | sortArrayByField: \'cvss.baseMetricScore\':-1}',
          'F{$index}: {title}',
          '{#references}',
          'R{$index}: {.}',
          '{/references}',
          '{/}',
          '{#scope}S{$index + 1}={name}{/scope}',
          'END'
        ])
        expect(between(paragraphs, 'START', 'END')).toEqual([
          `F0: ${findingTitles.critical}`, 'R0: https://owasp.org/a?b=1&c=2', 'R1: CWE-89',
          `F1: ${findingTitles.high}`,
          `F2: ${findingTitles.medium}`, 'R0: https://owasp.org/xss',
          `F3: ${findingTitles.low}`,
          `F4: ${findingTitles.none}`,
          'S1=rpt.example.comS2=10.0.0.0/24 & <internal>'
        ])
      })

      it('VULN-n bookmarks and references built with $index', async () => {
        var {xml, paragraphs} = await generateWith([
          'START',
          '{#findings | where: \'cvss.baseSeverity != ""\' | sortArrayByField: \'cvss.baseMetricScore\':-1}',
          '{@\'VULN-\'+($index+1) | bookmarkCreate | p: \'VulnDef\'}',
          '{@\'VULN-\'+($index+1) | bookmarkRef | p: \'VulnRef\'}',
          '{/}',
          'END'
        ])
        expect([...xml.matchAll(/<w:bookmarkStart w:id="\d+" w:name="([^"]+)"\/>/g)].map(m => m[1])).toEqual(['VULN_1', 'VULN_2', 'VULN_3', 'VULN_4'])
        expect([...xml.matchAll(/ REF (\S+) \\h /g)].map(m => m[1])).toEqual(['VULN_1', 'VULN_2', 'VULN_3', 'VULN_4'])
        expect(between(paragraphs, 'START', 'END')).toEqual(['', 'VULN-1', '', 'VULN-2', '', 'VULN-3', '', 'VULN-4'])
      })

      it('Sort, where, count, select, join, groupBy, length', async () => {
        var {paragraphs} = await generateWith([
          'START',
          'Count: {findings | length} C{findings | count: \'Critical\'} H{findings | count: \'High\':\'base\'} M{findings | count: \'Medium\':\'environmental\'} L{findings | count: \'Low\'}',
          'Sorted: {findings | select: \'title\' | sort | join: \' / \'}',
          'By score: {findings | sort: \'cvss.baseMetricScore\' | select: \'cvss.baseMetricScore\' | join: \',\'}',
          'Desc: {findings | sortDESC: \'cvss.baseMetricScore\' | select: \'cvss.baseSeverity\' | join: \',\'}',
          '{#findings | where: \'cvss.baseSeverity == "High" || cvss.baseSeverity == "Critical"\' | sortASC: \'title\'}W: {title}{/}',
          '{#findings | groupBy: \'category\'}',
          'G: {key} = {value | select: \'title\' | sort | join: \' + \'}',
          '{/}',
          '{#categories | sortASC: \'categoryName\'}C: {categoryName} ({categoryFindings | length}) {/}',
          'Unique: {findings | uniqFindings | length}',
          'END'
        ])
        var titles = findingTitles
        expect(between(paragraphs, 'START', 'END')).toEqual([
          'Count: 5 C1 H1 M1 L1',
          `Sorted: ${Object.values(titles).sort().join(' / ')}`,
          'By score: 3.7,6.1,8.1,9.8,', // Findings without score at the end
          'Desc: Critical,High,Medium,Low,',
          `W: ${titles.high}W: ${titles.critical}`,
          `G: rpt Web = ${[titles.critical, titles.medium].sort().join(' + ')}`,
          `G: rpt Infra = ${titles.low}`,
          `G: No Category = ${[titles.high, titles.none].sort().join(' + ')}`,
          'C: No Category (2) C: rpt Infra (1) C: rpt Web (2) ',
          'Unique: 5'
        ])
      })

      // Missing values are "" in the report data (CVSS score of a finding without vector)
      it('sort filter: findings without score at the end', async () => {
        var {paragraphs} = await generateWith(['START', '{findings | sort: \'cvss.baseMetricScore\' | select: \'title\' | join: \' / \'}', 'END'])
        expect(between(paragraphs, 'START', 'END')).toEqual([[findingTitles.low, findingTitles.medium, findingTitles.high, findingTitles.critical, findingTitles.none].join(' / ')])
      })

      it('Text filters: upper, lower, title, capfirst, initials, split, lines, d, translate, changeID', async () => {
        var {paragraphs} = await generateWith([
          'START',
          '{name | upper}|{name | lower}|{name | title}|{\'rpt word\' | capfirst}|{creator.firstname | initials}',
          '{\'a, b, c\' | split: \', \' | join: \'-\'}|{\'<p>one</p><p>two</p>\' | lines | join: \'+\'}|{missing | d: \'default\'}|{\'Attack Vector\' | translate: \'fr\'}',
          '{#findings | sortArrayByField: \'cvss.baseMetricScore\':-1}{identifier | changeID: \'PRJ-\'} {/}',
          'END'
        ])
        expect(between(paragraphs, 'START', 'END')).toEqual([
          'RPT RICH AUDIT|rpt rich audit|Rpt Rich Audit|Rpt word|R.',
          'a-b-c|one+two|default|Vecteur d\'attaque',
          expect.stringMatching(/^PRJ-00\d PRJ-00\d PRJ-00\d PRJ-00\d PRJ-00\d $/)
        ])
      })

      it('Dates: convertDate, convertDateLocale, fromTo', async () => {
        var {paragraphs} = await generateWith([
          'START',
          '{date | convertDate: \'full\'}|{date | convertDate: \'short\'}',
          '{date_start | fromTo: date_end:\'en-US\'}|{date_start | fromTo: \'2026-04-20\':\'en-US\'}|{date_start | fromTo: date_start:\'en-US\'}',
          'END'
        ])
        expect(between(paragraphs, 'START', 'END')).toEqual([
          'Monday, March 16, 2026|03/16/2026',
          'from 02 to 03/13/2026|from 03/02 to 04/20/2026|on 03/02/2026'
        ])
      })

      it('linkTo and mailto: hyperlink fields with escaped target and text', async () => {
        var {xml, paragraphs} = await generateWith([
          'START',
          '{@\'rpt link & <co>\' | linkTo: \'https://example.com/?a=1&b="2"\'}',
          '{@\'rpt@example.com\' | mailto}',
          'END'
        ])
        expect(xml).toContain('<w:instrText xml:space="preserve"> HYPERLINK "https://example.com/?a=1&amp;b=&quot;2&quot;" </w:instrText>')
        expect(xml).toContain('<w:instrText xml:space="preserve"> HYPERLINK "mailto:rpt@example.com" </w:instrText>')
        expect(between(paragraphs, 'START', 'END')).toEqual(['rpt link & <co>', 'rpt@example.com'])
      })

      it('Rich text with convertHTML: custom fields of the audit, the findings and the sections', async () => {
        var {xml, paragraphs} = await generateWith([
          'START',
          '{-w:p rptnotes}{@text | convertHTML}{/rptnotes}',
          '{#findings | where: \'cvss.baseSeverity == "Critical"\'}',
          'Owner: {rptowner}',
          '{-w:p rptimpact}{@text | convertHTML: \'Normal10\'}{/rptimpact}',
          '{/}',
          'Section: {rpt_summary.name}',
          '{-w:p rpt_summary.rptbody}{@text | convertHTML}{/rpt_summary.rptbody}',
          'END'
        ])
        expect(between(paragraphs, 'START', 'END')).toEqual([
          'General notes & more', 'Owner: Team <A&B>', 'Impact high', 'Section: Rpt Summary', 'Section body <b>', 'Section item'
        ])
        var impact = helpers.ooxmlParagraphs(xml).find(p => helpers.ooxmlText(p) === 'Impact high')
        expect(helpers.ooxmlValues(impact, 'w:pStyle', 'w:val')).toEqual(['Normal10'])
      })

      it('Template tags written in the audit data are not interpreted', async () => {
        var {paragraphs} = await generateWith([
          'START',
          '{#findings | where: \'cvss.baseSeverity == ""\'}{title}{/}',
          '{#findings | where: \'cvss.baseSeverity == ""\'}',
          '{-w:p description}{@text | convertHTML}{/description}',
          '{/}',
          'END'
        ])
        expect(between(paragraphs, 'START', 'END')).toEqual([findingTitles.none, 'Informational {title}'])
      })

      it('Numbered lists: one numbering identifier per list, items of a list share it', async () => {
        var {xml, zip} = await generateWith([
          '{#findings}',
          '{-w:p description}{@text | convertHTML}{/description}',
          '{/}'
        ])
        var paragraph = (content) => helpers.ooxmlParagraphs(xml).find(p => helpers.ooxmlText(p) === content)
        var numId = (content) => helpers.ooxmlValues(paragraph(content), 'w:numId', 'w:val')[0]
        expect(numId('Step one')).toBe(numId('Step two'))
        expect(numId('Restart one')).toBe(numId('Restart two'))
        expect(numId('Open the page')).toBe(numId('Post the payload'))
        // Nested list: numbering instance of its parent list at the next level
        expect(numId('Step two.a')).toBe(numId('Step one'))
        expect(helpers.ooxmlValues(paragraph('Step two.a'), 'w:ilvl', 'w:val')).toEqual(['1'])
        var lists = ['Step one', 'Restart one', 'Open the page', 'Reload'].map(numId)
        lists.forEach(id => expect(id).toMatch(/^\d+$/))
        expect(new Set(lists).size).toBe(lists.length) // Restarts at 1: own numbering for each list
        expect(numId('Bullet A')).toBe('1')
        var numbering = zip.file('word/numbering.xml').asText()
        lists.forEach(id => expect(numbering).toContain(`<w:num w:numId="${id}">`))
      })

      // Custom fields of the sections are not populated: a custom field saved by its identifier is looked up
      it('Section custom field saved by its identifier, like the custom fields of the audit and the findings', async () => {
        var update = (customFields) => request(app).put(`/api/audits/${auditId}/sections/${sectionId}`).set('Cookie', creatorCookie).send({customFields: customFields})
        expect((await update([{customField: customFieldIds.body, text: '<p>Saved by identifier</p>'}])).status).toBe(200)
        try {
          var {paragraphs} = await generateWith(['START', '{-w:p rpt_summary.rptbody}{@text | convertHTML}{/rpt_summary.rptbody}', 'END'])
          expect(between(paragraphs, 'START', 'END')).toEqual(['Saved by identifier'])
        }
        finally {
          expect((await update(sectionFields)).status).toBe(200)
        }
      })

      it('Invalid templates: error, next generations still work', async () => {
        var generateTemplate = async (paragraphs) => {
          var response = await request(app).put(`/api/templates/${miniTemplateId}`).set('Cookie', adminCookie)
            .send({file: templateWith(paragraphs).toString('base64'), ext: 'docx'})
          expect(response.status).toBe(200)
          await setTemplate(miniTemplateId)
          return request(app).get(`/api/audits/${auditId}/generate`).set('Cookie', creatorCookie)
        }
        expect((await generateTemplate(['{#findings}', '{title', '{/findings}'])).status).toBe(500) // Syntax error
        expect((await generateTemplate(['{findings | unknownFilter}'])).status).toBe(500) // Error when rendering
        expect((await generateTemplate(['{#findings}{title}'])).status).toBe(500) // Unclosed loop
        var {paragraphs} = await generateWith(['START', '{findings | length}', 'END'])
        expect(between(paragraphs, 'START', 'END')).toEqual(['5'])
      })

      it('Invalid templates: the error explains which tag is wrong', async () => {
        var generateTemplate = async (paragraphs) => {
          await request(app).put(`/api/templates/${miniTemplateId}`).set('Cookie', adminCookie).send({file: templateWith(paragraphs).toString('base64'), ext: 'docx'})
          await setTemplate(miniTemplateId)
          return request(app).get(`/api/audits/${auditId}/generate`).set('Cookie', creatorCookie)
        }
        expect((await generateTemplate(['{#findings}', '{title', '{/findings}'])).body.datas).toMatch(/The tag beginning with "\{title" is unclosed/)
        expect((await generateTemplate(['{findings | unknownFilter}'])).body.datas).toMatch(/findings \| unknownFilter/)
      })

      // Last test: deletes custom fields used by the audit, the findings and the section
      it('Custom fields deleted: report generated, their values left out', async () => {
        var template = ['START', '{-w:p rptnotes}{@text | convertHTML}{/rptnotes}', '{#findings | where: \'cvss.baseSeverity == "Critical"\'}',
          'Owner: {rptowner}', '{-w:p rptimpact}{@text | convertHTML}{/rptimpact}', '{/}', '{-w:p rpt_summary.rptbody}{@text | convertHTML}{/rpt_summary.rptbody}', 'END']
        for (var key of ['notes', 'impact', 'body']) {
          expect((await request(app).delete(`/api/data/custom-fields/${customFieldIds[key]}`).set('Cookie', adminCookie)).status).toBe(200)
          delete customFieldIds[key]
        }
        var {paragraphs} = await generateWith(template)
        // Custom fields of the audit and of the findings: populated as null, left out. Section: copy of the custom field kept
        expect(between(paragraphs, 'START', 'END')).toEqual(['Owner: Team <A&B>', 'Section body <b>', 'Section item'])
      })
    })
  })
}
