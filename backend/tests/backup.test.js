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
      'auditTypes', 'vulnerabilityTypes', 'vulnerabilityCategories', 'customFields', 'customSections', 'spellcheckWords', 'settings']

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

    it('Invalid parameters are refused', async () => {
      var backups = (await listBackups()).body.datas.length
      expect((await createBackup({name: 'x'.repeat(101)})).status).toBe(422)
      expect((await createBackup({name: {$ne: ''}})).status).toBe(422)
      expect((await createBackup({password: 1234})).status).toBe(422)
      expect((await createBackup({categories: 'users'})).status).toBe(422)
      // Upload: raw file required
      var response = await request(app).post('/api/backups/upload').set('Cookie', adminCookie).set('Content-Type', 'application/octet-stream')
      expect(response.status).toBe(422)
      response = await request(app).post('/api/backups/upload').set('Cookie', adminCookie).send({file: 'UEsDBA=='})
      expect(response.status).toBe(422)
      expect((await restore('20261108-120000-abcdef01', {password: ['x']})).status).toBe(422)
      expect((await listBackups()).body.datas.length).toBe(backups)
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

    it('Backup larger than the maximum length of a string: created, uploaded and restored', async () => {
      // Audits whose text exceeds the maximum length of a string (data of a collection held as a single string before):
      // compressible text, the archive stays small
      var audits = mongoose.model('Audit').collection
      var documentLength = 15 * 1024 * 1024 // Below the maximum size of a document (16 MB)
      var bigAudits = Math.ceil(require('buffer').constants.MAX_STRING_LENGTH / documentLength) + 1
      var ids = []
      try {
        for (var i = 0; i < bigAudits; i++) {
          var auditId = new mongoose.Types.ObjectId()
          ids.push(auditId)
          await audits.insertOne({_id: auditId, name: `big-backup-${i}`, findings: [{title: `big-${i}`, description: `<p>${i}-${'A'.repeat(documentLength)}</p>`}]})
        }
        var auditCount = await count('Audit')

        // Progress of the operation, read while it runs
        var observe = async (operation) => {
          var states = []
          var finished = false
          var result = operation.then(response => { finished = true; return response })
          while (!finished) {
            var progress = (await request(app).get('/api/backups/progress').set('Cookie', adminCookie)).body.datas
            if (progress) states.push(progress)
            await new Promise(resolve => setTimeout(resolve, 20))
          }
          return {response: await result, states}
        }

        var {response, states} = await observe(createBackup({name: 'Big backup', categories: ['audits'], password: 'Big-Backup-2026'}))
        expect(response.status).toBe(201)
        var data = states.filter(state => state.type === 'creation' && state.step === 'data')
        expect(data.length).toBeGreaterThan(0)
        expect(data.every(state => state.done <= state.total)).toBe(true)
        expect(data[0].total).toBe(auditCount + await count('Image'))
        expect((await request(app).get('/api/backups/progress').set('Cookie', adminCookie)).body.datas).toBeNull()
        expect(response.body.datas.collections.Audit).toBe(auditCount)
        var id = response.body.datas.id

        // Download and upload (streams): same backup
        response = await download(id)
        expect(response.status).toBe(200)
        response = await upload(response.body, 'big.zip.enc')
        expect(response.status).toBe(201)
        expect(response.body.datas).toMatchObject({name: 'Big backup', collections: {Audit: auditCount}, encrypted: true})
        var uploadedId = response.body.datas.id

        // Changed after the backup, then restored
        await audits.updateOne({_id: ids[0]}, {$set: {name: 'big-backup-changed', findings: []}})
        await audits.deleteOne({_id: ids[1]})
        var {response, states} = await observe(restore(uploadedId, {mode: 'replace', categories: ['audits'], password: 'Big-Backup-2026'}))
        expect(response.status).toBe(200)
        data = states.filter(state => state.type === 'restore' && state.step === 'data')
        expect(data.length).toBeGreaterThan(0)
        expect(data[0].total).toBe(auditCount)
        expect(data.every(state => state.done <= state.total)).toBe(true)
        expect(response.body.datas.collections).toEqual({Audit: auditCount})
        expect(await count('Audit')).toBe(auditCount)
        var restored = await audits.aggregate([
          {$match: {_id: {$in: ids}}},
          {$project: {name: 1, length: {$strLenCP: {$first: '$findings.description'}}}}
        ]).toArray()
        expect(restored.length).toBe(bigAudits)
        expect(restored.every(audit => audit.name.startsWith('big-backup-') && audit.name !== 'big-backup-changed')).toBe(true)
        expect(restored.every(audit => audit.length > documentLength)).toBe(true)
        // No temporary collection left
        var collections = (await mongoose.connection.db.listCollections({}, {nameOnly: true}).toArray()).map(c => c.name)
        expect(collections.filter(name => name.startsWith('pwndoc_restore_'))).toEqual([])

        await deleteBackup(id)
        await deleteBackup(uploadedId)
      }
      finally {
        await audits.deleteMany({_id: {$in: ids}})
      }
    }, 300000)

    describe('Automatic backups', () => {
      var schedule = require('../src/lib/backup-schedule')
      var fs = require('fs')
      var path = require('path')
      var DEFAULTS = {time: '02:00', days: [1, 2, 3, 4, 5], keepDaily: 5, keepWeekly: 2, weeklyDay: 5}
      var at = (year, month, day, hours = 2, minutes = 5) => new Date(year, month - 1, day, hours, minutes)
      var item = (id, date, origin = 'scheduled') => ({id, createdAt: date.toISOString(), origin})
      var setSchedule = (backups) => request(app).put('/api/settings').set('Cookie', adminCookie).send({backups})

      it('Rotation: the most recent backups of the days, and of the previous weeks', () => {
        // Monday to Friday: 2026-11-02 (Monday) to 2026-11-20 (Friday), 15 backups, and a backup made by a user
        var backups = [item('manual', at(2026, 10, 1), 'created')]
        for (var day = 2; day <= 20; day++)
          if (at(2026, 11, day).getDay() >= 1 && at(2026, 11, day).getDay() <= 5) backups.push(item(`d${day}`, at(2026, 11, day)))
        var kept = (now, policy = DEFAULTS) => {
          var deleted = schedule.backupsToDelete(backups, policy, now).map(b => b.id)
          return backups.map(b => b.id).filter(id => !deleted.includes(id)).sort()
        }
        // Friday: the five days of the week and the Fridays of the two previous weeks (7), the backup of a user kept
        expect(kept(at(2026, 11, 20, 3))).toEqual(['d16', 'd17', 'd18', 'd19', 'd20', 'd13', 'd6', 'manual'].sort())
        // Wednesday 2026-11-18 (backups until this day): five most recent, Fridays of the two previous weeks
        backups = backups.filter(b => b.id === 'manual' || Number(b.id.slice(1)) <= 18)
        expect(kept(at(2026, 11, 18, 3))).toEqual(['d12', 'd13', 'd16', 'd17', 'd18', 'd6', 'manual'].sort())
        // Friday of a previous week missing: the most recent backup of this week
        backups = backups.filter(b => b.id !== 'd13')
        expect(kept(at(2026, 11, 18, 3))).toEqual(['d11', 'd12', 'd16', 'd17', 'd18', 'd6', 'manual'].sort())
        // Weeks ending on Sunday, no weekly backup kept: the most recent backup is always kept
        expect(kept(at(2026, 11, 18, 3), {...DEFAULTS, keepDaily: 1, keepWeekly: 0, weeklyDay: 0})).toEqual(['d18', 'manual'])
      })

      it('Due once a day, on the days selected, once the time is reached', () => {
        var settings = {enabled: true, private: {...DEFAULTS, time: '02:30'}}
        var friday = at(2026, 11, 20, 2, 30)
        expect(schedule.isDue(settings, friday, [])).toBe(true)
        expect(schedule.isDue(settings, at(2026, 11, 20, 2, 29), [])).toBe(false)
        expect(schedule.isDue({...settings, enabled: false}, friday, [])).toBe(false)
        expect(schedule.isDue(settings, at(2026, 11, 21, 12), [])).toBe(false) // Saturday
        // Server started later the same day: made then, once
        expect(schedule.isDue(settings, at(2026, 11, 20, 18), [item('b', at(2026, 11, 19, 2, 31))])).toBe(true)
        expect(schedule.isDue(settings, at(2026, 11, 20, 18), [item('b', at(2026, 11, 20, 2, 31))])).toBe(false)
        expect(schedule.isDue(settings, at(2026, 11, 20, 18), [item('b', at(2026, 11, 20, 2, 31), 'created')])).toBe(true)

        // Next backup: now when due, else the next day selected at the time
        expect(schedule.nextRun(settings, friday, [])).toEqual(friday)
        expect(schedule.nextRun(settings, at(2026, 11, 20, 18), [item('b', at(2026, 11, 20, 2, 31))])).toEqual(at(2026, 11, 23, 2, 30))
        expect(schedule.nextRun(settings, at(2026, 11, 20, 1), [])).toEqual(at(2026, 11, 20, 2, 30))
        expect(schedule.nextRun({...settings, enabled: false}, friday, [])).toBeNull()
        expect(schedule.nextRun({...settings, private: {...DEFAULTS, days: []}}, friday, [])).toBeNull()
      })

      it('Invalid settings are refused', async () => {
        for (var backups of [{private: {time: '25:00'}}, {private: {days: [7]}}, {private: {days: [1, 1]}}, {private: {keepDaily: 0}}, {private: {weeklyDay: 1.5}}])
          expect((await setSchedule(backups)).status).toBe(422)
      })

      it('Automatic backup made when due, encrypted with BACKUP_PASSWORD, then rotation', async () => {
        var dir = path.join(__dirname, '..', 'backup')
        // Tomorrow at noon: the check of every minute (time of the test) never runs it
        var tomorrow = new Date()
        var now = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate() + 1, 12)
        var daysBefore = (days) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - days, 2, 5)
        // Previous backups: automatic ones of this week and of the previous weeks, one made by a user
        var previous = {a2: 2, a3: 3, a4: 4, a8: 8, a9: 9, a15: 15, user20: 20}
        var ids = {}
        Object.entries(previous).forEach(([name, days], index) => {
          var date = daysBefore(days)
          var id = `${date.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)}-0000000${index}`
          ids[name] = id
          fs.writeFileSync(path.join(dir, `${id}.backup`), 'x')
          fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({name, createdAt: date.toISOString(), type: 'full', categories: [], collections: {}, encrypted: false, origin: name.startsWith('user') ? 'created' : 'scheduled'}))
        })
        process.env.BACKUP_PASSWORD = 'Automatic-Backup-2026'
        try {
          expect((await setSchedule({enabled: true, private: {time: '00:00', days: [now.getDay()], keepDaily: 3, keepWeekly: 1, weeklyDay: now.getDay()}})).status).toBe(200)
          var status = (await request(app).get('/api/backups/schedule').set('Cookie', adminCookie)).body.datas
          expect(status).toMatchObject({enabled: true, encrypted: true})
          expect(new Date(status.nextRun)).toEqual(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0))

          schedule.resetFailure()
          var result = await schedule.runScheduledBackup(now)
          expect(result.created).toMatchObject({name: 'Automatic backup', type: 'full', encrypted: true, origin: 'scheduled'})
          // Kept: the 3 most recent automatic backups (the new one, 2 and 3 days before) and the most recent one of the
          // previous week (8 days before); the backup of the user is never deleted
          expect(result.deleted.sort()).toEqual([ids.a4, ids.a9, ids.a15].sort())
          var listed = (await listBackups()).body.datas.map(b => b.id)
          expect(listed).toEqual(expect.arrayContaining([result.created.id, ids.a2, ids.a3, ids.a8, ids.user20]))
          expect(listed).not.toEqual(expect.arrayContaining([ids.a4]))
          // Encrypted with the password of the environment
          expect((await restore(result.created.id, {mode: 'merge', categories: ['languages'], password: 'Automatic-Backup-2026'})).status).toBe(200)
          await deleteBackup(result.created.id)
        }
        finally {
          delete process.env.BACKUP_PASSWORD
          await setSchedule({enabled: false, private: DEFAULTS})
          Object.values(ids).forEach(id => ['backup', 'json'].forEach(ext => fs.rmSync(path.join(dir, `${id}.${ext}`), {force: true})))
        }
        expect((await request(app).get('/api/backups/schedule').set('Cookie', adminCookie)).body.datas).toEqual({enabled: false, encrypted: false, nextRun: null})
      }, 60000)
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
