/*
  Quality checks without AI and without network request (lib/qa.js): checks of the audits (completeness, review comments,
  internal links, images, references, highlighted texts) and of the vulnerability database (duplicated or similar titles),
  issues ignored by the users, settings of the checks. Data prefixed with "qa" deleted at the end, settings reverted.
*/

module.exports = function(request, app) {
  var helpers = require('./helpers')(request, app)
  var qa = require('../src/lib/qa')

  var ID = (n) => `6af573f15a4b2128f82d${String(n).padStart(4, '0')}`
  var codes = (issues) => issues.map(issue => issue.code)
  var finding = (extra = {}) => ({_id: ID(1), title: 'SQLi', description: '<p>Description</p>', remediation: '<p>Fix</p>', cvssv3: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H', status: 0, references: [], customFields: [], ...extra})

  describe('Quality checks of an audit (lib/qa.js)', () => {
    it('Completeness: findings without description, remediation, CVSS or still in redaction, empty sections, no finding', () => {
      var issues = qa.auditIssues({name: 'Audit', findings: [
        finding(),
        finding({_id: ID(2), title: 'Empty', description: '<p> </p>', remediation: '', cvssv3: '', status: 1}),
        finding({_id: ID(3), title: 'Image only', description: '<img class="custom-image" src="data:image/png;base64,AA" alt="Proof">'})
      ], sections: [
        {_id: ID(10), name: 'Empty section', text: '<p></p>', customFields: [{customField: {_id: 'c', label: 'Body', fieldType: 'text'}, text: '<p> </p>'}]},
        {_id: ID(11), name: 'Filled section', customFields: [{customField: {_id: 'c', label: 'Body', fieldType: 'text'}, text: '<p>Text</p>'}]}
      ]})
      expect(issues.map(issue => [issue.severity, issue.code, issue.location.name, issue.location.field])).toEqual([
        ['error', 'findingNoDescription', 'Empty', 'description'],
        ['warning', 'findingNoRemediation', 'Empty', 'remediation'],
        ['warning', 'findingNoCvss', 'Empty', 'cvss'],
        ['warning', 'findingRedacting', 'Empty', null],
        ['warning', 'sectionEmpty', 'Empty section', null]
      ])
      expect(codes(qa.auditIssues({name: 'Audit', findings: []}))).toEqual(['noFindings'])
    })

    it('Internal links: links to a deleted finding only', () => {
      var html = `<p><a href="#${ID(1)}">SQLi</a> <a href="#${ID(9)}">Deleted &amp; gone</a> <a href="#anchor">anchor</a> <a href="https://e.com">ext</a></p>`
      var issues = qa.auditIssues({name: 'A', findings: [finding({observation: html})]})
      expect(issues.map(issue => [issue.severity, issue.code, issue.params, issue.location.field])).toEqual([['error', 'internalLinkBroken', {text: 'Deleted & gone'}, 'observation']])
    })

    it('Images: not found, captions empty or left as file names or default captions', () => {
      var image = (src, alt) => `<img class="custom-image" src="${src}" alt="${alt}">`
      var poc = [image(ID(20), 'Burp request'), image(ID(21), 'Login page'), image(ID(20), ''), image(ID(20), 'IMG_1234.png'),
        image(ID(20), 'Capture d’écran 2026-11-12 à 10.00.00'), image(ID(20), 'External Image'), image(ID(20), 'screenshot1'), image('data:image/png;base64,AA', 'Image of the login page')].join('')
      var issues = qa.auditIssues({name: 'A', findings: [finding({poc: `<p>${poc}</p>`})]}, {existingImages: new Set([ID(20)])})
      expect(issues.map(issue => [issue.severity, issue.code, issue.params.caption])).toEqual([
        ['error', 'imageMissing', 'Login page'],
        ['warning', 'captionEmpty', undefined],
        ['warning', 'captionFileName', 'IMG_1234.png'],
        ['warning', 'captionFileName', 'Capture d’écran 2026-11-12 à 10.00.00'],
        ['warning', 'captionFileName', 'External Image'],
        ['warning', 'captionFileName', 'screenshot1']
      ])
      expect(qa.imageIds({findings: [{poc: `<p>${poc}</p>`}]}).sort()).toEqual([ID(20), ID(21)])
    })

    it('Passage of the field shown when an issue is opened: link text, image, reference, highlighted text', () => {
      var data = 'data:image/png;base64,' + 'A'.repeat(500)
      var html = `<p><a href="#${ID(9)}">Deleted link</a> <mark data-color="#ffff00">[CLIENT]</mark></p>` +
        `<img class="custom-image" src="${ID(21)}" alt="IMG_1234.png"><img class="custom-image" src="${data}" alt="">`
      var settings = {report: {enabled: true, public: {highlightWarning: true, highlightWarningColors: ['#ffff00']}}}
      var issues = qa.auditIssues({name: 'A', findings: [finding({description: html, references: ['htps://typo.example.com']})]}, {settings, existingImages: new Set([ID(21)])})
      expect(issues.map(issue => [issue.code, issue.location.passage])).toEqual([
        ['internalLinkBroken', {text: 'Deleted link'}],
        ['captionFileName', {image: {src: ID(21), alt: 'IMG_1234.png'}}],
        ['captionEmpty', {image: {src: 'hash:522:33a1db9c', alt: ''}}], // Long source: same anchor as the editors
        ['referenceInvalid', {text: 'htps://typo.example.com'}],
        ['highlightedText', {text: '[CLIENT]'}]
      ])
      expect(qa.imageAnchorKey(ID(21))).toBe(ID(21))
      // Fields without passage: the field is shown
      expect(qa.auditIssues({name: 'A', findings: [finding({description: ''})]}).find(issue => issue.code === 'findingNoDescription').location.passage).toBeUndefined()
    })

    it('References: empty, or written as links but invalid (offline: never requested)', () => {
      var references = ['https://owasp.org/www-community/attacks/SQL_Injection', 'CWE-89', 'OWASP A03:2021', 'www.example.com/advisory', '  ',
        'htps://typo.example.com', 'https://', 'https://exa mple.com', 'javascript://alert(1)', 'ftp://files.example.com', 'http://localhost']
      var issues = qa.auditIssues({name: 'A', findings: [finding({references})]})
      expect(issues.map(issue => [issue.code, issue.params.reference])).toEqual([
        ['referenceEmpty', undefined], ['referenceInvalid', 'htps://typo.example.com'], ['referenceInvalid', 'https://'],
        ['referenceInvalid', 'https://exa mple.com'], ['referenceInvalid', 'javascript://alert(1)'], ['referenceInvalid', 'ftp://files.example.com'],
        ['referenceInvalid', 'http://localhost']
      ])
    })

    it('Review comments not resolved: grouped by place', () => {
      var comments = [
        {target: {kind: 'finding', findingId: ID(1), field: 'description'}, resolved: false},
        {target: {kind: 'finding', findingId: ID(1), field: 'title'}, resolved: false},
        {target: {kind: 'finding', findingId: ID(1)}, resolved: true},
        {target: {kind: 'general', field: 'name'}, resolved: false}
      ]
      var issues = qa.auditIssues({name: 'A', findings: [finding()]}, {comments})
      expect(issues.map(issue => [issue.code, issue.params.count, issue.location.kind, issue.location.name])).toEqual([
        ['commentsOpen', 2, 'finding', 'SQLi'], ['commentsOpen', 1, 'general', 'A']
      ])
    })

    it('Texts highlighted with the warning colors when the warning is enabled', () => {
      var audit = {name: 'A', findings: [finding({description: '<p><mark data-color="#ffff00">[CLIENT]</mark> <mark data-color="#fe0000">red</mark></p>'})]}
      expect(qa.auditIssues(audit)).toEqual([])
      var settings = {report: {public: {highlightWarning: true, highlightWarningColors: ['#ffff00']}}}
      expect(qa.auditIssues(audit, {settings}).map(issue => [issue.code, issue.params, issue.location.field])).toEqual([['highlightedText', {text: '[CLIENT]', color: '#ffff00'}, 'description']])
    })

    it('Checks disabled in the settings are not run', () => {
      var audit = {name: 'A', findings: [finding({description: '', references: ['htps://x.y'], poc: '<img src="x" alt="">'})]}
      var all = codes(qa.auditIssues(audit))
      expect(all).toEqual(expect.arrayContaining(['findingNoDescription', 'referenceInvalid', 'captionEmpty']))
      var settings = {qa: {public: {checks: {completeness: false, references: false, images: false}}}}
      expect(qa.auditIssues(audit, {settings})).toEqual([])
      expect(qa.enabledChecks(settings)).toEqual(['comments', 'internalLinks', 'duplicates'])
    })

    it('Fingerprints: stable for the same issue, different when its content changes', () => {
      var fingerprint = (reference) => qa.auditIssues({name: 'A', findings: [finding({references: [reference]})]})[0].fingerprint
      expect(fingerprint('htps://a.b')).toMatch(/^[a-f0-9]{20}$/)
      expect(fingerprint('htps://a.b')).toBe(fingerprint('htps://a.b'))
      expect(fingerprint('htps://a.b')).not.toBe(fingerprint('htps://c.d'))
    })
  })

  describe('Quality checks of the vulnerability database (lib/qa.js)', () => {
    var vulnerability = (n, details) => ({_id: ID(n), details})
    it('Duplicated titles (case, accents, punctuation ignored) and similar titles, in the same language only', () => {
      var issues = qa.vulnerabilityIssues([
        vulnerability(1, [{locale: 'en', title: 'SQL Injection'}, {locale: 'fr', title: 'Injection SQL'}]),
        vulnerability(2, [{locale: 'en', title: 'sql-injection'}]),
        vulnerability(3, [{locale: 'fr', title: 'Injection  SQL !'}]),
        vulnerability(4, [{locale: 'en', title: 'Cross-Site Scripting (reflected)'}]),
        vulnerability(5, [{locale: 'en', title: 'Cross-Site Scripting (reflecteds)'}]),
        vulnerability(6, [{locale: 'de', title: 'SQL Injection'}]), // Other language
        vulnerability(7, [{locale: 'en', title: 'Weak TLS configuration'}])
      ])
      expect(issues.map(issue => [issue.severity, issue.code, issue.location.name, issue.params.other, issue.location.locale])).toEqual([
        ['warning', 'duplicateTitle', 'SQL Injection', 'sql-injection', 'en'],
        ['warning', 'duplicateTitle', 'Injection SQL', 'Injection  SQL !', 'fr'],
        ['info', 'similarTitle', 'Cross-Site Scripting (reflected)', 'Cross-Site Scripting (reflecteds)', 'en']
      ])
      expect(issues[0].params.otherId).toBe(ID(2))
    })

    it('Images and references of the details', () => {
      var issues = qa.vulnerabilityIssues([vulnerability(1, [{locale: 'en', title: 'X', description: '<p><img src="x" alt="IMG_1.png"></p>', references: ['htps://x.y']}])])
      expect(codes(issues)).toEqual(['captionFileName', 'referenceInvalid'])
      expect(issues[0].location).toMatchObject({kind: 'vulnerability', id: ID(1), name: 'X', field: 'description', locale: 'en'})
    })

    it('Similarity of the titles', () => {
      expect(qa.similarity('abc', 'abc')).toBe(1)
      expect(qa.similarity('night', 'nacht')).toBeCloseTo(0.25)
      expect(qa.similarity('a', 'b')).toBe(0)
      expect(qa.normalizedTitle('  Élévation de Privilèges !  ')).toBe('elevation de privileges')
    })
  })

  describe('Quality checks Suite Tests', () => {
    var adminCookie, userCookie, otherCookie, auditId, findingIds = {}, vulnIds = []
    var getQa = (cookie = userCookie, id = auditId) => request(app).get(`/api/audits/${id}/qa`).set('Cookie', cookie)
    var ignore = (fingerprint, ignored = true, cookie = userCookie, id = auditId) => request(app).put(`/api/audits/${id}/qa/ignored`).set('Cookie', cookie).send({fingerprint, ignored})

    beforeAll(async () => {
      adminCookie = await helpers.login('admin', 'Admin123')
      userCookie = await helpers.login('user2', 'User1234')
      otherCookie = await helpers.login('tmpuser', 'Tmpuser1')
      var response = await request(app).post('/api/audits').set('Cookie', userCookie).send({name: 'qa Audit', language: 'en', auditType: 'Web'})
      expect(response.status).toBe(201)
      auditId = response.body.datas.audit._id
      var findings = [
        {title: 'qa Complete', description: '<p>Text</p>', remediation: '<p>Fix</p>', cvssv3: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H', references: ['https://owasp.org/x']},
        {title: 'qa Incomplete', description: '', references: ['htps://typo.example.com']}
      ]
      for (var item of findings)
        expect((await request(app).post(`/api/audits/${auditId}/findings`).set('Cookie', userCookie).send(item)).status).toBe(200)
      var audit = (await request(app).get(`/api/audits/${auditId}`).set('Cookie', userCookie)).body.datas
      audit.findings.forEach(f => { findingIds[f.title] = f._id })
      // Link to a deleted finding, image not found
      await request(app).put(`/api/audits/${auditId}/findings/${findingIds['qa Complete']}`).set('Cookie', userCookie)
        .send({observation: `<p><a href="#${ID(99)}">old finding</a></p><img class="custom-image" src="${ID(98)}" alt="Burp">`})
      // Unresolved review comment
      expect((await request(app).post(`/api/audits/${auditId}/comments`).set('Cookie', userCookie)
        .send({target: {kind: 'finding', findingId: findingIds['qa Incomplete'], field: 'description'}, text: 'Description missing'})).status).toBe(200)
    })

    afterAll(async () => {
      await request(app).delete(`/api/audits/${auditId}`).set('Cookie', userCookie)
      for (var id of vulnIds)
        await request(app).delete(`/api/vulnerabilities/${id}`).set('Cookie', adminCookie)
      await request(app).put('/api/settings').set('Cookie', adminCookie).send({qa: {public: {checks: {completeness: true, comments: true, internalLinks: true, images: true, references: true, duplicates: true}}}})
    })

    it('Lists the issues of the audit, errors first', async () => {
      var response = await getQa()
      expect(response.status).toBe(200)
      expect(response.body.datas.ignored).toEqual([])
      expect(response.body.datas.issues.map(issue => [issue.severity, issue.code, issue.location.name])).toEqual([
        ['error', 'findingNoDescription', 'qa Incomplete'],
        ['error', 'internalLinkBroken', 'qa Complete'],
        ['error', 'imageMissing', 'qa Complete'],
        ['warning', 'findingRedacting', 'qa Complete'], // Order of the findings
        ['warning', 'findingNoRemediation', 'qa Incomplete'],
        ['warning', 'findingNoCvss', 'qa Incomplete'],
        ['warning', 'findingRedacting', 'qa Incomplete'],
        ['warning', 'referenceInvalid', 'qa Incomplete'],
        ['warning', 'commentsOpen', 'qa Incomplete']
      ])
      expect(response.body.datas.issues[0].location).toEqual({kind: 'finding', id: findingIds['qa Incomplete'], name: 'qa Incomplete', field: 'description', label: null})
    })

    it('Ignores an issue for all the users of the audit, then restores it', async () => {
      var issue = (await getQa()).body.datas.issues.find(item => item.code === 'findingNoCvss')
      expect((await ignore(issue.fingerprint)).status).toBe(200)
      expect((await ignore(issue.fingerprint)).status).toBe(200) // Once
      var datas = (await getQa(adminCookie)).body.datas
      expect(datas.issues.map(item => item.fingerprint)).not.toContain(issue.fingerprint)
      expect(datas.ignored).toEqual([issue])
      expect((await ignore(issue.fingerprint, false)).status).toBe(200)
      datas = (await getQa()).body.datas
      expect(datas.ignored).toEqual([])
      expect(datas.issues.map(item => item.fingerprint)).toContain(issue.fingerprint)
    })

    it('An ignored issue comes back when its content changes', async () => {
      var issue = (await getQa()).body.datas.issues.find(item => item.code === 'referenceInvalid')
      expect((await ignore(issue.fingerprint)).status).toBe(200)
      expect((await getQa()).body.datas.issues.map(item => item.code)).not.toContain('referenceInvalid')
      await request(app).put(`/api/audits/${auditId}/findings/${findingIds['qa Incomplete']}`).set('Cookie', userCookie).send({references: ['htps://other.example.com']})
      var reference = (await getQa()).body.datas.issues.find(item => item.code === 'referenceInvalid')
      expect(reference.params.reference).toBe('htps://other.example.com')
      expect(reference.fingerprint).not.toBe(issue.fingerprint)
    })

    it('Checks disabled in the settings are not run', async () => {
      expect((await request(app).put('/api/settings').set('Cookie', adminCookie).send({qa: {public: {checks: {completeness: false, comments: false}}}})).status).toBe(200)
      var found = (await getQa()).body.datas.issues.map(item => item.check)
      expect(found).not.toContain('completeness')
      expect(found).not.toContain('comments')
      expect(found).toContain('internalLinks')
    })

    it('Refuses invalid parameters, the users without access to the audit', async () => {
      for (var body of [{}, {fingerprint: 'abc', ignored: true}, {fingerprint: 'a'.repeat(20)}, {fingerprint: 'a'.repeat(20), ignored: 'yes'}, {fingerprint: {$ne: ''}, ignored: true}])
        expect((await request(app).put(`/api/audits/${auditId}/qa/ignored`).set('Cookie', userCookie).send(body)).status).toBe(422)
      expect((await getQa(otherCookie)).status).toBe(404)
      expect((await ignore('a'.repeat(20), true, otherCookie)).status).toBe(404)
      expect((await getQa(userCookie, 'deadbeefdeadbeefdeadbeef')).status).toBe(404)
      expect((await request(app).get(`/api/audits/${auditId}/qa`)).status).toBe(401)
    })

    it('Vulnerability database: duplicated and similar titles', async () => {
      var response = await request(app).post('/api/vulnerabilities').set('Cookie', adminCookie).send([
        {cvssv3: '', details: [{locale: 'en', title: 'qa Insecure Cookie Flag'}]},
        {cvssv3: '', details: [{locale: 'en', title: 'qa insecure-cookie flag'}]},
        {cvssv3: '', details: [{locale: 'en', title: 'qa Unique Weakness'}]}
      ])
      expect(response.status).toBe(201)
      var vulns = (await request(app).get('/api/vulnerabilities').set('Cookie', adminCookie)).body.datas
      vulnIds = vulns.filter(v => v.details.some(d => /^qa /i.test(d.title))).map(v => v._id)
      response = await request(app).get('/api/vulnerabilities/qa').set('Cookie', adminCookie)
      expect(response.status).toBe(200)
      var duplicates = response.body.datas.issues.filter(issue => issue.check === 'duplicates' && /^qa /i.test(issue.location.name))
      expect(duplicates.map(issue => [issue.code, issue.location.name, issue.params.other])).toEqual([['duplicateTitle', 'qa Insecure Cookie Flag', 'qa insecure-cookie flag']])
      expect((await request(app).get('/api/vulnerabilities/qa').set('Cookie', userCookie)).status).toBe(403)
    })
  })
}
