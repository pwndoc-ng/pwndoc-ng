/*
  Backups stored on the server: full or partial backups, optional encryption, upload, download,
  restore of the selected data (replace or merge).
  Run last: a restore replaces the data of the database.
*/
const PizZip = require('pizzip');
const mongoose = require('mongoose');

module.exports = function(request, app) {
  describe('Backup Suite Tests', () => {
    var adminCookie, userCookie
    var ALL_CATEGORIES = ['audits', 'images', 'vulnerabilities', 'users', 'companies', 'clients', 'templates', 'languages',
      'auditTypes', 'vulnerabilityTypes', 'vulnerabilityCategories', 'customFields', 'customSections', 'settings']

    // supertest: binary response body as a Buffer
    var binary = (res, callback) => {
      var chunks = []
      res.on('data', chunk => chunks.push(Buffer.from(chunk)))
      res.on('end', () => callback(null, Buffer.concat(chunks)))
    }
    var createBackup = (body = {}, cookie = adminCookie) => request(app).post('/api/backups').set('Cookie', cookie).send(body)
    var listBackups = (cookie = adminCookie) => request(app).get('/api/backups').set('Cookie', cookie)
    var download = (id, cookie = adminCookie) => request(app).get(`/api/backups/${id}/download`).set('Cookie', cookie).buffer(true).parse(binary)
    var upload = (buffer, fileName = 'backup.zip', cookie = adminCookie) => request(app).post('/api/backups/upload')
      .set('Cookie', cookie).set('Content-Type', 'application/octet-stream').set('X-Backup-Filename', encodeURIComponent(fileName)).send(buffer)
    var restore = (id, body = {}, cookie = adminCookie) => request(app).post(`/api/backups/${id}/restore`).set('Cookie', cookie).send(body)
    var deleteBackup = (id, cookie = adminCookie) => request(app).delete(`/api/backups/${id}`).set('Cookie', cookie)
    var count = (model, filter = {}) => mongoose.model(model).countDocuments(filter)
    var getVulns = async () => (await request(app).get('/api/vulnerabilities').set('Cookie', adminCookie)).body.datas
    var zipOf = async (id) => new PizZip((await download(id)).body)

    beforeAll(async () => {
      var response = await request(app).post('/api/users/token').send({username: 'admin', password: 'Admin123'})
      adminCookie = [`token=JWT ${response.body.datas.token}`]
      response = await request(app).post('/api/users/token').send({username: 'user2', password: 'User1234'})
      userCookie = [`token=JWT ${response.body.datas.token}`]
    })

    it('Only allowed users can manage the backups', async () => {
      expect((await listBackups(userCookie)).status).toBe(403)
      expect((await createBackup({}, userCookie)).status).toBe(403)
      expect((await upload(Buffer.from('x'), 'x.zip', userCookie)).status).toBe(403)
      expect((await restore('20261108-120000-abcdef01', {}, userCookie)).status).toBe(403)
      expect((await deleteBackup('20261108-120000-abcdef01', userCookie)).status).toBe(403)
      expect((await download('20261108-120000-abcdef01', userCookie)).status).toBe(403)
    })

    it('Full backup is stored on the server with every collection and the template files', async () => {
      var response = await createBackup({name: 'Full backup'})
      expect(response.status).toBe(201)
      var info = response.body.datas
      expect(info).toMatchObject({name: 'Full backup', type: 'full', encrypted: false, origin: 'created'})
      expect(info.categories).toEqual(ALL_CATEGORIES)
      expect(info.collections.User).toBe(await count('User'))
      expect(info.size).toBeGreaterThan(0)

      var list = (await listBackups()).body.datas
      expect(list.find(backup => backup.id === info.id)).toMatchObject({name: 'Full backup', type: 'full'})

      response = await download(info.id)
      expect(response.status).toBe(200)
      expect(response.headers['content-disposition']).toMatch(/pwndoc-ng-Full_backup-.*\.zip"/)
      var zip = new PizZip(response.body)
      var manifest = JSON.parse(zip.file('manifest.json').asText())
      expect(manifest).toMatchObject({format: 'pwndoc-ng-backup', version: 2, type: 'full'})
      expect(manifest.collections.Audit).toBe(await count('Audit'))
      expect(manifest.collections.Vulnerability).toBe(await count('Vulnerability'))
      expect(manifest.templates.length).toBeGreaterThan(0)
      expect(zip.file(`templates/${manifest.templates[0]}`)).toBeTruthy()
      // Extended JSON: identifiers and dates keep their types, sessions are not saved
      var users = zip.file('data/User.json').asText()
      expect(users).toContain('"$oid"')
      expect(users).not.toContain('refreshTokens')
    })

    it('Partial backup contains the selected data and its dependencies', async () => {
      var response = await createBackup({name: 'Partial', categories: ['clients', 'vulnerabilities']})
      expect(response.status).toBe(201)
      expect(response.body.datas.type).toBe('partial')
      expect(response.body.datas.categories).toEqual(['images', 'vulnerabilities', 'companies', 'clients'])

      var zip = await zipOf(response.body.datas.id)
      expect(Object.keys(zip.files).filter(file => file.startsWith('data/')).sort())
        .toEqual(['data/Client.json', 'data/Company.json', 'data/Image.json', 'data/Vulnerability.json', 'data/VulnerabilityUpdate.json'])
      expect(zip.file('templates/')).toBeFalsy()

      expect((await createBackup({categories: []})).status).toBe(422)
      expect((await createBackup({categories: ['unknown']})).status).toBe(422)
    })

    it('Replace restore puts the data of the backup back', async () => {
      var id = (await createBackup({name: 'Before changes'})).body.datas.id
      var vulnCount = await count('Vulnerability')
      var auditCount = await count('Audit')

      // Changes made after the backup
      var vuln = (await getVulns())[0]
      expect((await request(app).delete(`/api/vulnerabilities/${vuln._id}`).set('Cookie', adminCookie)).status).toBe(200)
      expect((await request(app).post('/api/companies').set('Cookie', adminCookie).send([{name: 'Company created after backup'}])).status).toBe(201)

      var response = await restore(id, {mode: 'replace'})
      expect(response.status).toBe(200)
      expect(response.body.datas.collections.Vulnerability).toBe(vulnCount)
      expect(response.body.datas.categories).toEqual(ALL_CATEGORIES)

      expect(await count('Vulnerability')).toBe(vulnCount)
      expect(await count('Audit')).toBe(auditCount)
      expect((await getVulns()).some(v => v._id === vuln._id)).toBe(true)
      expect(await count('Company', {name: 'Company created after backup'})).toBe(0)
      // Same users (password hashes kept): login still works
      response = await request(app).post('/api/users/token').send({username: 'admin', password: 'Admin123'})
      expect(response.status).toBe(200)
    })

    it('Restore of selected data only modifies this data', async () => {
      var id = (await createBackup()).body.datas.id
      var vulnCount = await count('Vulnerability')
      var vuln = (await getVulns())[0]
      await request(app).delete(`/api/vulnerabilities/${vuln._id}`).set('Cookie', adminCookie)
      await request(app).post('/api/companies').set('Cookie', adminCookie).send([{name: 'Company kept'}])

      var response = await restore(id, {mode: 'replace', categories: ['vulnerabilities']})
      expect(response.status).toBe(200)
      expect(Object.keys(response.body.datas.collections)).toEqual(['Vulnerability', 'VulnerabilityUpdate'])
      expect(await count('Vulnerability')).toBe(vulnCount)
      expect(await count('Company', {name: 'Company kept'})).toBe(1)

      // Data not in the backup cannot be restored
      var partial = (await createBackup({categories: ['companies']})).body.datas.id
      response = await restore(partial, {categories: ['users']})
      expect(response.status).toBe(422)
      expect(response.body.datas).toMatch(/not in the backup/)
    })

    it('Merge restore adds and updates documents without deleting anything', async () => {
      var companies = (await request(app).get('/api/companies').set('Cookie', adminCookie)).body.datas
      expect(companies.length).toBeGreaterThan(1)
      var id = (await createBackup({categories: ['companies']})).body.datas.id

      // After the backup: one company renamed, one deleted, one created
      await mongoose.model('Company').updateOne({_id: companies[0]._id}, {name: 'Renamed after backup'})
      await mongoose.model('Company').deleteOne({_id: companies[1]._id})
      await request(app).post('/api/companies').set('Cookie', adminCookie).send([{name: 'Created after merge backup'}])

      var response = await restore(id, {mode: 'merge'})
      expect(response.status).toBe(200)
      expect(await count('Company', {_id: companies[0]._id, name: companies[0].name})).toBe(1)
      expect(await count('Company', {_id: companies[1]._id})).toBe(1)
      expect(await count('Company', {name: 'Created after merge backup'})).toBe(1)
    })

    it('Merge restore in conflict with the current data is cancelled', async () => {
      var company = (await request(app).get('/api/companies').set('Cookie', adminCookie)).body.datas[0]
      var id = (await createBackup({categories: ['companies']})).body.datas.id
      // Same unique name with another identifier
      await mongoose.model('Company').deleteOne({_id: company._id})
      await mongoose.model('Company').create({name: company.name})
      var companyCount = await count('Company')

      var response = await restore(id, {mode: 'merge'})
      expect(response.status).toBe(422)
      expect(response.body.datas).toMatch(/previous data has been kept/)
      expect(response.body.datas).toMatch(/conflict/)
      expect(await count('Company')).toBe(companyCount)
      expect(await count('Company', {_id: company._id})).toBe(0)
    })

    it('Encrypted backup: information readable, data restored with the right password only', async () => {
      var response = await createBackup({name: 'Encrypted', categories: ['users'], password: 'Backup-Pass-2026'})
      expect(response.status).toBe(201)
      var id = response.body.datas.id
      expect(response.body.datas.encrypted).toBe(true)

      response = await download(id)
      expect(response.headers['content-disposition']).toMatch(/\.zip\.enc"/)
      var encrypted = response.body
      expect(encrypted.subarray(0, 20).toString()).toBe('PWNDOCNG-BACKUP-ENC2')

      expect((await restore(id)).status).toBe(422)
      response = await restore(id, {password: 'wrong password'})
      expect(response.status).toBe(422)
      expect(response.body.datas).toMatch(/password/i)
      response = await restore(id, {password: 'Backup-Pass-2026'})
      expect(response.status).toBe(200)
      expect(response.body.datas.collections.User).toBe(await count('User'))

      // Uploaded on another instance: name and content known without the password
      response = await upload(encrypted, 'copy.zip.enc')
      expect(response.status).toBe(201)
      expect(response.body.datas).toMatchObject({name: 'Encrypted', type: 'partial', categories: ['users'], encrypted: true, origin: 'uploaded'})

      // Modified header: refused at the restore
      var tampered = Buffer.from(encrypted)
      tampered.write('Encrypteb', tampered.indexOf('Encrypted'))
      var tamperedId = (await upload(tampered)).body.datas.id
      response = await restore(tamperedId, {password: 'Backup-Pass-2026'})
      expect(response.status).toBe(422)
    })

    it('Uploaded backups are checked, backups of the first version are accepted', async () => {
      var backups = (await listBackups()).body.datas.length
      expect((await upload(Buffer.from('not a backup'))).status).toBe(422)

      var zip = new PizZip()
      zip.file('manifest.json', JSON.stringify({format: 'other'}))
      expect((await upload(zip.generate({type: 'nodebuffer'}))).status).toBe(422)

      zip = new PizZip()
      zip.file('manifest.json', JSON.stringify({format: 'pwndoc-ng-backup', version: 2, categories: ['users'], collections: {}}))
      var response = await upload(zip.generate({type: 'nodebuffer'}))
      expect(response.status).toBe(422)
      expect(response.body.datas).toMatch(/not found/)
      expect((await listBackups()).body.datas.length).toBe(backups)

      // First version: every collection, no name, type nor categories
      zip = await zipOf((await createBackup()).body.datas.id)
      var manifest = JSON.parse(zip.file('manifest.json').asText())
      zip.file('manifest.json', JSON.stringify({format: manifest.format, version: 1, createdAt: manifest.createdAt, collections: manifest.collections, templates: manifest.templates}))
      response = await upload(zip.generate({type: 'nodebuffer'}), 'pwndoc-ng-backup-20261101-1200.zip')
      expect(response.status).toBe(201)
      expect(response.body.datas).toMatchObject({name: 'pwndoc-ng-backup-20261101-1200', type: 'full', encrypted: false})
      expect((await restore(response.body.datas.id, {mode: 'merge'})).status).toBe(200)
    })

    it('Failed restore puts the previous data back', async () => {
      var zip = await zipOf((await createBackup()).body.datas.id)
      var counts = {User: await count('User'), Vulnerability: await count('Vulnerability'), Audit: await count('Audit')}
      // Two companies with the same identifier: the insertion fails after the first collections were replaced
      var id = {'$oid': '5f1c0c3c2a6b2c00cccccccc'}
      zip.file('data/Company.json', JSON.stringify([{_id: id, name: 'Duplicate A'}, {_id: id, name: 'Duplicate B'}]))
      var manifest = JSON.parse(zip.file('manifest.json').asText())
      manifest.collections.Company = 2
      zip.file('manifest.json', JSON.stringify(manifest))

      var backupId = (await upload(zip.generate({type: 'nodebuffer'}))).body.datas.id
      var response = await restore(backupId)
      expect(response.status).toBe(422)
      expect(response.body.datas).toMatch(/previous data has been kept/)
      expect(await count('User')).toBe(counts.User)
      expect(await count('Vulnerability')).toBe(counts.Vulnerability)
      expect(await count('Audit')).toBe(counts.Audit)
      expect(await count('Company', {name: /Duplicate/})).toBe(0)
    })

    it('Deleted backups are removed from the server', async () => {
      var id = (await createBackup({name: 'To delete', categories: ['settings']})).body.datas.id
      expect((await deleteBackup(id)).status).toBe(200)
      expect((await listBackups()).body.datas.some(backup => backup.id === id)).toBe(false)
      expect((await download(id)).status).toBe(404)
      expect((await deleteBackup(id)).status).toBe(404)
      // Identifiers are checked: no access to other files
      expect((await download('..%2F..%2Fsrc%2Fconfig%2Fconfig')).status).toBe(404)
      expect((await restore('..%2Fbackup')).status).toBe(404)
    })
  })
}
