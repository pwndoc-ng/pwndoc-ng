// Minimal inference server compatible with OpenAI for the end-to-end tests (AI assistance), answers known in advance:
// - test of the connection: "OK"
// - assisted writing: the HTML fragment received, "[AI] " added at the start of its first paragraph
// - quality check by the AI: an issue for each finding without description
// The requests received are kept (GET /e2e/requests) to check what is sent (no image, pseudonymization).
const http = require('http')

const requests = []

function readBody (req) {
  return new Promise(resolve => {
    let data = ''
    req.on('data', chunk => { data += chunk })
    req.on('end', () => resolve(data))
  })
}

function answer (messages) {
  const text = messages.map(message => message.content).join('\n')
  if (text.includes('Answer with the single word OK')) return 'OK'
  if (text.includes('Findings (JSON):')) {
    const findings = JSON.parse(text.substring(text.indexOf('[', text.indexOf('Findings (JSON):')), text.lastIndexOf(']') + 1))
    return JSON.stringify(findings.filter(f => !f.description).map(f => ({ finding: f.id, field: 'description', severity: 'warning', message: `E2E AI: description of ${f.title} missing` })))
  }
  const fragment = text.split('HTML fragment:\n')[1] || ''
  return fragment.replace('<p>', '<p>[AI] ')
}

http.createServer(async (req, res) => {
  const body = await readBody(req)
  res.setHeader('Content-Type', 'application/json')
  if (req.url === '/e2e/requests') return res.end(JSON.stringify(requests))
  if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'e2e-model' }] }))
  if (req.url === '/v1/chat/completions' && req.method === 'POST') {
    const json = JSON.parse(body)
    requests.push(json)
    // Tokens of the reasoning of the model given like the reasoning models (shown by the test of the connection)
    return res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: answer(json.messages) }, finish_reason: 'stop' }], usage: { completion_tokens_details: { reasoning_tokens: 7 } } }))
  }
  res.statusCode = 404
  res.end(JSON.stringify({ error: 'not found' }))
}).listen(8000, () => console.log('AI stub listening on 8000'))
