// AI assistance (disabled by default): inference server of the local network designated in the settings.
// - provider 'openai': API compatible with OpenAI (POST <url>/chat/completions): OpenAI, and local servers exposing it
//   (Ollama, vLLM, LM Studio, LocalAI...). Variants: max_tokens or max_completion_tokens, models refusing the system role
// - provider 'tfserving': TensorFlow Serving (POST <url>/v1/models/<model>:predict): body built from a JSON template
//   ({{prompt}}, {{maxTokens}}, {{model}}), text read in the answer at a path (e.g. predictions.0)
// The API key is the environment variable AI_API_KEY (header Authorization: Bearer <key>, or AI_AUTH_HEADER: <key>): never
// stored, never sent to the browser. Certificate authority of the local network: NODE_EXTRA_CA_CERTS (Node.js).
// Images are never sent; the client, company and scope names can be replaced by tokens before sending (pseudonymization).
// The answers are proposals, sanitized by the browser before insertion: never applied automatically.

var MAX_TEXT = 60000; // Characters of HTML sent at once
var MAX_ANSWER = 200000; // Characters of an answer kept

// Actions of the assisted writing: instruction given to the model
var ACTIONS = {
    correct: 'Correct the spelling, grammar and punctuation of the text. Keep its meaning, its language, its wording and its formatting.',
    rephrase: 'Rephrase the text to make it clearer and more professional, for a penetration testing report. Keep its meaning, its language and the technical details.',
    shorten: 'Make the text shorter and more concise, keeping the important technical details, in the same language.',
    translateFr: 'Translate the text into French. Keep the technical terms usually written in English.',
    translateEn: 'Translate the text into English.',
    fromNotes: 'Write a clear paragraph for a penetration testing report from these notes, in the language of the notes.',
    custom: null // Instruction of the user
};

var SYSTEM = 'You are an assistant helping a penetration tester write a security audit report. ' +
    'You receive an HTML fragment of an editor and an instruction. Answer only with the resulting HTML fragment, without ' +
    'explanation and without code fence. Use only these tags: p, br, strong, em, u, s, code, pre, ul, ol, li, h1 to h6, a, ' +
    'table, thead, tbody, tr, th, td. Never add scripts, styles or attributes other than href. Keep the tokens written ' +
    'like [[TERM_1]] unchanged.';

// HTML sent to the model: images removed (never sent), attributes removed except href
function htmlForModel(html) {
    return String(html || '')
        .replace(/<img\b[^>]*>/gi, '')
        .replace(/<legend\b[^>]*>[\s\S]*?<\/legend>/gi, '')
        .replace(/<(\w+)\b([^>]*)>/g, (match, tag, attributes) => {
            var href = attributes.match(/\shref\s*=\s*"([^"]*)"/i);
            return href && tag.toLowerCase() === 'a' ? `<a href="${href[1]}">` : `<${tag}>`;
        })
        .trim();
}

// Answer of the model: code fence and text around the HTML removed, length limited
function answerHtml(text) {
    var answer = String(text || '').trim();
    var fence = answer.match(/^```[a-z]*\s*\n?([\s\S]*?)\n?```$/i);
    if (fence)
        answer = fence[1].trim();
    if (answer && !/^</.test(answer)) // Plain text: paragraphs
        answer = answer.split(/\n{2,}/).map(paragraph => `<p>${paragraph.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</p>`).join('');
    return answer.substring(0, MAX_ANSWER);
}

// Pseudonymization: terms (names of the client, company, scope) replaced by tokens before sending, restored in the answer
function pseudonymizer(terms) {
    var list = [...new Set((terms || []).map(term => String(term || '').trim()).filter(term => term.length >= 3))]
        .sort((a, b) => b.length - a.length);
    var escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return {
        hide: (text) => list.reduce((result, term, index) => result.replace(new RegExp(escape(term), 'gi'), `[[TERM_${index + 1}]]`), text),
        restore: (text) => text.replace(/\[\[TERM_(\d+)\]\]/g, (match, index) => list[Number(index) - 1] !== undefined ? list[Number(index) - 1] : match)
    };
}

// Terms of an audit to hide: company, client, scope (hosts, IP)
function auditTerms(audit) {
    if (!audit) return [];
    var company = audit.company || {};
    var client = audit.client || {};
    var scope = (audit.scope || []).flatMap(item => [item.name, ...(item.hosts || []).flatMap(host => [host.hostname, host.ip])]);
    return [company.name, company.shortName, client.firstname && client.lastname ? `${client.firstname} ${client.lastname}` : null,
        client.lastname, client.email, ...scope];
}

// Prompt of an action: {system, user}
function buildPrompt({action, html, instruction, guidelines}) {
    var task = action === 'custom' ? String(instruction || '').trim() : ACTIONS[action];
    var rules = String(guidelines || '').trim();
    return {
        system: rules ? `${SYSTEM}\nWriting guidelines of the company:\n${rules}` : SYSTEM,
        user: `Instruction: ${task}\n\nHTML fragment:\n${html}`
    };
}

