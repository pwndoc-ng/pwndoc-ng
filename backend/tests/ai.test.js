/*
  AI assistance (lib/ai.js, routes/ai.js), disabled by default: inference server exposing the chat completions API of
  OpenAI (fake server started here), assisted writing (images never sent but put back, pseudonymization), quality check of the
  findings by the AI, test of the connection. Data prefixed with "ai" deleted at the end, settings reverted.
*/

module.exports = function(request, app) {
  var helpers = require('./helpers')(request, app)
  var http = require('http')
  var ai = require('../src/lib/ai')

  // fetch of the inference server: requests recorded, answer chosen by the test
  var fakeFetch = (answer) => {
    var calls = []
    var fetchImpl = async (url, options) => {
      calls.push({url, method: options.method, headers: options.headers, body: options.body ? JSON.parse(options.body) : null})
      var result = typeof answer === 'function' ? answer(url, options) : answer
      if (result instanceof Error) throw result
      return {ok: (result.status || 200) < 400, status: result.status || 200, headers: {get: (name) => (result.headers || {})[name.toLowerCase()] || null},
        json: async () => { if (result.invalid) throw new Error('json'); return result.json }}
    }
    return {fetchImpl, calls}
  }
  var chat = (content) => ({json: {choices: [{message: {role: 'assistant', content}}]}})
  var CONFIG = {url: 'http://ai.local:8000/v1/', model: 'llama', tokenParameter: 'max_tokens', maxTokens: 500, timeout: 30, systemRole: true,
    extraParameters: '', guidelines: [], pseudonymize: false}

  describe('AI assistance (lib/ai.js)', () => {
    afterEach(() => {
      delete process.env.AI_API_KEY
      delete process.env.AI_AUTH_HEADER
    })

    it('Sends no image (tokens), the text of the captions, only the attributes of the links and of the formatting', () => {
      var sent = ai.htmlForModel('<p class="x" style="color:red">Text <img class="custom-image" src="6af5" alt="IMG.png"><a href="https://e.com" target="_blank">link</a></p><legend label="Figure" alt="c">c</legend>')
      expect(sent).toEqual({html: '<p>Text [[IMAGE_1]]<a href="https://e.com">link</a></p><legend data-caption="1">c</legend>', kept: [
        {token: '[[IMAGE_1]]', block: '<img class="custom-image" src="6af5" alt="IMG.png">'},
        {token: '[[CAPTION_1]]', block: '<legend label="Figure" alt="c">c</legend>', caption: true, image: null}]})
      // Image with its caption, figure, captions of a table (empty: token); formatting of the editor kept (highlight color,
      // language of the code, start of the list, merged cells and widths), its styles and classes removed. Values of the
      // attributes with ">" (not escaped by all the browsers), entities of the captions
      var html = '<img class="custom-image" src="6aef2c3a3b1d4e5f60718293" alt="Proof > 1" data-width="large"><legend label="Figure" alt="Proof &amp; &quot;login&quot; <b>"></legend>' +
        '<p>See <mark data-color="#ffc078" style="background-color: #ffc078; color: inherit">this</mark></p>' +
        '<pre><code class="language-bash">id</code></pre><pre><code class="hljs evil">x</code></pre><ol start="3"><li><p>three</p></li></ol>' +
        '<table style="min-width: 120px"><colgroup><col style="width: 120px"></colgroup><tbody><tr><td colspan="2" rowspan="1" colwidth="120" onclick="x"><p>cell</p></td></tr></tbody></table>' +
        '<legend label="Table" alt="  Open\n ports "></legend><legend label="Table" alt=""></legend><figure><img src="https://e.com/a.png" alt="A"><figcaption>Fig</figcaption></figure><p title="a>b">end</p>'
      sent = ai.htmlForModel(html)
      expect(sent.html).toBe('[[IMAGE_1]]<legend data-caption="1">Proof &gt; 1</legend><legend data-caption="2">Proof &amp; "login" &lt;b&gt;</legend><p>See <mark data-color="#ffc078">this</mark></p><pre><code class="language-bash">id</code></pre><pre><code>x</code></pre>' +
        '<ol start="3"><li><p>three</p></li></ol><table><tbody><tr><td colspan="2" rowspan="1" colwidth="120"><p>cell</p></td></tr></tbody></table>' +
        '<legend data-caption="3">Open ports</legend>[[CAPTION_4]][[IMAGE_2]]<p>end</p>')
      expect(sent.kept).toEqual([
        {token: '[[IMAGE_1]]', block: '<img class="custom-image" src="6aef2c3a3b1d4e5f60718293" alt="Proof > 1" data-width="large">'},
        {token: '[[CAPTION_1]]', block: null, caption: true, imageAlt: '[[IMAGE_1]]'}, // Caption of the image (its alt)
        {token: '[[CAPTION_2]]', block: '<legend label="Figure" alt="Proof &amp; &quot;login&quot; <b>"></legend>', caption: true, image: '[[IMAGE_1]]'},
        {token: '[[CAPTION_3]]', block: '<legend label="Table" alt="  Open\n ports "></legend>', caption: true, image: null},
        {token: '[[CAPTION_4]]', block: '<legend label="Table" alt=""></legend>', caption: false, image: null},
        {token: '[[IMAGE_2]]', block: '<figure><img src="https://e.com/a.png" alt="A"><figcaption>Fig</figcaption></figure>'}])
    })

    it('Puts the images back, the captions with the text of the model, once each; those lost by the model unchanged', () => {
      var {kept} = ai.htmlForModel('<p>a</p><img src="i1"><p>b</p><img src="i2"><legend label="Figure" alt="2"></legend><legend label="Table" alt="t"></legend><legend label="Table" alt=""></legend>')
      expect(ai.restoreKept('<p>A</p><p>[[IMAGE_1]]</p><p>B</p>[[image_2]]<p><legend data-caption="1">Two &amp; "<em>bis</em>"</legend></p><legend data-caption="2">T</legend>[[CAPTION_3]]', kept))
        .toEqual({html: '<p>A</p><img src="i1"><p>B</p><img src="i2"><legend label="Figure" alt="Two &amp; &quot;bis&quot;"></legend><legend label="Table" alt="T"></legend><legend label="Table" alt=""></legend>', missing: 0})
      // Number of a caption removed by the model: first caption not put back. Token or caption repeated, unknown, written
      // with a zero
      expect(ai.restoreKept('<p>A [[IMAGE_1]] [[IMAGE_1]] [[IMAGE_9]]</p><p>[[IMAGE_02]]</p><legend>Second</legend><legend data-caption="2">T</legend><legend data-caption="2">T</legend><legend data-caption="7">x</legend>', kept))
        .toEqual({html: '<p>A <img src="i1">  </p><img src="i2"><legend label="Figure" alt="Second"></legend><legend label="Table" alt="T"></legend><legend label="Table" alt=""></legend>', missing: 1})
      // Lost: caption of an image put back after it (unchanged), the others at the end
      expect(ai.restoreKept('<p>A</p>[[IMAGE_2]]<p>B</p>', kept))
        .toEqual({html: '<p>A</p><img src="i2"><legend label="Figure" alt="2"></legend><p>B</p><img src="i1"><legend label="Table" alt="t"></legend><legend label="Table" alt=""></legend>', missing: 3})
      expect(ai.restoreKept('<p>A</p>', kept)).toEqual({html: '<p>A</p><img src="i1"><img src="i2"><legend label="Figure" alt="2"></legend><legend label="Table" alt="t"></legend><legend label="Table" alt=""></legend>', missing: 5})
    })

    it('Corrects the caption of the images (alt), never their file name; caption lost by the model: unchanged', () => {
      var html = '<img src="i1" alt="Requete envoyer"><img src="i2" alt="Capture d&#39;écran 2024-01-01 à 10.00.00.PNG"><img src="https://e.com/a.png" alt="External Image"><img src="i4" alt=""><img src="i5" alt="Reponse">'
      var {html: sent, kept} = ai.htmlForModel(html)
      expect(sent).toBe('[[IMAGE_1]]<legend data-caption="1">Requete envoyer</legend>[[IMAGE_2]][[IMAGE_3]][[IMAGE_4]][[IMAGE_5]]<legend data-caption="2">Reponse</legend>')
      expect(ai.restoreKept('[[IMAGE_1]]<p><legend data-caption="1">Requête &amp; "envoyée" <em>ici</em></legend></p>[[IMAGE_2]][[IMAGE_3]][[IMAGE_4]][[IMAGE_5]]', kept))
        .toEqual({html: '<img src="i1" alt="Requête &amp; &quot;envoyée&quot; ici"><img src="i2" alt="Capture d&#39;écran 2024-01-01 à 10.00.00.PNG"><img src="https://e.com/a.png" alt="External Image"><img src="i4" alt=""><img src="i5" alt="Reponse">', missing: 0})
      // Image lost: put back at the end with its caption corrected
      expect(ai.restoreKept('<legend data-caption="1">Requête</legend>[[IMAGE_2]][[IMAGE_3]][[IMAGE_4]][[IMAGE_5]][[CAPTION_2]]', kept))
        .toEqual({html: '<img src="i2" alt="Capture d&#39;écran 2024-01-01 à 10.00.00.PNG"><img src="https://e.com/a.png" alt="External Image"><img src="i4" alt=""><img src="i5" alt="Reponse"><img src="i1" alt="Requête">', missing: 1})
    })

    it('Background jobs (lib/ai-jobs.js): result or error kept for their user, number running limited, removed after a while', async () => {
      var aiJobs = require('../src/lib/ai-jobs')
      var release = []
      var ids = []
      for (var i = 0; i < aiJobs.MAX_RUNNING; i++) ids.push(aiJobs.start('u1', () => new Promise(resolve => release.push(resolve))))
      var refused = null
      try { aiJobs.start('u1', () => 1) } catch (err) { refused = err }
      expect(refused).toEqual({status: 429, message: 'Too many requests to the AI at once: wait for the end of the previous ones'})
      var failed = aiJobs.start('u2', async () => { throw {status: 502, message: 'The AI server is not available'} }) // Other user: not limited
      await new Promise(resolve => setImmediate(resolve))
      expect(aiJobs.get('u1', ids[0])).toMatchObject({state: 'running', result: null})
      expect(aiJobs.get('u2', ids[0])).toBeNull()
      expect(aiJobs.get('u2', failed)).toMatchObject({state: 'error', error: {status: 502, message: 'The AI server is not available'}})
      release.forEach((resolve, index) => resolve({index}))
      await new Promise(resolve => setImmediate(resolve))
      expect(aiJobs.get('u1', ids[1])).toMatchObject({state: 'done', result: {index: 1}})
      expect(aiJobs.start('u1', () => 1)).toMatch(/^[a-f0-9]{32}$/) // No longer running
      // Removed some time after their end
      aiJobs.cleanup(Date.now() + aiJobs.KEEP + 1000)
      expect(aiJobs.get('u1', ids[1])).toBeNull()
      expect(aiJobs.get('u2', failed)).toBeNull()
    })

    it('Reads the HTML of the answer: code fence removed, plain text as paragraphs (escaped)', () => {
      expect(ai.answerHtml('```html\n<p>Fixed</p>\n```')).toBe('<p>Fixed</p>')
      expect(ai.answerHtml('First <b> & co\n\nSecond\nline')).toBe('<p>First &lt;b> &amp; co</p><p>Second<br>line</p>')
      expect(ai.answerHtml('  <p>a</p> ')).toBe('<p>a</p>')
      expect(ai.answerHtml('[[IMAGE_1]]\n<p>a</p>')).toBe('[[IMAGE_1]]\n<p>a</p>') // HTML starting with an image
      expect(ai.answerHtml('[[IMAGE_1]]\n\nText')).toBe('<p>[[IMAGE_1]]</p><p>Text</p>')
    })

    it('Pseudonymization: terms hidden whatever their case (longest first), restored in the answer', () => {
      var hider = ai.pseudonymizer(['ACME', 'ACME Corp', 'intranet.acme.example', 'ab', null, 'ACME'])
      var hidden = hider.hide('ACME Corp and acme on intranet.acme.example')
      expect(hidden).toBe('[[TERM_2]] and [[TERM_3]] on [[TERM_1]]')
      expect(hider.restore(hidden)).toBe('ACME Corp and ACME on intranet.acme.example')
      expect(hider.restore('[[TERM_9]]')).toBe('[[TERM_9]]')
      // Never searched in the tokens of the images, nor in those of the terms already hidden
      expect(ai.pseudonymizer(['Image Corp', 'age', 'TERM']).hide('Image Corp: age [[IMAGE_1]] term')).toBe('[[TERM_1]]: [[TERM_3]] [[IMAGE_1]] [[TERM_2]]')
      expect(ai.auditTerms({company: {name: 'ACME', shortName: 'AC'}, client: {firstname: 'Carl', lastname: 'Client', email: 'c@acme.example'},
        scope: [{name: '10.0.0.0/24', hosts: [{hostname: 'srv.acme.example', ip: '10.0.0.5'}]}]}))
        .toEqual(['ACME', 'AC', 'Carl Client', 'Client', 'c@acme.example', '10.0.0.0/24', 'srv.acme.example', '10.0.0.5'])
    })

    it('Prompt of an action: writing guidelines of the company numbered before the text, mandatory', () => {
      var prompt = ai.buildPrompt({action: 'correct', html: '<p>x</p>', guidelines: ['Use the formal tone.', ' ', ' Write "password" in full. ']})
      expect(prompt.system).toContain('The writing guidelines of the company given with the instruction are mandatory: apply each of them, even when the instruction asks to keep the wording.')
      expect(prompt.user).toBe(`Instruction: ${ai.ACTIONS.correct}\n\nWriting guidelines of the company (mandatory):\n1. Use the formal tone.\n2. Write "password" in full.\n\nHTML fragment:\n<p>x</p>`)
      // Without guidelines: not mentioned
      var plain = ai.buildPrompt({action: 'correct', html: '<p>x</p>', guidelines: []})
      expect(`${plain.system}\n${plain.user}`).not.toMatch(/guideline/i)
      expect(plain.user).toBe(`Instruction: ${ai.ACTIONS.correct}\n\nHTML fragment:\n<p>x</p>`)
      expect(ai.buildPrompt({action: 'custom', instruction: ' Say it in pirate ', html: '<p>x</p>'}).user).toContain('Instruction: Say it in pirate\n')
    })

    it('Writing guidelines: one per line, text of the settings saved before them split into lines', () => {
      expect(ai.guidelineLines('Formal tone\r\n\n  Short sentences ')).toEqual(['Formal tone', 'Short sentences'])
      expect(ai.guidelineLines(['a', 'b\nc', '', null])).toEqual(['a', 'b', 'c'])
      expect(ai.guidelineLines(undefined)).toEqual([])
      expect(ai.buildPrompt({action: 'shorten', html: '<p>x</p>', guidelines: ['Formal tone\nShort sentences']}).user)
        .toContain('Writing guidelines of the company (mandatory):\n1. Formal tone\n2. Short sentences\n\nHTML fragment:')
    })

    it('OpenAI compatible server: chat completions, model, token parameter, API key of the environment', async () => {
      process.env.AI_API_KEY = 'key-of-the-test'
      var {fetchImpl, calls} = fakeFetch(chat('<p>Corrected</p>'))
      expect(await ai.generate(CONFIG, {system: 'S', user: 'U'}, fetchImpl)).toBe('<p>Corrected</p>')
      expect(calls[0].url).toBe('http://ai.local:8000/v1/chat/completions')
      expect(calls[0].headers.Authorization).toBe('Bearer key-of-the-test')
      expect(calls[0].body).toEqual({model: 'llama', messages: [{role: 'system', content: 'S'}, {role: 'user', content: 'U'}], temperature: 0.2, stream: false, max_tokens: 500})
      process.env.AI_AUTH_HEADER = 'X-Api-Key'
      await ai.generate({...CONFIG, tokenParameter: 'max_completion_tokens', systemRole: false, model: '', url: 'https://ai.local/v1/chat/completions'}, {system: 'S', user: 'U'}, fetchImpl)
      expect(calls[1].url).toBe('https://ai.local/v1/chat/completions')
      expect(calls[1].headers['X-Api-Key']).toBe('key-of-the-test')
      expect(calls[1].headers.Authorization).toBeUndefined()
      expect(calls[1].body).toEqual({messages: [{role: 'user', content: 'S\n\nU'}], temperature: 0.2, stream: false, max_completion_tokens: 500})
    })

    it('OpenAI compatible server: parameters of the settings added to the requests (reasoning of the model)', async () => {
      var {fetchImpl, calls} = fakeFetch(chat('OK'))
      var extraParameters = '{"chat_template_kwargs": {"enable_thinking": false}, "temperature": 0.6, "messages": [], "stream": true}'
      expect(await ai.generate({...CONFIG, extraParameters}, {system: 'S', user: 'U'}, fetchImpl)).toBe('OK')
      // Messages and streaming of pwndoc kept, model and maximum length of the settings
      expect(calls[0].body).toEqual({model: 'llama', messages: [{role: 'system', content: 'S'}, {role: 'user', content: 'U'}], temperature: 0.6, stream: false, max_tokens: 500,
        chat_template_kwargs: {enable_thinking: false}})
      await ai.generate({...CONFIG, extraParameters: '  '}, {system: 'S', user: 'U'}, fetchImpl)
      expect(Object.keys(calls[1].body).sort()).toEqual(['max_tokens', 'messages', 'model', 'stream', 'temperature'])
      for (var invalid of ['{"broken"', '[1]', '"text"', 'null', '3'])
        await expect(ai.generate({...CONFIG, extraParameters: invalid}, {system: 'S', user: 'U'}, fetchImpl)).rejects.toEqual({status: 422, message: 'Invalid additional parameters of the requests (JSON object expected)'})
      expect(calls).toHaveLength(2)
      expect(ai.parseExtraParameters('')).toEqual({})
      expect(ai.parseExtraParameters('{"reasoning_effort": "low"}')).toEqual({reasoning_effort: 'low'})
      expect(ai.parseExtraParameters('[]')).toBe(null)
    })

    it('Reasoning models: maximum length reached before the answer, explained', async () => {
      var reasoning = (content, finish) => fakeFetch({json: {choices: [{message: {role: 'assistant', content, reasoning_content: 'Thinking...'}, finish_reason: finish}]}}).fetchImpl
      var prompt = {system: 'S', user: 'U'}
      var length = {status: 502, message: 'Maximum length reached before the answer of the AI (reasoning of the model included): increase the maximum length or limit the reasoning in the settings'}
      await expect(ai.generate(CONFIG, prompt, reasoning(null, 'length'))).rejects.toEqual(length)
      await expect(ai.generate(CONFIG, prompt, reasoning('', 'length'))).rejects.toEqual(length)
      await expect(ai.generate(CONFIG, prompt, reasoning(' ', 'stop'))).rejects.toEqual({status: 502, message: 'No text in the answer of the AI server'})
      // Reasoning repeating itself, stopped by the server (tensorfold), or answer filtered
      var loop = fakeFetch({json: {choices: [{message: {role: 'assistant', content: '', reasoning_content: 'Again'}, finish_reason: 'content_filter'}], error: {code: 'reasoning_loop', message: 'details'}}}).fetchImpl
      await expect(ai.generate(CONFIG, prompt, loop)).rejects.toEqual({status: 502, message: 'The reasoning of the model looped and was stopped by the AI server: retry, or limit the reasoning in the settings'})
      await expect(ai.generate(CONFIG, prompt, reasoning(null, 'content_filter'))).rejects.toEqual({status: 502, message: 'The AI server stopped the answer (content filter)'})
      expect(await ai.complete(CONFIG, prompt, fakeFetch({json: {choices: [{message: {content: 'OK'}}], usage: {completion_tokens_details: {reasoning_tokens: 12}}}}).fetchImpl)).toEqual({text: 'OK', reasoningTokens: 12})
      expect(await ai.generate(CONFIG, prompt, reasoning('[]', 'stop'))).toBe('[]')
    })

    it('Refusals of the server: its message for the request (4xx), the API key (401, 403), the address (404), codes of the waits', async () => {
      var prompt = {system: 'S', user: 'U'}
      var answer = (status, error) => fakeFetch({status, json: {error}}).fetchImpl
      await expect(ai.generate(CONFIG, prompt, answer(400, {message: 'reasoning_effort must be none, minimal, low, medium, high, xhigh or max', type: 'invalid_request_error'}))).rejects
        .toEqual({status: 502, message: 'The AI server refused the request: reasoning_effort must be none, minimal, low, medium, high, xhigh or max'})
      await expect(ai.generate(CONFIG, prompt, answer(400, {message: "This server's maximum context length is 200000 tokens\u0000", code: 'context_length_exceeded'}))).rejects
        .toEqual({status: 502, message: "The AI server refused the request (context_length_exceeded): This server's maximum context length is 200000 tokens"})
      await expect(ai.generate(CONFIG, prompt, answer(400, {message: 'x'.repeat(500)}))).rejects.toMatchObject({message: `The AI server refused the request: ${'x'.repeat(300)}`})
      await expect(ai.generate(CONFIG, prompt, answer(401, {message: 'Invalid key'}))).rejects.toEqual({status: 502, message: 'The AI server answered 401: check the API key (environment variable AI_API_KEY)'})
      await expect(ai.generate(CONFIG, prompt, answer(403, {message: 'No', code: 'insufficient_scope'}))).rejects.toEqual({status: 502, message: 'The AI server answered 403 (insufficient_scope): check the API key (environment variable AI_API_KEY)'})
      await expect(ai.generate(CONFIG, prompt, answer(404, 'not found'))).rejects.toEqual({status: 502, message: 'The AI server answered 404: check the address of the server (usually ending with /v1) and the model'})
      // Server errors: status and code only (never their message)
      await expect(ai.generate(CONFIG, prompt, answer(500, {message: 'secret details', type: 'server_error'}))).rejects.toEqual({status: 502, message: 'The AI server answered 500'})
      await expect(ai.generate(CONFIG, prompt, answer(503, {message: 'Busy', code: 'engine_busy'}))).rejects.toEqual({status: 502, message: 'The AI server answered 503 (engine_busy)'})
      await expect(ai.generate(CONFIG, prompt, answer(503, {message: 'Busy', code: 'bad code!'}))).rejects.toEqual({status: 502, message: 'The AI server answered 503'})
    })

    it('Waits announced by the server (503, 429 with Retry-After) waited then retried, within the timeout', async () => {
      var prompt = {system: 'S', user: 'U'}
      var waits = (count, retry) => fakeFetch((url, options) => {
        waits.calls = (waits.calls || 0) + 1
        return waits.calls <= count ? {status: 503, headers: {'retry-after': retry}, json: {error: {message: 'Loading', code: 'engine_loading'}}} : chat('OK')
      })
      waits.calls = 0
      var loading = waits(2, '0')
      expect(await ai.generate(CONFIG, prompt, loading.fetchImpl)).toBe('OK')
      expect(loading.calls).toHaveLength(3)
      waits.calls = 0
      var limited = fakeFetch(() => { waits.calls++; return waits.calls === 1 ? {status: 429, headers: {'retry-after': '0'}, json: {error: {message: 'Limit', code: 'admission_capacity_exceeded'}}} : chat('OK') })
      expect(await ai.generate(CONFIG, prompt, limited.fetchImpl)).toBe('OK')
      // Three retries at most
      waits.calls = 0
      var always = waits(10, '0')
      await expect(ai.generate(CONFIG, prompt, always.fetchImpl)).rejects.toEqual({status: 502, message: 'The AI server answered 503 (engine_loading)'})
      expect(always.calls).toHaveLength(4)
      // Wait longer than the timeout, or not announced: not retried
      waits.calls = 0
      var long = waits(1, '3600')
      await expect(ai.generate(CONFIG, prompt, long.fetchImpl)).rejects.toEqual({status: 502, message: 'The AI server answered 503 (engine_loading)'})
      expect(long.calls).toHaveLength(1)
      waits.calls = 0
      var unknown = fakeFetch(() => ({status: 503, json: {error: {code: 'engine_busy'}}}))
      await expect(ai.generate(CONFIG, prompt, unknown.fetchImpl)).rejects.toEqual({status: 502, message: 'The AI server answered 503 (engine_busy)'})
      expect(unknown.calls).toHaveLength(1)
    })

    it('Errors of the server: not available, timeout, error status, invalid answer, no text, no address', async () => {
      var prompt = {system: 'S', user: 'U'}
      await expect(ai.generate(CONFIG, prompt, fakeFetch(new TypeError('fetch failed')).fetchImpl)).rejects.toEqual({status: 502, message: 'The AI server is not available'})
      var timeout = new Error('timeout')
      timeout.name = 'TimeoutError'
      await expect(ai.generate(CONFIG, prompt, fakeFetch(timeout).fetchImpl)).rejects.toEqual({status: 502, message: 'The AI server did not answer in time'})
      await expect(ai.generate(CONFIG, prompt, fakeFetch({status: 500, json: {error: 'secret details'}}).fetchImpl)).rejects.toEqual({status: 502, message: 'The AI server answered 500'})
      await expect(ai.generate(CONFIG, prompt, fakeFetch({invalid: true}).fetchImpl)).rejects.toEqual({status: 502, message: 'Invalid answer of the AI server'})
      await expect(ai.generate(CONFIG, prompt, fakeFetch({json: {choices: []}}).fetchImpl)).rejects.toEqual({status: 502, message: 'No text in the answer of the AI server'})
      await expect(ai.generate({...CONFIG, url: ''}, prompt, fakeFetch(chat('x')).fetchImpl)).rejects.toEqual({status: 422, message: 'The address of the AI server is not configured'})
    })

    it('Assisted writing: images never sent but put back, captions corrected, client names hidden then restored when enabled, size limits', async () => {
      var {fetchImpl, calls} = fakeFetch((url, options) => chat(JSON.parse(options.body).messages[1].content.split('HTML fragment:\n')[1].replace(/Contact/g, 'Contacter')))
      var html = '<p>Contact ACME Corp</p><img src="6af573f15a4b2128f82dfede" alt="IMG_1.png"><legend label="Figure" alt="Contact ACME Corp"></legend>'
      expect(await ai.assist({...CONFIG, pseudonymize: true}, {action: 'correct', html}, {terms: ['ACME Corp']}, fetchImpl))
        .toEqual({html: '<p>Contacter ACME Corp</p><img src="6af573f15a4b2128f82dfede" alt="IMG_1.png"><legend label="Figure" alt="Contacter ACME Corp"></legend>', missing: 0})
      expect(JSON.stringify(calls[0].body)).not.toContain('ACME')
      expect(JSON.stringify(calls[0].body)).not.toContain('6af573f15a4b2128f82dfede')
      expect(JSON.stringify(calls[0].body)).not.toContain('IMG_1')
      expect(calls[0].body.messages[1].content).toContain('<p>Contact [[TERM_1]]</p>[[IMAGE_1]]<legend data-caption="1">Contact [[TERM_1]]</legend>')
      expect(calls[0].body.messages[0].content).toContain('[[IMAGE_1]] or [[CAPTION_1]] stand for the images and captions: keep each of them once, unchanged, at its place')
      expect(calls[0].body.messages[0].content).toContain('The legend elements are the captions of the images, tables and code blocks: apply the instruction to their text too')
      await ai.assist(CONFIG, {action: 'correct', html}, {terms: ['ACME Corp']}, fetchImpl)
      expect(calls[1].body.messages[1].content).toContain('ACME Corp') // Pseudonymization disabled
      await expect(ai.assist(CONFIG, {action: 'correct', html: '<p><img src="x"></p>'}, {}, fetchImpl)).rejects.toEqual({status: 422, message: 'Nothing to send to the AI'})
      await expect(ai.assist(CONFIG, {action: 'correct', html: `<p>${'x'.repeat(ai.MAX_TEXT)}</p>`}, {}, fetchImpl)).rejects.toMatchObject({status: 413})
      expect(calls).toHaveLength(2)
      // Image and caption lost by the model: put back at the end (caption unchanged), counted
      var lost = fakeFetch(chat('<p>Contacter ACME Corp</p>')).fetchImpl
      expect(await ai.assist(CONFIG, {action: 'correct', html}, {}, lost))
        .toEqual({html: '<p>Contacter ACME Corp</p><img src="6af573f15a4b2128f82dfede" alt="IMG_1.png"><legend label="Figure" alt="Contact ACME Corp"></legend>', missing: 2})
      // Caption alone: sent
      expect(await ai.assist(CONFIG, {action: 'correct', html: '<img src="6af573f15a4b2128f82dfede"><legend label="Figure" alt="Contact"></legend>'}, {}, fetchImpl))
        .toEqual({html: '<img src="6af573f15a4b2128f82dfede"><legend label="Figure" alt="Contacter"></legend>', missing: 0})
    })

    it('Quality check by the AI: findings sent by batches, issues of the JSON answer for the findings of the audit', async () => {
      var audit = {findings: [
        {_id: 'f1', title: 'SQLi on ACME', cvssv3: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H', description: '<p>Low impact <img src="x"></p>', remediation: '<p>Fix</p>'},
        {_id: 'f2', title: 'XSS', description: '<p>Text</p>'}
      ]}
      var {fetchImpl, calls} = fakeFetch(chat('Here is the review:\n[{"finding": "f1", "field": "cvss", "severity": "warning", "message": "Critical CVSS but [[TERM_1]] impact described as low"},' +
        '{"finding": "unknown", "message": "x"}, {"finding": "f2", "field": "other", "severity": "error", "message": " Unclear wording "}, {"finding": "f2", "message": ""}]'))
      var issues = await ai.qaIssues({...CONFIG, pseudonymize: true}, audit, {terms: ['ACME']}, fetchImpl)
      expect(issues.map(issue => [issue.check, issue.severity, issue.code, issue.params.message, issue.location])).toEqual([
        ['ai', 'warning', 'ai', 'Critical CVSS but ACME impact described as low', {kind: 'finding', id: 'f1', name: 'SQLi on ACME', field: 'cvss', label: null, passage: null}],
        ['ai', 'warning', 'ai', 'Unclear wording', {kind: 'finding', id: 'f2', name: 'XSS', field: null, label: null, passage: null}]
      ])
      expect(issues[0].fingerprint).toMatch(/^[a-f0-9]{20}$/)
      expect(calls).toHaveLength(1)
      var sent = calls[0].body.messages[1].content
      expect(sent).toContain('Findings:\n<finding id="f1">\n<title>SQLi on [[TERM_1]]</title>\n<cvss>CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H</cvss>\n' +
        '<description>\nLow impact\n[image 1]\n</description>\n<observation>\n\n</observation>\n<remediation>\nFix\n</remediation>\n</finding>\n\n<finding id="f2">')
      expect(sent).not.toContain('ACME')
      expect(sent).not.toContain('<img')
      await expect(ai.qaIssues(CONFIG, audit, {}, fakeFetch(chat('Nothing to say')).fetchImpl)).rejects.toEqual({status: 502, message: 'Invalid answer of the AI for the quality check'})
      expect(await ai.qaIssues(CONFIG, audit, {}, fakeFetch(chat('[]')).fetchImpl)).toEqual([])
    })

    it('Quality check by the AI: passage of the field shown when the issue is opened, only when really in the field', async () => {
      var audit = {findings: [{_id: 'f1', title: 'SQLi', description: '<p>The login form of <strong>ACME</strong> is   vulnerable.</p><p>Its gona be hacked.</p>', remediation: '<p>Use prepared statements.</p>'}]}
      var answer = (items) => fakeFetch(chat(JSON.stringify(items))).fetchImpl
      var issues = await ai.qaIssues({...CONFIG, pseudonymize: true}, audit, {terms: ['ACME']}, answer([
        {finding: 'f1', field: 'description', message: 'Informal', quote: 'its GONA be hacked'}, // Case and whitespace ignored
        {finding: 'f1', field: 'description', message: 'Pseudonymized', quote: 'form of [[TERM_1]] is vulnerable'}, // Name restored
        {finding: 'f1', field: 'remediation', message: 'Rephrased', quote: 'Use parameterized queries'}, // Not in the field
        {finding: 'f1', field: 'cvss', message: 'CVSS', quote: 'AV:N'}, // Not a text field
        {finding: 'f1', field: 'description', message: 'No quote'}
      ]))
      expect(issues.map(issue => issue.location.passage)).toEqual([{text: 'its GONA be hacked'}, {text: 'form of ACME is vulnerable'}, null, null, null])
      // Asked to the model
      var {fetchImpl, calls} = fakeFetch(chat('[]'))
      await ai.qaIssues(CONFIG, audit, {}, fetchImpl)
      expect(calls[0].body.messages[1].content).toContain('"quote": "<passage of the field concerned, copied word for word from one line of it, 3 to 15 words, without the markers in brackets; for a problem of an image or of the lines around it, the marker of the image, like [image 2]')
    })

    it('Quality check by the AI: text of the fields as in the editor (lines, empty lines, images), passages found like in the editor', async () => {
      var description = '<p>The <strong>XSS</strong>. Payload<mark>s</mark> of l&#39;<em>attacker</em>&nbsp;:</p><img class="custom-image" src="data:image/png;base64,AAAA" alt="Proof 1">' +
        '<p></p><p></p><p>Next<br>line</p><ul><li><p>one</p><ol><li><p>a</p></li></ol></li></ul><pre><code>cat /etc/passwd\nid</code></pre>'
      expect(ai.fieldText(description).text).toBe("The XSS. Payloads of l'attacker\u00a0:\n[image 1: Proof 1]\n[empty line]\n[empty line]\nNext\nline\n- one\n  1. a\ncat /etc/passwd\nid")
      expect(ai.fieldText(description, {markers: false}).text).toBe("The XSS. Payloads of l'attacker\u00a0:\nNext\nline\none\na\ncat /etc/passwd\nid")
      expect(ai.fieldText('<p>Inline <img src="x"></p><p></p>').text).toBe('Inline\n[image 1]\n[empty line]') // Image in a paragraph: not empty
      expect(ai.fieldText(`<p>${'x'.repeat(30)}</p>`, {max: 10}).text).toBe(`${'x'.repeat(10)}\n[truncated]`)
      var audit = {findings: [{_id: 'f1', title: 'XSS', description}]}
      var issues = await ai.qaIssues(CONFIG, audit, {}, fakeFetch(chat(JSON.stringify([
        {finding: 'f1', field: 'description', message: 'Two empty lines after the image (guideline 1)', quote: '[image 1: Proof 1]'},
        {finding: 'f1', field: 'description', message: 'Image 2', quote: '[image 2]'}, // No such image
        {finding: 'f1', field: 'description', message: 'Words', quote: 'XSS. Payloads of'}, // Text of the editor, without the tags
        {finding: 'f1', field: 'description', message: 'Marker', quote: 'Proof 1] [empty line]'} // Not in the editor
      ]))).fetchImpl)
      expect(issues.map(issue => issue.location.passage)).toEqual([{image: {src: require('../src/lib/qa').imageAnchorKey('data:image/png;base64,AAAA'), alt: 'Proof 1'}}, null, {text: 'XSS. Payloads of'}, null])
    })

    it('Quality check by the AI: each writing guideline of the company checked, numbered', async () => {
      var audit = {findings: [{_id: 'f1', title: 'SQLi', description: '<p>We hacked it.</p>'}]}
      var {fetchImpl, calls} = fakeFetch(chat('[]'))
      await ai.qaIssues({...CONFIG, guidelines: ['Write "the auditor", never "we".', 'No slang.']}, audit, {}, fetchImpl)
      var [system, user] = calls[0].body.messages.map(message => message.content)
      expect(system).toBe('You are an assistant reviewing the findings of a penetration testing report. The writing guidelines of the company are mandatory.')
      expect(user).toContain('every passage not respecting one of the writing guidelines of the company below (check each guideline on each field; one issue per guideline not respected, giving its number in the message)')
      expect(user).toContain('Writing guidelines of the company (mandatory):\n1. Write "the auditor", never "we".\n2. No slang.\n\nFindings:\n<finding id="f1">')
      // Without guidelines: not mentioned
      await ai.qaIssues(CONFIG, audit, {}, fetchImpl)
      expect(calls[1].body.messages.map(message => message.content).join('\n')).not.toMatch(/guideline/i)
    })

    it('Quality check by the AI: large audits sent in several requests (long fields shortened, marked)', async () => {
      var findings = Array.from({length: 30}, (_, i) => ({_id: `f${i}`, title: `F${i}`, description: `<p>${'x'.repeat(25000)}</p>`, remediation: `<p>${'y'.repeat(4000)}</p>`}))
      var {fetchImpl, calls} = fakeFetch(chat('[]'))
      await ai.qaIssues(CONFIG, {findings}, {}, fetchImpl)
      expect(calls.length).toBeGreaterThan(1)
      expect(calls.every(call => call.body.messages[1].content.length < ai.MAX_TEXT + 2000)).toBe(true)
      var sent = calls[0].body.messages[1].content
      expect(sent).toContain(`${'x'.repeat(20000)}\n[truncated]\n</description>`)
      expect(sent).not.toContain('x'.repeat(20001))
      expect(sent).toContain(`<remediation>\n${'y'.repeat(4000)}\n</remediation>`) // Not shortened
    })

    it('Test of the connection: models of the server, short answer, tokens of the reasoning and time taken', async () => {
      var {fetchImpl, calls} = fakeFetch((url) => url.endsWith('/models') ? {json: {data: [{id: 'llama'}, {id: 'mistral'}]}} :
        {json: {choices: [{message: {role: 'assistant', content: ' OK ', reasoning_content: 'Thinking'}, finish_reason: 'stop'}], usage: {completion_tokens_details: {reasoning_tokens: 229}}}})
      var result = await ai.testConnection(CONFIG, fetchImpl)
      expect(result).toEqual({models: ['llama', 'mistral'], answer: 'OK', reasoningTokens: 229, seconds: expect.any(Number)})
      expect(result.seconds).toBeGreaterThanOrEqual(0)
      expect((await ai.testConnection(CONFIG, fakeFetch(chat('OK')).fetchImpl)).reasoningTokens).toBeNull() // Not given by the server
      expect(calls.map(call => [call.method, call.url])).toEqual([['GET', 'http://ai.local:8000/v1/models'], ['POST', 'http://ai.local:8000/v1/chat/completions']])
      var noList = fakeFetch((url) => url.endsWith('/models') ? {status: 404, json: {}} : chat('OK'))
      expect((await ai.testConnection(CONFIG, noList.fetchImpl)).models).toBeNull()
    })
  })

  describe('AI assistance Suite Tests', () => {
    var adminCookie, userCookie, otherCookie, server, port, answer, requests, auditId, findingId
    var setAi = (values) => request(app).put('/api/settings').set('Cookie', adminCookie).send({ai: values})
    // Request to the AI run in the background: answer of its job once ended ({status, body}, result in body.datas), or the
    // answer of the request itself (refused before starting)
    var finish = async (pending, cookie = userCookie) => {
      var response = await pending
      if (response.status !== 202) return response
      expect(response.body.datas.job).toMatch(/^[a-f0-9]{32}$/)
      for (;;) {
        var poll = await request(app).get(`/api/ai/jobs/${response.body.datas.job}`).set('Cookie', cookie)
        if (poll.status !== 200) return poll
        if (poll.body.datas.state === 'done') return {status: 200, body: {...poll.body, datas: poll.body.datas.result}}
        expect(poll.body.datas).toEqual({state: 'running'})
        await new Promise(resolve => setTimeout(resolve, 20))
      }
    }
    var assist = (body, cookie = userCookie) => finish(request(app).post('/api/ai/assist').set('Cookie', cookie).send(body), cookie)

    beforeAll(async () => {
      adminCookie = await helpers.login('admin', 'Admin123')
      userCookie = await helpers.login('user2', 'User1234')
      otherCookie = await helpers.login('tmpuser', 'Tmpuser1')
      // Fake inference server compatible with OpenAI
      server = http.createServer((req, res) => {
        var body = ''
        req.on('data', chunk => body += chunk)
        req.on('end', () => {
          requests.push({method: req.method, url: req.url, body: body ? JSON.parse(body) : null})
          res.setHeader('Content-Type', 'application/json')
          if (req.url === '/v1/models') return res.end(JSON.stringify({data: [{id: 'fake-model'}]}))
          Promise.resolve(answer(JSON.parse(body))).then(content => res.end(JSON.stringify({choices: [{message: {role: 'assistant', content}}]})))
        })
      })
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
      port = server.address().port
      var response = await request(app).post('/api/audits').set('Cookie', userCookie).send({name: 'ai Audit', language: 'en', auditType: 'Web'})
      expect(response.status).toBe(201)
      auditId = response.body.datas.audit._id
      expect((await request(app).post(`/api/audits/${auditId}/findings`).set('Cookie', userCookie).send({title: 'ai Finding', description: '<p>Desc</p>'})).status).toBe(200)
      findingId = (await request(app).get(`/api/audits/${auditId}`).set('Cookie', userCookie)).body.datas.findings[0]._id
    })
    beforeEach(() => {
      requests = []
      answer = (body) => body.messages[body.messages.length - 1].content.split('HTML fragment:\n')[1].toUpperCase()
    })
    afterAll(async () => {
      await request(app).delete(`/api/audits/${auditId}`).set('Cookie', userCookie)
      var companies = (await request(app).get('/api/companies').set('Cookie', adminCookie)).body.datas
      for (var company of companies.filter(c => c.name === 'ai Secret Corp'))
        await request(app).delete(`/api/companies/${company._id}`).set('Cookie', adminCookie)
      await setAi({enabled: false, private: {url: '', model: '', pseudonymize: false, guidelines: ''}})
      await new Promise(resolve => server.close(resolve))
    })

    it('Disabled by default: refused, nothing sent', async () => {
      var response = await assist({action: 'correct', html: '<p>text</p>'})
      expect(response.status).toBe(403)
      expect(response.body.datas).toBe('AI assistance is disabled')
      expect((await request(app).get('/api/settings/public').set('Cookie', userCookie)).body.datas.ai).toEqual({enabled: false})
      expect(requests).toEqual([])
    })

    it('Settings of the AI server validated, test of the connection by the administrators', async () => {
      for (var values of [{private: {url: 'ftp://x'}}, {private: {maxTokens: 1.5}}, {private: {timeout: 2}}, {private: {tokenParameter: 'tokens'}},
        {private: {extraParameters: '{"broken"'}}, {private: {extraParameters: '[1]'}}])
        expect((await setAi(values)).status).toBe(422)
      expect((await setAi({private: {url: `http://127.0.0.1:${port}/v1`, model: 'fake-model'}})).status).toBe(200)
      answer = () => 'OK'
      var response = await finish(request(app).post('/api/ai/test').set('Cookie', adminCookie), adminCookie)
      expect(response.status).toBe(200)
      expect(response.body.datas).toEqual({models: ['fake-model'], answer: 'OK', reasoningTokens: null, seconds: expect.any(Number)})
      expect((await request(app).post('/api/ai/test').set('Cookie', userCookie)).status).toBe(403)
      // API key never in the settings
      expect(JSON.stringify((await request(app).get('/api/settings').set('Cookie', adminCookie)).body.datas.ai)).not.toMatch(/key/i)
    })

    it('Assisted writing once enabled: proposal of the server, images not sent but put back', async () => {
      expect((await setAi({enabled: true})).status).toBe(200)
      expect((await request(app).get('/api/settings/public').set('Cookie', userCookie)).body.datas.ai).toEqual({enabled: true})
      var response = await assist({action: 'correct', html: '<p>text <img src="6af573f15a4b2128f82dfede" alt="x"></p>'})
      expect(response.status).toBe(200)
      expect(response.body.datas).toEqual({html: '<P>TEXT <img src="6af573f15a4b2128f82dfede" alt="X"></P>', missing: 0}) // Caption of the image corrected
      expect(requests[0].body.model).toBe('fake-model')
      expect(JSON.stringify(requests[0].body)).not.toContain('6af573f15a4b2128f82dfede')
    })

    it('Pseudonymization with the company, client and scope of the audit', async () => {
      await request(app).put(`/api/audits/${auditId}/general`).set('Cookie', userCookie).send({company: {name: 'ai Secret Corp'}, scope: ['ai-intranet.example']})
      expect((await setAi({private: {pseudonymize: true}})).status).toBe(200)
      answer = (body) => body.messages[1].content.split('HTML fragment:\n')[1]
      var response = await assist({action: 'rephrase', html: '<p>ai Secret Corp hosts ai-intranet.example</p>', auditId})
      expect(response.body.datas).toEqual({html: '<p>ai Secret Corp hosts ai-intranet.example</p>', missing: 0})
      expect(JSON.stringify(requests[0].body)).not.toMatch(/Secret Corp|ai-intranet/)
    })

    it('Refuses invalid parameters, the audits not readable by the user', async () => {
      for (var body of [{}, {action: 'hack', html: '<p>x</p>'}, {action: 'correct', html: 3}, {action: 'custom', html: '<p>x</p>'}, {action: 'custom', html: '<p>x</p>', instruction: 'x'.repeat(2001)},
        {action: 'correct', html: '<p>x</p>', auditId: {$ne: ''}}])
        expect((await assist(body)).status).toBe(422)
      expect((await assist({action: 'correct', html: '<p>x</p>', auditId}, otherCookie)).status).toBe(404)
      expect((await request(app).post('/api/ai/assist').send({action: 'correct', html: '<p>x</p>'})).status).toBe(401)
    })

    it('Quality check of the audit by the AI: issues stored, listed with the other checks', async () => {
      answer = () => JSON.stringify([{finding: findingId, field: 'description', severity: 'warning', message: 'Description too short'}])
      var response = await finish(request(app).post(`/api/audits/${auditId}/qa/ai`).set('Cookie', userCookie))
      expect(response.status).toBe(200)
      expect(response.body.datas.issues).toEqual([expect.objectContaining({check: 'ai', code: 'ai', params: {message: 'Description too short'}})])
      var qa = (await request(app).get(`/api/audits/${auditId}/qa`).set('Cookie', userCookie)).body.datas
      expect(qa.ai.at).toBeDefined()
      expect(qa.issues.filter(issue => issue.check === 'ai').map(issue => issue.params.message)).toEqual(['Description too short'])
      // Ignored like the other issues
      var issue = qa.issues.find(item => item.check === 'ai')
      expect((await request(app).put(`/api/audits/${auditId}/qa/ignored`).set('Cookie', userCookie).send({fingerprint: issue.fingerprint, ignored: true})).status).toBe(200)
      expect((await request(app).get(`/api/audits/${auditId}/qa`).set('Cookie', userCookie)).body.datas.ignored.map(item => item.check)).toContain('ai')
      expect((await request(app).post(`/api/audits/${auditId}/qa/ai`).set('Cookie', otherCookie)).status).toBe(404)
    })

    it('Quality check of the audit by the AI: issues marked as addressed, until the next check', async () => {
      answer = () => JSON.stringify([{finding: findingId, field: 'description', severity: 'warning', message: 'Wording unclear'}, {finding: findingId, field: 'remediation', severity: 'info', message: 'Add a reference'}])
      expect((await finish(request(app).post(`/api/audits/${auditId}/qa/ai`).set('Cookie', userCookie))).status).toBe(200)
      var getQa = async () => (await request(app).get(`/api/audits/${auditId}/qa`).set('Cookie', userCookie)).body.datas
      var address = (fingerprint, addressed, cookie = userCookie) => request(app).put(`/api/audits/${auditId}/qa/ai/addressed`).set('Cookie', cookie).send({fingerprint, addressed})
      var qa = await getQa()
      var issue = qa.issues.find(item => item.params && item.params.message === 'Wording unclear')
      expect(qa.addressed).toEqual([])
      var response = await address(issue.fingerprint, true)
      expect(response.status).toBe(200)
      expect((await address(issue.fingerprint, true)).status).toBe(200) // Once
      qa = await getQa()
      expect(qa.issues.map(item => item.fingerprint)).not.toContain(issue.fingerprint) // Not counted any more
      expect(qa.addressed).toEqual([{...issue, addressed: {at: expect.any(String), by: expect.any(String)}}])
      expect(qa.addressed[0].addressed.by.length).toBeGreaterThan(0)
      // No longer addressed
      expect((await address(issue.fingerprint, false)).status).toBe(200)
      qa = await getQa()
      expect(qa.addressed).toEqual([])
      expect(qa.issues.map(item => item.fingerprint)).toContain(issue.fingerprint)
      // Refused: invalid parameters, issue not in the last check by the AI, user without write access
      for (var body of [{}, {fingerprint: issue.fingerprint}, {fingerprint: issue.fingerprint, addressed: 'yes'}, {fingerprint: {$ne: ''}, addressed: true}])
        expect((await request(app).put(`/api/audits/${auditId}/qa/ai/addressed`).set('Cookie', userCookie).send(body)).status).toBe(422)
      expect((await address('a'.repeat(20), true)).status).toBe(404)
      expect((await address(issue.fingerprint, true, otherCookie)).status).toBe(404)
      // A new check by the AI starts again without the issues addressed
      expect((await address(issue.fingerprint, true)).status).toBe(200)
      expect((await finish(request(app).post(`/api/audits/${auditId}/qa/ai`).set('Cookie', userCookie))).status).toBe(200)
      qa = await getQa()
      expect(qa.addressed).toEqual([])
      expect(qa.issues.map(item => item.fingerprint)).toContain(issue.fingerprint)
    })

    it('Answers the errors of the AI server', async () => {
      expect((await setAi({private: {url: 'http://127.0.0.1:1/v1'}})).status).toBe(200)
      var response = await assist({action: 'correct', html: '<p>x</p>'})
      expect(response.status).toBe(502)
      expect(response.body.datas).toBe('The AI server is not available')
      // Errors known before sending: answered at once (no job)
      response = await request(app).post('/api/ai/assist').set('Cookie', userCookie).send({action: 'correct', html: '<p>x</p>', auditId: 'deadbeefdeadbeefdeadbeef'})
      expect(response.status).toBe(404)
    })

    it('Runs the requests to the AI in the background: job of the user only, answered at once', async () => {
      expect((await setAi({private: {url: `http://127.0.0.1:${port}/v1`}})).status).toBe(200)
      var slow = null
      answer = () => new Promise(resolve => { slow = resolve }) // Answer of the AI given by the test
      var started = await request(app).post('/api/ai/assist').set('Cookie', userCookie).send({action: 'correct', html: '<p>wait</p>'})
      expect(started.status).toBe(202)
      var job = started.body.datas.job
      var poll = (cookie = userCookie, id = job) => request(app).get(`/api/ai/jobs/${id}`).set('Cookie', cookie)
      expect((await poll()).body.datas).toEqual({state: 'running'})
      expect((await poll(otherCookie)).status).toBe(404) // Job of another user
      expect((await poll(userCookie, 'f'.repeat(32))).status).toBe(404)
      expect((await request(app).get(`/api/ai/jobs/${job}`)).status).toBe(401)
      while (!slow) await new Promise(resolve => setTimeout(resolve, 10))
      slow('<p>WAITED</p>')
      var response = await finish(Promise.resolve(started))
      expect(response.body.datas).toEqual({html: '<p>WAITED</p>', missing: 0})
      expect((await poll()).body.datas).toEqual({state: 'done', result: {html: '<p>WAITED</p>', missing: 0}}) // Kept for a while
    })
  })
}
