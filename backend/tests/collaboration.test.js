/*
  Collaborative editing server (Hocuspocus v4): authentication of the websocket, access to the documents
  (audits: same rules as the REST API, other documents: write permissions on the data) and read-only connections.
  Minimal client speaking the Hocuspocus protocol (lib0 encoding, Yjs sync protocol), then clients synchronized like
  the HocuspocusProvider of the editors: concurrent editing, reconnection, access changes during a session, backup restore.
  The Yjs documents are not stored by the server: the editors save their content through the REST API.
*/
const encoding = require('lib0/encoding')
const decoding = require('lib0/decoding')
const Y = require('yjs')
const syncProtocol = require('y-protocols/sync')
const jwt = require('jsonwebtoken')

const MESSAGE_SYNC = 0
const MESSAGE_AUTH = 2
const MESSAGE_CLOSE = 7
const MESSAGE_SYNC_STATUS = 8
const AUTH_TOKEN = 0
const AUTH_PERMISSION_DENIED = 1
const AUTH_AUTHENTICATED = 2

module.exports = function(request, app) {
  describe('Collaboration Suite Tests', () => {
    var helpers = require('./helpers')(request, app)
    var auth = require('../src/lib/auth')
    var port = process.env.COLLAB_WEBSOCKET_PORT || 8440
    var adminCookie, editorCookie, reviewerCookie, outsiderCookie
    var auditId
    var sockets = []

    // Websocket with the authentication cookie, authentication message sent for the document.
    // auth: promise of {result: 'authenticated' (scope) | 'denied' (reason) | 'refused' (upgrade refused) | 'timeout'}
    // statuses: sync statuses sent by the server (false: update refused), closeReasons: documents closed by the server
    // options.sendDelay, options.receiveDelay: latency (ms) of a slow client, messages kept in order
    // Token: ids of the initial contents of the copy of the client like the editors ({"init": {<field>: <id>}}, map 'pwndoc'
    // keys 'init:<field>', see app.js), the legacy token 'cookie' without document, or options.token
    var initialContents = (ydoc) => Object.fromEntries([...ydoc.getMap('pwndoc').entries()]
      .filter(([key]) => key.startsWith('init:')).map(([key, id]) => [key.substring('init:'.length), id]))
    var connect = (cookie, documentName, ydoc = null, options = {}) => {
      var headers = cookie ? { headers: { cookie: cookie.join('; ') } } : undefined
      var ws = new WebSocket(`ws://127.0.0.1:${port}/collab/`, headers)
      ws.binaryType = 'arraybuffer'
      sockets.push(ws)
      var connection = { ws, statuses: [], closeReasons: [], wsClosed: false, received: 0 }
      connection.send = (data) => {
        var send = () => { if (ws.readyState === WebSocket.OPEN) ws.send(data) }
        if (options.sendDelay) setTimeout(send, options.sendDelay)
        else send()
      }
      ws.addEventListener('close', () => { connection.wsClosed = true })
      connection.opened = new Promise((resolve) => ws.addEventListener('open', resolve))
      connection.auth = new Promise((resolve) => {
        var timer = setTimeout(() => resolve({ result: 'timeout' }), 5000)
        var done = (value) => { clearTimeout(timer); resolve(value) }
        ws.addEventListener('error', () => done({ result: 'refused' }))
        ws.addEventListener('close', () => done({ result: 'refused' }))
        ws.addEventListener('open', () => {
          var encoder = encoding.createEncoder()
          encoding.writeVarString(encoder, documentName)
          encoding.writeVarUint(encoder, MESSAGE_AUTH)
          encoding.writeVarUint(encoder, AUTH_TOKEN)
          var token = options.token !== undefined ? options.token
            : ydoc ? JSON.stringify({ init: initialContents(ydoc) }) : 'cookie' // Authentication relies on the cookie
          encoding.writeVarString(encoder, token)
          connection.send(encoding.toUint8Array(encoder))
        })
        var handle = (event) => {
          connection.received++
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
              connection.send(encoding.toUint8Array(reply))
          }
          else if (type === MESSAGE_SYNC_STATUS) connection.statuses.push(decoding.readVarUint(decoder) === 1)
          else if (type === MESSAGE_CLOSE) connection.closeReasons.push(decoding.readVarString(decoder))
        }
        ws.addEventListener('message', (event) => options.receiveDelay ? setTimeout(() => handle(event), options.receiveDelay) : handle(event))
      })
      return connection
    }

    // Sends a Yjs update of the document on an authenticated connection
    var sendUpdate = (connection, documentName, update) => {
      var encoder = encoding.createEncoder()
      encoding.writeVarString(encoder, documentName)
      encoding.writeVarUint(encoder, MESSAGE_SYNC)
      syncProtocol.writeUpdate(encoder, update)
      connection.send(encoding.toUint8Array(encoder))
    }

    // Asks the server for the whole document (sync step 1 with an empty state)
    var requestDocument = (connection, documentName, ydoc) => {
      var encoder = encoding.createEncoder()
      encoding.writeVarString(encoder, documentName)
      encoding.writeVarUint(encoder, MESSAGE_SYNC)
      syncProtocol.writeSyncStep1(encoder, ydoc)
      connection.send(encoding.toUint8Array(encoder))
    }

    // Client synchronized like the HocuspocusProvider of the editors: after the authentication, sync step 1 with the
    // state of its document (the server answers with the missing changes and asks for the changes of the client),
    // then every local change is sent. ready: authentication result, once the first synchronization is done.
    var client = (cookie, documentName, ydoc = new Y.Doc(), options = {}) => {
      var connection = connect(cookie, documentName, ydoc, options)
      connection.ydoc = ydoc
      var onUpdate = (update, origin) => {
        if (origin !== 'server' && connection.ws.readyState === WebSocket.OPEN) sendUpdate(connection, documentName, update)
      }
      ydoc.on('update', onUpdate)
      connection.ready = connection.auth.then(async (result) => {
        if (result.result !== 'authenticated') return result
        requestDocument(connection, documentName, ydoc)
        // Sync step 2 of the client acknowledged (or connection closed meanwhile)
        await helpers.eventually(() => expect(connection.statuses.length > 0 || connection.wsClosed).toBe(true), 8000, 20)
        return result
      })
      connection.disconnect = () => {
        ydoc.off('update', onUpdate)
        connection.ws.close()
        return helpers.eventually(() => expect(connection.wsClosed).toBe(true))
      }
      return connection
    }

    // Websocket shared by several documents (HocuspocusProviderWebsocket shared by providers): one authentication per
    // document, messages routed by document name, document closed with a close message (provider detached).
    // open(documentName): {ydoc, statuses, ready: promise of the scope ('denied' if refused) once synchronized}
    var multiplexed = (cookie) => {
      var ws = new WebSocket(`ws://127.0.0.1:${port}/collab/`, { headers: { cookie: cookie.join('; ') } })
      ws.binaryType = 'arraybuffer'
      sockets.push(ws)
      var documents = {}
      var opened = new Promise((resolve) => ws.addEventListener('open', resolve))
      var send = (documentName, write) => {
        var encoder = encoding.createEncoder()
        encoding.writeVarString(encoder, documentName)
        write(encoder)
        if (ws.readyState === WebSocket.OPEN) ws.send(encoding.toUint8Array(encoder))
      }
      ws.addEventListener('message', (event) => {
        var decoder = decoding.createDecoder(new Uint8Array(event.data))
        var documentName = decoding.readVarString(decoder)
        var type = decoding.readVarUint(decoder)
        var document = documents[documentName]
        if (!document) return
        if (type === MESSAGE_AUTH) {
          var authType = decoding.readVarUint(decoder)
          var value = decoding.readVarString(decoder)
          if (authType === AUTH_AUTHENTICATED) document.authenticated(value)
          else if (authType === AUTH_PERMISSION_DENIED) document.authenticated('denied')
        }
        else if (type === MESSAGE_SYNC) {
          var reply = encoding.createEncoder()
          encoding.writeVarString(reply, documentName)
          encoding.writeVarUint(reply, MESSAGE_SYNC)
          syncProtocol.readSyncMessage(decoder, reply, document.ydoc, 'server')
          if (encoding.length(reply) > documentName.length + 2 && ws.readyState === WebSocket.OPEN) ws.send(encoding.toUint8Array(reply))
        }
        else if (type === MESSAGE_SYNC_STATUS) document.statuses.push(decoding.readVarUint(decoder) === 1)
      })
      return {
        open: (documentName) => {
          var document = { ydoc: new Y.Doc(), statuses: [], closed: false }
          documents[documentName] = document
          document.onUpdate = (update, origin) => {
            if (origin !== 'server') send(documentName, (encoder) => { encoding.writeVarUint(encoder, MESSAGE_SYNC); syncProtocol.writeUpdate(encoder, update) })
          }
          document.ydoc.on('update', document.onUpdate)
          var authenticated = new Promise((resolve) => { document.authenticated = resolve })
          document.ready = opened.then(() => {
            if (document.closed) return 'closed'
            document.authSent = true
            send(documentName, (encoder) => {
              encoding.writeVarUint(encoder, MESSAGE_AUTH)
              encoding.writeVarUint(encoder, AUTH_TOKEN)
              encoding.writeVarString(encoder, 'cookie')
            })
            return Promise.race([authenticated, helpers.sleep(5000).then(() => 'timeout')])
          }).then(async (scope) => {
            if (scope === 'denied' || scope === 'timeout' || scope === 'closed' || document.closed) return scope
            send(documentName, (encoder) => { encoding.writeVarUint(encoder, MESSAGE_SYNC); syncProtocol.writeSyncStep1(encoder, document.ydoc) })
            await helpers.eventually(() => expect(document.statuses.length > 0 || document.closed).toBe(true), 5000, 20)
            return scope
          })
          return document
        },
        close: (documentName) => {
          var document = documents[documentName]
          document.closed = true
          document.ydoc.off('update', document.onUpdate)
          if (document.authSent)
            send(documentName, (encoder) => { encoding.writeVarUint(encoder, MESSAGE_CLOSE); encoding.writeVarString(encoder, 'provider_initiated') })
        },
        opened,
        disconnect: () => ws.close()
      }
    }

    var text = (connection, field) => connection.ydoc.getText(field).toString()

    // Paragraph of a TipTap document (Y.XmlFragment of a field)
    var paragraph = (content) => {
      var element = new Y.XmlElement('paragraph')
      element.insert(0, [new Y.XmlText(content)])
      return element
    }

    var createUser = async (username) => {
      var response = await request(app).post('/api/users').set('Cookie', adminCookie)
        .send([{ username: username, password: 'Collab2026!', firstname: 'Collab', lastname: username, role: 'user' }])
      expect(response.status).toBe(201)
      return helpers.login(username, 'Collab2026!')
    }

    var createAudit = async (name, collaborators = [], reviewers = []) => {
      var response = await request(app).post('/api/audits').set('Cookie', adminCookie).send({ name: name, language: 'en', auditType: 'collab Type' })
      expect(response.status).toBe(201)
      var id = response.body.datas.audit._id
      response = await request(app).put(`/api/audits/${id}/general`).set('Cookie', adminCookie)
        .send({ collaborators: collaborators.map(_id => ({ _id })), reviewers: reviewers.map(_id => ({ _id })) })
      expect(response.status).toBe(200)
      return id
    }

    var editorId, reviewerId

    beforeAll(async () => {
      adminCookie = await helpers.login('admin', 'Admin123')
      editorCookie = await createUser('collab-editor')
      reviewerCookie = await createUser('collab-reviewer')
      outsiderCookie = await createUser('collab-outsider')
      expect((await request(app).post('/api/data/audit-types').set('Cookie', adminCookie).send({ name: 'collab Type', templates: [] })).status).toBe(201)

      editorId = await helpers.userId(adminCookie, 'collab-editor')
      reviewerId = await helpers.userId(adminCookie, 'collab-reviewer')
      auditId = await createAudit('Collaboration audit', [editorId], [reviewerId])
    })

    afterAll(async () => {
      sockets.forEach(ws => { try { ws.close() } catch (err) {} })
      await request(app).put('/api/settings/revert').set('Cookie', adminCookie)
      await request(app).delete(`/api/audits/${auditId}`).set('Cookie', adminCookie)
      await request(app).delete('/api/data/audit-types/collab%20Type').set('Cookie', adminCookie)
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

    describe('Concurrent editing', () => {
      var documentName

      beforeAll(async () => {
        documentName = await createAudit('collab Concurrent audit', [editorId], [reviewerId])
      })

      afterAll(async () => {
        await request(app).delete(`/api/audits/${documentName}`).set('Cookie', adminCookie)
      })

      it('Two editors typing in the same field at the same time get the same content', async () => {
        var a = client(editorCookie, documentName)
        var b = client(adminCookie, documentName)
        expect((await a.ready).scope).toBe('read-write')
        expect((await b.ready).scope).toBe('read-write')
        var field = `${documentName}-same-description`

        // Concurrent changes: each client changes its document before receiving the change of the other one
        a.ydoc.getText(field).insert(0, 'Hello from A. ')
        b.ydoc.getText(field).insert(0, 'Hello from B. ')
        await helpers.eventually(() => {
          expect(text(a, field)).toBe(text(b, field))
          expect(text(a, field)).toContain('Hello from A. ')
          expect(text(a, field)).toContain('Hello from B. ')
        })
        expect(text(a, field)).toHaveLength('Hello from A. Hello from B. '.length)

        // Concurrent deletion and insertion at the same place
        a.ydoc.getText(field).delete(0, 6)
        b.ydoc.getText(field).insert(6, '[B]')
        b.ydoc.getText(field).insert(text(b, field).length, ' end')
        await helpers.eventually(() => {
          expect(text(a, field)).toBe(text(b, field))
          expect(text(a, field)).toContain('[B]')
          expect(text(a, field).endsWith(' end')).toBe(true)
        })
        expect(text(a, field)).toHaveLength('Hello from A. Hello from B. '.length - 6 + '[B]'.length + ' end'.length)
        await a.disconnect()
        await b.disconnect()
      })

      it('Editors of different fields of the same audit: each field keeps its content', async () => {
        // Fields of the editors: <audit>-<finding>-<field> (Y.XmlFragment of TipTap) in the document of the audit
        var description = `${documentName}-6aef2c3a3b1d4e5f60718293-description`
        var poc = `${documentName}-6aef2c3a3b1d4e5f60718294-poc`
        var a = client(editorCookie, documentName)
        var b = client(adminCookie, documentName)
        await a.ready
        await b.ready
        a.ydoc.getXmlFragment(description).insert(0, [paragraph('Description by A')])
        b.ydoc.getXmlFragment(poc).insert(0, [paragraph('PoC by B')])
        a.ydoc.getXmlFragment(description).insert(1, [paragraph('Second paragraph by A')])
        await helpers.eventually(() => {
          for (var connection of [a, b]) {
            expect(connection.ydoc.getXmlFragment(description).toString()).toBe('<paragraph>Description by A</paragraph><paragraph>Second paragraph by A</paragraph>')
            expect(connection.ydoc.getXmlFragment(poc).toString()).toBe('<paragraph>PoC by B</paragraph>')
          }
        })
        await a.disconnect()
        await b.disconnect()
      })

      it('Three clients with interleaved insertions and deletions converge', async () => {
        var field = `${documentName}-stress-description`
        var clients = [client(editorCookie, documentName), client(adminCookie, documentName), client(editorCookie, documentName)]
        for (var c of clients) await c.ready
        var seed = 42
        var random = (max) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % max }
        for (var round = 0; round < 10; round++) {
          clients.forEach((c, index) => {
            var content = c.ydoc.getText(field)
            for (var i = 0; i < 5; i++) {
              if (content.length > 10 && random(3) === 0) content.delete(random(content.length - 3), 3)
              else content.insert(random(content.length + 1), `<${index}:${round}:${i}>`)
            }
          })
          if (round % 3 === 0) await helpers.sleep(20) // Some rounds before the changes of the others are received
        }
        await helpers.eventually(() => {
          expect(text(clients[1], field)).toBe(text(clients[0], field))
          expect(text(clients[2], field)).toBe(text(clients[0], field))
        }, 5000)
        expect(text(clients[0], field).length).toBeGreaterThan(0)
        for (var c of clients) await c.disconnect()
      })

      it('Reviewer (read-only) receives the changes of the editors live', async () => {
        var field = `${documentName}-live-description`
        var editor = client(editorCookie, documentName)
        var reviewer = client(reviewerCookie, documentName)
        expect((await editor.ready).scope).toBe('read-write')
        expect((await reviewer.ready).scope).toBe('readonly')
        editor.ydoc.getText(field).insert(0, 'Live change')
        await helpers.eventually(() => expect(text(reviewer, field)).toBe('Live change'))
        editor.ydoc.getText(field).insert(11, ' continued')
        await helpers.eventually(() => expect(text(reviewer, field)).toBe('Live change continued'))
        await editor.disconnect()
        await reviewer.disconnect()
      })

      it('Late client gets the whole current document', async () => {
        var field = `${documentName}-late-description`
        var editor = client(editorCookie, documentName)
        await editor.ready
        editor.ydoc.getText(field).insert(0, 'Written before the second client')
        editor.ydoc.getXmlFragment(`${field}-xml`).insert(0, [paragraph('Rich text')])
        await helpers.eventually(() => expect(editor.statuses.length).toBeGreaterThan(1)) // Change received by the server
        var late = client(adminCookie, documentName)
        await late.ready
        expect(text(late, field)).toBe('Written before the second client')
        expect(late.ydoc.getXmlFragment(`${field}-xml`).toString()).toBe('<paragraph>Rich text</paragraph>')
        await editor.disconnect()
        await late.disconnect()
      })

      it('Client reconnecting gets the changes made meanwhile and sends the changes made offline', async () => {
        var field = `${documentName}-reconnect-description`
        var a = client(editorCookie, documentName)
        var b = client(adminCookie, documentName)
        await a.ready
        await b.ready
        a.ydoc.getText(field).insert(0, 'one')
        await helpers.eventually(() => expect(text(b, field)).toBe('one'))

        // b offline: both change the field
        await b.disconnect()
        a.ydoc.getText(field).insert(3, ' two')
        var offlineDoc = b.ydoc
        offlineDoc.getText(field).insert(0, 'offline ')
        expect(text(a, field)).toBe('one two')

        // b reconnects with its document (HocuspocusProvider reconnection)
        var b2 = client(adminCookie, documentName, offlineDoc)
        await b2.ready
        await helpers.eventually(() => {
          expect(text(a, field)).toBe('offline one two')
          expect(text(b2, field)).toBe('offline one two')
        })
        await a.disconnect()
        await b2.disconnect()
      })

      it('The document is not stored by the server: unloaded when the last client leaves', async () => {
        // The content of the editors is saved through the REST API, the editors load it when the document is empty
        var field = `${documentName}-unload-description`
        var a = client(editorCookie, documentName)
        await a.ready
        a.ydoc.getText(field).insert(0, 'Kept while a client is connected')
        var b = client(adminCookie, documentName)
        await b.ready
        expect(text(b, field)).toBe('Kept while a client is connected')
        await a.disconnect()
        // Still loaded: b is connected
        var c = client(reviewerCookie, documentName)
        await c.ready
        expect(text(c, field)).toBe('Kept while a client is connected')
        await b.disconnect()
        await c.disconnect()

        await helpers.eventually(async () => {
          var d = client(reviewerCookie, documentName)
          await d.ready
          var content = text(d, field)
          await d.disconnect()
          expect(content).toBe('')
        }, 5000, 200)
      })
    })

    describe('Read-only connections', () => {
      it('Change of a read-only connection refused (sync status) and not received by the other clients', async () => {
        var field = `${auditId}-readonly-description`
        var editor = client(editorCookie, auditId)
        var reviewer = client(reviewerCookie, auditId)
        await editor.ready
        expect((await reviewer.ready).scope).toBe('readonly')
        expect(reviewer.statuses).toEqual([true]) // Nothing to send at the synchronization

        reviewer.ydoc.getText(field).insert(0, 'reviewer change')
        await helpers.eventually(() => expect(reviewer.statuses).toEqual([true, false]))
        editor.ydoc.getText(field).insert(0, 'editor change')
        await helpers.eventually(() => expect(text(reviewer, field)).toContain('editor change'))
        expect(text(editor, field)).toBe('editor change')
        // Read-only client sending the whole document again: still refused
        sendUpdate(reviewer, auditId, Y.encodeStateAsUpdate(reviewer.ydoc))
        await helpers.eventually(() => expect(reviewer.statuses).toEqual([true, false, false]))
        await helpers.sleep(200)
        expect(text(editor, field)).toBe('editor change')
        await editor.disconnect()
        await reviewer.disconnect()
      })

      it('Data documents: changes of users without write permission on the data are refused', async () => {
        var documentName = '5f1c0c3c2a6b2c00eeeeeeee/description'
        var admin = client(adminCookie, documentName)
        var user = client(editorCookie, documentName)
        expect((await admin.ready).scope).toBe('read-write')
        expect((await user.ready).scope).toBe('readonly')
        user.ydoc.getXmlFragment('description').insert(0, [paragraph('changed by a user')])
        await helpers.eventually(() => expect(user.statuses).toContain(false))
        admin.ydoc.getXmlFragment('description').insert(0, [paragraph('changed by an admin')])
        await helpers.eventually(() => expect(user.ydoc.getXmlFragment('description').toString()).toContain('changed by an admin'))
        expect(admin.ydoc.getXmlFragment('description').toString()).toBe('<paragraph>changed by an admin</paragraph>')
        await admin.disconnect()
        await user.disconnect()
      })

      describe('Audit in review or approved', () => {
        var reviewAuditId

        beforeAll(async () => {
          reviewAuditId = await createAudit('collab Review audit', [editorId], [reviewerId])
          var response = await request(app).put('/api/settings').set('Cookie', adminCookie).send({ reviews: { enabled: true } })
          expect(response.status).toBe(200)
          response = await request(app).put(`/api/audits/${reviewAuditId}/updateReadyForReview`).set('Cookie', editorCookie).send({ state: 'REVIEW' })
          expect(response.status).toBe(200)
        })

        afterAll(async () => {
          await request(app).put('/api/settings/revert').set('Cookie', adminCookie)
          await request(app).delete(`/api/audits/${reviewAuditId}`).set('Cookie', adminCookie)
        })

        it('Audit in review: the API refuses the changes of the editors, reviewers stay read-only', async () => {
          var response = await request(app).put(`/api/audits/${reviewAuditId}/general`).set('Cookie', editorCookie).send({ name: 'changed' })
          expect(response.status).toBe(403)
          expect((await connect(reviewerCookie, reviewAuditId).auth).scope).toBe('readonly')
        })

        // Same rule as the REST API (403 "not in the EDIT state"): no change of the shared document
        it('Audit in review or approved: read-only for its editors', async () => {
          expect((await connect(editorCookie, reviewAuditId).auth).scope).toBe('readonly')
          expect((await connect(adminCookie, reviewAuditId).auth).scope).toBe('readonly')
          await require('mongoose').model('Audit').updateOne({ _id: reviewAuditId }, { state: 'APPROVED' })
          expect((await connect(editorCookie, reviewAuditId).auth).scope).toBe('readonly')
          await require('mongoose').model('Audit').updateOne({ _id: reviewAuditId }, { state: 'REVIEW' })
        })

        it('Audit back to edition: open sessions reset, read-write again for its editors', async () => {
          var session = client(editorCookie, reviewAuditId)
          expect((await session.ready).scope).toBe('readonly')
          var response = await request(app).put(`/api/audits/${reviewAuditId}/updateReadyForReview`).set('Cookie', editorCookie).send({ state: 'EDIT' })
          expect(response.status).toBe(200)
          // Websocket closed: the provider reconnects and gets the new scope
          await helpers.eventually(() => expect(session.wsClosed).toBe(true))
          var reconnected = client(editorCookie, reviewAuditId, session.ydoc)
          expect((await reconnected.ready).scope).toBe('read-write')
          expect((await connect(reviewerCookie, reviewAuditId).auth).scope).toBe('readonly')

          // Back in review: read-write session reset, read-only after the reconnection
          response = await request(app).put(`/api/audits/${reviewAuditId}/updateReadyForReview`).set('Cookie', editorCookie).send({ state: 'REVIEW' })
          expect(response.status).toBe(200)
          await helpers.eventually(() => expect(reconnected.wsClosed).toBe(true))
          var again = client(editorCookie, reviewAuditId, session.ydoc)
          expect((await again.ready).scope).toBe('readonly')
          await again.disconnect()
        })
      })
    })

    describe('Authentication and access', () => {
      it('Expired, forged, unsigned tokens and refresh tokens are refused', async () => {
        var token = (await request(app).post('/api/users/token').send({ username: 'collab-editor', password: 'Collab2026!' })).body.datas
        var payload = helpers.jwtPayload(token.token)
        delete payload.iat
        delete payload.exp
        var expired = jwt.sign({ ...payload, exp: Math.floor(Date.now() / 1000) - 60 }, auth.jwtSecret)
        var forged = jwt.sign(payload, 'another secret', { expiresIn: '15 minutes' })
        var header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
        var unsigned = `${header}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.`
        for (var value of [expired, forged, unsigned, token.refreshToken])
          expect((await connect(helpers.cookie(value), auditId).auth).result).toBe('refused')
        // Valid token
        expect((await connect(helpers.cookie(token.token), auditId).auth).scope).toBe('read-write')
      })

      it('Token read in a cookie header with other cookies, URL encoded', async () => {
        var token = editorCookie[0].substring('token='.length)
        expect((await connect(['lang=fr', `token=${encodeURIComponent(token)}`, 'other=x'], auditId).auth).scope).toBe('read-write')
        expect((await connect([`refreshToken=${token}`], auditId).auth).result).toBe('refused')
        expect((await connect([`token=${token.replace('JWT ', 'Bearer ')}`], auditId).auth).result).toBe('refused')
      })

      it('Malformed document names: no access to the content of an audit', async () => {
        var field = `${auditId}-names-description`
        var editor = client(editorCookie, auditId)
        await editor.ready
        editor.ydoc.getText(field).insert(0, 'confidential content')
        await helpers.eventually(() => expect(editor.statuses.length).toBeGreaterThan(1))

        // Identifier of the audit in another case: access of the audit checked
        expect((await connect(outsiderCookie, auditId.toUpperCase()).auth).result).toBe('denied')
        // Names which are not audit identifiers: refused, or other documents (read-only for the users) without the audit content
        var results = {}
        for (var name of [`${auditId}/description`, `${auditId} `, ` ${auditId}`, `${auditId}-x`, `../${auditId}`, `${auditId}\u0000`]) {
          var outsider = client(outsiderCookie, name)
          var result = await outsider.ready
          results[JSON.stringify(name)] = result.result === 'authenticated' ? result.scope : result.result
          if (result.result === 'authenticated') {
            expect(text(outsider, field)).toBe('')
            expect(Y.encodeStateAsUpdate(outsider.ydoc)).toEqual(Y.encodeStateAsUpdate(new Y.Doc())) // Empty document
          }
          await outsider.disconnect()
        }
        Object.entries(results).forEach(([name, result]) => expect([name, ['readonly', 'denied'].includes(result)]).toEqual([name, true]))
        expect(results[JSON.stringify(`${auditId}/description`)]).toBe('readonly') // Name of the other documents
        await editor.disconnect()
      })

      it('Unusual document names do not break the server', async () => {
        for (var name of ['', 'x'.repeat(5000), '{"$ne":null}', '😀/ü', '5f1c0c3c2a6b2c00zzzzzzzz']) {
          var result = await connect(editorCookie, name).auth
          expect(['authenticated', 'denied']).toContain(result.result)
        }
        // Server still working
        var editor = client(editorCookie, auditId)
        expect((await editor.ready).scope).toBe('read-write')
        await editor.disconnect()
      })

      describe('Access removed during a session', () => {
        var revokedAuditId, removedCookie

        beforeAll(async () => {
          removedCookie = await createUser('collab-removed')
          revokedAuditId = await createAudit('collab Revoked audit', [editorId, await helpers.userId(adminCookie, 'collab-removed')])
        })

        it('Collaborator removed from the audit: new connections refused', async () => {
          expect((await connect(removedCookie, revokedAuditId).auth).scope).toBe('read-write')
          var response = await request(app).put(`/api/audits/${revokedAuditId}/general`).set('Cookie', adminCookie).send({ collaborators: [{ _id: editorId }] })
          expect(response.status).toBe(200)
          expect((await connect(removedCookie, revokedAuditId).auth).result).toBe('denied')
          expect((await connect(editorCookie, revokedAuditId).auth).scope).toBe('read-write')
        })

        // Sessions of the audit reset when its users change: the providers reconnect, the removed user is refused
        it('Collaborator removed from the audit during a session: session closed, no more changes received or sent', async () => {
          var field = `${revokedAuditId}-revoked-description`
          var response = await request(app).put(`/api/audits/${revokedAuditId}/general`).set('Cookie', adminCookie)
            .send({ collaborators: [{ _id: editorId }, { _id: await helpers.userId(adminCookie, 'collab-removed') }] })
          expect(response.status).toBe(200)
          var removed = client(removedCookie, revokedAuditId)
          var editor = client(editorCookie, revokedAuditId)
          expect((await removed.ready).scope).toBe('read-write')
          await editor.ready
          response = await request(app).put(`/api/audits/${revokedAuditId}/general`).set('Cookie', adminCookie).send({ collaborators: [{ _id: editorId }] })
          expect(response.status).toBe(200)
          await helpers.eventually(() => {
            expect(removed.wsClosed).toBe(true)
            expect(editor.wsClosed).toBe(true)
          })
          // Reconnection of the providers: refused for the removed user, accepted for the collaborator
          var removedAgain = client(removedCookie, revokedAuditId, removed.ydoc)
          expect((await removedAgain.ready).result).toBe('denied')
          var editorAgain = client(editorCookie, revokedAuditId, editor.ydoc)
          expect((await editorAgain.ready).scope).toBe('read-write')

          editorAgain.ydoc.getText(field).insert(0, 'after the removal')
          removed.ydoc.getText(field).insert(0, 'written by the removed user ')
          await helpers.sleep(500)
          expect(text(removed, field)).not.toContain('after the removal')
          expect(text(editorAgain, field)).toBe('after the removal')
          // Same users again: sessions kept
          response = await request(app).put(`/api/audits/${revokedAuditId}/general`).set('Cookie', adminCookie).send({ collaborators: [{ _id: editorId }], name: 'collab Revoked audit' })
          expect(response.status).toBe(200)
          await helpers.sleep(300)
          expect(editorAgain.wsClosed).toBe(false)
          await editorAgain.disconnect()
          await removed.disconnect()
        })

        it('Audit deleted: new connections refused, server still working', async () => {
          var editor = client(editorCookie, revokedAuditId)
          await editor.ready
          expect((await request(app).delete(`/api/audits/${revokedAuditId}`).set('Cookie', adminCookie)).status).toBe(200)
          expect((await connect(editorCookie, revokedAuditId).auth).result).toBe('denied')
          expect((await connect(adminCookie, revokedAuditId).auth).result).toBe('denied')
          await editor.disconnect()
          var other = client(editorCookie, auditId)
          expect((await other.ready).scope).toBe('read-write')
          await other.disconnect()
        })

        it('Audit deleted during a session: open sessions closed', async () => {
          var deletedAuditId = await createAudit('collab Deleted audit', [editorId])
          var field = `${deletedAuditId}-deleted-description`
          var editor = client(editorCookie, deletedAuditId)
          var admin = client(adminCookie, deletedAuditId)
          await editor.ready
          await admin.ready
          expect((await request(app).delete(`/api/audits/${deletedAuditId}`).set('Cookie', adminCookie)).status).toBe(200)
          await helpers.sleep(500)
          admin.ydoc.getText(field).insert(0, 'after the deletion')
          await helpers.sleep(500)
          expect(editor.closeReasons.length > 0 || editor.wsClosed).toBe(true)
          expect(text(editor, field)).toBe('')
          await editor.disconnect()
          await admin.disconnect()
        })
      })
    })

    describe('Content of the findings', () => {
      // The shared document of an audit holds one Y.XmlFragment per editor field (<audit>-<finding>-description). The
      // server does not load nor store it (no onLoadDocument / onStoreDocument): the editors read the content of the API,
      // write it in the shared document when their field is empty once synchronized (setInitialCollaborativeContent of
      // frontend/src/components/editor-collaboration.js, called by editor.vue) and save their content through the API.
      var hocuspocus = app.get('hocuspocus')
      var escapeHtml = (value) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      var unescapeHtml = (value) => value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
      var paragraphTexts = (fragment) => fragment.toArray().map(element => element.toArray().map(child => child.toString()).join(''))
      var htmlOf = (fragment) => paragraphTexts(fragment).map(content => `<p>${escapeHtml(content)}</p>`).join('')
      var paragraphsOf = (html) => [...(html || '').matchAll(/<p>(.*?)<\/p>/g)].map(match => paragraph(unescapeHtml(match[1])))
      var findingPath = (audit, findingId) => `/api/audits/${audit}/findings/${findingId}`
      var savedDescription = async (audit, findingId) => (await request(app).get(findingPath(audit, findingId)).set('Cookie', adminCookie)).body.datas.description
      var contains = (ydoc, value) => Buffer.from(Y.encodeStateAsUpdate(ydoc)).includes(value) // Text anywhere in a document
      var audits = []

      // Audit (editor: collaborator, reviewer) with findings whose description is saved in the database
      var createFindings = async (descriptions) => {
        var id = await createAudit(`collab Content ${audits.length}`, [editorId], [reviewerId])
        audits.push(id)
        for (var [name, description] of Object.entries(descriptions))
          expect((await request(app).post(`/api/audits/${id}/findings`).set('Cookie', editorCookie).send({ title: `collab ${name}`, description: description })).status).toBe(200)
        var audit = (await request(app).get(`/api/audits/${id}`).set('Cookie', editorCookie)).body.datas
        var findings = {}
        Object.keys(descriptions).forEach(name => { findings[name] = audit.findings.find(f => f.title === `collab ${name}`)._id })
        return { audit: id, findings }
      }

      // Initial content of editor.vue (setInitialCollaborativeContent of editor-collaboration.js): written in the shared field
      // when it is empty once synchronized. Deterministic: built in a temporary document whose client id is the 32-bit FNV-1a
      // hash of the field name and of the content (JSON of the ProseMirror document, emulated), so that editors writing the
      // same content (at the same time, or coming back with a copy after the server reloaded the document) create the same
      // Yjs items, kept once. A field with content (even an empty paragraph) is kept as it is, an empty value is not written
      var fnv1a32 = (value) => {
        var hash = 0x811c9dc5
        for (var i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 0x01000193) >>> 0
        return hash
      }
      var writeInitialContent = (editor, html) => {
        if (!html || html === '<p></p>' || editor.fragment.length > 0) return false
        var content = { type: 'doc', content: [...html.matchAll(/<p>(.*?)<\/p>/g)].map(match => ({ type: 'paragraph', content: [{ type: 'text', text: unescapeHtml(match[1]) }] })) }
        var initial = new Y.Doc()
        initial.clientID = fnv1a32(`${editor.field}\u0000${JSON.stringify(content)}`)
        // Id of the initial content recorded with it (token of the reconnections, see app.js), in the temporary document: a
        // local change in the transaction applying the update would make Yjs change the client id of the shared document
        initial.transact(() => {
          initial.getXmlFragment(editor.field).insert(0, paragraphsOf(html))
          initial.getMap('pwndoc').set(`init:${editor.field}`, initial.clientID)
        })
        Y.applyUpdate(editor.ydoc, Y.encodeStateAsUpdate(initial), 'pwndoc-initial-content')
        initial.destroy()
        return true
      }

      // Editor of the description of a finding: loaded once synchronized and initialized (unless initialContent: false).
      // options.html: value of the page
      var editorOf = (cookie, audit, findingId, options = {}) => {
        var editor = client(cookie, audit, new Y.Doc(), options)
        editor.field = `${audit}-${findingId}-description`
        editor.fragment = editor.ydoc.getXmlFragment(editor.field)
        editor.texts = () => paragraphTexts(editor.fragment)
        editor.save = async () => expect((await request(app).put(findingPath(audit, findingId)).set('Cookie', cookie).send({ description: htmlOf(editor.fragment) })).status).toBe(200)
        var pageValue = options.html !== undefined ? Promise.resolve(options.html) : savedDescription(audit, findingId)
        editor.loaded = Promise.all([pageValue, editor.ready]).then(([html, result]) => {
          editor.html = html
          if (result.result === 'authenticated' && !editor.wsClosed && options.initialContent !== false)
            writeInitialContent(editor, html)
          return result
        })
        return editor
      }
      var openEditor = async (cookie, audit, findingId, options) => {
        var editor = editorOf(cookie, audit, findingId, options)
        await editor.loaded
        return editor
      }
      var unloaded = (audit) => helpers.eventually(() => expect(hocuspocus.documents.has(audit)).toBe(false), 5000)
      // Same changes received by all the editors (same state vector) and same content, then the check of the content
      var converged = (editors, check = () => {}, timeout = 10000) => helpers.eventually(() => {
        var vector = Buffer.from(Y.encodeStateVector(editors[0].ydoc))
        editors.slice(1).forEach(editor => {
          expect(Buffer.from(Y.encodeStateVector(editor.ydoc)).equals(vector)).toBe(true)
          expect(htmlOf(editor.fragment)).toBe(htmlOf(editors[0].fragment))
        })
        check()
      }, timeout, 50)

      afterAll(async () => {
        for (var id of audits)
          await request(app).delete(`/api/audits/${id}`).set('Cookie', adminCookie)
      })

      describe('Throughput and latency', () => {
        it('Slow and fast clients typing at the same time converge, saved content identical', async () => {
          var { audit, findings } = await createFindings({ A: '<p>Saved in the database</p>' })
          var fast = await openEditor(editorCookie, audit, findings.A)
          var slow = await openEditor(adminCookie, audit, findings.A, { sendDelay: 150, receiveDelay: 150 })
          var slower = await openEditor(editorCookie, audit, findings.A, { sendDelay: 400, receiveDelay: 50 })
          var editors = [fast, slow, slower]
          await converged(editors)
          expect(fast.texts()).toEqual(['Saved in the database']) // Initial content written once

          for (var round = 0; round < 30; round++) {
            editors.forEach((editor, index) => {
              editor.fragment.insert(editor.fragment.length, [paragraph(`${index}:${round}`)])
              editor.fragment.get(0).get(0).insert(0, `${index}`)
            })
            if (round % 5 === 0) await helpers.sleep(30)
          }
          await converged(editors, () => expect(fast.texts()).toHaveLength(91), 15000)
          var texts = fast.texts()
          for (var round = 0; round < 30; round++)
            [0, 1, 2].forEach(index => expect(texts.filter(t => t === `${index}:${round}`)).toHaveLength(1))
          expect(texts[0]).toMatch(/^[012]{90}Saved in the database$/)
          await slower.save()
          expect(await savedDescription(audit, findings.A)).toBe(htmlOf(fast.fragment))
          for (var editor of editors) await editor.disconnect()
        })

        it('Bursts of small updates and grouped updates: no change lost', async () => {
          var { audit, findings } = await createFindings({ A: '<p>Start</p>' })
          var a = await openEditor(editorCookie, audit, findings.A)
          var b = await openEditor(adminCookie, audit, findings.A, { receiveDelay: 20 })
          await converged([a, b])
          // One message per character
          for (var i = 0; i < 300; i++) a.fragment.get(0).get(0).insert(a.texts()[0].length, 'a')
          for (var i = 0; i < 100; i++) b.fragment.insert(b.fragment.length, [paragraph(`b${i}`)])
          // Changes made offline from the shared state: sent grouped in one message, and as a burst of messages
          var offline = (prefix) => {
            var doc = new Y.Doc()
            Y.applyUpdate(doc, Y.encodeStateAsUpdate(a.ydoc))
            var updates = []
            doc.on('update', update => updates.push(update))
            var fragment = doc.getXmlFragment(`${audit}-${findings.A}-description`)
            for (var i = 0; i < 200; i++) fragment.insert(fragment.length, [paragraph(`${prefix}${i}`)])
            return updates
          }
          var grouped = connect(editorCookie, audit)
          var burst = connect(adminCookie, audit)
          expect((await grouped.auth).scope).toBe('read-write')
          expect((await burst.auth).scope).toBe('read-write')
          sendUpdate(grouped, audit, Y.mergeUpdates(offline('g')))
          offline('u').forEach(update => sendUpdate(burst, audit, update))

          await converged([a, b], () => expect(a.texts()).toHaveLength(501), 15000)
          var texts = a.texts()
          expect(texts[0]).toBe('Start' + 'a'.repeat(300))
          for (var prefix of ['b', 'g', 'u'])
            expect(texts.filter(t => t.startsWith(prefix) && /^[bgu]\d+$/.test(t))).toHaveLength(prefix === 'b' ? 100 : 200)
          await b.save()
          expect(await savedDescription(audit, findings.A)).toBe(htmlOf(a.fragment))
          grouped.ws.close()
          burst.ws.close()
          await a.disconnect()
          await b.disconnect()
        })

        it('Large document: 2000 paragraphs and a paragraph of 1 MB', async () => {
          var { audit, findings } = await createFindings({ A: '<p>Start</p>' })
          var a = await openEditor(editorCookie, audit, findings.A)
          var large = 'x'.repeat(1024 * 1024)
          a.ydoc.transact(() => {
            a.fragment.insert(1, Array.from({ length: 2000 }, (_, i) => paragraph(`Paragraph ${i}`)))
            a.fragment.insert(a.fragment.length, [paragraph(large)])
          })
          var late = await openEditor(adminCookie, audit, findings.A, { receiveDelay: 50 })
          await converged([a, late], () => expect(late.texts()).toHaveLength(2002), 15000)
          expect(late.texts()[2001]).toHaveLength(1024 * 1024)
          await late.save()
          expect(await savedDescription(audit, findings.A)).toBe(htmlOf(a.fragment))
          await a.disconnect()
          await late.disconnect()
        })

        it('Updates received out of order are applied once their dependencies arrive', async () => {
          var { audit, findings } = await createFindings({ A: '<p>Start</p>' })
          var a = await openEditor(editorCookie, audit, findings.A)
          // Three successive changes of another client: each one depends on the previous one
          var local = new Y.Doc()
          Y.applyUpdate(local, Y.encodeStateAsUpdate(a.ydoc))
          var updates = []
          local.on('update', update => updates.push(update))
          var fragment = local.getXmlFragment(`${audit}-${findings.A}-description`)
          fragment.insert(1, [paragraph('first')])
          fragment.get(1).get(0).insert(5, ' second')
          fragment.insert(2, [paragraph('third')])
          var sender = connect(adminCookie, audit)
          await sender.auth
          for (var index of [2, 1, 0]) {
            sendUpdate(sender, audit, updates[index])
            await helpers.sleep(100)
            if (index > 0) expect(a.texts()).toEqual(['Start']) // Pending: dependencies missing
          }
          await helpers.eventually(() => expect(a.texts()).toEqual(['Start', 'first second', 'third']))
          var late = await openEditor(reviewerCookie, audit, findings.A)
          expect(late.texts()).toEqual(['Start', 'first second', 'third'])
          await a.save()
          expect(await savedDescription(audit, findings.A)).toBe('<p>Start</p><p>first second</p><p>third</p>')
          sender.ws.close()
          await a.disconnect()
          await late.disconnect()
        })

        it('Changes made while another client is still synchronizing', async () => {
          var { audit, findings } = await createFindings({ A: '<p>Saved in the database</p>' })
          var a = await openEditor(editorCookie, audit, findings.A)
          var b = editorOf(adminCookie, audit, findings.A, { receiveDelay: 300, sendDelay: 100 })
          for (var i = 0; i < 50; i++) {
            a.fragment.insert(a.fragment.length, [paragraph(`during ${i}`)])
            await helpers.sleep(5)
          }
          await b.loaded
          await converged([a, b], () => expect(b.texts()).toHaveLength(51))
          expect(b.texts().filter(t => t === 'Saved in the database')).toHaveLength(1) // Not written again by b
          await b.save()
          expect(await savedDescription(audit, findings.A)).toBe(htmlOf(a.fragment))
          await a.disconnect()
          await b.disconnect()
        })

        it('Changes made offline and sent after several reconnections', async () => {
          var { audit, findings } = await createFindings({ A: '<p>Saved in the database</p>' })
          var a = await openEditor(editorCookie, audit, findings.A)
          var b = await openEditor(adminCookie, audit, findings.A)
          for (var cycle = 0; cycle < 5; cycle++) {
            await b.disconnect()
            a.fragment.insert(a.fragment.length, [paragraph(`a online ${cycle}`)])
            b.fragment.insert(b.fragment.length, [paragraph(`b offline ${cycle}`)])
            var reconnected = client(adminCookie, audit, b.ydoc, { receiveDelay: cycle * 20 }) // Same document, like the provider
            await reconnected.ready
            reconnected.fragment = b.fragment
            reconnected.texts = b.texts
            reconnected.save = b.save
            b = reconnected
          }
          await converged([a, b], () => expect(a.texts()).toHaveLength(11))
          var texts = a.texts()
          for (var cycle = 0; cycle < 5; cycle++) {
            expect(texts.filter(t => t === `a online ${cycle}`)).toHaveLength(1)
            expect(texts.filter(t => t === `b offline ${cycle}`)).toHaveLength(1)
          }
          await b.save()
          expect(await savedDescription(audit, findings.A)).toBe(htmlOf(a.fragment))
          await a.disconnect()
          await b.disconnect()
        })
      })

      describe('Content not loaded: database content never overwritten', () => {
        it('Client sending an empty document without finishing its synchronization: content kept', async () => {
          var { audit, findings } = await createFindings({ A: '<p>Saved in the database</p>' })
          var editor = await openEditor(editorCookie, audit, findings.A)
          // Neither sync step 1 sent nor sync step 2 of the server handled: empty document, then a new document with an empty
          // paragraph in the field (editor rendered before any content)
          var unsynced = connect(adminCookie, audit)
          expect((await unsynced.auth).scope).toBe('read-write')
          sendUpdate(unsynced, audit, Y.encodeStateAsUpdate(new Y.Doc()))
          var fresh = new Y.Doc()
          fresh.getXmlFragment(`${audit}-${findings.A}-description`).insert(0, [new Y.XmlElement('paragraph')])
          sendUpdate(unsynced, audit, Y.encodeStateAsUpdate(fresh))
          await helpers.eventually(() => expect(unsynced.statuses).toEqual([true, true]))
          await helpers.eventually(() => expect(editor.fragment.length).toBe(2))
          // An empty paragraph added, the content is neither replaced nor removed
          expect(editor.texts().filter(t => t !== '')).toEqual(['Saved in the database'])
          await editor.save()
          expect(await savedDescription(audit, findings.A)).toMatch(/^(<p><\/p>)?<p>Saved in the database<\/p>(<p><\/p>)?$/)
          unsynced.ws.close()
          await editor.disconnect()
        })

        it('Initial content of the API written only when the shared field is still empty once synchronized (slow client)', async () => {
          var { audit, findings } = await createFindings({ A: '<p>Saved in the database</p>' })
          var first = await openEditor(editorCookie, audit, findings.A)
          first.fragment.insert(1, [paragraph('Not saved yet')])
          // Slow client: the content of the server arrives late, the initial content of the API is not written over it
          var slow = await openEditor(adminCookie, audit, findings.A, { receiveDelay: 400, sendDelay: 200 })
          await converged([first, slow])
          expect(slow.texts()).toEqual(['Saved in the database', 'Not saved yet'])
          expect(writeInitialContent(slow, slow.html)).toBe(false)
          await slow.save()
          expect(await savedDescription(audit, findings.A)).toBe('<p>Saved in the database</p><p>Not saved yet</p>')
          await first.disconnect()
          await slow.disconnect()
        })

        it('Disconnection in the middle of the synchronization: content kept', async () => {
          var { audit, findings } = await createFindings({ A: '<p>Saved in the database</p>' })
          var editor = await openEditor(editorCookie, audit, findings.A)
          // Sync step 1 sent, websocket closed at once
          var first = connect(adminCookie, audit, new Y.Doc())
          await first.auth
          requestDocument(first, audit, new Y.Doc())
          first.ws.close()
          // Sync step 2 of the server received, sync step 1 of the server not answered
          var second = connect(adminCookie, audit)
          await second.auth
          requestDocument(second, audit, new Y.Doc())
          await helpers.eventually(() => expect(second.received).toBeGreaterThanOrEqual(3))
          second.ws.close()
          // Slow client closed while its synchronization is in progress, with a change of its new document
          var third = client(adminCookie, audit, new Y.Doc(), { receiveDelay: 200 })
          await third.auth
          third.ydoc.getXmlFragment(`${audit}-${findings.A}-description`).insert(0, [paragraph('Pending')])
          await helpers.sleep(50)
          third.ws.close()
          await helpers.sleep(300)
          expect(editor.texts().filter(t => t !== 'Pending')).toEqual(['Saved in the database'])
          await editor.save()
          expect(await savedDescription(audit, findings.A)).toMatch(/^(<p>Pending<\/p>)?<p>Saved in the database<\/p>(<p>Pending<\/p>)?$/)
          await editor.disconnect()
          // Document reloaded later: content of the database written once
          await unloaded(audit)
          var next = await openEditor(editorCookie, audit, findings.A)
          expect(next.texts()).toEqual(paragraphTexts(editor.fragment))
          await next.disconnect()
        })

        it('Database unavailable or slow when a document is opened: refused or delayed, content kept', async () => {
          var { audit, findings } = await createFindings({ A: '<p>Saved in the database</p>' })
          var editor = await openEditor(editorCookie, audit, findings.A)
          var Audit = require('mongoose').model('Audit')
          var getUserAccess = Audit.getUserAccess
          var slow = async (...args) => { await helpers.sleep(1000); return getUserAccess.apply(Audit, args) }
          var change = (text) => {
            var doc = new Y.Doc()
            Y.applyUpdate(doc, Y.encodeStateAsUpdate(editor.ydoc))
            var updates = []
            doc.on('update', update => updates.push(update))
            doc.getXmlFragment(`${audit}-${findings.A}-description`).insert(1, [paragraph(text)])
            return updates[0]
          }
          var spy = jest.spyOn(Audit, 'getUserAccess')
          try {
            // Database error during the access check: connection refused, its change (sent before the answer) not applied
            spy.mockImplementationOnce(() => Promise.reject(new Error('Database unavailable')))
            var failed = connect(adminCookie, audit)
            await failed.opened
            sendUpdate(failed, audit, change('sent before a failed access check'))
            expect((await failed.auth).result).toBe('denied')
            // Slow database: changes sent before the end of the access check are applied with the scope of the user
            spy.mockImplementationOnce(slow).mockImplementationOnce(slow)
            var writer = connect(adminCookie, audit)
            var reviewer = connect(reviewerCookie, audit)
            await writer.opened
            await reviewer.opened
            sendUpdate(writer, audit, change('sent by an editor before the access check'))
            sendUpdate(reviewer, audit, change('sent by a reviewer before the access check'))
            expect((await writer.auth).scope).toBe('read-write')
            expect((await reviewer.auth).scope).toBe('readonly')
            await helpers.eventually(() => expect(reviewer.statuses).toContain(false))
            await helpers.eventually(() => expect(editor.texts()).toContain('sent by an editor before the access check'))
          }
          finally {
            spy.mockRestore()
          }
          await helpers.sleep(200)
          expect(editor.texts()).toEqual(['Saved in the database', 'sent by an editor before the access check'])
          await editor.save()
          expect(await savedDescription(audit, findings.A)).toBe('<p>Saved in the database</p><p>sent by an editor before the access check</p>')
          for (var connection of [failed, writer, reviewer]) connection.ws.close()
          await editor.disconnect()
          // Unknown audit: nothing loaded
          expect((await connect(adminCookie, '5f1c0c3c2a6b2c00ffffffff').auth).result).toBe('denied')
          expect(hocuspocus.documents.has('5f1c0c3c2a6b2c00ffffffff')).toBe(false)
        })

        it('The collaboration server never writes the database: shared field emptied, last editor gone', async () => {
          var { audit, findings } = await createFindings({ A: '<p>Saved in the database</p>' })
          var editor = await openEditor(editorCookie, audit, findings.A)
          editor.fragment.delete(0, editor.fragment.length) // Emptied in the shared document, not saved
          await helpers.eventually(() => expect(editor.statuses.length).toBeGreaterThan(2))
          await editor.disconnect()
          await unloaded(audit)
          await helpers.sleep(2500) // Debounce of the storage of the server
          expect(await savedDescription(audit, findings.A)).toBe('<p>Saved in the database</p>')
          // Opened again: empty document, initial content of the database
          var next = await openEditor(editorCookie, audit, findings.A)
          expect(next.texts()).toEqual(['Saved in the database'])
          await next.disconnect()
        })

        it('Field empty in the database: two editors opening it at the same time and typing', async () => {
          var { audit, findings } = await createFindings({ A: '' })
          var [a, b] = await Promise.all([openEditor(editorCookie, audit, findings.A), openEditor(adminCookie, audit, findings.A)])
          expect(a.texts()).toEqual([])
          expect(b.texts()).toEqual([])
          a.fragment.insert(0, [paragraph('Typed by A')])
          b.fragment.insert(0, [paragraph('Typed by B')])
          await converged([a, b], () => expect([...a.texts()].sort()).toEqual(['Typed by A', 'Typed by B']))
          await a.save()
          expect(await savedDescription(audit, findings.A)).toBe(htmlOf(b.fragment))
          await a.disconnect()
          await b.disconnect()
        })

        it('Second editor opening the finding after the initial content of the first one reached the server: written once', async () => {
          var { audit, findings } = await createFindings({ A: '<p>One</p><p>Two</p>' })
          var a = await openEditor(editorCookie, audit, findings.A)
          await helpers.eventually(() => expect(a.statuses.length).toBeGreaterThan(1)) // Initial content received by the server
          var b = await openEditor(adminCookie, audit, findings.A)
          expect(b.texts()).toEqual(['One', 'Two'])
          await converged([a, b])
          expect(a.texts()).toEqual(['One', 'Two'])
          await a.disconnect()
          await b.disconnect()
        })

        // Both editors find the field empty: the deterministic initial content gives the same Yjs items, kept once
        it('Two editors opening at the same time a finding whose document is not loaded: initial content written once', async () => {
          var { audit, findings } = await createFindings({ A: '<p>One</p><p>Two</p>' })
          var [a, b] = await Promise.all([
            openEditor(editorCookie, audit, findings.A, { initialContent: false }),
            openEditor(adminCookie, audit, findings.A, { initialContent: false })
          ])
          // Both synchronized with the empty document: both write the initial content of the API
          var clientIds = [a.ydoc.clientID, b.ydoc.clientID]
          expect(writeInitialContent(a, a.html)).toBe(true)
          expect(writeInitialContent(b, b.html)).toBe(true)
          expect([a.ydoc.clientID, b.ydoc.clientID]).toEqual(clientIds) // Client ids of the documents kept
          await converged([a, b])
          expect(a.texts()).toEqual(['One', 'Two'])
          await a.save()
          expect(await savedDescription(audit, findings.A)).toBe('<p>One</p><p>Two</p>')
          await a.disconnect()
          await b.disconnect()
        })

        // Ids of the initial contents (app.js): an editor coming back after the document was unloaded and initialized again
        // is accepted when its field was initialized from the same value of the database (same Yjs items: merged without
        // duplicate, offline changes kept), refused ('stale-document') when it was initialized from another value: the
        // editor then starts again from the shared document with a new copy
        var sharedInit = (audit, field) => hocuspocus.documents.get(audit).getMap('pwndoc').get(`init:${field}`)
        var reloadedEditor = async (audit, findingId, staleEditor) => {
          var stale = client(editorCookie, audit, staleEditor.ydoc)
          expect(await stale.ready).toEqual({ result: 'denied', reason: 'stale-document' })
          return openEditor(editorCookie, audit, findingId, { html: staleEditor.html }) // Value of its page
        }

        it('Editor reconnecting after the document was unloaded and initialized again by another editor: content not duplicated, offline changes kept', async () => {
          var { audit, findings } = await createFindings({ A: '<p>Saved in the database</p>' })
          var a = await openEditor(editorCookie, audit, findings.A)
          await helpers.eventually(() => expect(a.statuses.length).toBeGreaterThan(1))
          await a.disconnect() // Connection lost: the document of the provider is kept
          a.fragment.insert(1, [paragraph('Typed offline')])
          await unloaded(audit)
          var b = await openEditor(adminCookie, audit, findings.A)
          expect(b.texts()).toEqual(['Saved in the database'])
          await helpers.eventually(() => expect(sharedInit(audit, a.field)).toBe(a.ydoc.getMap('pwndoc').get(`init:${a.field}`))) // Same value: same id
          var reconnected = client(editorCookie, audit, a.ydoc)
          expect((await reconnected.ready).scope).toBe('read-write')
          await converged([a, b])
          expect(b.texts()).toEqual(['Saved in the database', 'Typed offline'])
          await b.save()
          expect(await savedDescription(audit, findings.A)).toBe('<p>Saved in the database</p><p>Typed offline</p>')
          await b.disconnect()
          await reconnected.disconnect()
        })

        it('Editor reconnecting with a copy initialized from an older value of the database: refused, content not duplicated', async () => {
          var { audit, findings } = await createFindings({ A: '<p>Version 1</p>' })
          var a = await openEditor(editorCookie, audit, findings.A)
          await helpers.eventually(() => expect(a.statuses.length).toBeGreaterThan(1))
          await a.disconnect()
          await unloaded(audit)
          expect((await request(app).put(findingPath(audit, findings.A)).set('Cookie', adminCookie).send({ description: '<p>Version 2</p>' })).status).toBe(200)
          var b = await openEditor(adminCookie, audit, findings.A)
          expect(b.texts()).toEqual(['Version 2'])
          await helpers.eventually(() => expect(sharedInit(audit, b.field)).toBe(b.ydoc.getMap('pwndoc').get(`init:${b.field}`)))
          expect(sharedInit(audit, b.field)).not.toBe(a.ydoc.getMap('pwndoc').get(`init:${a.field}`))
          // Page of the editor still showing Version 1: the shared field is not empty, its content is kept
          var again = await reloadedEditor(audit, findings.A, a)
          await converged([again, b])
          expect(b.texts()).toEqual(['Version 2'])
          expect(again.texts()).toEqual(['Version 2'])
          await b.disconnect()
          await again.disconnect()
        })

        it('Field not initialized in the loaded document: copy of the editor coming back accepted', async () => {
          var { audit, findings } = await createFindings({ A: '<p>Content A</p>', B: '<p>Content B</p>' })
          var a = await openEditor(editorCookie, audit, findings.A)
          await helpers.eventually(() => expect(a.statuses.length).toBeGreaterThan(1))
          await a.disconnect()
          a.fragment.insert(1, [paragraph('Typed offline in A')])
          await unloaded(audit)
          // Another editor opens finding B: document loaded again, field of A not initialized
          var b = await openEditor(adminCookie, audit, findings.B)
          await helpers.eventually(() => expect(sharedInit(audit, b.field)).toBeDefined())
          var reconnected = client(editorCookie, audit, a.ydoc)
          expect((await reconnected.ready).scope).toBe('read-write')
          var readerOfA = await openEditor(reviewerCookie, audit, findings.A)
          expect(readerOfA.texts()).toEqual(['Content A', 'Typed offline in A'])
          expect(b.texts()).toEqual(['Content B'])
          await b.disconnect()
          await readerOfA.disconnect()
          await reconnected.disconnect()
        })

        it('Document not loaded: the copy of an editor coming back seeds it (user alone after a network drop)', async () => {
          var { audit, findings } = await createFindings({ A: '<p>Saved in the database</p>' })
          var a = await openEditor(editorCookie, audit, findings.A)
          a.fragment.insert(1, [paragraph('Typed before the network drop')])
          await helpers.eventually(() => expect(a.statuses.length).toBeGreaterThan(2))
          await a.disconnect()
          await unloaded(audit)
          var back = client(editorCookie, audit, a.ydoc)
          expect((await back.ready).scope).toBe('read-write')
          var other = await openEditor(adminCookie, audit, findings.A)
          expect(other.texts()).toEqual(['Saved in the database', 'Typed before the network drop'])
          expect(other.ydoc.getMap('pwndoc').get(`init:${other.field}`)).toBe(a.ydoc.getMap('pwndoc').get(`init:${a.field}`))
          await back.disconnect()
          await other.disconnect()
        })

        it('Initial contents of the token: refused only for a field initialized with another id, after the access check', async () => {
          var { audit, findings } = await createFindings({ A: '<p>Saved in the database</p>' })
          var editor = await openEditor(editorCookie, audit, findings.A)
          await helpers.eventually(() => expect(sharedInit(audit, editor.field)).toBeDefined())
          var current = sharedInit(audit, editor.field)
          var authenticate = async (token, cookie = adminCookie) => {
            var connection = connect(cookie, audit, null, { token: token })
            var result = await connection.auth
            connection.ws.close()
            return result.result === 'authenticated' ? result.scope : result.reason
          }
          var init = (entries) => JSON.stringify({ init: entries })
          // Legacy and malformed tokens: no entries
          for (var token of ['cookie', 'not json', 'null', '{}', '{"init":null}', '{"init":[1]}', init({ [editor.field]: 'text id' })])
            expect([token, await authenticate(token)]).toEqual([token, 'read-write'])
          expect(await authenticate(init({ [editor.field]: current }))).toBe('read-write') // Same initial content
          expect(await authenticate(init({ [`${audit}-other-description`]: 1234 }))).toBe('read-write') // Field not initialized
          expect(await authenticate(init({ [editor.field]: current + 1 }))).toBe('stale-document')
          expect(await authenticate(init({ [`${audit}-other-description`]: 1234, [editor.field]: current + 1 }))).toBe('stale-document')
          expect(await authenticate(init({ [editor.field]: current + 1 }), reviewerCookie)).toBe('stale-document')
          // Access checked first: no information on the document for the users without access
          expect(await authenticate(init({ [editor.field]: current + 1 }), outsiderCookie)).toBe('permission-denied')
          await editor.disconnect()
          // Document unloaded: any copy accepted (it seeds the document)
          await unloaded(audit)
          expect(await authenticate(init({ [editor.field]: current + 1 }))).toBe('read-write')
        })

        it('Editor reconnecting while the document is still loaded: content not duplicated', async () => {
          var { audit, findings } = await createFindings({ A: '<p>Saved in the database</p>' })
          var a = await openEditor(editorCookie, audit, findings.A)
          var b = await openEditor(adminCookie, audit, findings.A)
          await a.disconnect()
          a.fragment.insert(1, [paragraph('Offline')])
          var reconnected = client(editorCookie, audit, a.ydoc)
          await reconnected.ready
          await helpers.eventually(() => expect(b.texts()).toEqual(['Saved in the database', 'Offline']))
          expect(htmlOf(a.fragment)).toBe(htmlOf(b.fragment))
          await b.disconnect()
          await reconnected.disconnect()
        })
      })

      describe('Rapid switching between findings', () => {
        it('Findings A, B then C opened within a few milliseconds, change in C, back to A: each content in its finding', async () => {
          var { audit, findings } = await createFindings({ A: '<p>Content A</p>', B: '<p>Content B</p>', C: '<p>Content C</p>' })
          var expectedC = ['Content C']
          for (var withColleague of [false, true]) {
            // Colleague on finding B: the document stays loaded
            var colleague = withColleague ? await openEditor(adminCookie, audit, findings.B) : null
            var a = editorOf(editorCookie, audit, findings.A)
            await helpers.sleep(2)
            var b = editorOf(editorCookie, audit, findings.B)
            var leaveA = a.disconnect() // Editor destroyed by the route change, before or during its synchronization
            await helpers.sleep(2)
            var c = editorOf(editorCookie, audit, findings.C)
            var leaveB = b.disconnect()
            await c.loaded
            expect(c.texts()).toEqual(expectedC)
            c.fragment.insert(c.fragment.length, [paragraph(`Written in C ${withColleague}`)])
            expectedC.push(`Written in C ${withColleague}`)
            await c.save()
            await c.disconnect()
            var backToA = await openEditor(editorCookie, audit, findings.A)
            expect(backToA.texts()).toEqual(['Content A'])
            await backToA.save()
            await Promise.all([leaveA, leaveB, a.loaded, b.loaded])

            expect(await savedDescription(audit, findings.A)).toBe('<p>Content A</p>')
            expect(await savedDescription(audit, findings.B)).toBe('<p>Content B</p>')
            expect(await savedDescription(audit, findings.C)).toBe(expectedC.map(t => `<p>${t}</p>`).join(''))
            if (colleague) {
              // Each change in the field of its finding only
              var fields = (name) => paragraphTexts(colleague.ydoc.getXmlFragment(`${audit}-${findings[name]}-description`))
              await helpers.eventually(() => expect(fields('C')).toEqual(expectedC))
              expect(fields('A')).toEqual(['Content A'])
              expect(fields('B')).toEqual(['Content B'])
              await colleague.disconnect()
            }
            await backToA.disconnect()
            await unloaded(audit)
          }
        })

        it('Websocket shared by several documents: opened and closed in a burst, each change applied to its document', async () => {
          // Documents of three audits on one websocket (HocuspocusProviderWebsocket shared by providers; the editors of
          // pwndoc use one websocket per editor)
          var targets = []
          for (var name of ['X', 'Y', 'Z']) targets.push(await createFindings({ [name]: `<p>Content ${name}</p>` }))
          var [X, Yt, Z] = targets
          var socket = multiplexed(editorCookie)
          await socket.opened
          var x = socket.open(X.audit)
          var y = socket.open(Yt.audit)
          var z = socket.open(Z.audit)
          socket.close(X.audit)
          socket.close(Yt.audit)
          expect(await z.ready).toBe('read-write')
          z.ydoc.getXmlFragment(`${Z.audit}-${Z.findings.Z}-description`).insert(0, [paragraph('Written in Z')])
          var x2 = socket.open(X.audit) // Back to X
          expect(await x2.ready).toBe('read-write')
          x2.ydoc.getXmlFragment(`${X.audit}-${X.findings.X}-description`).insert(0, [paragraph('Written in X')])
          await helpers.eventually(() => {
            expect(z.statuses.filter(s => s)).toHaveLength(2)
            expect(x2.statuses.filter(s => s)).toHaveLength(2)
          })
          await Promise.all([x.ready, y.ready])

          // Documents read by other clients
          var read = async (target) => {
            var reader = client(adminCookie, target.audit)
            await reader.ready
            var ydoc = reader.ydoc
            await reader.disconnect()
            return ydoc
          }
          var docX = await read(X)
          var docY = await read(Yt)
          var docZ = await read(Z)
          expect(paragraphTexts(docX.getXmlFragment(`${X.audit}-${X.findings.X}-description`))).toEqual(['Written in X'])
          expect(paragraphTexts(docZ.getXmlFragment(`${Z.audit}-${Z.findings.Z}-description`))).toEqual(['Written in Z'])
          expect(contains(docX, 'Written in Z')).toBe(false)
          expect(contains(docZ, 'Written in X')).toBe(false)
          expect(contains(docY, 'Written in')).toBe(false)
          socket.disconnect()
          for (var target of targets) await unloaded(target.audit)
          for (var target of targets)
            expect(await savedDescription(target.audit, Object.values(target.findings)[0])).toBe(`<p>Content ${Object.keys(target.findings)[0]}</p>`)
        })

        it('Connection closed right after sending a change: change received by the others, then saved', async () => {
          var { audit, findings } = await createFindings({ A: '<p>Saved in the database</p>' })
          var colleague = await openEditor(adminCookie, audit, findings.A)
          var writer = await openEditor(editorCookie, audit, findings.A)
          writer.fragment.insert(1, [paragraph('Sent just before closing')])
          writer.ws.close()
          await helpers.eventually(() => expect(colleague.texts()).toEqual(['Saved in the database', 'Sent just before closing']))
          await colleague.save()
          expect(await savedDescription(audit, findings.A)).toBe('<p>Saved in the database</p><p>Sent just before closing</p>')
          await colleague.disconnect()
          // Alone: change sent and saved through the API, websocket closed at once, finding reopened at once
          var alone = await openEditor(editorCookie, audit, findings.A)
          alone.fragment.insert(2, [paragraph('Saved then closed')])
          await alone.save()
          alone.disconnect()
          var reopened = await openEditor(editorCookie, audit, findings.A)
          expect(reopened.texts()).toEqual(['Saved in the database', 'Sent just before closing', 'Saved then closed'])
          await reopened.disconnect()
        })

        it('Document reopened immediately after closing: latest content, never an older version, never duplicated', async () => {
          var { audit, findings } = await createFindings({ A: '<p>Version 0</p>' })
          var expected = ['Version 0']
          for (var cycle = 1; cycle <= 10; cycle++) {
            var editor = await openEditor(editorCookie, audit, findings.A)
            expect([cycle, editor.texts()]).toEqual([cycle, expected])
            editor.fragment.insert(editor.fragment.length, [paragraph(`Version ${cycle}`)])
            expected.push(`Version ${cycle}`)
            await editor.save()
            editor.disconnect() // Not waited: reopened at once
          }
          var last = await openEditor(adminCookie, audit, findings.A)
          expect(last.texts()).toEqual(expected)
          expect(await savedDescription(audit, findings.A)).toBe(expected.map(t => `<p>${t}</p>`).join(''))
          await last.disconnect()
        })

        it('20 connections opened and closed quickly: server stable, no document left loaded', async () => {
          var { audit, findings } = await createFindings({ A: '<p>Stable</p>' })
          var loaded = hocuspocus.documents.size
          var pending = []
          for (var i = 0; i < 20; i++) {
            var editor = editorOf(i % 2 ? editorCookie : adminCookie, audit, findings.A)
            if (i % 4 === 0) editor.ws.close() // Before the websocket is open
            else if (i % 4 === 1) editor.auth.then(() => editor.ws.close()) // Authenticated, not synchronized
            else if (i % 4 === 2) editor.loaded.then(() => { editor.fragment.insert(0, [paragraph('Not saved')]); editor.ws.close() })
            pending.push(editor)
            await helpers.sleep(i % 3)
          }
          await Promise.all(pending.map(editor => editor.loaded.catch(() => {})))
          for (var editor of pending) await editor.disconnect()
          await unloaded(audit)
          expect(hocuspocus.documents.size).toBe(loaded)
          expect(hocuspocus.loadingDocuments.size).toBe(0)
          expect(hocuspocus.unloadingDocuments.size).toBe(0)
          // Still working: document loaded again with the content of the database
          var next = await openEditor(editorCookie, audit, findings.A)
          expect(next.texts()).toEqual(['Stable'])
          expect(await savedDescription(audit, findings.A)).toBe('<p>Stable</p>')
          await next.disconnect()
          await unloaded(audit)
        })
      })
    })

    describe('Backup restore', () => {
      it('Restore closes the editing sessions: clients reconnect on a document reloaded from the restored data', async () => {
        var field = `${auditId}-restore-description`
        var a = client(editorCookie, auditId)
        var b = client(reviewerCookie, auditId)
        await a.ready
        await b.ready
        a.ydoc.getText(field).insert(0, 'before the restore')
        await helpers.eventually(() => expect(text(b, field)).toBe('before the restore'))

        // Restore of a backup of the languages only (merge: the data is not changed)
        var response = await request(app).post('/api/backups').set('Cookie', adminCookie).send({ name: 'collab restore', categories: ['languages'] })
        expect(response.status).toBe(201)
        var backupId = response.body.datas.id
        try {
          response = await request(app).post(`/api/backups/${backupId}/restore`).set('Cookie', adminCookie).send({ mode: 'merge' })
          expect(response.status).toBe(200)
          await helpers.eventually(() => {
            expect(a.closeReasons).toEqual(['Reset Connection'])
            expect(b.closeReasons).toEqual(['Reset Connection'])
          })
          // Session closed: changes not received anymore
          a.ydoc.getText(field).insert(0, 'after the reset ')
          await helpers.sleep(300)
          expect(text(b, field)).toBe('before the restore')

          // New session: document reloaded (the editors load the restored data of the API in the empty document)
          var c = client(editorCookie, auditId)
          expect((await c.ready).scope).toBe('read-write')
          expect(text(c, field)).toBe('')
          await c.disconnect()
        }
        finally {
          expect((await request(app).delete(`/api/backups/${backupId}`).set('Cookie', adminCookie)).status).toBe(200)
          await a.disconnect()
          await b.disconnect()
        }
      })
    })
  })
}
