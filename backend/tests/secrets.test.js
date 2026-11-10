/*
  JWT secrets of src/lib/auth.js: environment variables JWT_SECRET and JWT_REFRESH_SECRET first, otherwise config.json of
  the environment (generated and written in config.json when missing). The module is loaded again for each case with its
  own environment and configuration; writes of config.json are intercepted (the file of the sources is never modified).
*/

module.exports = function() {
  var fs = require('fs')
  var path = require('path')

  describe('JWT Secrets Suite Tests', () => {
    var env = process.env.NODE_ENV || 'dev'
    var CONFIG_FILE = path.join(__dirname, '..', 'src', 'config', 'config.json')
    var SECRET = 'environment-secret-0123456789abcdef-0123456789'
    var REFRESH_SECRET = 'environment-refresh-secret-0123456789abcdef-01'

    // auth.js loaded with the environment variables (undefined: not set) and the configuration of the environment given
    var load = (variables, configuration) => {
      var saved = {JWT_SECRET: process.env.JWT_SECRET, JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET}
      var write = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {})
      var result = {}
      try {
        Object.entries(variables).forEach(([name, value]) => value === undefined ? delete process.env[name] : process.env[name] = value)
        jest.isolateModules(() => {
          jest.doMock(CONFIG_FILE, () => ({[env]: {...configuration}}))
          try {
            result.auth = require('../src/lib/auth')
          }
          catch (err) {
            result.error = err
          }
        })
        result.writes = write.mock.calls.map(([file, content]) => ({file, content: JSON.parse(content)}))
      }
      finally {
        write.mockRestore()
        Object.entries(saved).forEach(([name, value]) => value === undefined ? delete process.env[name] : process.env[name] = value)
      }
      return result
    }

    it('Environment variables set: used, nothing generated nor written in config.json', () => {
      var result = load({JWT_SECRET: SECRET, JWT_REFRESH_SECRET: REFRESH_SECRET}, {port: 1})
      expect(result.error).toBeUndefined()
      expect([result.auth.jwtSecret, result.auth.jwtRefreshSecret]).toEqual([SECRET, REFRESH_SECRET])
      expect(result.writes).toEqual([])
      // Also over the secrets of config.json
      result = load({JWT_SECRET: SECRET, JWT_REFRESH_SECRET: REFRESH_SECRET}, {jwtSecret: 'config-secret-'.repeat(4), jwtRefreshSecret: 'config-refresh-'.repeat(4)})
      expect([result.auth.jwtSecret, result.auth.jwtRefreshSecret, result.writes]).toEqual([SECRET, REFRESH_SECRET, []])
    })

    it('Environment variables not set: secrets of config.json, generated and written when missing', () => {
      var result = load({JWT_SECRET: undefined, JWT_REFRESH_SECRET: undefined}, {jwtSecret: 'config-secret-'.repeat(4), jwtRefreshSecret: 'config-refresh-'.repeat(4)})
      expect([result.auth.jwtSecret, result.auth.jwtRefreshSecret, result.writes]).toEqual(['config-secret-'.repeat(4), 'config-refresh-'.repeat(4), []])

      result = load({JWT_SECRET: undefined, JWT_REFRESH_SECRET: undefined}, {port: 1})
      expect(result.auth.jwtSecret).toMatch(/^[a-f0-9]{64}$/)
      expect(result.auth.jwtRefreshSecret).toMatch(/^[a-f0-9]{64}$/)
      expect(result.auth.jwtSecret).not.toBe(result.auth.jwtRefreshSecret)
      expect(result.writes).toHaveLength(1)
      expect(result.writes[0].file).toBe(CONFIG_FILE)
      expect(result.writes[0].content[env]).toEqual({port: 1, jwtSecret: result.auth.jwtSecret, jwtRefreshSecret: result.auth.jwtRefreshSecret})
    })

    it('One environment variable set: only the other secret is generated and written', () => {
      var result = load({JWT_SECRET: SECRET, JWT_REFRESH_SECRET: undefined}, {port: 1})
      expect(result.auth.jwtSecret).toBe(SECRET)
      expect(result.writes).toHaveLength(1)
      expect(result.writes[0].content[env]).toEqual({port: 1, jwtRefreshSecret: result.auth.jwtRefreshSecret})
    })

    it('Invalid environment variables stop the start without showing their value', () => {
      for (var [name, value] of [['JWT_SECRET', ''], ['JWT_SECRET', '   '], ['JWT_REFRESH_SECRET', 'short-secret']]) {
        var result = load({JWT_SECRET: SECRET, JWT_REFRESH_SECRET: REFRESH_SECRET, [name]: value}, {port: 1})
        expect([name, value, result.error && result.error.message]).toEqual([name, value, expect.stringContaining(`${name}: 32 characters at least required`)])
        if (value.trim())
          expect(result.error.message).not.toContain(value)
        expect(result.writes).toEqual([])
      }
      var result = load({JWT_SECRET: SECRET, JWT_REFRESH_SECRET: SECRET}, {port: 1})
      expect(result.error.message).toBe('The JWT secret and the JWT refresh secret must be different (JWT_SECRET, JWT_REFRESH_SECRET)')
      expect(result.error.message).not.toContain(SECRET)
    })

    it('Secrets of the running server: those of config.json of the tests (no environment variable)', () => {
      var auth = require('../src/lib/auth')
      var config = JSON.parse(fs.readFileSync(CONFIG_FILE))[env]
      expect([auth.jwtSecret, auth.jwtRefreshSecret]).toEqual([config.jwtSecret, config.jwtRefreshSecret])
    })
  })
}