// Error answered by the routes with its status
function aiError(message, status = 502) {
    return {status: status, message: message};
}

// Value at a path of an object: 'predictions.0.text'
function valueAt(object, path) {
    return String(path || '').split('.').filter(key => key !== '').reduce((value, key) => (value === undefined || value === null) ? undefined : value[/^\d+$/.test(key) ? Number(key) : key], object);
}

var baseUrl = (url) => String(url || '').trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, '');

function headers() {
    var result = {'Content-Type': 'application/json', Accept: 'application/json'};
    var key = process.env.AI_API_KEY;
    if (key) {
        if (process.env.AI_AUTH_HEADER) result[process.env.AI_AUTH_HEADER] = key;
        else result.Authorization = `Bearer ${key}`;
    }
    return result;
}

// Request to the inference server: JSON answer, errors of the server reported without their content
async function request(url, options, timeout, fetchImpl) {
    var response;
    try {
        response = await fetchImpl(url, {...options, headers: headers(), signal: AbortSignal.timeout(timeout * 1000)});
    }
    catch (err) {
        throw aiError(err && err.name === 'TimeoutError' ? 'The AI server did not answer in time' : 'The AI server is not available');
    }
    if (!response.ok)
        throw aiError(`The AI server answered ${response.status}`);
    try {
        return await response.json();
    }
    catch (err) {
        throw aiError('Invalid answer of the AI server');
    }
}

