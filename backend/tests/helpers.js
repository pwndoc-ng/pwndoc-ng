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

  // Well-formedness errors of an XML document or fragment (empty array: well-formed). Checks the nesting of the
  // elements, the attributes (quoted, not repeated, no '<' and no bare '&') and the text (no '<', no bare '&', no
  // character forbidden in XML 1.0)
  helpers.xmlErrors = (xml) => {
    var errors = []
    var stack = []
    var badAmp = /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/
    var token = /<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[A-Za-z_][\w:.-]*\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/?)>|<|&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)|[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g
    var match
    while ((match = token.exec(xml)) !== null) {
      var [text, closing, name, attributes, selfClosing] = match
      var at = `at ${match.index}: ${JSON.stringify(xml.substring(match.index, match.index + 40))}`
      if (name) {
        if (closing) {
          if (attributes || selfClosing) errors.push(`Invalid closing tag ${at}`)
          var open = stack.pop()
          if (open !== name) errors.push(`</${name}> closes <${open}> ${at}`)
        }
        else {
          var names = [...attributes.matchAll(/\s+([A-Za-z_][\w:.-]*)\s*=\s*(?:"[^"]*"|'[^']*')/g)].map(m => m[1])
          if (new Set(names).size !== names.length) errors.push(`Repeated attribute ${at}`)
          if (badAmp.test(attributes)) errors.push(`Unescaped & in attribute ${at}`)
          if (!selfClosing) stack.push(name)
        }
      }
      else if (text === '<') errors.push(`Unescaped < ${at}`)
      else if (text === '&') errors.push(`Unescaped & ${at}`)
      else if (!text.startsWith('<')) errors.push(`Character U+${text.charCodeAt(0).toString(16).padStart(4, '0')} forbidden in XML ${at}`)
    }
    if (stack.length > 0) errors.push(`Unclosed elements: ${stack.join(', ')}`)
    return errors
  }

  // Text of the runs of an OOXML document or fragment (w:t elements), entities decoded
  helpers.ooxmlText = (xml) => (xml.match(/<w:t(?:\s[^>]*)?>[^<]*<\/w:t>/g) || [])
    .map(t => t.replace(/<[^>]+>/g, ''))
    .join('')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

  // Paragraphs (w:p) of an OOXML fragment, in the order of the document (paragraphs of the table cells included)
  helpers.ooxmlParagraphs = (xml) => xml.match(/<w:p(?:\s[^>]*)?\/>|<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) || []

  // Values of an attribute of an element in an OOXML fragment: helpers.ooxmlValues(xml, 'w:numId', 'w:val')
  helpers.ooxmlValues = (xml, element, attribute) =>
    [...xml.matchAll(new RegExp(`<${element}\\b[^>]*?\\s${attribute}="([^"]*)"`, 'g'))].map(m => m[1])

  helpers.CVSS = {
    critical: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H', // 9.8
    high: 'CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:N', // 8.1
    medium: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N', // 6.1
    low: 'CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:N/A:N' // 3.7
  }

  return helpers
}
