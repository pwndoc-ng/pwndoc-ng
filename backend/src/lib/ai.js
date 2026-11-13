// AI assistance (disabled by default): inference server of the local network designated in the settings, exposing the
// chat completions API of OpenAI (GET <url>/models, POST <url>/chat/completions, not streamed): OpenAI, and local servers
// (Ollama, vLLM, SGLang, LM Studio, LocalAI, tensorfold...). Variants: max_tokens or max_completion_tokens, models refusing
// the system role, parameters added to the requests (reasoning of the model: names depending on the server).
// Reasoning models: the reasoning is returned apart (reasoning_content), never used as the answer, and counted in the
// maximum length. Extensions of tensorfold handled: error beside the answer (reasoning_loop), codes of the waits (503).
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

// Writing guidelines of the company (settings): one per line. Text of the settings saved before (one string, lines
// separated by line breaks) accepted
function guidelineLines(value) {
    var list = Array.isArray(value) ? value : [value];
    return list.flatMap(item => String(item === undefined || item === null ? '' : item).split(/\r?\n/))
        .map(line => line.trim()).filter(Boolean);
}

// Writing guidelines given to the model: numbered, in the user message before the text (followed better than at the end
// of the system message: tested with a local model, the guidelines changing the wording were ignored when the action
// asked to keep it). Empty without guidelines
function guidelinesText(guidelines) {
    var lines = guidelineLines(guidelines);
    return lines.length ? `Writing guidelines of the company (mandatory):\n${lines.map((line, index) => `${index + 1}. ${line}`).join('\n')}\n\n` : '';
}

var GUIDELINES_RULE = ' The writing guidelines of the company given with the instruction are mandatory: apply each of them, even ' +
    'when the instruction asks to keep the wording.';

