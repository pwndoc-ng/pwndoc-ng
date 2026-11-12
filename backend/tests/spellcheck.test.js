/*
  Spell checker of the editors: texts checked by LanguageTool through the backend (fake LanguageTool server started
  here), words ignored once approved (proposals of the users, approval by the administrators, approved words read by all
  the users). The words created here begin with "spl" and are deleted at the end.
*/

module.exports = function(request, app) {
  var helpers = require('./helpers')(request, app)
  var http = require('http')

  describe('Spellcheck check Suite Tests', () => {
    var userCookie, server, port, requests, answer
    var check = (body, cookie = userCookie) => request(app).post('/api/spellcheck/check').set('Cookie', cookie).send(body)
    var MATCH = {offset: 0, length: 6, message: 'Possible spelling mistake', replacements: [{value: 'Example'}], rule: {id: 'MORFOLOGIK', issueType: 'misspelling'}}

    beforeAll(async () => {
      userCookie = await helpers.login('user2', 'User1234')
      // Fake LanguageTool server: requests recorded, answer chosen by the test
      server = http.createServer((req, res) => {
        var body = ''
        req.on('data', chunk => body += chunk)
        req.on('end', () => {
          requests.push({method: req.method, url: req.url, type: req.headers['content-type'], params: Object.fromEntries(new URLSearchParams(body))})
          answer(res)
        })
      })
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
      port = server.address().port
    })
    beforeEach(() => {
      requests = []
      answer = (res) => res.end(JSON.stringify({software: {name: 'LanguageTool'}, matches: [MATCH]}))
      process.env.LANGUAGETOOL_URL = `http://127.0.0.1:${port}/`
    })
    afterAll(async () => {
      delete process.env.LANGUAGETOOL_URL
      await new Promise(resolve => server.close(resolve))
    })

    it('Checks the text with LanguageTool and answers its matches', async () => {
      var response = await check({text: 'Exmple de texte é 漢字 & <b>', language: 'fr'})
      expect(response.status).toBe(200)
      expect(response.body.datas).toEqual({matches: [MATCH]})
      expect(requests).toEqual([{method: 'POST', url: '/v2/check', type: 'application/x-www-form-urlencoded',
        params: {text: 'Exmple de texte é 漢字 & <b>', language: 'fr', enabledOnly: 'false'}}])
    })

    it('Detects the language by default, answers no match for a blank text without request', async () => {
      await check({text: 'Exmple'})
      expect(requests[0].params.language).toBe('auto')
      requests = []
      expect((await check({text: '   \n '})).body.datas).toEqual({matches: []})
      expect(requests).toEqual([])
    })

    it('Answers 502 when LanguageTool answers an error or is not available', async () => {
      answer = (res) => { res.statusCode = 500; res.end('error') }
      var response = await check({text: 'Exmple'})
      expect(response.status).toBe(502)
      expect(response.body.datas).toBe('LanguageTool answered 500')
      answer = (res) => res.end('not json')
      expect((await check({text: 'Exmple'})).status).toBe(502)
      process.env.LANGUAGETOOL_URL = 'http://127.0.0.1:1' // Nothing listening
      response = await check({text: 'Exmple'})
      expect(response.status).toBe(502)
      expect(response.body.datas).toBe('LanguageTool is not available')
    })

    it('Refuses invalid parameters and too long texts, without request', async () => {
      for (var body of [{}, {text: 12}, {text: ['a']}, {text: {$ne: ''}}, {text: 'a', language: 'fr&enabledOnly=true'}, {text: 'a', language: 3}])
        expect((await check(body)).status).toBe(422)
      expect((await check({text: 'a'.repeat(50001)})).status).toBe(413)
      expect((await check({text: 'a'.repeat(50000)})).status).toBe(200)
      expect(requests).toHaveLength(1)
    })

    it('Requires an authenticated user', async () => {
      expect((await request(app).post('/api/spellcheck/check').send({text: 'Exmple'})).status).toBe(401)
      expect(requests).toEqual([])
    })
  })

  describe('Spellcheck words Suite Tests', () => {
    var adminCookie, userCookie
    var words = (cookie) => request(app).get('/api/spellcheck/words').set('Cookie', cookie)
    var all = async () => (await request(app).get('/api/spellcheck/words/all').set('Cookie', adminCookie)).body.datas
    var idOf = async (word) => (await all()).find(w => w.word === word)._id
    var propose = (word, cookie) => request(app).post('/api/spellcheck/words').set('Cookie', cookie).send({word: word})
    var approve = (id, cookie = adminCookie, body = {status: 'approved'}) => request(app).put(`/api/spellcheck/words/${id}`).set('Cookie', cookie).send(body)
    var remove = (id, cookie = adminCookie) => request(app).delete(`/api/spellcheck/words/${id}`).set('Cookie', cookie)

    beforeAll(async () => {
      adminCookie = await helpers.login('admin', 'Admin123')
      userCookie = await helpers.login('user2', 'User1234')
    })
    afterAll(async () => {
      for (var word of (await all()).filter(w => w.word.toLowerCase().startsWith('spl')))
        await remove(word._id)
    })

    it('A word proposed by a user is pending: not ignored until it is approved', async () => {
      var response = await propose('splNmap', userCookie)
      expect(response.status).toBe(201)
      expect(response.body.datas).toMatchObject({word: 'splNmap', status: 'pending'})
      expect((await words(userCookie)).body.datas).not.toContain('splNmap')
      var listed = (await all()).find(w => w.word === 'splNmap')
      expect(listed).toMatchObject({status: 'pending', proposedBy: {username: 'user2'}})
      expect(listed.approvedBy).toBeUndefined()
    })

    it('An administrator approves the word: ignored for all the users', async () => {
      var response = await approve(await idOf('splNmap'))
      expect(response.status).toBe(200)
      expect(response.body.datas.status).toBe('approved')
      expect((await words(userCookie)).body.datas).toContain('splNmap')
      expect((await all()).find(w => w.word === 'splNmap')).toMatchObject({status: 'approved', approvedBy: {username: 'admin'}})
    })

    it('A word is stored once whatever its case, an approved word proposed again stays approved', async () => {
      var response = await propose('SPLNMAP', userCookie)
      expect(response.status).toBe(201)
      expect(response.body.datas).toMatchObject({word: 'splNmap', status: 'approved'})
      expect((await all()).filter(w => w.word.toLowerCase() === 'splnmap')).toHaveLength(1)
    })

    it('A word proposed by an administrator is approved at once', async () => {
      var response = await propose('  splBurp  ', adminCookie)
      expect(response.status).toBe(201)
      expect(response.body.datas).toMatchObject({word: 'splBurp', status: 'approved'})
      expect((await words(userCookie)).body.datas).toContain('splBurp')
      // Pending word proposed again by an administrator: approved
      expect((await propose('splPending', userCookie)).body.datas.status).toBe('pending')
      expect((await propose('splpending', adminCookie)).body.datas).toMatchObject({word: 'splPending', status: 'approved'})
    })

    it('Approved words sorted, pending words listed first for the administrators', async () => {
      await propose('splAaa', userCookie)
      expect((await all()).filter(w => w.word.startsWith('spl'))[0]).toMatchObject({word: 'splAaa', status: 'pending'})
      expect((await words(userCookie)).body.datas.filter(w => w.startsWith('spl'))).toEqual(['splBurp', 'splNmap', 'splPending'])
    })

    it('Deleting a word: refused proposal, or word no longer ignored', async () => {
      var id = await idOf('splBurp')
      expect((await remove(id)).status).toBe(200)
      expect((await words(userCookie)).body.datas).not.toContain('splBurp')
      expect((await remove(id)).status).toBe(404)
    })

    it('Invalid words refused', async () => {
      for (var word of ['', '   ', 'spl two words', `spl${'x'.repeat(98)}`, 12, null, {$ne: ''}, ['splArray']])
        expect((await propose(word, userCookie)).status).toBe(422)
      expect((await propose(`spl${'x'.repeat(97)}`, userCookie)).status).toBe(201) // 100 characters
      expect((await propose("spl-d'accès", userCookie)).body.datas.word).toBe("spl-d'accès")
    })

    it('Approval: approved status required, unknown words', async () => {
      var id = await idOf('splAaa')
      expect((await approve(id, adminCookie, {status: 'pending'})).status).toBe(422)
      expect((await approve(id, adminCookie, {})).status).toBe(422)
      expect((await approve('deadbeefdeadbeefdeadbeef')).status).toBe(404)
      expect((await approve('not-an-id')).status).toBe(404)
      expect((await remove('not-an-id')).status).toBe(404)
    })

    it('Users can neither approve, list nor delete the words', async () => {
      var id = await idOf('splAaa')
      expect((await approve(id, userCookie)).status).toBe(403)
      expect((await remove(id, userCookie)).status).toBe(403)
      expect((await request(app).get('/api/spellcheck/words/all').set('Cookie', userCookie)).status).toBe(403)
      expect((await request(app).get('/api/spellcheck/words')).status).toBe(401)
      expect((await all()).find(w => w.word === 'splAaa').status).toBe('pending')
    })
  })
}
