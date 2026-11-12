// Quality checks of the audits and of the vulnerability database, without AI and without any network request (the links
// are never followed: references of the reports contain payloads, IDOR...). Pure functions: the data is read by the routes.
//
// Issue: {fingerprint, check, severity ('error' | 'warning' | 'info'), code (message of the frontend, qa.codes.<code>),
//   params (values of the message), location: {kind ('general' | 'finding' | 'section' | 'vulnerability'), id, name, field,
//   label, passage}}. passage (optional): part of the field shown when the issue is opened, {text} or {image: {src, alt}}.
//   The fingerprint identifies the issue and its content: an issue ignored by the users comes back when its content
//   changes.
var crypto = require('crypto');
var highlights = require('./highlights');

var CHECKS = ['completeness', 'comments', 'internalLinks', 'images', 'references', 'duplicates'];
var FINDING_FIELDS = ['description', 'observation', 'remediation', 'poc', 'scope'];
var SEVERITIES = {error: 0, warning: 1, info: 2};
var SIMILAR_TITLES = 0.9; // Similarity of two titles (bigrams, 0 to 1) from which they are reported as similar

// Checks enabled in the settings (all by default)
function enabledChecks(settings) {
    var checks = (settings && settings.qa && settings.qa.public && settings.qa.public.checks) || {};
    return CHECKS.filter(check => checks[check] !== false);
}

function issue(check, severity, code, location, params = {}, detail = '') {
    var fingerprint = crypto.createHash('sha1')
        .update([check, code, location.kind, location.id || '', location.field || '', detail].join('\u0000'))
        .digest('hex').substring(0, 20);
    return {fingerprint, check, severity, code, params, location};
}

