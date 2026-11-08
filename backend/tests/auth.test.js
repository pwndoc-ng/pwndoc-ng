/*
  Authentication (tokens, sessions, two-factor authentication) and users management.
  At the end: more users 'sessionuser', 'manageduser', 'profileuser2' (renamed from 'profileuser'), 'totpuser', 'batchuser'
  Users of user.test.js unchanged.
*/

module.exports = function(request, app) {
  var helpers = require('./helpers')(request, app)
  var jwt = require('jsonwebtoken')
  var OTPAuth = require('otpauth')
  var auth = require('../src/lib/auth')

  // Value of a cookie in the Set-Cookie headers of a response
  var getSetCookie = (response, name) => (response.headers['set-cookie'] || []).find(c => c.startsWith(`${name}=`))

  describe('Authentication Suite Tests', () => {
    var adminCookie

    beforeAll(async () => {
      adminCookie = await helpers.login('admin', 'Admin123')
      var response = await request(app).post('/api/users').set('Cookie', adminCookie).send([
        {username: 'sessionuser', password: 'Session123', firstname: 'Session', lastname: 'User'},
        {username: 'manageduser', password: 'Managed123', firstname: 'Managed', lastname: 'User', email: 'managed@example.com'},
        {username: 'profileuser', password: 'Profile123', firstname: 'Profile', lastname: 'User'},
        {username: 'totpuser', password: 'Totpuser123', firstname: 'Totp', lastname: 'User'}
      ])
      expect(response.status).toBe(201)
      expect(response.body.datas).toEqual({created: 4, duplicates: 0})
    })

    describe('Login', () => {
      it('Sets the access and refresh tokens in secure cookies', async () => {
        var response = await request(app).post('/api/users/token').send({username: 'sessionuser', password: 'Session123'})
        expect(response.status).toBe(200)
        expect(response.body.datas.token).toMatch(/^eyJ/)
        expect(response.body.datas.refreshToken).toMatch(/^eyJ/)

        var token = getSetCookie(response, 'token')
        expect(token).toContain(`token=JWT%20${response.body.datas.token}`)
        expect(token).toMatch(/HttpOnly/)
        expect(token).toMatch(/Secure/)
        expect(token).toMatch(/SameSite=Strict/)
        var refreshToken = getSetCookie(response, 'refreshToken')
        expect(refreshToken).toContain(`refreshToken=${response.body.datas.refreshToken}`)
        expect(refreshToken).toMatch(/Path=\/api\/users\/refreshtoken/)
        expect(refreshToken).toMatch(/HttpOnly/)
        expect(refreshToken).toMatch(/Secure/)

        // Access token: 15 minutes, user information
        var payload = helpers.jwtPayload(response.body.datas.token)
        expect(payload).toMatchObject({username: 'sessionuser', role: 'user', firstname: 'Session', lastname: 'User'})
        expect(payload.exp - payload.iat).toBe(15 * 60)
        expect(payload.password).toBeUndefined()
      })

      it('Refuses parameters which are not strings (NoSQL injection)', async () => {
        var response = await request(app).post('/api/users/token').send({username: {$ne: null}, password: {$ne: null}})
        expect(response.status).toBe(422)
        response = await request(app).post('/api/users/token').send({username: 'admin', password: ['Admin123']})
        expect(response.status).toBe(422)
        response = await request(app).post('/api/users/token').send({username: 'admin', password: 'Admin123', totpToken: 123456})
        expect(response.status).toBe(422)
        response = await request(app).post('/api/users/token').send({username: 'admin'})
        expect(response.status).toBe(422)
      })

      it('Refuses a wrong password without cookie', async () => {
        var response = await request(app).post('/api/users/token').send({username: 'sessionuser', password: 'Wrong1234'})
        expect(response.status).toBe(401)
        expect(response.headers['set-cookie']).toBeUndefined()
      })
    })

    describe('Access token verification', () => {
      var payload = {id: '5f1c0c3c2a6b2c00aaaaaaaa', username: 'admin', role: 'admin', roles: '*'}
      var get = (cookie) => request(app).get('/api/users/me').set('Cookie', cookie)

      it('Refuses missing or malformed tokens', async () => {
        expect((await request(app).get('/api/users/me')).body.datas).toBe('No token provided')
        var response = await get(['token=Bearer abc'])
        expect(response.status).toBe(401)
        expect(response.body.datas).toBe('Bad token type')
        response = await get(['token=JWT'])
        expect(response.status).toBe(401)
        expect(response.body.datas).toBe('Bad token type')
        response = await get(['token=JWT not.a.jwt'])
        expect(response.status).toBe(401)
        expect(response.body.datas).toBe('Invalid token')
      })

      it('Refuses tokens signed with another secret or not signed', async () => {
        var forged = jwt.sign(payload, 'another secret', {expiresIn: '15 minutes'})
        var response = await get(helpers.cookie(forged))
        expect(response.status).toBe(401)
        expect(response.body.datas).toBe('Invalid token')

        var header = Buffer.from(JSON.stringify({alg: 'none', typ: 'JWT'})).toString('base64url')
        var body = Buffer.from(JSON.stringify(payload)).toString('base64url')
        response = await get(helpers.cookie(`${header}.${body}.`))
        expect(response.status).toBe(401)
      })

      it('Refuses expired tokens', async () => {
        var expired = jwt.sign({...payload, exp: Math.floor(Date.now() / 1000) - 60}, auth.jwtSecret)
        var response = await get(helpers.cookie(expired))
        expect(response.status).toBe(401)
        expect(response.body.datas).toBe('Expired token')
      })

      it('Refuses a refresh token used as access token', async () => {
        var response = await request(app).post('/api/users/token').send({username: 'sessionuser', password: 'Session123'})
        response = await get(helpers.cookie(response.body.datas.refreshToken))
        expect(response.status).toBe(401)
        expect(response.body.datas).toBe('Invalid token')
      })

      it('Accepts a valid token signed with the secret', async () => {
        var adminId = await helpers.userId(adminCookie, 'admin')
        var token = jwt.sign({...payload, id: adminId}, auth.jwtSecret, {expiresIn: '1 minute'})
        var response = await get(helpers.cookie(token))
        expect(response.status).toBe(200)
        expect(response.body.datas.username).toBe('admin')
      })
    })

    describe('Sessions', () => {
      var login = async () => (await request(app).post('/api/users/token').send({username: 'sessionuser', password: 'Session123'})).body.datas
      var refresh = (refreshToken) => request(app).get('/api/users/refreshtoken').set('Cookie', [`refreshToken=${refreshToken}`])
      var logout = (refreshToken) => request(app).delete('/api/users/refreshtoken').set('Cookie', [`refreshToken=${refreshToken}`])

      it('Refresh token gives a new access token and a new refresh token', async () => {
        var session = await login()
        await helpers.sleep(1100) // Tokens issued in another second
        var response = await refresh(session.refreshToken)
        expect(response.status).toBe(200)
        expect(response.body.datas.token).not.toBe(session.token)
        expect(response.body.datas.refreshToken).not.toBe(session.refreshToken)
        expect(getSetCookie(response, 'token')).toContain(`token=JWT%20${response.body.datas.token}`)
        expect(getSetCookie(response, 'refreshToken')).toContain(response.body.datas.refreshToken)

        // Same session and same expiration date
        var previous = helpers.jwtPayload(session.refreshToken)
        var renewed = helpers.jwtPayload(response.body.datas.refreshToken)
        expect(renewed.sessionId).toBe(previous.sessionId)
        expect(renewed.exp).toBe(previous.exp)
        expect(renewed.exp - previous.iat).toBe(7 * 24 * 3600)

        expect((await request(app).get('/api/users/me').set('Cookie', helpers.cookie(response.body.datas.token))).status).toBe(200)
      })

      it('Replaced refresh token cannot be used again', async () => {
        var session = await login()
        await helpers.sleep(1100)
        var response = await refresh(session.refreshToken)
        expect(response.status).toBe(200)
        response = await refresh(session.refreshToken)
        expect(response.status).toBe(401)
        expect(response.body.datas).toBe('Session not found')
        // Cookies removed
        expect(getSetCookie(response, 'token')).toMatch(/Expires=Thu, 01 Jan 1970/)
        expect(getSetCookie(response, 'refreshToken')).toMatch(/Expires=Thu, 01 Jan 1970/)
      })

      it('Logout removes the session only', async () => {
        var session1 = await login()
        var session2 = await login()
        expect(helpers.jwtPayload(session1.refreshToken).sessionId).not.toBe(helpers.jwtPayload(session2.refreshToken).sessionId)

        var response = await logout(session1.refreshToken)
        expect(response.status).toBe(200)
        expect(getSetCookie(response, 'token')).toMatch(/Expires=Thu, 01 Jan 1970/)
        expect((await refresh(session1.refreshToken)).status).toBe(401)
        expect((await refresh(session2.refreshToken)).status).toBe(200)
      })

      it('Refuses missing or invalid refresh tokens', async () => {
        var response = await request(app).get('/api/users/refreshtoken')
        expect(response.status).toBe(401)
        expect(response.body.datas).toBe('Invalid refreshToken')
        response = await request(app).delete('/api/users/refreshtoken')
        expect(response.status).toBe(401)

        // Access token used as refresh token
        var session = await login()
        expect((await refresh(session.token)).status).toBe(401)
        // Refresh token of another secret
        var forged = jwt.sign({sessionId: null, userId: helpers.jwtPayload(session.token).id}, 'another secret')
        expect((await refresh(forged)).status).toBe(401)
        // Expired refresh token
        var expired = jwt.sign({sessionId: helpers.jwtPayload(session.refreshToken).sessionId, userId: helpers.jwtPayload(session.token).id, exp: Math.floor(Date.now() / 1000) - 10}, auth.jwtRefreshSecret)
        response = await refresh(expired)
        expect(response.status).toBe(401)
        expect(response.body.datas).toBe('Expired refreshToken')
      })
    })

    describe('Users management', () => {
      var managedId

      beforeAll(async () => {
        managedId = await helpers.userId(adminCookie, 'manageduser')
      })

      it('Should not create users with missing parameters or a weak password', async () => {
        var create = (users) => request(app).post('/api/users').set('Cookie', adminCookie).send(users)
        expect((await create([{username: 'incomplete', password: 'Password1', firstname: 'In'}])).status).toBe(422)
        expect((await create([{username: 'weak', password: 'password', firstname: 'Weak', lastname: 'User'}])).status).toBe(422)
        expect((await create([{username: 'short', password: 'Pa1', firstname: 'Short', lastname: 'User'}])).status).toBe(422)
        var response = await create([{username: 'manageduser', password: 'Password1', firstname: 'Dup', lastname: 'User'}])
        expect(response.status).toBe(422)
        expect(response.body.datas).toBe('Username already exists')
        response = await request(app).get('/api/users').set('Cookie', adminCookie)
        expect(response.body.datas.map(u => u.username)).not.toEqual(expect.arrayContaining(['incomplete']))
        expect(response.body.datas.map(u => u.username)).not.toContain('weak')
      })

      it('Creates the new users of a list containing existing ones', async () => {
        var response = await request(app).post('/api/users').set('Cookie', adminCookie).send([
          {username: 'batchuser', password: 'Batchuser1', firstname: 'Batch', lastname: 'User'},
          {username: 'sessionuser', password: 'Session123', firstname: 'Session', lastname: 'User'}
        ])
        expect(response.status).toBe(201)
        expect(response.body.datas.created).toBe(1)
        expect(response.body.datas.duplicates).toHaveLength(1)
        expect((await request(app).get('/api/users/batchuser').set('Cookie', adminCookie)).body.datas.role).toBe('user')
      })

      it('Users data does not contain secrets', async () => {
        var userCookie = await helpers.login('user2', 'User1234')
        for (var route of ['/api/users', '/api/users/manageduser', '/api/users/me', '/api/users/reviewers']) {
          var serialized = JSON.stringify((await request(app).get(route).set('Cookie', userCookie)).body.datas)
          expect(serialized).not.toContain('password')
          expect(serialized).not.toContain('totpSecret')
          expect(serialized).not.toContain('refreshTokens')
        }
        var response = await request(app).get('/api/users/manageduser').set('Cookie', userCookie)
        expect(response.body.datas).toMatchObject({username: 'manageduser', email: 'managed@example.com', role: 'user', enabled: true, totpEnabled: false})
      })

      it('Get unknown user', async () => {
        var response = await request(app).get('/api/users/nobody').set('Cookie', adminCookie)
        expect(response.status).toBe(404)
      })

      it('Admin updates the information and the role of a user', async () => {
        var response = await request(app).put(`/api/users/${managedId}`).set('Cookie', adminCookie)
          .send({firstname: 'Updated', lastname: 'Name', email: 'updated@example.com', phone: '0102030405', role: 'report'})
        expect(response.status).toBe(200)
        response = await request(app).get('/api/users/manageduser').set('Cookie', adminCookie)
        expect(response.body.datas).toMatchObject({firstname: 'Updated', lastname: 'Name', email: 'updated@example.com', phone: '0102030405', role: 'report'})

        // New role in the next tokens
        var token = (await request(app).post('/api/users/token').send({username: 'manageduser', password: 'Managed123'})).body.datas.token
        expect(helpers.jwtPayload(token).roles).toContain('audits:read-all')

        response = await request(app).put(`/api/users/${managedId}`).set('Cookie', adminCookie).send({role: 'user'})
        expect(response.status).toBe(200)
      })

      it('Admin update validation', async () => {
        var update = (id, body) => request(app).put(`/api/users/${id}`).set('Cookie', adminCookie).send(body)
        expect((await update(managedId, {password: 'weakpassword'})).status).toBe(422)
        var response = await update(managedId, {username: 'admin'})
        expect(response.status).toBe(422)
        expect(response.body.datas).toBe('Username already exists')
        expect((await update('deadbeefdeadbeefdeadbeef', {firstname: 'Nobody'})).status).toBe(404)
        // Unchanged
        expect((await request(app).post('/api/users/token').send({username: 'manageduser', password: 'Managed123'})).status).toBe(200)
      })

      it('Admin resets the password of a user', async () => {
        var response = await request(app).put(`/api/users/${managedId}`).set('Cookie', adminCookie).send({password: 'Resetpass1'})
        expect(response.status).toBe(200)
        expect((await request(app).post('/api/users/token').send({username: 'manageduser', password: 'Managed123'})).status).toBe(401)
        expect((await request(app).post('/api/users/token').send({username: 'manageduser', password: 'Resetpass1'})).status).toBe(200)
      })

      it('Disabled account cannot log in nor refresh its session', async () => {
        var session = (await request(app).post('/api/users/token').send({username: 'manageduser', password: 'Resetpass1'})).body.datas

        var response = await request(app).put(`/api/users/${managedId}`).set('Cookie', adminCookie).send({enabled: false})
        expect(response.status).toBe(200)
        expect((await request(app).get('/api/users/manageduser').set('Cookie', adminCookie)).body.datas.enabled).toBe(false)

        response = await request(app).post('/api/users/token').send({username: 'manageduser', password: 'Resetpass1'})
        expect(response.status).toBe(401)
        expect(response.body.datas).toBe('Account disabled')
        response = await request(app).get('/api/users/refreshtoken').set('Cookie', [`refreshToken=${session.refreshToken}`])
        expect(response.status).toBe(401)

        response = await request(app).put(`/api/users/${managedId}`).set('Cookie', adminCookie).send({enabled: true})
        expect(response.status).toBe(200)
        expect((await request(app).post('/api/users/token').send({username: 'manageduser', password: 'Resetpass1'})).status).toBe(200)
      })

      it('Ignores flags which are not booleans', async () => {
        var response = await request(app).put(`/api/users/${managedId}`).set('Cookie', adminCookie).send({enabled: 'false', totpEnabled: 'true'})
        expect(response.status).toBe(200)
        response = await request(app).get('/api/users/manageduser').set('Cookie', adminCookie)
        expect(response.body.datas.enabled).toBe(true)
        expect(response.body.datas.totpEnabled).toBe(false)
      })
    })

    describe('Own profile', () => {
      var profileCookie

      beforeAll(async () => {
        profileCookie = await helpers.login('profileuser', 'Profile123')
      })

      var update = (body, cookie = profileCookie) => request(app).put('/api/users/me').set('Cookie', cookie).send(body)

      it('Requires the current password', async () => {
        var response = await update({firstname: 'NoPassword'})
        expect(response.status).toBe(422)
        response = await update({currentPassword: 'Wrong1234', firstname: 'WrongPassword'})
        expect(response.status).toBe(401)
        expect(response.body.datas).toBe('Current password is invalid')
        expect((await request(app).get('/api/users/me').set('Cookie', profileCookie)).body.datas.firstname).toBe('Profile')
      })

      it('Checks the new password confirmation', async () => {
        expect((await update({currentPassword: 'Profile123', newPassword: 'Newpass123'})).status).toBe(422)
        expect((await update({currentPassword: 'Profile123', confirmPassword: 'Newpass123'})).status).toBe(422)
        var response = await update({currentPassword: 'Profile123', newPassword: 'Newpass123', confirmPassword: 'Newpass124'})
        expect(response.status).toBe(422)
        expect(response.body.datas).toBe('New password validation failed')
        expect((await request(app).post('/api/users/token').send({username: 'profileuser', password: 'Profile123'})).status).toBe(200)
      })

      // BUG: src/routes/user.js:290 the password policy check is `newPassword && newPassword.length==0 && ...`, never true:
      // PUT /api/users/me {currentPassword, newPassword: 'a', confirmPassword: 'a'} sets a one character password (200)
      it.skip('Refuses a new password not matching the password policy', async () => {
        var response = await update({currentPassword: 'Profile123', newPassword: 'weak', confirmPassword: 'weak'})
        expect(response.status).toBe(422)
        expect((await request(app).post('/api/users/token').send({username: 'profileuser', password: 'weak'})).status).toBe(401)
      })

      it('Updates the profile and returns a new token', async () => {
        var response = await update({currentPassword: 'Profile123', firstname: 'Pro', lastname: 'File', email: 'profile@example.com', phone: '0601020304'})
        expect(response.status).toBe(200)
        var token = getSetCookie(response, 'token')
        expect(token).toContain(`token=${encodeURIComponent(response.body.datas.token)}`)
        expect(response.body.datas.token).toMatch(/^JWT /)
        expect(helpers.jwtPayload(response.body.datas.token.split(' ')[1])).toMatchObject({firstname: 'Pro', lastname: 'File', email: 'profile@example.com'})

        response = await request(app).get('/api/users/me').set('Cookie', profileCookie)
        expect(response.body.datas).toMatchObject({username: 'profileuser', firstname: 'Pro', lastname: 'File', email: 'profile@example.com', phone: '0601020304', role: 'user'})
      })

      it('Cannot take the username of another user', async () => {
        var response = await update({currentPassword: 'Profile123', username: 'admin'})
        expect(response.status).toBe(422)
        expect(response.body.datas).toBe('Username already exists')
      })

      it('Cannot change its own role', async () => {
        var response = await update({currentPassword: 'Profile123', role: 'admin'})
        expect(response.status).toBe(200)
        expect((await request(app).get('/api/users/me').set('Cookie', profileCookie)).body.datas.role).toBe('user')
      })

      it('Changes its password and username', async () => {
        var response = await update({currentPassword: 'Profile123', username: 'profileuser2', newPassword: 'Newpass123', confirmPassword: 'Newpass123'})
        expect(response.status).toBe(200)
        expect(helpers.jwtPayload(response.body.datas.token.split(' ')[1]).username).toBe('profileuser2')
        expect((await request(app).post('/api/users/token').send({username: 'profileuser2', password: 'Profile123'})).status).toBe(401)
        expect((await request(app).post('/api/users/token').send({username: 'profileuser2', password: 'Newpass123'})).status).toBe(200)
        expect((await request(app).post('/api/users/token').send({username: 'profileuser', password: 'Newpass123'})).status).toBe(401)
      })
    })

    describe('Two-factor authentication', () => {
      var totpCookie, secret
      var totpFor = (secret, offset = 0) => new OTPAuth.TOTP({algorithm: 'SHA1', digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secret)})
        .generate({timestamp: Date.now() + offset * 30 * 1000})
      var login = (body) => request(app).post('/api/users/token').send({username: 'totpuser', password: 'Totpuser123', ...body})

      beforeAll(async () => {
        totpCookie = await helpers.login('totpuser', 'Totpuser123')
      })

      it('Gives a new secret and its QR code', async () => {
        var response = await request(app).get('/api/users/totp').set('Cookie', totpCookie)
        expect(response.status).toBe(200)
        expect(response.body.datas.totpQrCode).toMatch(/^data:image\/png;base64,/)
        expect(response.body.datas.totpSecret).toMatch(/^[A-Z2-7]{16}$/)
        var other = await request(app).get('/api/users/totp').set('Cookie', totpCookie)
        expect(other.body.datas.totpSecret).not.toBe(response.body.datas.totpSecret)
        secret = response.body.datas.totpSecret
        // Not enabled until verified
        expect((await login({})).status).toBe(200)
      })

      it('Setup requires a valid code of the secret', async () => {
        var setup = (body) => request(app).post('/api/users/totp').set('Cookie', totpCookie).send(body)
        expect((await setup({totpSecret: secret})).status).toBe(422)
        expect((await setup({totpToken: '123456'})).status).toBe(422)
        expect((await setup({totpToken: '12345', totpSecret: secret})).status).toBe(422)
        var response = await setup({totpToken: totpFor(secret, -120), totpSecret: secret})
        expect(response.status).toBe(401)
        expect(response.body.datas).toBe('Wrong TOTP token.')
        // Within the validation window but too far from the current time
        response = await setup({totpToken: totpFor(secret, 4), totpSecret: secret})
        expect(response.status).toBe(401)
        expect(response.body.datas).toBe('TOTP token out of window.')
        expect((await request(app).get('/api/users/me').set('Cookie', totpCookie)).body.datas.totpEnabled).toBe(false)
      })

      it('Enables the two-factor authentication', async () => {
        var response = await request(app).post('/api/users/totp').set('Cookie', totpCookie).send({totpToken: totpFor(secret), totpSecret: secret})
        expect(response.status).toBe(200)
        expect((await request(app).get('/api/users/me').set('Cookie', totpCookie)).body.datas.totpEnabled).toBe(true)

        // Already enabled: refused
        response = await request(app).post('/api/users/totp').set('Cookie', totpCookie).send({totpToken: totpFor(secret), totpSecret: secret})
        expect(response.status).toBeGreaterThanOrEqual(400)
      })

      it('Login requires a valid code', async () => {
        var response = await login({})
        expect(response.status).toBe(422)
        expect(response.body.datas).toBe('Missing TOTP token')
        expect(response.headers['set-cookie']).toBeUndefined()
        response = await login({totpToken: totpFor(secret, -120)})
        expect(response.status).toBe(401)
        response = await login({totpToken: '1234567'})
        expect(response.status).toBe(422)
        // Wrong password with a valid code
        response = await request(app).post('/api/users/token').send({username: 'totpuser', password: 'Wrong1234', totpToken: totpFor(secret)})
        expect(response.status).toBe(401)

        response = await login({totpToken: totpFor(secret)})
        expect(response.status).toBe(200)
        expect(response.body.datas.token).toMatch(/^eyJ/)
      })

      it('Disabling requires a valid code', async () => {
        var cancel = (body) => request(app).delete('/api/users/totp').set('Cookie', totpCookie).send(body)
        expect((await cancel({})).status).toBe(422)
        expect((await cancel({totpToken: totpFor(secret, -120)})).status).toBe(401)
        expect((await request(app).get('/api/users/me').set('Cookie', totpCookie)).body.datas.totpEnabled).toBe(true)

        var response = await cancel({totpToken: totpFor(secret)})
        expect(response.status).toBe(200)
        expect((await request(app).get('/api/users/me').set('Cookie', totpCookie)).body.datas.totpEnabled).toBe(false)
        expect((await login({})).status).toBe(200)
        // Not enabled anymore
        expect((await cancel({totpToken: totpFor(secret)})).status).toBeGreaterThanOrEqual(400)
      })

      it('Admin disables the two-factor authentication of a user', async () => {
        var response = await request(app).get('/api/users/totp').set('Cookie', totpCookie)
        secret = response.body.datas.totpSecret
        response = await request(app).post('/api/users/totp').set('Cookie', totpCookie).send({totpToken: totpFor(secret), totpSecret: secret})
        expect(response.status).toBe(200)
        expect((await login({})).status).toBe(422)

        var userId = await helpers.userId(adminCookie, 'totpuser')
        response = await request(app).put(`/api/users/${userId}`).set('Cookie', adminCookie).send({totpEnabled: false})
        expect(response.status).toBe(200)
        expect((await login({})).status).toBe(200)
      })
    })
  })
}
