/*
  Words ignored by the spell checker of the editors: proposals of the users, approval by the administrators, approved
  words read by all the users. The words created here begin with "spl" and are deleted at the end.
*/

module.exports = function(request, app) {
  var helpers = require('./helpers')(request, app)

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