// Text generated by the model for a prompt ({system, user}), with the settings of the AI (settings.ai.private)
async function generate(config, prompt, fetchImpl = fetch) {
    var url = baseUrl(config.url);
    if (!/^https?:\/\//i.test(url))
        throw aiError('The address of the AI server is not configured', 422);
    var timeout = config.timeout || 120;
    if (config.provider === 'tfserving') {
        var model = encodeURIComponent(config.model || '');
        var text = `${prompt.system}\n\n${prompt.user}`;
        var bodyText = String(config.tfRequest || '')
            .replace(/\{\{prompt\}\}/g, JSON.stringify(text).slice(1, -1))
            .replace(/\{\{maxTokens\}\}/g, String(config.maxTokens || 2000))
            .replace(/\{\{model\}\}/g, JSON.stringify(String(config.model || '')).slice(1, -1));
        try {
            JSON.parse(bodyText);
        }
        catch (err) {
            throw aiError('Invalid request template of TensorFlow Serving', 422);
        }
        var answer = await request(`${url}/v1/models/${model}:predict`, {method: 'POST', body: bodyText}, timeout, fetchImpl);
        var value = valueAt(answer, config.tfResponsePath);
        if (Array.isArray(value)) value = value[0];
        if (value && typeof value === 'object') value = value.text || value.generated_text || value.output;
        if (typeof value !== 'string')
            throw aiError('No text in the answer of TensorFlow Serving (path of the answer)');
        return value;
    }
    var messages = config.systemRole === false ?
        [{role: 'user', content: `${prompt.system}\n\n${prompt.user}`}] :
        [{role: 'system', content: prompt.system}, {role: 'user', content: prompt.user}];
    var body = {messages: messages, temperature: 0.2, stream: false};
    if (config.model) body.model = config.model;
    body[config.tokenParameter === 'max_completion_tokens' ? 'max_completion_tokens' : 'max_tokens'] = config.maxTokens || 2000;
    var result = await request(`${url}/chat/completions`, {method: 'POST', body: JSON.stringify(body)}, timeout, fetchImpl);
    var content = valueAt(result, 'choices.0.message.content');
    if (Array.isArray(content)) content = content.map(part => part && part.text).filter(Boolean).join('');
    if (typeof content !== 'string')
        throw aiError('No text in the answer of the AI server');
    return content;
}

// Assisted writing: HTML proposed for an action on an HTML fragment. context: {terms (pseudonymization)}
async function assist(config, {action, html, instruction}, {terms = []} = {}, fetchImpl = fetch) {
    var sent = htmlForModel(html);
    if (!sent.replace(/<[^>]*>/g, '').trim()) // No text (images only)
        throw aiError('Nothing to send to the AI', 422);
    if (sent.length > MAX_TEXT)
        throw aiError(`Text too long for the AI: ${MAX_TEXT} characters at most`, 413);
    var hider = pseudonymizer(config.pseudonymize ? terms : []);
    var prompt = buildPrompt({action, html: hider.hide(sent), instruction, guidelines: config.guidelines});
    var answer = await generate(config, prompt, fetchImpl);
    return {html: hider.restore(answerHtml(answer))};
}

// Text of an HTML value for the quality check by the AI (images and tags removed), limited
var plainText = (html, max = 3000) => String(html || '').replace(/<img\b[^>]*>/gi, ' ').replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim().substring(0, max);

var QA_INSTRUCTION = 'Review these findings of a penetration testing report. Report only real problems: severity (CVSS ' +
    'vector) not matching the description, remediation not addressing the vulnerability, contradictions, unclear or ' +
    'unprofessional wording, writing guidelines not respected. Answer only with a JSON array, without code fence, of ' +
    'objects {"finding": "<id of the finding>", "field": "title" | "description" | "observation" | "remediation" | "cvss", ' +
    '"severity": "warning" | "info", "message": "<short explanation in the language of the findings>"}. Answer [] when ' +
    'there is nothing to report. Keep the tokens written like [[TERM_1]] unchanged.';
var QA_FIELDS = ['title', 'description', 'observation', 'remediation', 'cvss'];

// Issues of the JSON answer of the model (array found in the text), for the findings of the audit
function qaAnswerIssues(text, findings, hider) {
    var start = text.indexOf('['), end = text.lastIndexOf(']');
    if (start === -1 || end <= start)
        throw aiError('Invalid answer of the AI for the quality check');
    var list;
    try {
        list = JSON.parse(text.substring(start, end + 1));
    }
    catch (err) {
        throw aiError('Invalid answer of the AI for the quality check');
    }
    var byId = new Map(findings.map(finding => [String(finding._id), finding]));
    return (Array.isArray(list) ? list : []).filter(item => item && typeof item.message === 'string' && item.message.trim() && byId.has(String(item.finding)))
        .map(item => {
            var finding = byId.get(String(item.finding));
            var message = hider.restore(item.message.trim()).substring(0, 1000);
            var field = QA_FIELDS.includes(item.field) ? item.field : null;
            var fingerprint = require('crypto').createHash('sha1').update(['ai', String(finding._id), field || '', message].join('\u0000')).digest('hex').substring(0, 20);
            return {fingerprint, check: 'ai', severity: item.severity === 'info' ? 'info' : 'warning', code: 'ai', params: {message},
                location: {kind: 'finding', id: String(finding._id), name: finding.title || '', field: field, label: null}};
        });
}

// Quality check of the findings of an audit by the AI: issues {fingerprint, check 'ai', severity, code 'ai', params
// {message}, location}. Findings sent by batches (size of the requests)
async function qaIssues(config, audit, {terms = []} = {}, fetchImpl = fetch) {
    var hider = pseudonymizer(config.pseudonymize ? terms : []);
    var findings = audit.findings || [];
    var batches = [], batch = [], size = 0;
    findings.forEach(finding => {
        var text = JSON.stringify({id: String(finding._id), title: finding.title || '', cvss: finding.cvssv3 || '',
            description: plainText(finding.description), observation: plainText(finding.observation), remediation: plainText(finding.remediation)});
        if (batch.length && size + text.length > MAX_TEXT) {
            batches.push(batch);
            batch = [];
            size = 0;
        }
        batch.push(text);
        size += text.length;
    });
    if (batch.length) batches.push(batch);
    var issues = [];
    for (var items of batches) {
        var prompt = buildPrompt({action: 'custom', instruction: QA_INSTRUCTION, html: hider.hide(`[${items.join(',\n')}]`), guidelines: config.guidelines});
        prompt.user = prompt.user.replace('HTML fragment:', 'Findings (JSON):');
        prompt.system = prompt.system.replace(/Answer only with the resulting HTML fragment[^.]*\.|Use only these tags[^.]*\.|Never add scripts[^.]*\./g, '').replace(/\s+/g, ' ').trim();
        issues.push(...qaAnswerIssues(await generate(config, prompt, fetchImpl), findings, hider));
    }
    return issues;
}

// Test of the connection: models of the server (OpenAI) or status of the model (TensorFlow Serving), then a short answer
async function testConnection(config, fetchImpl = fetch) {
    var url = baseUrl(config.url);
    if (!/^https?:\/\//i.test(url))
        throw aiError('The address of the AI server is not configured', 422);
    var result = {provider: config.provider || 'openai', models: [], answer: ''};
    var timeout = Math.min(config.timeout || 120, 30);
    try {
        if (result.provider === 'tfserving') {
            var status = await request(`${url}/v1/models/${encodeURIComponent(config.model || '')}`, {method: 'GET'}, timeout, fetchImpl);
            result.models = (status.model_version_status || []).map(version => `${config.model} v${version.version} (${version.state})`);
        }
        else {
            var models = await request(`${url}/models`, {method: 'GET'}, timeout, fetchImpl);
            result.models = (models.data || models.models || []).map(model => model.id || model.name).filter(Boolean);
        }
    }
    catch (err) {
        result.models = null; // Not listed by this server: the answer is checked anyway
    }
    var answer = await generate(config, {system: 'Answer with the single word OK.', user: 'Test of the connection.'}, fetchImpl);
    result.answer = answer.trim().substring(0, 200);
    return result;
}

module.exports = {ACTIONS, MAX_TEXT, htmlForModel, answerHtml, pseudonymizer, auditTerms, buildPrompt, valueAt, generate, assist, qaIssues, qaAnswerIssues, testConnection};