// Prompt of an action: {system, user}
function buildPrompt({action, html, instruction, guidelines}) {
    var task = action === 'custom' ? String(instruction || '').trim() : ACTIONS[action];
    var rules = guidelinesText(guidelines);
    return {
        system: rules ? SYSTEM + GUIDELINES_RULE : SYSTEM,
        user: `Instruction: ${task}\n\n${rules}HTML fragment:\n${html}`
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

// Parameters added to the requests to a server compatible with OpenAI: JSON object of the settings, mainly to set the
// reasoning of the model, whose parameters differ between the servers ({"chat_template_kwargs": {"enable_thinking":
// false}}, {"reasoning_effort": "low"}...). The messages and the streaming stay those of pwndoc. Invalid: null
function parseExtraParameters(text) {
    if (!String(text || '').trim()) return {};
    var value;
    try {
        value = JSON.parse(text);
    }
    catch (err) {
        return null;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    var result = {...value};
    delete result.messages;
    delete result.stream;
    return result;
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

var sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Seconds to wait announced by the server (Retry-After in seconds), null when not given
function retryAfter(response) {
    var value = response.headers && typeof response.headers.get === 'function' ? response.headers.get('retry-after') : null;
    return value !== null && value !== undefined && /^\d+$/.test(String(value).trim()) ? Number(value) : null;
}

// Error of an answer of the server (OpenAI shape: {error: {message, type, code}}). The refusals of the request (4xx: invalid
// parameter, context too long) give the message of the server, the other errors only their status and code
async function answerError(response) {
    var body = null;
    try {
        body = await response.json();
    }
    catch (err) {}
    var error = body && typeof body.error === 'object' && body.error ? body.error : {};
    var code = typeof error.code === 'string' && /^[a-z0-9_]{1,50}$/i.test(error.code) ? ` (${error.code})` : '';
    if (response.status === 401 || response.status === 403)
        return aiError(`The AI server answered ${response.status}${code}: check the API key (environment variable AI_API_KEY)`);
    if (response.status === 404)
        return aiError('The AI server answered 404: check the address of the server (usually ending with /v1) and the model');
    var message = typeof error.message === 'string' ? error.message.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().substring(0, 300) : '';
    if (response.status >= 400 && response.status < 500 && message)
        return aiError(`The AI server refused the request${code}: ${message}`);
    return aiError(`The AI server answered ${response.status}${code}`);
}

// Request to the inference server: JSON answer. Waits announced by the server (503 or 429 with Retry-After: model loading,
// restart, limit of requests) waited then retried, within the timeout
async function request(url, options, timeout, fetchImpl) {
    var deadline = Date.now() + timeout * 1000;
    for (var attempt = 1; ; attempt++) {
        var response;
        try {
            response = await fetchImpl(url, {...options, headers: headers(), signal: AbortSignal.timeout(Math.max(deadline - Date.now(), 1000))});
        }
        catch (err) {
            throw aiError(err && err.name === 'TimeoutError' ? 'The AI server did not answer in time' : 'The AI server is not available');
        }
        if (!response.ok) {
            var wait = retryAfter(response);
            if ([429, 503].includes(response.status) && wait !== null && attempt < 4 && Date.now() + wait * 1000 + 1000 < deadline) {
                await sleep(wait * 1000);
                continue;
            }
            throw await answerError(response);
        }
        try {
            return await response.json();
        }
        catch (err) {
            throw aiError('Invalid answer of the AI server');
        }
    }
}

// Text generated by the model for a prompt ({system, user}), with the settings of the AI (settings.ai.private)
async function generate(config, prompt, fetchImpl = fetch) {
    return (await complete(config, prompt, fetchImpl)).text;
}

// Answer of the model for a prompt: {text, reasoningTokens (tokens of the reasoning of the model, null when not given)}
async function complete(config, prompt, fetchImpl = fetch) {
    var url = baseUrl(config.url);
    if (!/^https?:\/\//i.test(url))
        throw aiError('The address of the AI server is not configured', 422);
    var timeout = config.timeout || 120;
    var messages = config.systemRole === false ?
        [{role: 'user', content: `${prompt.system}\n\n${prompt.user}`}] :
        [{role: 'system', content: prompt.system}, {role: 'user', content: prompt.user}];
    var extra = parseExtraParameters(config.extraParameters);
    if (!extra)
        throw aiError('Invalid additional parameters of the requests (JSON object expected)', 422);
    var body = {temperature: 0.2, ...extra, messages: messages, stream: false};
    if (config.model) body.model = config.model;
    body[config.tokenParameter === 'max_completion_tokens' ? 'max_completion_tokens' : 'max_tokens'] = config.maxTokens || 2000;
    var result = await request(`${url}/chat/completions`, {method: 'POST', body: JSON.stringify(body)}, timeout, fetchImpl);
    var content = valueAt(result, 'choices.0.message.content');
    if (Array.isArray(content)) content = content.map(part => part && part.text).filter(Boolean).join('');
    if (typeof content !== 'string' || !content.trim()) {
        var finish = valueAt(result, 'choices.0.finish_reason');
        // Reasoning models: the reasoning can use all the maximum length, without answer
        if (finish === 'length')
            throw aiError('Maximum length reached before the answer of the AI (reasoning of the model included): increase the maximum length or limit the reasoning in the settings');
        // Reasoning repeating itself, stopped by the server (tensorfold: error reasoning_loop)
        if (valueAt(result, 'error.code') === 'reasoning_loop')
            throw aiError('The reasoning of the model looped and was stopped by the AI server: retry, or limit the reasoning in the settings');
        if (finish === 'content_filter')
            throw aiError('The AI server stopped the answer (content filter)');
        throw aiError('No text in the answer of the AI server');
    }
    var reasoningTokens = valueAt(result, 'usage.completion_tokens_details.reasoning_tokens');
    return {text: content, reasoningTokens: typeof reasoningTokens === 'number' ? reasoningTokens : null};
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

var FIELD_MAX = 20000; // Characters of a field sent for the quality check by the AI

var ENTITIES = {nbsp: '\u00a0', lt: '<', gt: '>', quot: '"', amp: '&', apos: "'"};
var decodeEntities = (text) => text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (code[0] !== '#') return ENTITIES[code.toLowerCase()] !== undefined ? ENTITIES[code.toLowerCase()] : match;
    var number = /^#x/i.test(code) ? parseInt(code.substring(2), 16) : parseInt(code.substring(1), 10);
    return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : match;
});

var BLOCKS = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'blockquote', 'div', 'tr', 'table', 'legend', 'figure'];

// Text of an HTML field for the quality check by the AI, as shown by the editor: one line per paragraph, heading, list item
// (with its marker) or table cell, "[empty line]" for an empty paragraph, "[image N: caption]" for an image (never sent),
// inline tags (bold, highlight, links...) removed without adding spaces (the model reads the text of the editor, not
// words cut by the tags). Long fields shortened, ending with "[truncated]". markers false: text only, as searched in the
// editor (passages of the issues)
function fieldText(html, {max = FIELD_MAX, markers = true} = {}) {
    var lines = [], current = null, prefix = '', lists = [], images = [], pre = false;
    var withImage = false; // Image in the paragraph (older contents): not an empty paragraph
    var start = () => {
        if (current === null) {
            current = prefix;
            prefix = '';
        }
    };
    var end = (paragraph) => {
        if (current !== null && current.trim())
            lines.push(pre ? current : current.replace(/[ \t]+$/, ''));
        else if (paragraph && markers)
            lines.push('[empty line]');
        current = null;
    };
    (String(html || '').match(/<[^>]*>|[^<]+/g) || []).forEach(token => {
        var tag = token.match(/^<(\/?)([a-z][a-z0-9]*)\b([^>]*)>$/i);
        if (!tag) { // Text (whitespace between blocks ignored)
            if (current === null && !token.trim()) return;
            start();
            current += decodeEntities(pre ? token : token.replace(/[\r\n\t]+/g, ' '));
            return;
        }
        var closing = tag[1] === '/', name = tag[2].toLowerCase();
        if (name === 'img') {
            end(false);
            var alt = decodeEntities((tag[3].match(/\salt\s*=\s*"([^"]*)"/i) || [])[1] || '').trim();
            var src = (tag[3].match(/\ssrc\s*=\s*"([^"]*)"/i) || [])[1] || '';
            images.push({src, alt});
            withImage = true;
            if (markers) lines.push(`[image ${images.length}${alt ? `: ${alt}` : ''}]`);
        }
        else if (name === 'br') {
            start();
            current += '\n';
        }
        else if (name === 'ul' || name === 'ol') {
            end(false);
            if (closing) lists.pop();
            else lists.push({ordered: name === 'ol', count: 0});
        }
        else if (name === 'li') {
            end(false);
            prefix = '';
            if (!closing && markers) {
                var list = lists[lists.length - 1] || {ordered: false, count: 0};
                list.count++;
                prefix = '  '.repeat(Math.max(lists.length - 1, 0)) + (list.ordered ? `${list.count}. ` : '- ');
            }
        }
        else if (name === 'td' || name === 'th') {
            if (!closing) {
                end(false);
                start();
            }
        }
        else if (BLOCKS.includes(name)) {
            if (name === 'pre') pre = !closing;
            if (closing) end(name === 'p' && !withImage);
            else {
                end(false);
                start();
                withImage = false;
            }
        }
        // Inline tags (strong, em, u, s, mark, a, code, span...): removed
    });
    end(false);
    var text = lines.join('\n');
    return {text: text.length > max ? `${text.substring(0, max)}\n[truncated]` : text, images};
}

// Instruction of the quality check by the AI, with the check of each writing guideline of the company when there are some
function qaInstruction(withGuidelines) {
    return 'Review these findings of a penetration testing report, each given as <finding id="..."> with its fields. The ' +
        'text of the fields is shown as in the editor: one line per paragraph or list item, [empty line] for an empty ' +
        'paragraph, [image N: caption] for an image, [truncated] at the end of a field shortened (its end is not ' +
        'incomplete). Report only real problems: severity (CVSS vector) not ' +
        'matching the description, remediation not addressing the vulnerability, contradictions, unclear or unprofessional ' +
        'wording' + (withGuidelines ? ', and every passage not respecting one of the writing guidelines of the company below ' +
        '(check each guideline on each field; one issue per guideline not respected, giving its number in the message)' : '') +
        '. Answer only with a JSON array, without code fence, of objects {"finding": "<id of the finding>", "field": "title" | ' +
        '"description" | "observation" | "remediation" | "cvss", "severity": "warning" | "info", "message": "<short ' +
        'explanation in the language of the findings>", "quote": "<passage of the field concerned, copied word for word from ' +
        'one line of it, 3 to 15 words, without the markers in brackets; for a problem of an image or of the lines around ' +
        'it, the marker of the image, like [image 2]; empty for the title and the CVSS>"}. Answer [] when there is nothing to ' +
        'report. Keep the tokens written like [[TERM_1]] unchanged.';
}

// Finding sent for the quality check by the AI: its fields as in the editor
function qaFindingText(finding) {
    var field = (name) => `<${name}>\n${fieldText(finding[name]).text}\n</${name}>`;
    return `<finding id="${String(finding._id)}">\n<title>${String(finding.title || '').trim()}</title>\n<cvss>${String(finding.cvssv3 || '')}</cvss>\n` +
        `${['description', 'observation', 'remediation'].map(field).join('\n')}\n</finding>`;
}

// Prompt of the quality check of findings (text of the findings): {system, user}
function qaPrompt(findingsText, guidelines) {
    var rules = guidelinesText(guidelines);
    return {
        system: 'You are an assistant reviewing the findings of a penetration testing report.' + (rules ? ' The writing guidelines of the company are mandatory.' : ''),
        user: `Instruction: ${qaInstruction(!!rules)}\n\n${rules}Findings:\n${findingsText}`
    };
}
var QA_FIELDS = ['title', 'description', 'observation', 'remediation', 'cvss'];

// Text compared to find a passage: whitespace and case ignored
var sameText = (text) => String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();

// Passage of a field shown when an issue of the AI is opened: an image quoted by its marker ([image 2]), or a text really in
// the field (copied word for word, searched like in the editor). null otherwise
function issuePassage(finding, field, quote) {
    if (!['description', 'observation', 'remediation'].includes(field)) return null;
    var text = String(quote || '').replace(/\s+/g, ' ').trim().substring(0, 300);
    var image = text.match(/^\[image (\d+)\b/i);
    if (image) {
        var found = fieldText(finding[field], {max: Infinity}).images[Number(image[1]) - 1];
        return found ? {image: {src: require('./qa').imageAnchorKey(found.src), alt: found.alt}} : null;
    }
    return text && sameText(fieldText(finding[field], {max: Infinity, markers: false}).text).includes(sameText(text)) ? {text} : null;
}

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
            var passage = issuePassage(finding, field, typeof item.quote === 'string' ? hider.restore(item.quote) : '');
            var fingerprint = require('crypto').createHash('sha1').update(['ai', String(finding._id), field || '', message].join('\u0000')).digest('hex').substring(0, 20);
            return {fingerprint, check: 'ai', severity: item.severity === 'info' ? 'info' : 'warning', code: 'ai', params: {message},
                location: {kind: 'finding', id: String(finding._id), name: finding.title || '', field: field, label: null, passage: passage}};
        });
}

// Quality check of the findings of an audit by the AI: issues {fingerprint, check 'ai', severity, code 'ai', params
// {message}, location}. Findings sent by batches (size of the requests)
async function qaIssues(config, audit, {terms = []} = {}, fetchImpl = fetch) {
    var hider = pseudonymizer(config.pseudonymize ? terms : []);
    var findings = audit.findings || [];
    var batches = [], batch = [], size = 0;
    findings.forEach(finding => {
        var text = qaFindingText(finding);
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
        var prompt = qaPrompt(hider.hide(items.join('\n\n')), config.guidelines);
        issues.push(...qaAnswerIssues(await generate(config, prompt, fetchImpl), findings, hider));
    }
    return issues;
}

// Test of the connection: models of the server, then a short answer
async function testConnection(config, fetchImpl = fetch) {
    var url = baseUrl(config.url);
    if (!/^https?:\/\//i.test(url))
        throw aiError('The address of the AI server is not configured', 422);
    var result = {models: [], answer: ''};
    var timeout = Math.min(config.timeout || 120, 30);
    try {
        var models = await request(`${url}/models`, {method: 'GET'}, timeout, fetchImpl);
        result.models = (models.data || models.models || []).map(model => model.id || model.name).filter(Boolean);
    }
    catch (err) {
        result.models = null; // Not listed by this server: the answer is checked anyway
    }
    // Short answer, with the tokens of the reasoning of the model and the time taken (to set the reasoning, the maximum
    // length and the timeout)
    var started = Date.now();
    var answer = await complete(config, {system: 'Answer with the single word OK.', user: 'Test of the connection.'}, fetchImpl);
    result.answer = answer.text.trim().substring(0, 200);
    result.reasoningTokens = answer.reasoningTokens;
    result.seconds = Math.round((Date.now() - started) / 100) / 10;
    return result;
}

module.exports = {ACTIONS, MAX_TEXT, parseExtraParameters, guidelineLines, htmlForModel, answerHtml, pseudonymizer, auditTerms, buildPrompt, qaPrompt, fieldText, valueAt, generate, complete, assist, qaIssues, qaAnswerIssues, testConnection};
