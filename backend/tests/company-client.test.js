/*
  Companies and clients: all the fields, duplicates, companies created with the clients, exports.
  At the end: no more company or client created here.
*/

module.exports = function(request, app) {
  var helpers = require('./helpers')(request, app)
  var mongoose = require('mongoose')

  describe('Companies and Clients Suite Tests', () => {
    var userCookie
    var fullCompanyId, clientId
    var companies = async () => (await request(app).get('/api/companies').set('Cookie', userCookie)).body.datas
    var clients = async () => (await request(app).get('/api/clients').set('Cookie', userCookie)).body.datas

    beforeAll(async () => {
      // Users manage the companies and the clients
      userCookie = await helpers.login('user2', 'User1234')
    })

    afterAll(async () => {
      await mongoose.model('Client').deleteMany({email: /@company-client\.test$/})
      await mongoose.model('Company').deleteMany({name: {$in: ['Full Company', 'Batch Company', 'Client Company']}})
    })

    describe('Companies', () => {
      it('Create a company with all its information', async () => {
        var response = await request(app).post('/api/companies').set('Cookie', userCookie).send([{
          name: 'Full Company', shortName: 'FC', address: '1 rue de la Paix', postalCode: '75002', city: 'Paris', logo: helpers.PNG_DATA_URI
        }])
        expect(response.status).toBe(201)
        expect(response.body.datas).toEqual({created: 1, duplicates: 0})

        var company = (await companies()).find(c => c.name === 'Full Company')
        expect(company).toEqual({_id: expect.any(String), name: 'Full Company', shortName: 'FC', address: '1 rue de la Paix', postalCode: '75002', city: 'Paris', logo: helpers.PNG_DATA_URI})
        fullCompanyId = company._id
      })

      it('Export the companies without their identifiers', async () => {
        var response = await request(app).get('/api/companies/export').set('Cookie', userCookie)
        expect(response.status).toBe(200)
        expect(response.body.datas.find(c => c.name === 'Full Company')).toEqual({name: 'Full Company', shortName: 'FC', address: '1 rue de la Paix', postalCode: '75002', city: 'Paris', logo: helpers.PNG_DATA_URI})
        expect(response.body.datas.every(c => c._id === undefined)).toBe(true)
      })

      it('Should not create companies without name or with an existing name', async () => {
        var count = (await companies()).length
        expect((await request(app).post('/api/companies').set('Cookie', userCookie).send([{shortName: 'No name'}])).status).toBe(422)
        var response = await request(app).post('/api/companies').set('Cookie', userCookie).send([{name: 'Full Company', city: 'Lyon'}])
        expect(response.status).toBe(422)
        expect(response.body.datas).toBe('Company name already exists')
        expect((await companies()).length).toBe(count)
        expect((await companies()).find(c => c.name === 'Full Company').city).toBe('Paris')

        response = await request(app).post('/api/companies').set('Cookie', userCookie).send([{name: 'Batch Company'}, {name: 'Full Company'}])
        expect(response.status).toBe(422)
      })

      it('Update a company', async () => {
        var response = await request(app).put(`/api/companies/${fullCompanyId}`).set('Cookie', userCookie).send({address: '2 place Bellecour', postalCode: '69002', city: 'Lyon'})
        expect(response.status).toBe(200)
        expect((await companies()).find(c => c._id === fullCompanyId)).toMatchObject({name: 'Full Company', shortName: 'FC', address: '2 place Bellecour', postalCode: '69002', city: 'Lyon'})

        response = await request(app).put(`/api/companies/${fullCompanyId}`).set('Cookie', userCookie).send({name: 'Company 1'})
        expect(response.status).toBe(422)
        expect(response.body.datas).toBe('Company name already exists')
        expect((await companies()).find(c => c._id === fullCompanyId).name).toBe('Full Company')
      })

      it('Company information in the audits', async () => {
        var response = await request(app).post('/api/audits').set('Cookie', userCookie).send({name: 'Company audit', language: 'en', auditType: 'Web'})
        var auditId = response.body.datas.audit._id
        expect((await request(app).put(`/api/audits/${auditId}/general`).set('Cookie', userCookie).send({company: {_id: fullCompanyId}})).status).toBe(200)
        var audit = (await request(app).get(`/api/audits/${auditId}`).set('Cookie', userCookie)).body.datas
        expect(audit.company).toMatchObject({name: 'Full Company', shortName: 'FC', city: 'Lyon', postalCode: '69002'})
        expect((await request(app).delete(`/api/audits/${auditId}`).set('Cookie', userCookie)).status).toBe(200)
      })
    })

    describe('Clients', () => {
      it('Create a client with a new company', async () => {
        var response = await request(app).post('/api/clients').set('Cookie', userCookie).send([{
          email: 'contact@company-client.test', firstname: 'Ada', lastname: 'Lovelace', phone: '0102030405', cell: '0607080910', title: 'CISO',
          company: {name: 'Client Company'}
        }])
        expect(response.status).toBe(201)
        var client = (await clients()).find(c => c.email === 'contact@company-client.test')
        expect(client).toEqual({_id: expect.any(String), email: 'contact@company-client.test', firstname: 'Ada', lastname: 'Lovelace', phone: '0102030405', cell: '0607080910', title: 'CISO', company: {name: 'Client Company'}})
        clientId = client._id
        expect((await companies()).filter(c => c.name === 'Client Company')).toHaveLength(1)
      })

      it('Create a client of an existing company', async () => {
        var count = (await companies()).length
        var response = await request(app).post('/api/clients').set('Cookie', userCookie).send([{email: 'second@company-client.test', company: {name: 'Client Company'}}])
        expect(response.status).toBe(201)
        expect((await clients()).find(c => c.email === 'second@company-client.test').company).toEqual({name: 'Client Company'})
        expect((await companies()).length).toBe(count)
      })

      it('Should not create clients with an existing email', async () => {
        var response = await request(app).post('/api/clients').set('Cookie', userCookie).send([{email: 'contact@company-client.test', firstname: 'Other'}])
        expect(response.status).toBe(422)
        expect(response.body.datas).toBe('Client email already exists')
        expect((await clients()).find(c => c.email === 'contact@company-client.test').firstname).toBe('Ada')
        response = await request(app).post('/api/clients').set('Cookie', userCookie).send([{email: 'third@company-client.test'}, {email: 'contact@company-client.test'}])
        expect(response.status).toBe(422)
      })

      it('Update a client: other company, cleared fields', async () => {
        var response = await request(app).put(`/api/clients/${clientId}`).set('Cookie', userCookie)
          .send({email: 'contact@company-client.test', firstname: 'Grace', company: {name: 'Full Company'}})
        expect(response.status).toBe(200)
        var client = (await clients()).find(c => c._id === clientId)
        expect(client).toMatchObject({firstname: 'Grace', company: {name: 'Full Company'}})
        // Fields not given are cleared
        expect(client.lastname).toBeFalsy()
        expect(client.title).toBeFalsy()

        response = await request(app).put(`/api/clients/${clientId}`).set('Cookie', userCookie).send({email: 'second@company-client.test'})
        expect(response.status).toBe(422)
        expect(response.body.datas).toBe('Client email already exists')
      })

      it('Export the clients without their identifiers', async () => {
        var response = await request(app).get('/api/clients/export').set('Cookie', userCookie)
        expect(response.status).toBe(200)
        expect(response.body.datas.find(c => c.email === 'contact@company-client.test')).toMatchObject({firstname: 'Grace'})
        expect(response.body.datas.every(c => c._id === undefined)).toBe(true)
      })

      it('Delete clients', async () => {
        expect((await request(app).delete(`/api/clients/${clientId}`).set('Cookie', userCookie)).status).toBe(200)
        expect((await request(app).delete(`/api/clients/${clientId}`).set('Cookie', userCookie)).status).toBe(404)
        expect((await clients()).map(c => c._id)).not.toContain(clientId)
      })
    })
  })
}
