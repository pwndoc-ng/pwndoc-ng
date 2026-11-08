/*
  Unit tests of the libraries: CVSS calculator, password policy, utilities, access control, HTTP responses,
  filters of the report templates.
*/

module.exports = function() {
  var CVSS31 = require('../src/lib/cvsscalc31')
  var passwordpolicy = require('../src/lib/passwordpolicy')
  var utils = require('../src/lib/utils')
  var auth = require('../src/lib/auth')
  var Response = require('../src/lib/httpResponse')
  var reportGenerator = require('../src/lib/report-generator')
  var jwt = require('jsonwebtoken')

  describe('Unit Suite Tests', () => {

    describe('CVSS 3.1 calculator', () => {
      var score = (vector) => {
        var result = CVSS31.calculateCVSSFromVector(vector)
        return [result.baseMetricScore, result.baseSeverity, result.temporalMetricScore, result.environmentalMetricScore, result.environmentalSeverity]
      }

      it('Base score and severity', () => {
        expect(score('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H').slice(0, 2)).toEqual(['10.0', 'Critical'])
        expect(score('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H').slice(0, 2)).toEqual(['9.8', 'Critical'])
        expect(score('CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:N').slice(0, 2)).toEqual(['8.1', 'High'])
        expect(score('CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N').slice(0, 2)).toEqual(['6.1', 'Medium'])
        expect(score('CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:N/A:N').slice(0, 2)).toEqual(['3.7', 'Low'])
        expect(score('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N').slice(0, 2)).toEqual(['0.0', 'None'])
        // CVSS 3.0 vectors are accepted
        expect(score('CVSS:3.0/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H').slice(0, 2)).toEqual(['9.8', 'Critical'])
      })

      it('Temporal and environmental scores', () => {
        expect(score('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H/E:U/RL:O/RC:U')).toEqual(['9.8', 'Critical', '7.8', '7.8', 'High'])
        expect(score('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H/CR:L/IR:L/AR:L/MAV:P')).toEqual(['9.8', 'Critical', '9.8', '5.0', 'Medium'])
      })

      it('Invalid vectors', () => {
        expect(CVSS31.calculateCVSSFromVector('CVSS:3.1/AV:N')).toMatchObject({success: false, errorType: 'MissingBaseMetric'})
        expect(CVSS31.calculateCVSSFromVector('garbage')).toMatchObject({success: false, errorType: 'MalformedVectorString'})
        expect(CVSS31.calculateCVSSFromVector('')).toMatchObject({success: false})
        expect(CVSS31.calculateCVSSFromVector(undefined)).toMatchObject({success: false})
      })

      it('Severity rating and rounding', () => {
        expect([0, 0.1, 3.9, 4, 6.9, 7, 8.9, 9, 10].map(CVSS31.severityRating)).toEqual(['None', 'Low', 'Low', 'Medium', 'Medium', 'High', 'High', 'Critical', 'Critical'])
        expect(CVSS31.roundUp1(4.02)).toBe(4.1)
        expect(CVSS31.roundUp1(4.0)).toBe(4)
      })
    })

    describe('Password policy', () => {
      it('At least 8 characters with a digit, a lowercase and an uppercase letter', () => {
        expect(passwordpolicy.strongPassword('Password1')).toBe(true)
        expect(passwordpolicy.strongPassword('Pa55word')).toBe(true)
        expect(passwordpolicy.strongPassword('password1')).toBe(false)
        expect(passwordpolicy.strongPassword('PASSWORD1')).toBe(false)
        expect(passwordpolicy.strongPassword('Password')).toBe(false)
        expect(passwordpolicy.strongPassword('Pass1')).toBe(false)
        expect(passwordpolicy.strongPassword('')).toBe(false)
      })
    })

    describe('Utilities', () => {
      it('Extension validation', () => {
        expect(utils.validExtension('docx')).toBe(true)
        expect(utils.validExtension('DOTX')).toBe(true)
        expect(utils.validExtension('do cx')).toBe(false)
        expect(utils.validExtension('.docx')).toBe(false)
        expect(utils.validExtension('docx/..')).toBe(false)
        expect(utils.validExtension('')).toBe(false)
      })

      it('Filename validation refuses path and markup characters', () => {
        ['../x', 'a/b', 'a\\b', '<b>', 'a.b', 'a:b', 'a\nb', ''].forEach(name => expect([name, utils.validFilename(name)]).toEqual([name, false]))
        ;["Rapport d'audit (v2) [final]", 'Тест_1', '测试'].forEach(name => expect([name, utils.validFilename(name)]).toEqual([name, true]))
      })

      it('XML entities escaped', () => {
        expect(utils.escapeXMLEntities('<w:t>A & B</w:t>')).toBe('&lt;w:t&gt;A &amp; B&lt;/w:t&gt;')
        expect(utils.escapeXMLEntities('"quotes"')).toBe('"quotes"')
      })

      it('Numbers padded to 3 digits', () => {
        expect(utils.lPad(1)).toBe('001')
        expect(utils.lPad(42)).toBe('042')
        expect(utils.lPad(99)).toBe('099')
        expect(utils.lPad(100)).toBe('100')
        expect(utils.lPad(1234)).toBe('1234')
      })

      it('Regular expression escaped', () => {
        var escaped = utils.escapeRegex('a.b*c(d)[e]+?^$|{f}\\/')
        var regex = new RegExp(escaped)
        expect(regex.test('a.b*c(d)[e]+?^$|{f}\\/')).toBe(true)
        expect(new RegExp(utils.escapeRegex('.*')).test('anything')).toBe(false)
      })

      it('Paths of an object', () => {
        expect(utils.getObjectPaths({a: {b: 1, c: [1, 2], d: {e: null}}, f: 'x', g: null})).toEqual(['a.b', 'a.c', 'a.d.e', 'f', 'g'])
        expect(utils.getObjectPaths({})).toEqual([])
      })

      it('Random identifiers', () => {
        var id = utils.generateUUID()
        expect(id).toMatch(/^[0-9a-f]{64}$/)
        expect(utils.generateUUID()).not.toBe(id)
      })
    })

    describe('Access control', () => {
      var ACL = auth.acl.constructor
      var acl = new ACL({
        user: {allows: ['audits:read', 'audits:create']},
        auditor: {inherits: ['user'], allows: ['audits:read-all']},
        lead: {inherits: ['auditor'], allows: ['audits:review']},
        multi: {inherits: ['auditor', 'manager']},
        manager: {allows: ['users:read']},
        admin: {allows: '*'}
      })

      it('Roles must be an object', () => {
        expect(() => new ACL('admin')).toThrow(TypeError)
      })

      it('Permissions granted by the role and by the inherited roles', () => {
        expect(acl.isAllowed('user', 'audits:read')).toBe(true)
        expect(acl.isAllowed('user', 'audits:read-all')).toBe(false)
        expect(acl.isAllowed('lead', 'audits:review')).toBe(true)
        expect(acl.isAllowed('lead', 'audits:read-all')).toBe(true)
        expect(acl.isAllowed('lead', 'audits:create')).toBe(true)
        expect(acl.isAllowed('lead', 'users:read')).toBe(false)
        expect(acl.isAllowed('multi', 'users:read')).toBe(true)
        expect(acl.isAllowed('multi', 'audits:read-all')).toBe(true)
        expect(acl.isAllowed('admin', 'anything:at-all')).toBe(true)
      })

      it('Unknown roles get the permissions of the user role', () => {
        expect(acl.isAllowed('unknown', 'audits:read')).toBe(true)
        expect(acl.isAllowed('unknown', 'audits:read-all')).toBe(false)
        expect(new ACL({admin: {allows: '*'}}).isAllowed('unknown', 'audits:read')).toBe(false)
      })

      it('Permissions list of a role', () => {
        expect(acl.getRoles('lead').sort()).toEqual(['audits:create', 'audits:read', 'audits:read-all', 'audits:review'])
        expect(acl.getRoles('multi').sort()).toEqual(['audits:create', 'audits:read', 'audits:read-all', 'users:read'])
        expect(acl.getRoles('unknown').sort()).toEqual(['audits:create', 'audits:read'])
        expect(acl.getRoles('admin')).toBe('*')
      })

      it('Built-in roles', () => {
        expect(auth.acl.isAllowed('admin', 'backups:restore')).toBe(true)
        expect(auth.acl.isAllowed('user', 'audits:update')).toBe(true)
        expect(auth.acl.isAllowed('user', 'audits:update-all')).toBe(false)
        expect(auth.acl.isAllowed('user', 'images:delete')).toBe(false)
        expect(auth.acl.isAllowed('report', 'audits:read-all')).toBe(true)
        expect(auth.acl.isAllowed('report', 'audits:update-all')).toBe(false)
      })
    })

    describe('Token of the websocket connections', () => {
      var payload = {id: '5f1c0c3c2a6b2c00aaaaaaaa', username: 'admin', role: 'admin'}
      var token

      beforeAll(() => {
        token = jwt.sign(payload, auth.jwtSecret, {expiresIn: '1 minute'})
      })

      it('Token read from the cookie header', () => {
        expect(auth.decodeTokenFromCookieHeader(`lang=fr; token=JWT%20${token}; other=1`)).toMatchObject(payload)
        expect(auth.decodeTokenFromCookieHeader(`token=JWT ${token}`)).toMatchObject(payload)
      })

      it('Missing, malformed or invalid tokens', () => {
        expect(auth.decodeTokenFromCookieHeader(undefined)).toBeNull()
        expect(auth.decodeTokenFromCookieHeader({token: token})).toBeNull()
        expect(auth.decodeTokenFromCookieHeader('lang=fr')).toBeNull()
        expect(auth.decodeTokenFromCookieHeader(`token=${token}`)).toBeNull()
        expect(auth.decodeTokenFromCookieHeader(`token=Bearer%20${token}`)).toBeNull()
        expect(auth.decodeTokenFromCookieHeader(`mytoken=JWT%20${token}`)).toBeNull()
        expect(auth.decodeTokenFromCookieHeader('token=JWT%20%E0%A4%A')).toBeNull()
        expect(auth.decodeTokenFromCookieHeader(`token=JWT%20${jwt.sign(payload, 'another secret')}`)).toBeNull()
        expect(auth.decodeTokenFromCookieHeader(`token=JWT%20${jwt.sign(payload, auth.jwtRefreshSecret)}`)).toBeNull()
        expect(auth.decodeTokenFromCookieHeader(`token=JWT%20${jwt.sign({...payload, exp: Math.floor(Date.now() / 1000) - 10}, auth.jwtSecret)}`)).toBeNull()
      })
    })

    describe('HTTP responses', () => {
      var fakeResponse = () => {
        var res = {headers: {}}
        res.status = (code) => { res.code = code; return res }
        res.json = (body) => { res.body = body; return res }
        res.send = (body) => { res.body = body; return res }
        res.set = (headers) => { Object.assign(res.headers, headers); return res }
        return res
      }

      it('Errors mapped to their HTTP status', () => {
        var cases = [
          [{fn: 'NotFound', message: 'Audit not found'}, 404, 'Audit not found'],
          [{fn: 'BadParameters', message: 'Bad Audit Id'}, 422, 'Bad Audit Id'],
          [{fn: 'Forbidden', message: 'No'}, 403, 'No'],
          [{fn: 'Unauthorized', message: 'Expired'}, 401, 'Expired'],
          [{fn: 'Unknown', message: 'Message'}, 500, 'Message'],
          [{errmsg: 'E11000 duplicate key'}, 500, 'E11000 duplicate key'],
          [new Error('Unexpected'), 500, 'Unexpected'],
          [{}, 500, 'Internal Error']
        ]
        cases.forEach(([error, code, message]) => {
          var res = fakeResponse()
          Response.Internal(res, error)
          expect([error, res.code, res.body]).toEqual([error, code, {status: 'error', datas: message}])
        })
      })

      it('Success responses', () => {
        var res = fakeResponse()
        Response.Created(res, {_id: 1})
        expect([res.code, res.body]).toEqual([201, {status: 'success', datas: {_id: 1}}])
        res = fakeResponse()
        Response.Ok(res, 'Done')
        expect([res.code, res.body]).toEqual([200, {status: 'success', datas: 'Done'}])
      })

      it('Files sent with an encoded file name', () => {
        var res = fakeResponse()
        Response.SendFile(res, 'Rapport "final".docx', Buffer.from('x'))
        expect(res.code).toBe(200)
        expect(res.headers['Content-Disposition']).toBe('attachment; filename="Rapport%20%22final%22.docx"')
        res = fakeResponse()
        Response.SendImage(res, Buffer.from('abc'))
        expect(res.headers).toEqual({'Content-Type': 'image/png', 'Content-Length': 3})
      })
    })

    describe('Filters of the report templates', () => {
      var evaluate = (tag, scope) => reportGenerator.parser(tag).get(scope, {scopeList: [scope], num: 0})
      var findings = [
        {title: 'XSS', identifier: 'IDX-002', cvss: {baseSeverity: 'Medium', environmentalSeverity: 'Medium', baseMetricScore: '6.1'}},
        {title: 'SQLi', identifier: 'IDX-010', cvss: {baseSeverity: 'Critical', environmentalSeverity: 'High', baseMetricScore: '9.8'}},
        {title: 'XSS', identifier: 'IDX-001', cvss: {baseSeverity: 'Medium', environmentalSeverity: 'Low', baseMetricScore: '5.4'}}
      ]

      it('Text filters', () => {
        expect(evaluate("t | capfirst", {t: 'sql injection'})).toBe('Sql injection')
        expect(evaluate("t | upper", {t: 'xss'})).toBe('XSS')
        expect(evaluate("t | lower", {t: 'XSS'})).toBe('xss')
        expect(evaluate("t | title", {t: 'cross site scripting'})).toBe('Cross Site Scripting')
        expect(evaluate("t | initials", {t: 'Jean Pierre'})).toBe('J. P.')
        expect(evaluate("t | split: ', '", {t: 'a, b, c'})).toEqual(['a', 'b', 'c'])
        expect(evaluate("t | join: ' / '", {t: ['a', 'b']})).toBe('a / b')
        expect(evaluate("t | length", {t: [1, 2, 3]})).toBe(3)
        expect(evaluate("t | changeID: 'PRJ-'", {t: 'IDX-001'})).toBe('PRJ-001')
        expect(evaluate("t | d: 'default'", {t: ''})).toBe('default')
        expect(evaluate("t | d: 'default'", {t: 'value'})).toBe('value')
        expect(evaluate("t | upper", {})).toBeUndefined()
      })

      it('Lines of a text', () => {
        expect(evaluate("t | lines", {t: '<p>first</p><p>second</p>'})).toEqual(['first', 'second'])
        expect(evaluate("t | lines", {t: 'first\nsecond'})).toEqual(['first', 'second'])
      })

      it('Lists filters', () => {
        expect(evaluate("f | uniqFindings", {f: findings}).map(f => f.identifier)).toEqual(['IDX-002', 'IDX-010'])
        expect(evaluate("f | sortArrayByField: 'identifier':1", {f: [...findings]}).map(f => f.identifier)).toEqual(['IDX-001', 'IDX-002', 'IDX-010'])
        expect(evaluate("f | sortArrayByField: 'cvss.baseMetricScore':-1", {f: [...findings]}).map(f => f.title)).toEqual(['SQLi', 'XSS', 'XSS'])
        expect(evaluate("f | sortASC: 'cvss.baseMetricScore'", {f: findings}).map(f => f.cvss.baseMetricScore)).toEqual(['5.4', '6.1', '9.8'])
        expect(evaluate("f | sortDESC: 'cvss.baseMetricScore'", {f: findings}).map(f => f.cvss.baseMetricScore)).toEqual(['9.8', '6.1', '5.4'])
        expect(evaluate("f | where: 'cvss.baseSeverity == \"Medium\"' | select: 'identifier'", {f: findings})).toEqual(['IDX-002', 'IDX-001'])
        expect(evaluate("t | reverse", {t: [1, 2, 3]})).toEqual([3, 2, 1])
        expect(evaluate("o | loopObject", {o: {a: 1, b: 2}})).toEqual([{key: 'a', value: 1}, {key: 'b', value: 2}])
        expect(evaluate("o | toJSON", {o: {a: [1]}})).toBe('{"a":[1]}')
      })

      it('Count of the findings by severity', () => {
        expect(evaluate("f | count: 'Medium'", {f: findings})).toBe(1) // Environmental severity by default
        expect(evaluate("f | count: 'Medium':'base'", {f: findings})).toBe(2)
        expect(evaluate("f | count: 'Critical':'base'", {f: findings})).toBe(1)
        expect(evaluate("f | count: 'High':'environmental'", {f: findings})).toBe(1)
      })

      it('Sort filter with a key sorts the elements', () => {
        var result = evaluate("f | sort: 'v'", {f: [{v: 1}, {v: 3}, {v: 2}, {v: 5}, {v: 4}]}).map(e => e.v)
        expect([[1, 2, 3, 4, 5], [5, 4, 3, 2, 1]]).toContainEqual(result)
      })

      it('Dates', () => {
        expect(evaluate("d | convertDate: 'short'", {d: '2026-03-05'})).toBe('03/05/2026')
        expect(evaluate("d | convertDate: 'full'", {d: '2026-03-05'})).toBe('Thursday, March 05, 2026')
        expect(evaluate("d | convertDate: 'full'", {d: 'not a date'})).toBeUndefined()
        expect(evaluate("d | convertDateLocale: 'en-US':'short'", {d: '2026-03-05'})).toBe('03/05/2026')
        require('../src/translate').setLocale('en')
        expect(evaluate("s | fromTo: e:'en-US'", {s: '2026-03-02', e: '2026-03-18'})).toBe('from 02 to 03/18/2026')
        expect(evaluate("s | fromTo: e:'en-US'", {s: '2026-02-27', e: '2026-03-04'})).toBe('from 02/27 to 03/04/2026')
        expect(evaluate("s | fromTo: e:'en-US'", {s: '2025-12-29', e: '2026-01-09'})).toBe('from 12/29/2025 to 01/09/2026')
        expect(evaluate("s | fromTo: e:'en-US'", {s: '2026-03-04', e: '2026-03-04'})).toBe('on 03/04/2026')
        expect(evaluate("s | fromTo: e:'en-US'", {s: 'unknown', e: '2026-03-04'})).toBe('unknown')
      })

      it('Dates of the same month on the same weekday', () => {
        require('../src/translate').setLocale('en')
        expect(evaluate("s | fromTo: e:'en-US'", {s: '2026-03-04', e: '2026-03-11'})).toBe('from 04 to 03/11/2026')
      })

      it('Raw XML filters escape their text', () => {
        var link = evaluate("t | linkTo: u", {t: 'A & <B>', u: 'https://example.com/?a=1&b="2"'})
        expect(link).toContain('<w:t>A &amp; &lt;B&gt;</w:t>')
        expect(link).toContain('HYPERLINK "https://example.com/?a=1&amp;b=&quot;2&quot;"')
        expect(evaluate("t | mailto", {t: 'contact@example.com'})).toContain('HYPERLINK "mailto:contact@example.com"')
        expect(evaluate("t | NewLines", {t: 'a < b\nline 2\n\nparagraph 2'}))
          .toBe('<w:p><w:r><w:t>a &lt; b<w:br/>line 2</w:t></w:r></w:p><w:p><w:r><w:t>paragraph 2</w:t></w:r></w:p>')
      })

      it('Paragraphs and bookmarks', () => {
        expect(evaluate("t | p", {t: 'Text'})).toBe('<w:p><w:r><w:t>Text</w:t></w:r></w:p>')
        expect(evaluate("t | p: 'My Style'", {t: 'Text'})).toBe('<w:p><w:pPr><w:pStyle w:val="MyStyle"/></w:pPr><w:r><w:t>Text</w:t></w:r></w:p>')
        expect(evaluate("t | p", {t: ''})).toBe('')
        expect(evaluate("t | s", {t: 'Text'})).toBe('<w:r><w:t xml:space="preserve">Text</w:t></w:r>')
        expect(evaluate("t | bookmarkRef", {t: 'VULN-1'})).toContain(' REF VULN_1 \\h ')
        var bookmark = evaluate("t | bookmarkCreate", {t: 'VULN-1 é'})
        expect(bookmark).toMatch(/^<w:bookmarkStart w:id="\d+" w:name="VULN_1__"\/><w:bookmarkEnd w:id="\d+"\/>$/)
        expect(evaluate("t | bookmarkLink: id", {t: 'See', id: 'VULN-1 ' + 'x'.repeat(50)})).toContain(`w:anchor="VULN_1_${'x'.repeat(33)}"`)
      })
    })
  })
}
