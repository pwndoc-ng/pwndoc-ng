// Texts highlighted with given colors in the editors of an audit (setting "highlight warning" of the reports: generic
// texts of the templates, to replace before the report is delivered). Warning only: the report is generated anyway.

// Highlight colors of the editors (frontend/src/components/editor.vue)
var HIGHLIGHT_COLORS = ['#ffff00', '#fe0000', '#00ff00', '#00ffff'];

var MARK = /<mark\b([^>]*)>([\s\S]*?)<\/mark>/gi;
var MARK_COLOR = /\bdata-color\s*=\s*["']?(#[0-9a-f]{6})/i;
var ENTITIES = {'&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' '};
var EXCERPT_LENGTH = 100;

// Finding fields edited with an editor (HTML)
var FINDING_FIELDS = ['description', 'observation', 'remediation', 'poc', 'scope'];

// Text of an HTML fragment, on one line, shortened
function excerpt(html) {
    var text = html.replace(/<[^>]*>/g, '').replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, entity => ENTITIES[entity]).replace(/\s+/g, ' ').trim();
    return text.length > EXCERPT_LENGTH ? `${text.substring(0, EXCERPT_LENGTH - 1)}…` : text;
}

// Texts highlighted with one of the colors in an HTML value (other values: none): [{text, color}]
function highlightsIn(html, colors) {
    if (typeof html !== 'string' || !html.includes('<mark'))
        return [];
    var wanted = [].concat(colors || []).map(color => String(color).toLowerCase());
    return [...html.matchAll(MARK)]
        .map(match => {
            var markColor = match[1].match(MARK_COLOR);
            return {text: excerpt(match[2]), color: markColor ? markColor[1].toLowerCase() : null};
        })
        .filter(highlight => highlight.text && wanted.includes(highlight.color));
}

// Places of an audit (custom fields populated: label and type of the custom fields) with texts highlighted with one of the
// colors: [{kind: 'general' | 'finding' | 'section', id (finding, section), name (finding title, section name), field (key
// or customFields.<id>), label (label of a custom field), texts: [{text, color}]}]
function auditHighlights(audit, colors) {
    var items = [];
    var add = (kind, id, name, field, label, html) => {
        var texts = highlightsIn(html, colors);
        if (texts.length > 0)
            items.push({kind: kind, id: id ? String(id) : null, name: name || '', field: field, label: label || null, texts: texts});
    };
    var addCustomFields = (kind, id, name, fields) => (fields || []).forEach(entry => {
        var definition = entry && entry.customField;
        if (definition && typeof definition === 'object' && (!definition.fieldType || definition.fieldType === 'text'))
            add(kind, id, name, `customFields.${definition._id}`, definition.label, entry.text);
    });

    add('general', null, audit.name, 'summary', null, audit.summary);
    addCustomFields('general', null, audit.name, audit.customFields);
    (audit.findings || []).forEach(finding => {
        FINDING_FIELDS.forEach(field => add('finding', finding._id, finding.title, field, null, finding[field]));
        addCustomFields('finding', finding._id, finding.title, finding.customFields);
    });
    (audit.sections || []).forEach(section => {
        add('section', section._id, section.name, 'text', null, section.text);
        addCustomFields('section', section._id, section.name, section.customFields);
    });
    return items;
}

module.exports = { HIGHLIGHT_COLORS, highlightsIn, auditHighlights };
