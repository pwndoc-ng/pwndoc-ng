/*
  Report templates (upload, download, update, deletion) and generation of the reports with the default template.
  At the end: no more template, audit, audit type or image created here, settings reverted.
*/

module.exports = function(request, app) {
  var helpers = require('./helpers')(request, app)
  var CVSS = helpers.CVSS
  var fs = require('fs')
  var path = require('path')
  var PizZip = require('pizzip')
  var mongoose = require('mongoose')

  var TEMPLATES_DIR = path.join(__dirname, '..', 'report-templates')
  var DEFAULT_TEMPLATE = fs.readFileSync(path.join(TEMPLATES_DIR, 'Default Template.docx'))

  describe('Report Suite Tests', () => {
    var adminCookie, creatorCookie, reportCookie, otherCookie

    var download = (id, cookie = adminCookie) => request(app).get(`/api/templates/download/${id}`).set('Cookie', cookie).buffer(true).parse(helpers.binary)
    var generate = (id, cookie = creatorCookie) => request(app).get(`/api/audits/${id}/generate`).set('Cookie', cookie).buffer(true).parse(helpers.binary)
    var documentXml = (buffer) => new PizZip(buffer).file('word/document.xml').asText()
    var templates = async () => (await request(app).get('/api/templates').set('Cookie', adminCookie)).body.datas
    var createTemplate = (name, content, ext = 'docx') => request(app).post('/api/templates').set('Cookie', adminCookie).send({name: name, ext: ext, file: Buffer.from(content).toString('base64')})

    beforeAll(async () => {
      adminCookie = await helpers.login('admin', 'Admin123')
      creatorCookie = await helpers.login('user2', 'User1234')
      reportCookie = await helpers.login('report', 'Report123')
      otherCookie = await helpers.login('tmpuser', 'Tmpuser1')
    })

    describe('Templates', () => {
      var replaceableId

      it('Should not upload a template with missing or invalid parameters', async () => {
        var count = (await templates()).length
        var file = Buffer.from('content').toString('base64')
        var create = (body) => request(app).post('/api/templates').set('Cookie', adminCookie).send(body)
        expect((await create({name: 'No ext', file: file})).status).toBe(422)
        expect((await create({name: 'Bad ext', ext: 'do cx', file: file})).status).toBe(422)
        expect((await create({name: 'Bad ext', ext: 'docx/../../x', file: file})).status).toBe(422)
        expect((await create({name: 'Bad ext', ext: '.docx', file: file})).status).toBe(422)
        expect((await create({name: 'No file', ext: 'docx'})).status).toBe(422)
        expect((await templates()).length).toBe(count)
        expect(fs.existsSync(path.join(TEMPLATES_DIR, 'No file.docx'))).toBe(false)
      })

      it('Upload and download a template', async () => {
        var response = await createTemplate('Report Template', DEFAULT_TEMPLATE)
        expect(response.status).toBe(201)
        expect(response.body.datas).toEqual({_id: expect.any(String), name: 'Report Template', ext: 'docx'})
        var id = response.body.datas._id
        expect(fs.readFileSync(path.join(TEMPLATES_DIR, 'Report Template.docx')).equals(DEFAULT_TEMPLATE)).toBe(true)

        // Users download the templates
        response = await download(id, creatorCookie)
        expect(response.status).toBe(200)
        expect(response.headers['content-disposition']).toBe('attachment; filename="Report Template.docx"')
        expect(response.body.equals(DEFAULT_TEMPLATE)).toBe(true)
      })

      it('Replace the file of a template', async () => {
        var response = await createTemplate('Replaceable', 'Version A')
        replaceableId = response.body.datas._id
        response = await request(app).put(`/api/templates/${replaceableId}`).set('Cookie', adminCookie)
          .send({file: Buffer.from('Version B').toString('base64'), ext: 'docx'})
        expect(response.status).toBe(200)
        expect((await download(replaceableId)).body.toString()).toBe('Version B')
      })

      it('Rename a template', async () => {
        var response = await request(app).put(`/api/templates/${replaceableId}`).set('Cookie', adminCookie).send({name: 'Renamed template'})
        expect(response.status).toBe(200)
        expect((await templates()).find(t => t._id === replaceableId).name).toBe('Renamed template')
        response = await download(replaceableId)
        expect(response.headers['content-disposition']).toBe('attachment; filename="Renamed template.docx"')
        expect(response.body.toString()).toBe('Version B')
        expect(fs.existsSync(path.join(TEMPLATES_DIR, 'Replaceable.docx'))).toBe(false)
      })

      it('Rename a template and replace its file with another type', async () => {
        var response = await request(app).put(`/api/templates/${replaceableId}`).set('Cookie', adminCookie)
          .send({name: 'Renamed twice', ext: 'dotx', file: Buffer.from('Version C').toString('base64')})
        expect(response.status).toBe(200)
        expect((await templates()).find(t => t._id === replaceableId)).toMatchObject({name: 'Renamed twice', ext: 'dotx'})
        response = await download(replaceableId)
        expect(response.headers['content-disposition']).toBe('attachment; filename="Renamed twice.dotx"')
        expect(response.body.toString()).toBe('Version C')
        expect(fs.existsSync(path.join(TEMPLATES_DIR, 'Renamed template.docx'))).toBe(false)
      })

      it('Should not update a template with invalid parameters', async () => {
        var update = (id, body) => request(app).put(`/api/templates/${id}`).set('Cookie', adminCookie).send(body)
        expect((await update(replaceableId, {name: '../Renamed'})).status).toBe(422)
        expect((await update(replaceableId, {ext: 'do/cx', file: 'eA=='})).status).toBe(422)
        var response = await update(replaceableId, {name: 'Report Template'})
        expect(response.status).toBe(422)
        expect(response.body.datas).toBe('Template name already exists')
        expect((await update('deadbeefdeadbeefdeadbeef', {name: 'Unknown'})).status).toBe(404)
        expect((await templates()).find(t => t._id === replaceableId).name).toBe('Renamed twice')
      })

      it('Delete a template and its file', async () => {
        expect((await request(app).delete(`/api/templates/${replaceableId}`).set('Cookie', adminCookie)).status).toBe(200)
        expect((await templates()).map(t => t._id)).not.toContain(replaceableId)
        expect(fs.existsSync(path.join(TEMPLATES_DIR, 'Renamed twice.dotx'))).toBe(false)
      })

      it('Delete a template whose file is missing', async () => {
        var template = await mongoose.model('Template').create({name: 'Template without file', ext: 'docx'})
        var response = await request(app).delete(`/api/templates/${template._id}`).set('Cookie', adminCookie)
        expect(response.status).toBe(200)
        expect(response.body.datas).toBe('Template File not found but deleted successfully in database')
        expect((await templates()).map(t => t._id)).not.toContain(String(template._id))
      })

      it('Download an unknown template', async () => {
        expect((await download('deadbeefdeadbeefdeadbeef')).status).toBe(404)
      })
    })

    describe('Generation', () => {
      var templateId, imageId, auditId, secondAuditId, companyId
      var setTemplate = (id, template) => request(app).put(`/api/audits/${id}/general`).set('Cookie', creatorCookie).send({template: template})

      beforeAll(async () => {
        templateId = (await templates()).find(t => t.name === 'Report Template')._id
        companyId = (await request(app).get('/api/companies').set('Cookie', adminCookie)).body.datas.find(c => c.name === 'Company 1')._id
        imageId = (await request(app).post('/api/images').set('Cookie', creatorCookie).send({value: helpers.PNG_DATA_URI, name: 'burp.png'})).body.datas._id
        var response = await request(app).post('/api/data/audit-types').set('Cookie', adminCookie)
          .send({name: 'Report type', templates: [{template: templateId, locale: 'en'}]})
        expect(response.status).toBe(201)

        response = await request(app).post('/api/audits').set('Cookie', creatorCookie).send({name: 'Report audit', language: 'en', auditType: 'Report type'})
        auditId = response.body.datas.audit._id
        response = await request(app).put(`/api/audits/${auditId}/general`).set('Cookie', creatorCookie)
          .send({company: {_id: companyId}, date_start: '2026-02-02', date_end: '2026-02-13', scope: ['app.example.com']})
        expect(response.status).toBe(200)
        var findings = [
          {title: 'SQL injection in login form', cvssv3: CVSS.critical, description: `<p>The <b>username</b> parameter is injectable</p><img src="${imageId}" alt="Burp request">`, remediation: '<p>Use prepared statements</p>', references: ['https://owasp.org/www-community/attacks/SQL_Injection']},
          {title: 'Stored cross-site scripting', cvssv3: CVSS.medium, description: '<ul><li><p>Comments</p></li><li><p>Profile</p></li></ul>'},
          {title: 'Missing security headers', description: '<p>Informational</p>'},
          {title: 'Default credentials', cvssv3: CVSS.high, remediation: '<p>Ask {_{company.name}_} to change the passwords of {_{scope[0].name}_}</p>'}
        ]
        for (var finding of findings)
          expect((await request(app).post(`/api/audits/${auditId}/findings`).set('Cookie', creatorCookie).send(finding)).status).toBe(200)

        response = await request(app).post('/api/audits').set('Cookie', creatorCookie).send({name: 'Second report audit', language: 'en', auditType: 'Report type'})
        secondAuditId = response.body.datas.audit._id
        await request(app).put(`/api/audits/${secondAuditId}/general`).set('Cookie', creatorCookie).send({scope: ['second.example.com']})
        await request(app).post(`/api/audits/${secondAuditId}/findings`).set('Cookie', creatorCookie).send({title: 'Weak password policy', cvssv3: CVSS.high})
      })

      afterAll(async () => {
        await request(app).put('/api/settings/revert').set('Cookie', adminCookie)
        await request(app).delete(`/api/audits/${auditId}`).set('Cookie', creatorCookie)
        await request(app).delete(`/api/audits/${secondAuditId}`).set('Cookie', creatorCookie)
        await request(app).delete('/api/data/audit-types/Report%20type').set('Cookie', adminCookie)
        await request(app).delete(`/api/templates/${templateId}`).set('Cookie', adminCookie)
        await request(app).delete(`/api/images/${imageId}`).set('Cookie', adminCookie)
      })

      it('Audit gets the template of its type in its language', async () => {
        var audit = (await request(app).get(`/api/audits/${auditId}`).set('Cookie', creatorCookie)).body.datas
        expect(audit.template).toMatchObject({_id: templateId, name: 'Report Template', ext: 'docx'})
      })

      it('Generate the report of an audit', async () => {
        var response = await generate(auditId)
        expect(response.status).toBe(200)
        expect(response.headers['content-disposition']).toBe('attachment; filename="Report%20audit.docx"')
        var zip = new PizZip(response.body)
        var xml = zip.file('word/document.xml').asText()
        expect(xml).toContain('app.example.com') // Scope
        expect(xml).toContain('Company 1')
        expect(xml).toContain('SQL injection in login form')
        expect(xml).toContain('Stored cross-site scripting')
        expect(xml).toContain('Use prepared statements')
        expect(xml).toContain('Burp request') // Caption of the image
        expect(xml).toContain('Comments')
        // Sub-templating: values of the audit in the text of the findings
        expect(xml).toContain('Ask Company 1 to change the passwords of app.example.com')
        expect(xml).not.toMatch(/\{[#/@%]?(title|findings|description)\b/) // No template tag left
        // Findings without CVSS score are not in the findings tables of the default template
        expect(xml).not.toContain('Missing security headers')
        // Image of the finding description, image of the company logo
        var media = Object.keys(zip.files).filter(name => name.startsWith('word/media/')).map(name => zip.file(name).asNodeBuffer())
        expect(media.some(content => content.equals(Buffer.from(helpers.PNG_BASE64, 'base64')))).toBe(true)
      })

      it('Report colors come from the settings', async () => {
        var response = await request(app).put('/api/settings').set('Cookie', adminCookie).send({report: {enabled: true, public: {cvssColors: {
          noneColor: '#4a86e8', lowColor: '#008000', mediumColor: '#f9a009', highColor: '#fe0000', criticalColor: '#123abc'
        }}}})
        expect(response.status).toBe(200)
        var xml = documentXml((await generate(auditId)).body)
        expect(xml).toContain('w:fill="123abc"')
        expect((await request(app).put('/api/settings/revert').set('Cookie', adminCookie)).status).toBe(200)
        expect(documentXml((await generate(auditId)).body)).not.toContain('w:fill="123abc"')
      })

      it('Border of the images from the settings: images of the fields only, not the logo of the company', async () => {
        // Images generated by the image module (not the drawings of the template: charts, images of the cover...)
        var drawings = (xml) => (xml.match(/<w:drawing>[\s\S]*?<\/w:drawing>/g) || []).filter(drawing => drawing.includes('<pic:cNvPr id="0" name="Picture 1" descr="image"/>'))
        var bordered = (xml) => drawings(xml).filter(drawing => drawing.includes('<a:srgbClr val="123456"/>'))
        // Company with a logo ({%company.logo_small} of the default template: 37 pixels high)
        expect((await request(app).post('/api/companies').set('Cookie', adminCookie).send([{name: 'Report logo company', logo: helpers.PNG_DATA_URI}])).status).toBe(201)
        var logoCompanyId = (await request(app).get('/api/companies').set('Cookie', adminCookie)).body.datas.find(c => c.name === 'Report logo company')._id
        expect((await request(app).put(`/api/audits/${auditId}/general`).set('Cookie', creatorCookie).send({company: {_id: logoCompanyId}})).status).toBe(200)
        try {
          var isLogo = (drawing) => drawing.includes('cy="352425"')
          var xml = documentXml((await generate(auditId)).body)
          expect(drawings(xml).filter(isLogo)).toHaveLength(1)
          expect(bordered(xml)).toHaveLength(0) // No border by default
          var response = await request(app).put('/api/settings').set('Cookie', adminCookie).send({report: {enabled: true, private: {imageBorder: true, imageBorderColor: '#123456'}}})
          expect(response.status).toBe(200)
          xml = documentXml((await generate(auditId)).body)
          expect(drawings(xml).filter(isLogo)).toHaveLength(1)
          expect(drawings(xml).filter(isLogo)[0]).not.toContain('srgbClr') // Logo without border
          expect(bordered(xml).length).toBeGreaterThan(0) // Image of the finding
          expect(bordered(xml)).toHaveLength(drawings(xml).length - 1) // All the generated images except the logo
          // Space reserved around the bordered images for the border (else Word cuts its top), not around the logo
          bordered(xml).forEach(drawing => {
            expect(drawing).toContain('<wp:effectExtent l="9525" t="9525" r="9525" b="9525"/>')
            expect(drawing).toContain('<a:ln w="9525"><a:solidFill><a:srgbClr val="123456"/>')
          })
          expect(drawings(xml).filter(isLogo)[0]).toContain('<wp:effectExtent l="0" t="0" r="0" b="0"/>')
        }
        finally {
          await request(app).put('/api/settings/revert').set('Cookie', adminCookie)
          await request(app).put(`/api/audits/${auditId}/general`).set('Cookie', creatorCookie).send({company: {_id: companyId}})
          await request(app).delete(`/api/companies/${logoCompanyId}`).set('Cookie', adminCookie)
        }
      })

      it('Report access: users who read the audit', async () => {
        expect((await generate(auditId, otherCookie)).status).toBe(404)
        var response = await generate(auditId, reportCookie)
        expect(response.status).toBe(200)
        expect(documentXml(response.body)).toContain('SQL injection in login form')
      })

      it('File name without the characters forbidden in file names', async () => {
        expect((await request(app).put(`/api/audits/${auditId}/general`).set('Cookie', creatorCookie).send({name: 'Q1: web/app <test>?'})).status).toBe(200)
        var response = await generate(auditId)
        expect(response.status).toBe(200)
        expect(response.headers['content-disposition']).toBe('attachment; filename="Q1%20webapp%20test.docx"')
        expect(documentXml(response.body)).toContain('SQL injection in login form')
        expect((await request(app).put(`/api/audits/${auditId}/general`).set('Cookie', creatorCookie).send({name: 'Report audit'})).status).toBe(200)
      })

      it('Simultaneous generations produce the report of each audit', async () => {
        var responses = await Promise.all([generate(auditId), generate(secondAuditId), generate(auditId), generate(secondAuditId)])
        responses.forEach(response => expect(response.status).toBe(200))
        var xmls = responses.map(response => documentXml(response.body))
        expect(xmls[0]).toContain('SQL injection in login form')
        expect(xmls[0]).not.toContain('Weak password policy')
        expect(xmls[1]).toContain('second.example.com')
        expect(xmls[1]).toContain('Weak password policy')
        expect(xmls[1]).not.toContain('SQL injection in login form')
        expect(xmls[2]).toEqual(expect.stringContaining('Stored cross-site scripting'))
        expect(xmls[3]).not.toContain('Stored cross-site scripting')
      })

      it('Audit without template', async () => {
        var response = await request(app).post('/api/audits').set('Cookie', creatorCookie).send({name: 'No template audit', language: 'fr', auditType: 'Report type'})
        var id = response.body.datas.audit._id
        response = await request(app).get(`/api/audits/${id}/generate`).set('Cookie', creatorCookie)
        expect(response.status).toBe(422)
        expect(response.body.datas).toBe('Template not defined')
        expect((await request(app).delete(`/api/audits/${id}`).set('Cookie', creatorCookie)).status).toBe(200)
      })

      it('Template file missing', async () => {
        var template = await mongoose.model('Template').create({name: 'Missing file template', ext: 'docx'})
        expect((await setTemplate(secondAuditId, String(template._id))).status).toBe(200)
        var response = await request(app).get(`/api/audits/${secondAuditId}/generate`).set('Cookie', creatorCookie)
        expect(response.status).toBe(422)
        expect(response.body.datas).toBe('Template File not found')
        expect((await setTemplate(secondAuditId, templateId)).status).toBe(200)
        expect((await request(app).delete(`/api/templates/${template._id}`).set('Cookie', adminCookie)).status).toBe(200)
      })

      it('Invalid template file: error, next generations still work', async () => {
        var response = await createTemplate('Broken template', 'This is not a docx file')
        var brokenId = response.body.datas._id
        expect((await setTemplate(secondAuditId, brokenId)).status).toBe(200)
        response = await request(app).get(`/api/audits/${secondAuditId}/generate`).set('Cookie', creatorCookie)
        expect(response.status).toBeGreaterThanOrEqual(400)

        response = await generate(auditId)
        expect(response.status).toBe(200)
        expect(documentXml(response.body)).toContain('SQL injection in login form')

        expect((await setTemplate(secondAuditId, templateId)).status).toBe(200)
        expect((await request(app).delete(`/api/templates/${brokenId}`).set('Cookie', adminCookie)).status).toBe(200)
      })
    })
  })
}
