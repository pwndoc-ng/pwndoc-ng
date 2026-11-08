/*
  Realtime server (socket.io): authentication of the connections and access to the rooms of the audits.
  Minimal socket.io client over the HTTP long-polling transport (Engine.IO protocol v4) on the HTTPS server of the app.
*/

module.exports = function(request, app) {
  var helpers = require('./helpers')(request, app)
  var https = require('https')
  var env = process.env.NODE_ENV || 'dev'
  var port = require('../src/config/config.json')[env].port

  function httpRequest(method, path, cookie, body) {
    return new Promise((resolve, reject) => {
      var headers = {}
      if (cookie) headers.Cookie = cookie
      if (body !== undefined) {
        headers['Content-Type'] = 'text/plain;charset=UTF-8'
        headers['Content-Length'] = Buffer.byteLength(body)
      }
      var req = https.request({host: '127.0.0.1', port: port, path: path, method: method, headers: headers, rejectUnauthorized: false}, res => {
        var data = ''
        res.setEncoding('utf8')
        res.on('data', chunk => data += chunk)
        res.on('end', () => resolve({status: res.statusCode, body: data}))
      })
      req.on('error', reject)
      req.setTimeout(8000, () => req.destroy(new Error('Socket.io request timeout')))
      if (body !== undefined) req.write(body)
      req.end()
    })
  }

  class PollingSocket {
    constructor(cookie) {
      this.cookie = cookie
      this.events = []
    }

    url() {
      return `/socket.io/?EIO=4&transport=polling${this.sid ? `&sid=${this.sid}` : ''}`
    }

    // Engine.IO handshake then socket.io connection to the main namespace: returns the connection packet
    async connect() {
      var response = await httpRequest('GET', this.url(), this.cookie)
      if (response.body[0] !== '0')
        throw new Error(`Unexpected handshake: ${response.body}`)
      this.sid = JSON.parse(response.body.substring(1)).sid
      await this.send('40')
      var packets = await this.poll()
      return packets.find(p => p.startsWith('40') || p.startsWith('44'))
    }

    send(packet) {
      return httpRequest('POST', this.url(), this.cookie, packet)
    }

    emit(event, data) {
      return this.send('42' + JSON.stringify([event, data]))
    }

    // Packets received (waits for at least one packet), events stored
    async poll() {
      var response = await httpRequest('GET', this.url(), this.cookie)
      var packets = response.body.split('\x1e')
      packets.filter(p => p.startsWith('42')).forEach(p => this.events.push(JSON.parse(p.substring(2))))
      return packets
    }

    // Waits for an event
    async waitFor(name) {
      for (var i = 0; i < 10; i++) {
        var index = this.events.findIndex(e => e[0] === name)
        if (index !== -1)
          return this.events.splice(index, 1)[0]
        await this.poll()
      }
      throw new Error(`Event ${name} not received`)
    }

    // Users of the room (asked by this socket, member of the room)
    async roomUsers(room) {
      this.events = []
      await this.emit('updateUsers', {room: room})
      return (await this.waitFor('roomUsers'))[1].map(u => u.username).sort()
    }

    close() {
      return this.send('1').catch(() => {})
    }
  }

  describe('Realtime Suite Tests', () => {
    var adminCookie, reportCookie, userCookie
    var audit1Id
    var sockets = []
    var socket = (cookie) => {
      var s = new PollingSocket(cookie ? cookie[0] : undefined)
      sockets.push(s)
      return s
    }

    beforeAll(async () => {
      adminCookie = await helpers.login('admin', 'Admin123')
      reportCookie = await helpers.login('report', 'Report123')
      userCookie = await helpers.login('user2', 'User1234')
      audit1Id = (await request(app).get('/api/audits').set('Cookie', adminCookie)).body.datas.find(a => a.name === 'Audit 1')._id
    })

    afterAll(async () => {
      for (var s of sockets)
        await s.close()
    })

    it('Connections without a valid token are refused', async () => {
      expect(await socket().connect()).toBe('44{"message":"Unauthorized"}')
      expect(await socket(['token=JWT invalid.token.value']).connect()).toBe('44{"message":"Unauthorized"}')
      var refreshToken = (await request(app).post('/api/users/token').send({username: 'admin', password: 'Admin123'})).body.datas.refreshToken
      expect(await socket([`token=JWT ${refreshToken}`]).connect()).toBe('44{"message":"Unauthorized"}')
    })

    it('Connections with a valid token are accepted', async () => {
      var packet = await socket(adminCookie).connect()
      expect(packet).toMatch(/^40\{"sid":/)
    })

    describe('Rooms of the audits', () => {
      var admin, report, user

      beforeAll(async () => {
        admin = socket(adminCookie)
        report = socket(reportCookie)
        user = socket(userCookie)
        await admin.connect()
        await report.connect()
        await user.connect()
      })

      it('Users with access to the audit join its room', async () => {
        await admin.emit('join', {room: audit1Id})
        await admin.waitFor('updateUsers')
        expect(await admin.roomUsers(audit1Id)).toEqual(['admin'])

        await report.emit('join', {room: audit1Id})
        await admin.waitFor('updateUsers') // Broadcasted to the room when a user joins
        expect(await admin.roomUsers(audit1Id)).toEqual(['admin', 'report'])
      })

      it('Connected users are listed with the audits', async () => {
        var response = await request(app).get('/api/audits').set('Cookie', adminCookie)
        expect(response.body.datas.find(a => a._id === audit1Id).connected.sort()).toEqual(['admin', 'report'])
      })

      it('Users without access to the audit cannot join its room', async () => {
        await user.emit('join', {room: audit1Id})
        await user.emit('join', {room: 'not-an-audit-id'})
        await user.emit('join', {room: {$ne: null}})
        await user.emit('join', null)
        await helpers.sleep(300) // Access check done
        expect(await admin.roomUsers(audit1Id)).toEqual(['admin', 'report'])
      })

      it('Position of the users in the audit is shared with the room', async () => {
        await report.emit('menu', {menu: 'editFinding', finding: '5f1c0c3c2a6b2c0012345678', room: audit1Id})
        await admin.waitFor('updateUsers')
        admin.events = []
        await admin.emit('updateUsers', {room: audit1Id})
        var users = (await admin.waitFor('roomUsers'))[1]
        expect(users.find(u => u.username === 'report')).toMatchObject({menu: 'editFinding', finding: '5f1c0c3c2a6b2c0012345678'})
        expect(users.find(u => u.username === 'report').color).toMatch(/^#[0-9a-f]{6}$/)
      })

      it('Leaving the room', async () => {
        await report.emit('leave', {room: audit1Id})
        await admin.waitFor('updateUsers')
        expect(await admin.roomUsers(audit1Id)).toEqual(['admin'])
      })
    })
  })
}
