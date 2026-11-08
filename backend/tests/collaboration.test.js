/*
  Collaborative editing server (Hocuspocus v4): authentication of the websocket, access to the documents
  (audits: same rules as the REST API, other documents: write permissions on the data) and read-only connections.
  Minimal client speaking the Hocuspocus protocol (lib0 encoding, Yjs sync protocol).
*/
const encoding = require('lib0/encoding')
const decoding = require('lib0/decoding')
const Y = require('yjs')
const syncProtocol = require('y-protocols/sync')

const MESSAGE_SYNC = 0
const MESSAGE_AUTH = 2
const AUTH_TOKEN = 0
const AUTH_PERMISSION_DENIED = 1
const AUTH_AUTHENTICATED = 2

module.exports = function(request, app) {
  describe('Collaboration Suite Tests', () => {
    var helpers = require('./helpers')(request, app)
    var port = process.env.COLLAB_WEBSOCKET_PORT || 8440
    var adminCookie, editorCookie, reviewerCookie, outsiderCookie
    var auditId
    var sockets = []

    // Websocket with the authentication cookie, authentication message sent for the document.
    // auth: promise of {result: 'authenticated' (scope) | 'denied' (reason) | 'refused' (upgrade refused) | 'timeout'}
    var connect = (cookie, documentName, ydoc = null) => {
      var options = cookie ? { headers: { cookie: cookie.join('; ') } } : undefined
      var ws = new WebSocket(`ws://127.0.0.1:${port}/collab/`, options)
      ws.binaryType = 'arraybuffer'
      sockets.push(ws)
      var auth = new Promise((resolve) => {
        var timer = setTimeout(() => resolve({ result: 'timeout' }), 5000)
        var done = (value) => { clearTimeout(timer); resolve(value) }
        ws.addEventListener('error', () => done({ result: 'refused' }))
        ws.addEventListener('close', () => done({ result: 'refused' }))
        ws.addEventListener('open', () => {
          var encoder = encoding.createEncoder()
          encoding.writeVarString(encoder, documentName)
          encoding.writeVarUint(encoder, MESSAGE_AUTH)
          encoding.writeVarUint(encoder, AUTH_TOKEN)
          encoding.writeVarString(encoder, 'cookie') // Dummy token: authentication relies on the cookie
          ws.send(encoding.toUint8Array(encoder))
        })
        ws.addEventListener('message', (event) => {
          var decoder = decoding.createDecoder(new Uint8Array(event.data))
          decoding.readVarString(decoder) // Document name
          var type = decoding.readVarUint(decoder)
          if (type === MESSAGE_AUTH) {
            var authType = decoding.readVarUint(decoder)
            var value = decoding.readVarString(decoder)
            if (authType === AUTH_AUTHENTICATED) done({ result: 'authenticated', scope: value })
            else if (authType === AUTH_PERMISSION_DENIED) done({ result: 'denied', reason: value })
          }
          // Sync messages: applied to the local document, answers sent to the server
          else if (type === MESSAGE_SYNC && ydoc) {
            var reply = encoding.createEncoder()
            encoding.writeVarString(reply, documentName)
            encoding.writeVarUint(reply, MESSAGE_SYNC)
            syncProtocol.readSyncMessage(decoder, reply, ydoc, 'server')
            if (encoding.length(reply) > documentName.length + 2)
              ws.send(encoding.toUint8Array(reply))
          }
        })
      })
      return { ws, auth }
    }

    // Sends a Yjs update of the document on an authenticated connection
    var sendUpdate = (connection, documentName, update) => {
      var encoder = encoding.createEncoder()
      encoding.writeVarString(encoder, documentName)
      encoding.writeVarUint(encoder, MESSAGE_SYNC)
      syncProtocol.writeUpdate(encoder, update)
      connection.ws.send(encoding.toUint8Array(encoder))
    }

    // Asks the server for the whole document (sync step 1 with an empty state)
    var requestDocument = (connection, documentName, ydoc) => {
      var encoder = encoding.createEncoder()
      encoding.writeVarString(encoder, documentName)
      encoding.writeVarUint(encoder, MESSAGE_SYNC)
      syncProtocol.writeSyncStep1(encoder, ydoc)
      connection.ws.send(encoding.toUint8Array(encoder))
    }

    var createUser = async (username) => {
      var response = await request(app).post('/api/users').set('Cookie', adminCookie)
        .send([{ username: username, password: 'Collab2026!', firstname: 'Collab', lastname: username, role: 'user' }])
      expect(response.status).toBe(201)
      return helpers.login(username, 'Collab2026!')
    }

    beforeAll(async () => {
      adminCookie = await helpers.login('admin', 'Admin123')
      editorCookie = await createUser('collab-editor')
      reviewerCookie = await createUser('collab-reviewer')
      outsiderCookie = await createUser('collab-outsider')

      var response = await request(app).post('/api/audits').set('Cookie', adminCookie).send({ name: 'Collaboration audit', language: 'en', auditType: 'Web' })
      expect(response.status).toBe(201)
      auditId = response.body.datas.audit._id
      var editorId = await helpers.userId(adminCookie, 'collab-editor')
      var reviewerId = await helpers.userId(adminCookie, 'collab-reviewer')
      response = await request(app).put(`/api/audits/${auditId}/general`).set('Cookie', adminCookie)
        .send({ collaborators: [{ _id: editorId }], reviewers: [{ _id: reviewerId }] })
      expect(response.status).toBe(200)
    })

    afterAll(() => {
      sockets.forEach(ws => { try { ws.close() } catch (err) {} })
    })

    it('Websocket refused without a valid authentication', async () => {
      expect((await connect(null, auditId).auth).result).toBe('refused')
      expect((await connect(['token=JWT invalid.token.value'], auditId).auth).result).toBe('refused')
      expect((await connect(['token=other'], auditId).auth).result).toBe('refused')
    })

    it('Audit documents: same access as the audit', async () => {
      expect(await connect(adminCookie, auditId).auth).toEqual({ result: 'authenticated', scope: 'read-write' })
      expect(await connect(editorCookie, auditId).auth).toEqual({ result: 'authenticated', scope: 'read-write' })
      expect(await connect(reviewerCookie, auditId).auth).toEqual({ result: 'authenticated', scope: 'readonly' })
      expect((await connect(outsiderCookie, auditId).auth).result).toBe('denied')
      // Unknown audit
      expect((await connect(editorCookie, '5f1c0c3c2a6b2c00cccccccc').auth).result).toBe('denied')
    })

    it('Other documents (vulnerabilities, custom fields): written by users allowed to edit the data only', async () => {
      var documentName = '5f1c0c3c2a6b2c00dddddddd/description'
      expect(await connect(adminCookie, documentName).auth).toEqual({ result: 'authenticated', scope: 'read-write' })
      expect(await connect(editorCookie, documentName).auth).toEqual({ result: 'authenticated', scope: 'readonly' })
    })

    it('Changes of read-only connections are not applied to the shared document', async () => {
      var documentName = auditId
      var editorDoc = new Y.Doc()
      var editor = connect(editorCookie, documentName, editorDoc)
      expect((await editor.auth).scope).toBe('read-write')
      var reviewer = connect(reviewerCookie, documentName, new Y.Doc())
      expect((await reviewer.auth).scope).toBe('readonly')

      var editorChange = new Y.Doc()
      editorChange.getText('field').insert(0, 'written by the editor')
      sendUpdate(editor, documentName, Y.encodeStateAsUpdate(editorChange))
      var reviewerChange = new Y.Doc()
      reviewerChange.getText('other').insert(0, 'written by the reviewer')
      sendUpdate(reviewer, documentName, Y.encodeStateAsUpdate(reviewerChange))

      // Document read by another connection (editor and reviewer still connected: the document stays loaded)
      var readerDoc = new Y.Doc()
      var reader = connect(adminCookie, documentName, readerDoc)
      expect((await reader.auth).scope).toBe('read-write')
      await helpers.eventually(() => {
        requestDocument(reader, documentName, new Y.Doc())
        expect(readerDoc.getText('field').toString()).toBe('written by the editor')
      }, 5000, 300)
      expect(readerDoc.getText('other').toString()).toBe('')
    })
  })
}
