/*
  Global backup: export of all the data, restore (full replacement), optional encryption.
  Run last: a restore replaces the whole database.
*/
const PizZip = require('pizzip');
const mongoose = require('mongoose');

module.exports = function(request, app) {
  describe('Backup Suite Tests', () => {
    var adminCookie, userCookie

    // supertest: binary response body as a Buffer
    var binary = (res, callback) => {
      var chunks = []
      res.on('data', chunk => chunks.push(Buffer.from(chunk)))
      res.on('end', () => callback(null, Buffer.concat(chunks)))
    }
    var exportBackup = (body = {}, cookie = adminCookie) => request(app).post('/api/backup/export').set('Cookie', cookie).send(body).buffer(true).parse(binary)
    var importBackup = (buffer, password, cookie = adminCookie) => {
      var req = request(app).post('/api/backup/import').set('Cookie', cookie).set('Content-Type', 'application/octet-stream')
      if (password) req = req.set('X-Backup-Password', Buffer.from(password).toString('base64'))
      return req.send(buffer)
    }
    var count = (model) => mongoose.model(model).countDocuments()
    var getVulns = async () => (await request(app).get('/api/vulnerabilities').set('Cookie', adminCookie)).body.datas

    beforeAll(async () => {
      var response = await request(app).post('/api/users/token').send({username: 'admin', password: 'Admin123'})
      adminCookie = [`token=JWT ${response.body.datas.token}`]
      response = await request(app).post('/api/users/token').send({username: 'user2', password: 'User1234'})
      userCookie = [`token=JWT ${response.body.datas.token}`]
    })

    it('Only allowed users can export or restore', async () => {
      expect((await exportBackup({}, userCookie)).status).toBe(403)
      expect((await importBackup(Buffer.from('x'), null, userCookie)).status).toBe(403)
    })

    it('Export contains every collection and the template files', async () => {
      var response = await exportBackup()
      expect(response.status).toBe(200)
      expect(response.headers['content-disposition']).toMatch(/pwndoc-ng-backup-.*\.zip"/)

      var zip = new PizZip(response.body)
      var manifest = JSON.parse(zip.file('manifest.json').asText())
      expect(manifest.format).toBe('pwndoc-ng-backup')
      expect(manifest.collections.User).toBe(await count('User'))
      expect(manifest.collections.Audit).toBe(await count('Audit'))
      expect(manifest.collections.Vulnerability).toBe(await count('Vulnerability'))
      expect(manifest.collections.Template).toBe(await count('Template'))
      expect(manifest.templates.length).toBeGreaterThan(0)
      expect(zip.file(`templates/${manifest.templates[0]}`)).toBeTruthy()
      // Extended JSON: identifiers and dates keep their types, sessions are not exported
      var users = zip.file('data/User.json').asText()
      expect(users).toContain('"$oid"')
      expect(users).not.toContain('refreshTokens')
    })

    it('Restore replaces all the data by the backup', async () => {
      var backupFile = (await exportBackup()).body
      var vulnCount = await count('Vulnerability')
      var auditCount = await count('Audit')

      // Changes made after the backup
      var vuln = (await getVulns())[0]
      expect((await request(app).delete(`/api/vulnerabilities/${vuln._id}`).set('Cookie', adminCookie)).status).toBe(200)
      expect((await request(app).post('/api/companies').set('Cookie', adminCookie).send([{name: 'Company created after backup'}])).status).toBe(201)

      var response = await importBackup(backupFile)
      expect(response.status).toBe(200)
      expect(response.body.datas.collections.Vulnerability).toBe(vulnCount)

      expect(await count('Vulnerability')).toBe(vulnCount)
      expect(await count('Audit')).toBe(auditCount)
      expect((await getVulns()).some(v => v._id === vuln._id)).toBe(true)
      expect(await mongoose.model('Company').countDocuments({name: 'Company created after backup'})).toBe(0)
      // Same users (password hashes kept): login still works
      response = await request(app).post('/api/users/token').send({username: 'admin', password: 'Admin123'})
      expect(response.status).toBe(200)
    })

    it('Encrypted backup needs the right password', async () => {
      var response = await exportBackup({password: 'Backup-Pass-2026'})
      expect(response.status).toBe(200)
      expect(response.headers['content-disposition']).toMatch(/\.zip\.enc"/)
      var encrypted = response.body
      expect(encrypted.subarray(0, 2).toString()).not.toBe('PK')

      expect((await importBackup(encrypted)).status).toBe(422)
      response = await importBackup(encrypted, 'wrong password')
      expect(response.status).toBe(422)
      expect(response.body.datas).toMatch(/password/i)

      response = await importBackup(encrypted, 'Backup-Pass-2026')
      expect(response.status).toBe(200)
      expect(response.body.datas.collections.User).toBe(await count('User'))
    })

    it('Invalid files are refused without modifying the data', async () => {
      var users = await count('User')
      expect((await importBackup(Buffer.from('not a backup'))).status).toBe(422)

      var zip = new PizZip()
      zip.file('manifest.json', JSON.stringify({format: 'other'}))
      expect((await importBackup(zip.generate({type: 'nodebuffer'}))).status).toBe(422)

      zip = new PizZip()
      zip.file('manifest.json', JSON.stringify({format: 'pwndoc-ng-backup', version: 1, collections: {}}))
      var response = await importBackup(zip.generate({type: 'nodebuffer'}))
      expect(response.status).toBe(422)
      expect(response.body.datas).toMatch(/not found/)

      expect(await count('User')).toBe(users)
    })

    it('Failed restore puts the previous data back', async () => {
      var zip = new PizZip((await exportBackup()).body)
      var counts = {User: await count('User'), Vulnerability: await count('Vulnerability'), Audit: await count('Audit')}
      // Two companies with the same identifier: the insertion fails after the first collections were replaced
      var id = {'$oid': '5f1c0c3c2a6b2c00cccccccc'}
      zip.file('data/Company.json', JSON.stringify([{_id: id, name: 'Duplicate A'}, {_id: id, name: 'Duplicate B'}]))
      var manifest = JSON.parse(zip.file('manifest.json').asText())
      manifest.collections.Company = 2
      zip.file('manifest.json', JSON.stringify(manifest))

      var response = await importBackup(zip.generate({type: 'nodebuffer'}))
      expect(response.status).toBe(422)
      expect(response.body.datas).toMatch(/previous data has been kept/)
      expect(await count('User')).toBe(counts.User)
      expect(await count('Vulnerability')).toBe(counts.Vulnerability)
      expect(await count('Audit')).toBe(counts.Audit)
      expect(await mongoose.model('Company').countDocuments({name: /Duplicate/})).toBe(0)
    })
  })
}
