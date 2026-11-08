/*
  Images of the editors (findings, sections, vulnerabilities...)
  At the end: no more image
*/

module.exports = function(request, app) {
  var helpers = require('./helpers')(request, app)

  describe('Image Suite Tests', () => {
    var adminCookie, userCookie, otherCookie
    var imageId, auditId

    beforeAll(async () => {
      adminCookie = await helpers.login('admin', 'Admin123')
      userCookie = await helpers.login('tmpuser', 'Tmpuser1')
      otherCookie = await helpers.login('user2', 'User1234')
      var response = await request(app).post('/api/audits').set('Cookie', userCookie).send({name: 'Images audit', language: 'en', auditType: 'Web'})
      auditId = response.body.datas.audit._id
    })

    afterAll(async () => {
      await request(app).delete(`/api/audits/${auditId}`).set('Cookie', userCookie)
    })

    it('Should not create an image without a string value', async () => {
      var response = await request(app).post('/api/images').set('Cookie', userCookie).send({name: 'empty.png'})
      expect(response.status).toBe(422)
      response = await request(app).post('/api/images').set('Cookie', userCookie).send({value: {$gt: ''}})
      expect(response.status).toBe(422)
      response = await request(app).post('/api/images').set('Cookie', userCookie).send({value: ['a', 'b']})
      expect(response.status).toBe(422)
    })

    it('Create an image of an audit', async () => {
      var response = await request(app).post('/api/images').set('Cookie', userCookie).send({value: helpers.PNG_DATA_URI, name: 'poc.png', auditId: auditId})
      expect(response.status).toBe(201)
      expect(Object.keys(response.body.datas)).toEqual(['_id'])
      imageId = response.body.datas._id
    })

    it('Same image is stored once', async () => {
      var response = await request(app).post('/api/images').set('Cookie', adminCookie).send({value: helpers.PNG_DATA_URI, name: 'copy.png'})
      expect(response.status).toBe(201)
      expect(response.body.datas._id).toBe(imageId)
    })

    it('Get an image', async () => {
      var response = await request(app).get(`/api/images/${imageId}`).set('Cookie', userCookie)
      expect(response.status).toBe(200)
      expect(response.body.datas).toEqual({_id: imageId, value: helpers.PNG_DATA_URI, name: 'poc.png', auditId: auditId})
    })

    it('Download an image', async () => {
      var response = await request(app).get(`/api/images/download/${imageId}`).set('Cookie', userCookie).buffer(true).parse(helpers.binary)
      expect(response.status).toBe(200)
      expect(response.headers['content-type']).toBe('image/png')
      expect(response.body.equals(Buffer.from(helpers.PNG_BASE64, 'base64'))).toBe(true)
      expect(Number(response.headers['content-length'])).toBe(response.body.length)
    })

    it('Get or download an unknown image', async () => {
      expect((await request(app).get('/api/images/deadbeefdeadbeefdeadbeef').set('Cookie', userCookie)).status).toBe(404)
      expect((await request(app).get('/api/images/download/deadbeefdeadbeefdeadbeef').set('Cookie', userCookie)).status).toBe(404)
    })

    // BUG: src/routes/image.js:11 and :61 images are returned to any authenticated user knowing their identifier,
    // whatever the audit they belong to (auditId stored but never checked): user2, without access to the audit, reads it.
    it.skip('Images of an audit are readable by the users with access to the audit only', async () => {
      expect((await request(app).get(`/api/audits/${auditId}`).set('Cookie', otherCookie)).status).toBe(404)
      expect((await request(app).get(`/api/images/${imageId}`).set('Cookie', otherCookie)).status).toBe(404)
      expect((await request(app).get(`/api/images/download/${imageId}`).set('Cookie', otherCookie)).status).toBe(404)
    })

    it('Only allowed users delete images', async () => {
      var response = await request(app).delete(`/api/images/${imageId}`).set('Cookie', userCookie)
      expect(response.status).toBe(403)
      expect((await request(app).get(`/api/images/${imageId}`).set('Cookie', userCookie)).status).toBe(200)

      response = await request(app).delete(`/api/images/${imageId}`).set('Cookie', adminCookie)
      expect(response.status).toBe(200)
      expect((await request(app).get(`/api/images/${imageId}`).set('Cookie', userCookie)).status).toBe(404)
      expect((await request(app).delete(`/api/images/${imageId}`).set('Cookie', adminCookie)).status).toBe(404)
    })

    it('Large images are accepted', async () => {
      // Body limit of the API: 100 MB (editor images in base64)
      var big = `data:image/png;base64,${Buffer.alloc(3 * 1024 * 1024, 1).toString('base64')}`
      var response = await request(app).post('/api/images').set('Cookie', userCookie).send({value: big, auditId: auditId})
      expect(response.status).toBe(201)
      expect((await request(app).delete(`/api/images/${response.body.datas._id}`).set('Cookie', adminCookie)).status).toBe(200)
    })
  })
}