var unescape = (value) => value.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// Text of an HTML value (images count as content)
function textOf(html) {
    if (typeof html !== 'string')
        return '';
    return unescape(html.replace(/<img\b[^>]*>/gi, ' [image] ').replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ')).replace(/\s+/g, ' ').trim();
}

// Anchor of an image of the editors (same as the frontend, comment-highlight.js): its source, a hash for long sources
function imageAnchorKey(src) {
    if (typeof src !== 'string') return '';
    if (src.length <= 200) return src;
    var hash = 0x811c9dc5;
    for (var i = 0; i < src.length; i++) {
        hash ^= src.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return `hash:${src.length}:${hash.toString(16)}`;
}

// Images of the editors in an HTML value: [{src, alt}]
function imagesIn(html) {
    if (typeof html !== 'string' || !html.includes('<img'))
        return [];
    return [...html.matchAll(/<img\b[^>]*>/gi)].map(match => {
        var attribute = (name) => {
            var value = match[0].match(new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, 'i'));
            return value ? unescape(value[1]) : null;
        };
        return {src: attribute('src') || '', alt: attribute('alt')};
    });
}

// Caption left as given at the upload: file name (IMG_1234.png, Capture d'écran...) or default caption of the editor
var FILE_NAME = /\.(png|jpe?g|gif|bmp|webp|svg|tiff?|heic)$/i;
var DEFAULT_CAPTION = /^(img|dsc|image|screenshot|capture d['’]écran|capture|screen shot|external image)([\s_\-.]?\d|$)/i;
var isFileNameCaption = (caption) => FILE_NAME.test(caption.trim()) || DEFAULT_CAPTION.test(caption.trim());

// Targets of the internal links (link to a finding, inserted with ":::"): ids of the findings
function internalLinksIn(html) {
    if (typeof html !== 'string' || !html.includes('href'))
        return [];
    return [...html.matchAll(/<a\b[^>]*\shref\s*=\s*"#([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)]
        .map(match => ({target: unescape(match[1]), text: textOf(match[2])}));
}

// Reference that cannot be a valid link: written as an address (scheme or www.) but not a valid http(s) URL. Plain text
// references (CWE-89, OWASP A03...) are not links. Checked offline: the link is never requested
function invalidReference(reference) {
    var value = reference.trim();
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value) && !/^www\./i.test(value))
        return false;
    try {
        var url = new URL(/^www\./i.test(value) ? `https://${value}` : value);
        return !['http:', 'https:'].includes(url.protocol) || !url.hostname.includes('.') || /\s/.test(value);
    }
    catch (err) {
        return true;
    }
}

// Images and references of the HTML fields of a place (finding, section, vulnerability)
function contentIssues(checks, location, fields, references, existingImages) {
    var issues = [];
    if (checks.includes('images')) {
        fields.forEach(({field, label, html}) => imagesIn(html).forEach(image => {
            var at = {...location, field, label: label || null, passage: {image: {src: imageAnchorKey(image.src), alt: image.alt || ''}}};
            var caption = (image.alt || '').trim();
            if (/^[a-f0-9]{24}$/i.test(image.src) && existingImages && !existingImages.has(image.src.toLowerCase()))
                issues.push(issue('images', 'error', 'imageMissing', at, {caption}, image.src));
            if (!caption)
                issues.push(issue('images', 'warning', 'captionEmpty', at, {}, image.src));
            else if (isFileNameCaption(caption))
                issues.push(issue('images', 'warning', 'captionFileName', at, {caption}, `${image.src}\u0000${caption}`));
        }));
    }
    if (checks.includes('references')) {
        (references || []).forEach(reference => {
            var at = {...location, field: 'references', label: null};
            if (typeof reference !== 'string' || !reference.trim())
                issues.push(issue('references', 'warning', 'referenceEmpty', at));
            else if (invalidReference(reference))
                issues.push(issue('references', 'warning', 'referenceInvalid', {...at, passage: {text: reference.trim()}}, {reference: reference.trim()}, reference.trim()));
        });
    }
    return issues;
}

// HTML fields of the custom fields (editors): [{field, label, html}]
var customHtmlFields = (customFields) => (customFields || [])
    .filter(entry => entry && entry.customField && typeof entry.customField === 'object' && (!entry.customField.fieldType || entry.customField.fieldType === 'text'))
    .map(entry => ({field: `customFields.${entry.customField._id}`, label: entry.customField.label, html: entry.text}));

// Issues of an audit (custom fields populated: label and type). context: {settings, comments (review comments of the
// audit), existingImages (Set of the ids of the images found among those of the audit)}
function auditIssues(audit, {settings, comments = [], existingImages} = {}) {
    var checks = enabledChecks(settings);
    var issues = [];
    var findings = audit.findings || [];
    var findingIds = new Set(findings.map(finding => String(finding._id)));
    var general = {kind: 'general', id: null, name: audit.name || '', field: null, label: null};

    // Places of the audit and their HTML fields
    var places = [{location: general, fields: [{field: 'summary', html: audit.summary}, ...customHtmlFields(audit.customFields)], references: []}];
    findings.forEach(finding => places.push({
        location: {kind: 'finding', id: String(finding._id), name: finding.title || '', field: null, label: null},
        fields: [...FINDING_FIELDS.map(field => ({field, html: finding[field]})), ...customHtmlFields(finding.customFields)],
        references: finding.references,
        finding
    }));
    (audit.sections || []).forEach(section => places.push({
        location: {kind: 'section', id: String(section._id), name: section.name || '', field: null, label: null},
        fields: [{field: 'text', html: section.text}, ...customHtmlFields(section.customFields)],
        references: [],
        section
    }));

    if (checks.includes('completeness')) {
        if (findings.length === 0)
            issues.push(issue('completeness', 'warning', 'noFindings', general));
        places.forEach(({location, finding, section}) => {
            if (finding) {
                if (!textOf(finding.description))
                    issues.push(issue('completeness', 'error', 'findingNoDescription', {...location, field: 'description'}));
                if (!textOf(finding.remediation))
                    issues.push(issue('completeness', 'warning', 'findingNoRemediation', {...location, field: 'remediation'}));
                if (!finding.cvssv3)
                    issues.push(issue('completeness', 'warning', 'findingNoCvss', {...location, field: 'cvss'}));
                if (finding.status === 1)
                    issues.push(issue('completeness', 'warning', 'findingRedacting', location));
            }
            if (section) {
                var texts = [section.text, ...(section.customFields || []).map(entry => entry && entry.text)];
                if (!texts.some(text => textOf(typeof text === 'string' ? text : '')))
                    issues.push(issue('completeness', 'warning', 'sectionEmpty', location));
            }
        });
    }

    if (checks.includes('internalLinks')) {
        places.forEach(({location, fields}) => fields.forEach(({field, label, html}) => internalLinksIn(html).forEach(link => {
            if (/^[a-f0-9]{24}$/i.test(link.target) && !findingIds.has(link.target.toLowerCase()))
                issues.push(issue('internalLinks', 'error', 'internalLinkBroken', {...location, field, label: label || null, passage: link.text ? {text: link.text} : null}, {text: link.text}, `${link.target}\u0000${link.text}`));
        })));
    }

    places.forEach(({location, fields, references}) => issues.push(...contentIssues(checks, location, fields, references, existingImages)));

    if (checks.includes('comments')) {
        var open = new Map(); // Unresolved review comments by place
        comments.filter(comment => !comment.resolved && comment.target).forEach(comment => {
            var target = comment.target;
            var key = `${target.kind}:${target.findingId || target.sectionId || ''}`;
            open.set(key, {target, count: (open.has(key) ? open.get(key).count : 0) + 1});
        });
        open.forEach(({target, count}) => {
            var id = target.findingId || target.sectionId;
            var place = id && places.find(p => p.location.id === String(id));
            var location = place ? place.location : {...general, kind: ['general', 'network'].includes(target.kind) ? target.kind : 'general'};
            issues.push(issue('comments', 'warning', 'commentsOpen', location, {count}, String(count)));
        });
    }

    // Texts highlighted with the warning colors (setting of the reports)
    var report = settings && settings.report;
    if (report && report.enabled !== false && report.public && report.public.highlightWarning) {
        highlights.auditHighlights(audit, report.public.highlightWarningColors || []).forEach(item => item.texts.forEach(highlight => {
            var location = {kind: item.kind, id: item.id, name: item.name, field: item.field, label: item.label, passage: {text: highlight.text}};
            issues.push(issue('highlights', 'warning', 'highlightedText', location, highlight, `${highlight.color}\u0000${highlight.text}`));
        }));
    }

    return sortIssues(issues);
}

// Similarity of two strings: Dice coefficient of their bigrams (0 to 1)
function similarity(a, b) {
    var bigrams = (text) => {
        var list = new Map();
        for (var i = 0; i < text.length - 1; i++) {
            var bigram = text.substring(i, i + 2);
            list.set(bigram, (list.get(bigram) || 0) + 1);
        }
        return list;
    };
    if (a === b) return 1;
    if (a.length < 2 || b.length < 2) return 0;
    var first = bigrams(a), second = bigrams(b), common = 0;
    first.forEach((count, bigram) => { common += Math.min(count, second.get(bigram) || 0); });
    return (2 * common) / (a.length - 1 + b.length - 1);
}

// Title compared for the duplicates: case, accents and punctuation ignored
var normalizedTitle = (title) => String(title || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Issues of the vulnerability database: duplicated or similar titles (same language), images and references of the
// details. context: {settings, existingImages}
function vulnerabilityIssues(vulnerabilities, {settings, existingImages} = {}) {
    var checks = enabledChecks(settings);
    var issues = [];
    var byLocale = new Map(); // Titles of each language: [{vulnerability, title, normalized}]
    (vulnerabilities || []).forEach(vulnerability => (vulnerability.details || []).forEach(detail => {
        var location = {kind: 'vulnerability', id: String(vulnerability._id), name: detail.title || '', field: null, label: null, locale: detail.locale || ''};
        var fields = [...['description', 'observation', 'remediation'].map(field => ({field, html: detail[field]})), ...customHtmlFields(detail.customFields)];
        issues.push(...contentIssues(checks, location, fields, detail.references, existingImages));
        if (detail.title) {
            if (!byLocale.has(location.locale)) byLocale.set(location.locale, []);
            byLocale.get(location.locale).push({vulnerability, title: detail.title, normalized: normalizedTitle(detail.title), location});
        }
    }));
    if (checks.includes('duplicates')) {
        byLocale.forEach(titles => {
            for (var i = 0; i < titles.length; i++) {
                for (var j = i + 1; j < titles.length; j++) {
                    var [a, b] = [titles[i], titles[j]];
                    if (String(a.vulnerability._id) === String(b.vulnerability._id) || !a.normalized || !b.normalized)
                        continue;
                    var pair = [a.title, b.title].sort().join('\u0000');
                    if (a.normalized === b.normalized)
                        issues.push(issue('duplicates', 'warning', 'duplicateTitle', a.location, {other: b.title, otherId: String(b.vulnerability._id)}, pair));
                    else if (similarity(a.normalized, b.normalized) >= SIMILAR_TITLES)
                        issues.push(issue('duplicates', 'info', 'similarTitle', a.location, {other: b.title, otherId: String(b.vulnerability._id)}, pair));
                }
            }
        });
    }
    return sortIssues(issues);
}

// Errors first, then warnings, then information (order of the content kept)
function sortIssues(issues) {
    return issues.map((item, index) => ({item, index}))
        .sort((a, b) => (SEVERITIES[a.item.severity] - SEVERITIES[b.item.severity]) || (a.index - b.index))
        .map(({item}) => item);
}

// Ids of the images of the editors used in an audit or in vulnerabilities (to check that they exist)
function imageIds(values) {
    var ids = new Set();
    var visit = (value) => {
        if (typeof value === 'string') imagesIn(value).forEach(image => { if (/^[a-f0-9]{24}$/i.test(image.src)) ids.add(image.src.toLowerCase()); });
        else if (Array.isArray(value)) value.forEach(visit);
        else if (value && typeof value === 'object') Object.values(value).forEach(visit);
    };
    visit(values);
    return [...ids];
}

module.exports = {imageAnchorKey, CHECKS, enabledChecks, auditIssues, vulnerabilityIssues, imageIds, isFileNameCaption, invalidReference, similarity, normalizedTitle};
