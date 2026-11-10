// Minimal LanguageTool replacement for the end-to-end tests.
// nginx (frontend/.docker/nginx.conf) proxies /v2 to pwndoc-ng-languagetool:8010: the stub answers the spell checking
// requests of the editors without any suggestion, except for the word "E2E_TYPO_WORD" (used to check that the
// suggestions are displayed). Lighter and faster to start than the real LanguageTool server.
const http = require('http')

const languages = [
  { name: 'English (US)', code: 'en', longCode: 'en-US' },
  { name: 'French', code: 'fr', longCode: 'fr' }
]

function readBody (req) {
  return new Promise(resolve => {
    let data = ''
    req.on('data', chunk => { data += chunk })
    req.on('end', () => resolve(data))
  })
}

http.createServer(async (req, res) => {
  const body = await readBody(req)
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (req.url.startsWith('/v2/languages')) {
    return res.end(JSON.stringify(languages))
  }
  if (req.url.startsWith('/v2/check')) {
    const params = new URLSearchParams(body)
    const text = params.get('text') || ''
    const matches = []
    const word = 'E2E_TYPO_WORD'
    let index = text.indexOf(word)
    while (index !== -1) {
      matches.push({
        message: 'Possible spelling mistake found.',
        shortMessage: 'Spelling mistake',
        replacements: [{ value: 'E2E_FIXED_WORD' }],
        offset: index,
        length: word.length,
        context: { text, offset: index, length: word.length },
        sentence: text,
        type: { typeName: 'Other' },
        rule: { id: 'MORFOLOGIK_RULE_EN_US', description: 'Possible spelling mistake', issueType: 'misspelling', category: { id: 'TYPOS', name: 'Possible Typo' } }
      })
      index = text.indexOf(word, index + word.length)
    }
    return res.end(JSON.stringify({ software: { name: 'LanguageTool', version: 'e2e-stub' }, language: { name: 'English (US)', code: 'en-US' }, matches }))
  }
  res.statusCode = 404
  res.end(JSON.stringify({ error: 'not found' }))
}).listen(8010, () => console.log('LanguageTool stub listening on 8010'))
