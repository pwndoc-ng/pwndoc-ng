/*
  Helpers shared by the API test suites (not a test suite itself)
*/

module.exports = function(request, app) {
  var helpers = {}

  // Cookie header of an access token
  helpers.cookie = (token) => [`token=JWT ${token}`]

  // Login and return the cookie of the access token
  helpers.login = async (username, password) => {
    var response = await request(app).post('/api/users/token').send({username: username, password: password})
    if (response.status !== 200)
      throw new Error(`Login of ${username} failed: ${response.status} ${JSON.stringify(response.body)}`)
    return helpers.cookie(response.body.datas.token)
  }

  // Payload of a JWT (not verified)
  helpers.jwtPayload = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())

  // Identifier of a user
  helpers.userId = async (cookie, username) => {
    var response = await request(app).get(`/api/users/${username}`).set('Cookie', cookie)
    return response.body.datas._id
  }

  // supertest: binary response body as a Buffer
  helpers.binary = (res, callback) => {
    var chunks = []
    res.on('data', chunk => chunks.push(Buffer.from(chunk)))
    res.on('end', () => callback(null, Buffer.concat(chunks)))
  }

  // Retries an assertion function until it passes (for writes not awaited by the API before answering)
  helpers.eventually = async (fn, timeout = 3000, interval = 100) => {
    var start = Date.now()
    while (true) {
      try {
        return await fn()
      }
      catch (err) {
        if (Date.now() - start > timeout)
          throw err
        await new Promise(resolve => setTimeout(resolve, interval))
      }
    }
  }

  helpers.sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

  // 1x1 PNG image
  helpers.PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
  helpers.PNG_DATA_URI = `data:image/png;base64,${helpers.PNG_BASE64}`

  helpers.CVSS = {
    critical: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H', // 9.8
    high: 'CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:N', // 8.1
    medium: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N', // 6.1
    low: 'CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:N/A:N' // 3.7
  }

  return helpers
}
