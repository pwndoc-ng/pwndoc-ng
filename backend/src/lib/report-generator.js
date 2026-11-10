var fs = require('fs');
var Docxtemplater = require('docxtemplater');
var PizZip = require("pizzip");
var expressions = require('angular-expressions');
var ImageModule = require('docxtemplater-image-module-pwndoc');
var { imageSize: sizeOf } = require('image-size');
var customGenerator = require('./custom-generator');
var chartGenerator = require('./chart-generator');
var utils = require('./utils');
var html2ooxml = require('./html2ooxml');
var _ = require('lodash');
var Image = require('mongoose').model('Image');
var Settings = require('mongoose').model('Settings');
var VulnerabilityType = require('mongoose').model('VulnerabilityType');
var CustomField = require('mongoose').model('CustomField');
var CVSS31 = require('./cvsscalc31.js');
var translate = require('../translate')
var $t
var pieChartXML
var barChartXML
var zip
var numberOfPieChart = 0
var numberOfBarChart = 0
var chartRelXml = ''
var chartContentTypeXml = ''
var generatedListIds = [] // Numbering instances of the numbered lists converted by convertHTML (one per list)
var nextListId = 0

const encodeHTMLEntities = s => s.replace(/[\u00A0-\u9999<>&]/g, i => '&#'+i.charCodeAt(0)+';')

// Width of images from editor fields relative to the template text width (large: between page margins)
// Same values as the editor display (frontend/src/components/uploadImage.vue)
const IMAGE_WIDTH_RATIOS = {small: 0.5, medium: 0.75, large: 1}
// Height (px) kept free below a page-high image so that its caption stays on the same page
const IMAGE_CAPTION_RESERVED_HEIGHT = 60

// The width chosen for an image is carried as a parameter of its data URI: the image module only gives
// the tag value to getSize and treats object values as already resolved images, while getImage only uses
// the data after the comma. e.g. data:image/png;pwndoc-width=medium;base64,iVBOR...
function setImageWidthParam(dataUri, width) {
    if (typeof dataUri !== 'string' || !dataUri.startsWith('data:'))
        return dataUri
    return dataUri.replace(/^data:([^,]*?)(;base64)?,/, (match, mediaType, base64) => `data:${mediaType};pwndoc-width=${width}${base64 || ''},`)
}
exports.setImageWidthParam = setImageWidthParam

function getImageWidthParam(dataUri) {
    if (typeof dataUri !== 'string' || !dataUri.startsWith('data:'))
        return null
    var match = dataUri.substring(0, dataUri.indexOf(',')).match(/;pwndoc-width=([a-z]+)/)
    return match ? match[1] : null
}
exports.getImageWidthParam = getImageWidthParam

// Text area of the template in pixels (96 dpi: 1px = 15 twips), from the page size and margins
// of the main section (last w:sectPr of the body)
function getTemplateTextArea(zip) {
    try {
        var sections = zip.files['word/document.xml'].asText().match(/<w:sectPr[\s\S]*?<\/w:sectPr>/g)
        var section = sections[sections.length - 1]
        var attr = (tag, name) => {
            var element = (section.match(new RegExp(`<w:${tag}\\b[^>]*>`)) || [''])[0]
            var value = element.match(new RegExp(`w:${name}="(-?\\d+)"`))
            return value ? Math.abs(parseInt(value[1], 10)) : 0
        }
        var width = attr('pgSz', 'w') - (attr('pgMar', 'left') || attr('pgMar', 'start')) - (attr('pgMar', 'right') || attr('pgMar', 'end')) - attr('pgMar', 'gutter')
        var height = attr('pgSz', 'h') - attr('pgMar', 'top') - attr('pgMar', 'bottom')
        if (width > 0)
            return {width: Math.floor(width / 15), height: height > 0 ? Math.floor(height / 15) : null}
    }
    catch (err) {}
    return {width: 600, height: null} // Previous fixed max width
}
exports.getTemplateTextArea = getTemplateTextArea

// The generation relies on module-level state shared with the template filters (zip, charts counters
// and relations, numbering ids, translation locale). Generations are therefore queued so that two
// concurrent requests never interleave (prepAuditData is async).
var generationQueue = Promise.resolve()

function generateDoc(audit) {
    var generation = generationQueue.then(() => _generateDoc(audit))
    generationQueue = generation.catch(() => {}) // A failed generation must not block the next ones
    return generation
}
exports.generateDoc = generateDoc;

// Generate document with docxtemplater
async function _generateDoc(audit) {

    // Reset global variables for each document generation
    generatedListIds = [];
    pieChartXML = null;
    barChartXML = null;
    numberOfPieChart = 0;
    numberOfBarChart = 0;
    chartRelXml = '';
    chartContentTypeXml = '';

    var templatePath = `${__basedir}/../report-templates/${audit.template.name}.${audit.template.ext || 'docx'}`
    var content = fs.readFileSync(templatePath, "binary");

    zip = new PizZip(content);
    var textArea = getTemplateTextArea(zip); // Space between margins, for editor images width
    nextListId = firstFreeNumId(zip);

    translate.setLocale(audit.language)
    $t = translate.translate

    // set the identifier of each vulnerability to the index of the array
    audit.findings.forEach((finding, index) => {
        finding.identifier = index + 1
    })

    var settings = await Settings.getAll();
    var preppedAudit = await prepAuditData(audit, settings)

    var opts = {};
    // opts.centered = true;
    opts.getImage = function(tagValue, tagName) {
        if (tagValue !== "undefined") {
            tagValue = tagValue.split(",")[1];
            return Buffer.from(tagValue, 'base64');
        }
        // return fs.readFileSync(tagValue, {encoding: 'base64'});
    }
    opts.getSize = function(img, tagValue, tagName) {
        if (img) {
            var sizeObj = sizeOf(img);
            var width = sizeObj.width;
            var height = sizeObj.height;
            if (tagName === "company.logo_small") {
                var divider = sizeObj.height / 37;
                height = 37;
                width = Math.floor(sizeObj.width / divider);
            }
            else if (tagName === "company.logo") {
                var divider = sizeObj.height / 250;
                height = 250;
                width = Math.floor(sizeObj.width / divider);
                if (width > 400) {
                    divider = sizeObj.width / 400;
                    height = Math.floor(sizeObj.height / divider);
                    width = 400;
                }
            }
            // Image from an editor field (findings, sections...): small, medium or large (between margins) width
            else if (getImageWidthParam(tagValue)) {
                var ratio = IMAGE_WIDTH_RATIOS[getImageWidthParam(tagValue)] || IMAGE_WIDTH_RATIOS[settings.report.public.imageDefaultWidth] || 1;
                width = Math.floor(textArea.width * ratio);
                height = Math.round(sizeObj.height * width / sizeObj.width);
                // Keep tall images inside the page, with room left for their caption
                var maxHeight = textArea.height ? textArea.height - IMAGE_CAPTION_RESERVED_HEIGHT : null;
                if (maxHeight && height > maxHeight) {
                    height = maxHeight;
                    width = Math.round(sizeObj.width * height / sizeObj.height);
                }
            }
            else if (sizeObj.width > 600) {
                var divider = sizeObj.width / 600;
                width = 600;
                height = Math.floor(sizeObj.height / divider);
            }
            return [width,height];
        }
        return [0,0]
    }

    if (settings.report.private.imageBorder && settings.report.private.imageBorderColor)
        opts.border = settings.report.private.imageBorderColor.replace('#', '')

    try {
        var imageModule = new ImageModule(opts);
    }
    catch(err) {
        console.log(err)
    }
    try {
        var doc = new Docxtemplater(zip, {
            modules: [imageModule],
            parser: parser,
            paragraphLoop: true,
            stripInvalidXMLChars: true // Control characters of the audit data: a document containing them cannot be opened
        });
    }
    catch (error) {
        throw templateError(error) // Syntax errors of the template
    }

    customGenerator.apply(preppedAudit);

    try {
        doc.render(preppedAudit);
    }
    catch (error) {
        throw templateError(error)
    }
    declareListNumbering(zip, generatedListIds);
    declareTableStyle(zip);

    // Include refs in document
    const relsPath = "word/_rels/document.xml.rels";
    let relsXml = zip.files[relsPath].asText();
    relsXml = relsXml.replace("</Relationships>", `${chartRelXml}</Relationships>`);


    zip.file(relsPath, relsXml);
    


    const piechartStyleXmlPath = "word/charts/pieChart-style-pwndoc.xml";
    const pieChartcolorsXmlPath = "word/charts/pieChart-colors-pwndoc.xml";

    const barChartstyleXmlPath = "word/charts/barChart-style-pwndoc.xml";
    const barChartcolorsXmlPath = "word/charts/barChart-colors-pwndoc.xml";

    const pieChartstyleXml = `<c:chartStyle xmlns:c="http://schemas.microsoft.com/office/drawing/2012/chartStyle"/>`;
    const pieChartcolorsXml = `<c:chartColors xmlns:c="http://schemas.microsoft.com/office/drawing/2012/chartColor"/>`;

    const barChartstyleXml = `<c:chartStyle xmlns:c="http://schemas.microsoft.com/office/drawing/2012/chartStyle"/>`;
    const barChartcolorsXml = `<c:chartColors xmlns:c="http://schemas.microsoft.com/office/drawing/2012/chartColor"/>`;

    zip.file(piechartStyleXmlPath, pieChartstyleXml);
    zip.file(pieChartcolorsXmlPath, pieChartcolorsXml);
    zip.file(barChartstyleXmlPath, barChartstyleXml);
    zip.file(barChartcolorsXmlPath, barChartcolorsXml);

    // Add content type
    const contentTypesPath = "[Content_Types].xml";
    let contentTypesXml = zip.files[contentTypesPath].asText();
    contentTypesXml = contentTypesXml.replace("</Types>", `${chartContentTypeXml}</Types>`);
    zip.file(contentTypesPath, contentTypesXml);
    

    var buf = doc.getZip().generate({type:"nodebuffer"});

    return buf;
}

// *** Angular parser filters ***

// Keep only first finding with a given title
expressions.filters.uniqFindings = function (findings) {
    if (!findings) return findings;
    var titles = [];
    var filtered_findings = [];
    findings.forEach(function (f) {
        if (!(titles.includes(f.title))){
            titles.push(f.title);
            filtered_findings.push(f);
        }
    });
    return filtered_findings;
};

// Creates a text block or simple location bookmark:
// - Text block: {@name | bookmarkCreate: identifier | p}
// - Location: {@identifier | bookmarkCreate | p}
// Identifiers are sanitized as follow:
// - Invalid characters replaced by underscores.
// - Identifiers longer than 40 chars are truncated (MS-Word limitation).
expressions.filters.bookmarkCreate = function(input, refid = null) {
    let rand_id = Math.floor(Math.random() * 1000000 + 1000);
    let parsed_id = (refid ? refid : input).replace(/[^a-zA-Z0-9_]/g, '_').substring(0,40);

    // Accept both text and OO-XML as input.
    if (input.indexOf('<w:r') !== 0) {
        input = '<w:r><w:t>' + input + '</w:t></w:r>';
    }

    return '<w:bookmarkStart w:id="' + rand_id + '" '
        + 'w:name="' + parsed_id + '"/>'
        + (refid ? input : '')
        + '<w:bookmarkEnd w:id="' + rand_id + '"/>';
}

// Creates a hyperlink to a text block or location bookmark:
// {@input | bookmarkLink: identifier | p}
// Identifiers are sanitized as follow:
// - Invalid characters replaced by underscores.
// - Identifiers longer than 40 chars are truncated (MS-Word limitation).
expressions.filters.bookmarkLink = function(input, identifier) {
    identifier = identifier.replace(/[^a-zA-Z0-9_]/g, '_').substring(0,40);
    return '<w:hyperlink w:anchor="' + identifier + '">'
        + '<w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr>'
        + '<w:t>' + input + '</w:t>'
        + '</w:r></w:hyperlink>';
}

// Creates a clickable dynamic field referencing a text block bookmark:
// Identifiers are sanitized as follow:
// - Invalid characters replaced by underscores.
// - Identifiers longer than 40 chars are truncated (MS-Word limitation).
expressions.filters.bookmarkRef = function(input) {
    return '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve">'
        + ' REF ' + input.replace(/[^a-zA-Z0-9_]/g, '_').substring(0,40) + ' \\h </w:instrText></w:r>'
        + '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>'
        + input + '</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>';
}

// Capitalizes input first letter: {input | capfirst}
expressions.filters.capfirst = function(input) {
    if (!input || input == "undefined") return input;
    return input.replace(/^\w/, (c) => c.toUpperCase());
}

// Convert input date with parameter s (full,short): {input | convertDate: 's'}
expressions.filters.convertDate = function(input, s) {
    var date = new Date(input);
    if (date != "Invalid Date") {
        var monthsFull = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        var monthsShort = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];
        var days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        var day = date.getUTCDate();
        var month = date.getUTCMonth();
        var year = date.getUTCFullYear();
        if (s === "full") {
            return days[date.getUTCDay()] + ", " + monthsFull[month] + " " + (day<10 ? '0'+day: day) + ", " + year;
        }
        if (s === "short") {
            return monthsShort[month] + "/" + (day<10 ? '0'+day: day) + "/" + year;
        }
    }
}

// Convert input date with parameter s (full,short): {input | convertDateLocale: 'locale':'style'}
expressions.filters.convertDateLocale = function(input, locale, style) {
    var date = new Date(input);
    if (date != "Invalid Date") {
        var options = { year: 'numeric', month: '2-digit', day: '2-digit'}

        if (style === "full")
            options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'}

        return date.toLocaleDateString(locale, options)

    }
}

// Convert identifier prefix to a user defined prefix: {identifier | changeID: 'PRJ-'}
expressions.filters.changeID = function (input, prefix) {
    return input.replace("IDX-", prefix);
}

// Default value: returns input if it is truthy, otherwise its parameter.
// Example producing a comma-separated list of affected systems, falling-back on the whole audit scope: {affected | lines | d: (scope | select: 'name') | join: ', '}
expressions.filters.d = function(input, s) {
    return (input && input != "undefined") ? input : s;
}

// Display "From ... to ..." dates nicely, removing redundant information when the start and end date occur during the same month or year: {date_start | fromTo: date_end:'fr' | capfirst}
// To internationalize or customize the resulting string, associate the desired output to the strings "from {0} to {1}" and "on {0}" in your Pwndoc translate file.
expressions.filters.fromTo = function(start, end, locale) {
    const start_date = new Date(start);
    const end_date = new Date(end);
    let options = {}, start_str = '', end_str = '';
    let str = "from {0} to {1}";

    if (start_date == "Invalid Date" || end_date == "Invalid Date") return start;

    options = {day: '2-digit', month: '2-digit', year: 'numeric'};
    end_str = end_date.toLocaleDateString(locale, options);

    if (start_date.getFullYear() != end_date.getFullYear()) {
        options = {day: '2-digit', month: '2-digit', year: 'numeric'};
        start_str = start_date.toLocaleDateString(locale, options);
    }
    else if (start_date.getMonth() != end_date.getMonth()) {
        options = {day: '2-digit', month: '2-digit'};
        start_str = start_date.toLocaleDateString(locale, options);
    }
    else if (start_date.getDate() != end_date.getDate()) { // Day of the month
        options = {day: '2-digit'};
        start_str = start_date.toLocaleDateString(locale, options);
    }
    else {
        start_str = end_str;
        str = "on {0}";
    }

    return translate.translate(str).format(start_str, end_str);
}

// Group input elements by an attribute: {#findings | groupBy: 'severity'}{title}{/findings | groupBy: 'severity'}
// Source: https://stackoverflow.com/a/34890276
expressions.filters.groupBy = function(input, key) {
    return expressions.filters.loopObject(
        input.reduce(function(rv, x) {
            var group = _getPropertyValue(x, key);
            (rv[group] = rv[group] || []).push(x);
            return rv;
        }, Object.create(null)) // No prototype: a value such as '__proto__' is a group like any other
    );
}

// Returns the initials from an input string (typically a firstname): {creator.firstname | initials}
expressions.filters.initials = function(input) {
    if (!input || input == "undefined") return input;
    return input.replace(/(\w)\w+/gi,"$1.");
}

// Returns a string which is a concatenation of input elements using an optional separator string: {references | join: ', '}
// Can also be used to build raw OOXML strings.
expressions.filters.join = function(input, sep = '') {
    if (!input || input == "undefined") return input;
    return input.join(sep);
}

// Returns the length (ie. number of items for an array) of input: {input | length}
// Can be used as a conditional to check the emptiness of a list: {#input | length}Not empty{/input | length}
expressions.filters.length = function(input) {
    return input.length;
}

// Takes a multilines input strings (either raw or simple HTML paragraphs) and returns each line as an ordered list: {input | lines}
expressions.filters.lines = function(input) {
    if (!input || input == "undefined") return input;
    if (input.indexOf('<p>') == 0) {
        return input.substring(3,input.length - 4).split('</p><p>');
    }
    else {
        return input.split("\n");
    }
}


// Creates a hyperlink: {@input | linkTo: 'https://example.com' | p}
expressions.filters.linkTo = function(input, url) {
    // fix breaking word with special characters in reference
    var entityencodedinput = input.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;'); // encode to prevent xml issues

    if(typeof url === 'undefined') {
        var entityencodedurl = entityencodedinput
    } else {
        var entityencodedurl = url.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;'); // encode to prevent xml issues
    }
    
    return `<w:p><w:r>
    <w:fldChar w:fldCharType="begin"/></w:r><w:r>
    <w:instrText xml:space="preserve"> HYPERLINK "${entityencodedurl}" </w:instrText>
</w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>
<w:r><w:rPr><w:rStyle w:val="PwndocLink"/>
        <w:shd w:val="clear" w:color="auto" w:fill="auto"/> <!-- Remove any shading -->
    </w:rPr><w:t>${entityencodedinput}</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/>
</w:r></w:p>`;
        
}

// Loop over the input object, providing acccess to its keys and values: {#findings | loopObject}{key}{value.title}{/findings | loopObject}
// Source: https://stackoverflow.com/a/60887987
expressions.filters.loopObject = function(input) {
    return Object.keys(input).map(function(key) {
        return { key , value : input[key]};
    });
}

// Lowercases input: {input | lower}
expressions.filters.lower = function(input) {
    if (!input || input == "undefined") return input;
        return input.toLowerCase();
}

// Creates a clickable "mailto:" link, assumes that input is an email address if
// no other address has been provided as parameter:
// {@lastname | mailto: email | p}
expressions.filters.mailto = function(input, address = null) {
    return expressions.filters.linkTo(input, 'mailto:' + (address ? address : input));
}

// Applies a filter on a sequence of objects: {scope | select: 'name' | map: 'lower' | join: ', '}
expressions.filters.map = function(input, filter) {
    let args = Array.prototype.slice.call(arguments, 2);
    if (!Object.prototype.hasOwnProperty.call(expressions.filters, filter) || typeof expressions.filters[filter] !== 'function')
        throw new Error(`Filter '${filter}' is not defined`);
    return input.map(x => expressions.filters[filter](x, ...args));
}

// Replace newlines in office XML format: {@input | NewLines}
expressions.filters.NewLines = function(input) {
    var pre = '<w:p><w:r><w:t>';
    var post = '</w:t></w:r></w:p>';
    var lineBreak = '<w:br/>';
    var result = '';

    if(!input) return pre + post;

    input = utils.escapeXMLEntities(input);
    var inputArray = input.split(/\n\n+/g);
    inputArray.forEach(p => {
        result += `${pre}${p.replace(/\n/g, lineBreak)}${post}`
    });
    // input = input.replace(/\n/g, lineBreak);
    // return pre + input + post;
    return result;
}

// Embeds input within OOXML paragraph tags, applying an optional style name to it: {@input | p: 'Some style'}


expressions.filters.p = function(input, style = null) {
    // Don't create paragraph if content is empty
    if (!input || input === "" || input === "undefined" || input === null) {
        return "";
    }

    // If input already contains a paragraph, don't create a new one
    if (input.includes('<w:p>') && input.includes('</w:p>')) {
        // If a style is requested, add it to existing paragraph
        if (style) {
            let style_parsed = style.replaceAll(' ', '');
            if (style_parsed === 'Bullets') {
                return input.replace('<w:p>', '<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>');
            }
        }
        return input;
    }

    // Create a new paragraph if necessary
    let result = '<w:p>';
    if (style !== null) {
        let style_parsed = style.replaceAll(' ', '');
        if (style_parsed === 'Bullets') {
            result += '<w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>';
        } else {
            result += '<w:pPr><w:pStyle w:val="' + style_parsed + '"/></w:pPr>';
        }
    }
    // OOXML input (runs, bookmarks or fields of the other filters) goes directly in the paragraph: inside a w:t, which only
    // contains text, it would be lost or make the document invalid. Text input is put in an escaped run
    if (/^\s*<w:/.test(input))
        result += input + '</w:p>';
    else
        result += '<w:r><w:t>' + utils.escapeXMLEntities(String(input)) + '</w:t></w:r></w:p>';
    return result;
}


// Reverses the input array: {input | reverse}
expressions.filters.reverse = function(input) {
    return input.reverse();
}

// Add proper XML tags to embed raw string inside a docxtemplater raw expression: {@('Vulnerability: ' | s) + title | bookmarkCreate: identifier | p}
expressions.filters.s = function(input) {
    return '<w:r><w:t xml:space="preserve">' + input + '</w:t></w:r>';
}

// Looks up an attribute from a sequence of objects, doted notation is supported: {findings | select: 'cvss.environmentalSeverity'}
expressions.filters.select = function(input, attr) {
    return input.map(function(item) { return _getPropertyValue(item, attr) });
}

// Sorts the input array according an optional given attribute, dotted notation is supported: {#findings | sort 'cvss.environmentalSeverity'}{name}{/findings | sort 'cvss.environmentalSeverity'}
expressions.filters.sort = function(input, key = null) {
    if (key === null) {
        return input.sort();
    }
    else {
        // Ascending order (same as without key), elements without value at the end ("" in the report data, e.g. the CVSS
        // score of a finding without vector)
        var noValue = (value) => value === undefined || value === null || value === "";
        return input.sort(function(a, b) {
            var x = _getPropertyValue(a, key), y = _getPropertyValue(b, key);
            if (x === y) return 0;
            if (noValue(x)) return noValue(y) ? 0 : 1;
            if (noValue(y)) return -1;
            return x < y ? -1 : 1;
        });
    }
}
expressions.filters.sortDESC = function(input, key = null) {
    return  _.sortBy(input, o => _.get(o,key)).reverse()
}
expressions.filters.sortASC = function(input=null, key = null) {
    return  _.sortBy(input, o =>  _.get(o,key))
}

// Sort array by supplied field: {#findings | sortArrayByField: 'identifier':1}{/}
// order: 1 = ascending, -1 = descending
expressions.filters.sortArrayByField = function (input, field, order) {
    //invalid order sort ascending
    if(order != 1 && order != -1) order = 1;
    
    const sorted = input.sort((a,b) => {
        //multiply by order so that if is descending (-1) will reverse the values
        return _.get(a, field).toString().localeCompare(_.get(b, field).toString(), undefined, {numeric: true}) * order
    })    
    return sorted;
} 


// Takes a string as input and split it into an ordered list using a separator: {input | split: ', '}
expressions.filters.split = function(input, sep) {
    if (!input || input == "undefined") return input;
    return input.split(sep);
}

// Capitalizes input first letter of each word, can be associated to 'lower' to normalize case: {creator.lastname | lower | title}
expressions.filters.title= function(input) {
    if (!input || input == "undefined") return input;
    return input.replace(/\w\S*/g, (w) => (w.replace(/^\w/, (c) => c.toUpperCase())));
}

// Returns the JSON representation of the input value, useful to dump variables content while debugging a template: {input | toJSON}
expressions.filters.toJSON = function(input) {
    return JSON.stringify(input);
}

// Upercases input: {input | upper}
expressions.filters.upper = function(input) {
    if (!input || input == "undefined") return input;
    return input.toUpperCase();
}

// Filters input elements matching a free-form Angular statements: {#findings | where: 'cvss.severity == "Critical"'}{title}{/findings | where: 'cvss.severity == "Critical"'}
// Source: https://docxtemplater.com/docs/angular-parse/#data-filtering
expressions.filters.where = function(input, query) {
    return input.filter(function (item) {
        return expressions.compile(query, COMPILE_OPTIONS)(item);
    });
};

// Convert HTML data to Open Office XML format: {@input | convertHTML: 'customStyle' | 'listIds'}
expressions.filters.convertHTML = function(input, style, listIds) {
    if (typeof input === 'undefined') {
        var result = html2ooxml('')
    } else {
        // Count numbered lists (<ol>) in HTML input
        let olCount = 0;
        if (input && typeof input === 'string') {
            olCount = (input.match(/<ol/g) || []).length;
        }

        // Convert listIds to array if it is a string
        let listIdsArray = [];
        if (listIds) {
            if (typeof listIds === 'string') {
                try {
                    listIdsArray = JSON.parse(listIds);
                } catch (e) {
                    listIdsArray = [listIds];
                }
            } else if (Array.isArray(listIds)) {
                listIdsArray = listIds;
            } else {
                listIdsArray = [listIds];
            }
        }
        
        // Without identifiers given by the template: one new numbering instance per list, declared in numbering.xml
        // after the rendering (declareListNumbering) so that each list starts at 1
        if (olCount > 0 && listIdsArray.length === 0) {
            listIdsArray = Array.from({length: olCount}, () => nextListId++);
            generatedListIds.push(...listIdsArray);
        }

        var result = html2ooxml(input.replace(/(<p><\/p>)+$/, ''), style, listIdsArray)
    }
    return result;
}

// First numbering identifier not used by the template (identifiers of the numbering instances of the generated lists)
function firstFreeNumId(zip) {
    var numbering = zip.file('word/numbering.xml')
    var ids = numbering ? [...numbering.asText().matchAll(/<w:num\b[^>]*\bw:numId="(\d+)"/g)].map(match => parseInt(match[1], 10)) : []
    return Math.max(0, ...ids) + 1
}

// Declares the numbering instances of the lists generated by convertHTML. They use the definition of the ordered list of
// the template (numId 2, see docs/docxtemplate.md), restarted at 1 for each list. Templates without this definition get
// a decimal definition. Templates without numbering.xml are not supported (bullet lists use its numId 1 too).
function declareListNumbering(zip, listIds) {
    var file = zip.file('word/numbering.xml')
    if (listIds.length === 0 || !file)
        return
    var numbering = file.asText()

    var ordered = numbering.match(/<w:num\b[^>]*\bw:numId="2"[^>]*>\s*<w:abstractNumId w:val="(\d+)"\s*\/>/)
    var abstractNumId = ordered ? ordered[1] : null
    if (abstractNumId === null) {
        abstractNumId = Math.max(-1, ...[...numbering.matchAll(/<w:abstractNum\b[^>]*\bw:abstractNumId="(\d+)"/g)].map(match => parseInt(match[1], 10))) + 1
        var levels = Array.from({length: 9}, (_, level) =>
            `<w:lvl w:ilvl="${level}"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%${level + 1}."/><w:lvlJc w:val="left"/>` +
            `<w:pPr><w:ind w:left="${720 * (level + 1)}" w:hanging="360"/></w:pPr></w:lvl>`).join('')
        var definition = `<w:abstractNum w:abstractNumId="${abstractNumId}"><w:multiLevelType w:val="hybridMultilevel"/>${levels}</w:abstractNum>`
        // Definitions (w:abstractNum) come before the instances (w:num)
        var firstNum = numbering.search(/<w:num\b/)
        numbering = firstNum === -1 ? numbering.replace('</w:numbering>', `${definition}</w:numbering>`) : numbering.slice(0, firstNum) + definition + numbering.slice(firstNum)
    }

    var restart = Array.from({length: 9}, (_, level) => `<w:lvlOverride w:ilvl="${level}"><w:startOverride w:val="1"/></w:lvlOverride>`).join('')
    var instances = listIds.map(id => `<w:num w:numId="${id}"><w:abstractNumId w:val="${abstractNumId}"/>${restart}</w:num>`).join('')
    // Instances before w:numIdMacAtCleanup (last element of the schema) if present
    numbering = numbering.includes('<w:numIdMacAtCleanup') ? numbering.replace('<w:numIdMacAtCleanup', `${instances}<w:numIdMacAtCleanup`) : numbering.replace('</w:numbering>', `${instances}</w:numbering>`)
    zip.file('word/numbering.xml', numbering)
}

// Table style of the tables converted by convertHTML (#244): templates define it to customize the tables of the editors
// (borders, header row). Added to the report when the template does not define it: Word ignores a style missing from
// styles.xml, the tables would have no borders. Simple grid, header row (first row of th cells) bold and shaded
var DEFAULT_TABLE_STYLE = `<w:style w:type="table" w:customStyle="1" w:styleId="${html2ooxml.TABLE_STYLE}"><w:name w:val="Pwndoc Table"/>` +
    '<w:uiPriority w:val="59"/><w:tblPr><w:tblBorders>' +
    ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(side => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="auto"/>`).join('') +
    '</w:tblBorders><w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
    '<w:tblStylePr w:type="firstRow"><w:rPr><w:b/><w:bCs/></w:rPr><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="D9D9D9"/></w:tcPr></w:tblStylePr>' +
    '</w:style>'
exports.DEFAULT_TABLE_STYLE = DEFAULT_TABLE_STYLE

function declareTableStyle(zip) {
    var file = zip.file('word/styles.xml')
    if (!file)
        return
    var styles = file.asText()
    if (!styles.includes(`w:styleId="${html2ooxml.TABLE_STYLE}"`))
        zip.file('word/styles.xml', styles.replace('</w:styles>', `${DEFAULT_TABLE_STYLE}</w:styles>`))
}

// Error of the template (syntax error found when it is compiled, error when it is rendered): message naming the faulty
// tags, answered to the user. Only the explanations are logged: the error properties contain the data of the report
function templateError(error) {
    if (!error || !error.properties)
        return error
    var errors = error.properties.errors instanceof Array ? error.properties.errors : [error]
    var explanations = errors.map(err => (err.properties && err.properties.explanation) || err.message)
    explanations.forEach(explanation => console.log(`Template Error: ${explanation}`))
    return new Error(`Template Error: ${explanations.join(' / ')}`)
}

// Count vulnerability by severity
// Example: {findings | count: 'Critical'}
// Example: {findings | count: 'Critical':'base'}
// Example: {findings | count: 'High':'temporal'}
// Example: {findings | count: 'Medium':'environmental'}
expressions.filters.count = function(input, severity, scoreType) {
    if(!input) return input;
    var count = 0;
    var scoreAttribute;
    switch(scoreType){
        case "base":
            scoreAttribute = "baseSeverity";
            break;
        case "temporal":
            scoreAttribute = "temporalSeverity";
            break;
        case "environmental":
        default:  // Set default to environmental score
            scoreAttribute = "environmentalSeverity";            
    }
    for(var i = 0; i < input.length; i++){

        if(input[i].cvss[scoreAttribute] === severity){
            count += 1;
        }
    }

    return count;
}

// Generate a pie chart for findings severity
// Example: {@findings | pieChart:'field':'title':'barColor':'labelColor':'labelSize'}
// Example: {@findings | pieChart:'My bar chart':'000000':'FF0000':'FFA500':'FFFF00'}
expressions.filters.pieChart = function(input, title, colorCrit, colorHigh, colorMed, colorLow) {
    if(!input) return input;
    if(!title) title = "";
    if(!colorCrit) colorCrit = "000000";
    if(!colorHigh) colorHigh = "FF0000";
    if(!colorMed) colorMed = "FFA500";
    if(!colorLow) colorLow = "FFFF00";
    var countCritical = 0;
    var countHigh = 0;
    var countMedium = 0;
    var countLow = 0;

    for(var i = 0; i < input.length; i++){

        if(input[i].cvss["baseSeverity"] === "Critical"){
            countCritical += 1;
        } else if(input[i].cvss["baseSeverity"] === "High"){
            countHigh += 1;
        } else if(input[i].cvss["baseSeverity"] === "Medium"){
            countMedium += 1;
        } else if(input[i].cvss["baseSeverity"] === "Low"){
            countLow += 1;
        }
    }

    pieChartXML = chartGenerator.generatePieChart(title, colorCrit, colorHigh, colorMed, colorLow, countCritical, countHigh, countMedium, countLow, $t);

    numberOfPieChart += 1;

    // References
    chartRelXml += `<Relationship Id="rId-pwndoc-pie-${numberOfPieChart}"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart"
    Target="charts/pieChart-${numberOfPieChart}-pwndoc.xml"/>`;

    // Content type
    chartContentTypeXml += `<Override PartName="/word/charts/pieChart-${numberOfPieChart}-pwndoc.xml"
                ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>
    `;

    const piechartXmlPath = `word/charts/pieChart-${numberOfPieChart}-pwndoc.xml`;
    zip.file(piechartXmlPath, pieChartXML);

    return `<w:p>
    <w:r>
        <w:drawing>
            <wp:inline distT="0" distB="0" distL="0" distR="0" wp14:anchorId="5CD9E55B" wp14:editId="2E40AF66">
                <wp:extent cx="5486400" cy="3200400"/>
                <wp:effectExtent l="0" t="0" r="0" b="0"/>
                <wp:docPr id="1836246480" name="Piechart Severity"/>
                <wp:cNvGraphicFramePr/>
                <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
                    <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">
                        <c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                                 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
                                 r:id="rId-pwndoc-pie-${numberOfPieChart}"/>
                    </a:graphicData>
                </a:graphic>
            </wp:inline>
        </w:drawing>
    </w:r>
</w:p>`;
}

// Generate a bar chart for findings data
// Example: {@findings | barChart:'field':'title':'barColor':'labelColor':'labelSize'}
// Example: {@findings | barChart:'vulnType':'My bar chart'}
// Example: {@findings | barChart:'cvss.baseSeverity':'My chart':'FF0000':'AABB00':'1500'}
expressions.filters.barChart = function(input, field, title, barColor, labelColor, labelSize) {
    if(!input) return input;
    if(!field) return field;
    if(!labelSize) labelSize = 1100
    if(!title) title = "";
    if(!barColor) barColor = "000000";
    if(!labelColor) labelColor = "000000";

    var dataTypeCount = {};

    for(var i = 0; i < input.length; i++){
        var fieldValue = input[i];
        var parts = field.split('.');
    
        for (var j = 0; j < parts.length; j++) {
            if (fieldValue && fieldValue[parts[j]]) {
                fieldValue = fieldValue[parts[j]];
            } else {
                fieldValue = undefined;
                break;
            }
        }
    
        if (fieldValue !== undefined) {
            if (dataTypeCount[fieldValue]) {
                dataTypeCount[fieldValue]++;
            } else {
                dataTypeCount[fieldValue] = 1;
            }
        }
    }

    var valueXML = `<c:ptCount val="${Object.keys(dataTypeCount).length}"/>`;
    var legendXML = `<c:ptCount val="${Object.keys(dataTypeCount).length}"/>`;

    var index = 0;

    for (var type in dataTypeCount) {

        legendXML += ` <c:pt idx="${index}"><c:v>${encodeHTMLEntities(type.toString())}</c:v></c:pt>`
        valueXML += `<c:pt idx="${index}"><c:v>${encodeHTMLEntities(dataTypeCount[type].toString())}</c:v></c:pt>`
        index+=1;
    }

    barChartXML = chartGenerator.generateBarChart(title, barColor, legendXML, valueXML, labelSize, labelColor);

    numberOfBarChart +=1

    // References
    chartRelXml += `<Relationship Id="rId-pwndoc-bar-${numberOfBarChart}"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart"
    Target="charts/barChart-${numberOfBarChart}-pwndoc.xml"/>`;

    // Content type
    chartContentTypeXml += `<Override PartName="/word/charts/barChart-${numberOfBarChart}-pwndoc.xml"
                ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>
    `;

    // Chart path
    const barchartXmlPath = `word/charts/barChart-${numberOfBarChart}-pwndoc.xml`;
    zip.file(barchartXmlPath, barChartXML);

    return `<w:p>
    <w:r>
        <w:drawing>
            <wp:inline distT="0" distB="0" distL="0" distR="0" wp14:anchorId="5CD9E55B" wp14:editId="2E40AF66">
                <wp:extent cx="5486400" cy="3200400"/>
                <wp:effectExtent l="0" t="0" r="0" b="0"/>
                <wp:docPr id="1836246480" name="barChart type"/>
                <wp:cNvGraphicFramePr/>
                <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
                    <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">
                        <c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                                 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
                                 r:id="rId-pwndoc-bar-${numberOfBarChart}"/>
                    </a:graphicData>
                </a:graphic>
            </wp:inline>
        </w:drawing>
    </w:r>
</w:p>`;
}

// Translate using locale from 'translate' folder
// Example: {input | translate: 'fr'}
expressions.filters.translate = function(input, locale) {
    if (!input) return input
    return $t(input, locale)
}

// Filters helper: handles the use of dotted notation as property names.
// Only own properties are read: the report templates have no access to the prototypes (constructor, __proto__...)
// Source: https://stackoverflow.com/a/37510735
function _getPropertyValue(obj, dataToRetrieve) {
  return String(dataToRetrieve)
    .split('.')
    .reduce(function(o, k) {
      if (o === null || o === undefined || !Object.prototype.hasOwnProperty.call(Object(o), k))
        return undefined;
      return o[k];
    }, obj);
}

// Filters helper: handles the use of preformated easilly translatable strings.
// Source: https://www.tutorialstonight.com/javascript-string-format.php
String.prototype.format = function () {
    let args = arguments;
    return this.replace(/{([0-9]+)}/g, function (match, index) {
        return typeof args[index] == 'undefined' ? match : args[index];
    });
};

// angular-expressions >= 1.7 refuses expressions longer than 250 characters by default:
// template tags can be longer (e.g. variables computed in the Default Template)
var COMPILE_OPTIONS = {maxExpressionLength: 10000};

// Compile all angular expressions
var angularParser = function(tag) {
    expressions = {...expressions, ...customGenerator.expressions};
    if (tag === '.') {
        return {
            get: function(s){ return s;}
        };
    }
    const expr = expressions.compile(
        tag.replace(/(’|‘)/g, "'").replace(/(“|”)/g, '"'),
        COMPILE_OPTIONS
    );
    return {
        get: function(scope, context) {
            let obj = {};
            const scopeList = context.scopeList;
            const num = context.num;
            for (let i = 0, len = num + 1; i < len; i++) {
                obj = _.merge(obj, scopeList[i]);
            }
            // $index: position in the innermost loop (e.g. {'VULN-'+($index+1)} in the loop of the findings)
            const scopePathItem = context.scopePathItem || [];
            obj.$index = scopePathItem[scopePathItem.length - 1];
            return expr(scope, obj);
        }
    };
}

function parser(tag) {
    // We write an exception to handle the tag "$pageBreakExceptLast"
    if (tag === "$pageBreakExceptLast") {
        return {
            get(scope, context) {
                const totalLength = context.scopePathLength[context.scopePathLength.length - 1];
                const index = context.scopePathItem[context.scopePathItem.length - 1];
                const isLast = index === totalLength - 1;
                if (!isLast) {
                    return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
                }
                else {
                    return '';
                }
            }
        }
    }
    // We use the angularParser as the default fallback
    // If you don't wish to use the angularParser,
    // you can use the default parser as documented here:
    // https://docxtemplater.readthedocs.io/en/latest/configuration.html#default-parser
    return angularParser(tag);
}
exports.parser = parser // Exported for the tests

function cvssStrToObject(cvss) {
    var initialState = 'Not Defined'
    var res = {AV:initialState, AC:initialState, PR:initialState, UI:initialState, S:initialState, C:initialState, I:initialState, A:initialState, E:initialState, RL:initialState, RC:initialState, CR:initialState, IR:initialState, AR:initialState, MAV:initialState, MAC:initialState, MPR:initialState, MUI:initialState, MS:initialState, MC:initialState, MI:initialState, MA:initialState};
    if (cvss) {
        var temp = cvss.split('/');
        for (var i=0; i<temp.length; i++) {
            var elt = temp[i].split(':');
            switch(elt[0]) {
                case "AV":
                    if (elt[1] === "N") res.AV = "Network"
                    else if (elt[1] === "A") res.AV = "Adjacent Network"
                    else if (elt[1] === "L") res.AV = "Local"
                    else if (elt[1] === "P") res.AV = "Physical"
                    res.AV = $t(res.AV)
                    break;
                case "AC":
                    if (elt[1] === "L") res.AC = "Low"
                    else if (elt[1] === "H") res.AC = "High"
                    res.AC = $t(res.AC)
                    break;
                case "PR":
                    if (elt[1] === "N") res.PR = "None"
                    else if (elt[1] === "L") res.PR = "Low"
                    else if (elt[1] === "H") res.PR = "High"
                    res.PR = $t(res.PR)
                    break;
                case "UI":
                    if (elt[1] === "N") res.UI = "None"
                    else if (elt[1] === "R") res.UI = "Required"
                    res.UI = $t(res.UI)
                    break;
                case "S":
                    if (elt[1] === "U") res.S = "Unchanged"
                    else if (elt[1] === "C") res.S = "Changed"
                    res.S = $t(res.S)
                    break;
                case "C":
                    if (elt[1] === "N") res.C = "None"
                    else if (elt[1] === "L") res.C = "Low"
                    else if (elt[1] === "H") res.C = "High"
                    res.C = $t(res.C)
                    break;
                case "I":
                    if (elt[1] === "N") res.I = "None"
                    else if (elt[1] === "L") res.I = "Low"
                    else if (elt[1] === "H") res.I = "High"
                    res.I = $t(res.I)
                    break;
                case "A":
                    if (elt[1] === "N") res.A = "None"
                    else if (elt[1] === "L") res.A = "Low"
                    else if (elt[1] === "H") res.A = "High"
                    res.A = $t(res.A)
                    break;
                case "E":
                    if (elt[1] === "U") res.E = "Unproven"
                    else if (elt[1] === "P") res.E = "Proof-of-Concept"
                    else if (elt[1] === "F") res.E = "Functional"
                    else if (elt[1] === "H") res.E = "High"
                    res.E = $t(res.E)
                    break;
                case "RL":
                    if (elt[1] === "O") res.RL = "Official Fix"
                    else if (elt[1] === "T") res.RL = "Temporary Fix"
                    else if (elt[1] === "W") res.RL = "Workaround"
                    else if (elt[1] === "U") res.RL = "Unavailable"
                    res.RL = $t(res.RL)
                    break;
                case "RC":
                    if (elt[1] === "U") res.RC = "Unknown"
                    else if (elt[1] === "R") res.RC = "Reasonable"
                    else if (elt[1] === "C") res.RC = "Confirmed"
                    res.RC = $t(res.RC)
                    break;
                case "CR":
                    if (elt[1] === "L") res.CR = "Low"
                    else if (elt[1] === "M") res.CR = "Medium"
                    else if (elt[1] === "H") res.CR = "High"
                    res.CR = $t(res.CR)
                    break;
                case "IR":
                    if (elt[1] === "L") res.IR = "Low"
                    else if (elt[1] === "M") res.IR = "Medium"
                    else if (elt[1] === "H") res.IR = "High"
                    res.IR = $t(res.IR)
                    break;
                case "AR":
                    if (elt[1] === "L") res.AR = "Low"
                    else if (elt[1] === "M") res.AR = "Medium"
                    else if (elt[1] === "H") res.AR = "High"
                    res.AR = $t(res.AR)
                    break;
                case "MAV":
                    if (elt[1] === "N") res.MAV = "Network"
                    else if (elt[1] === "A") res.MAV = "Adjacent Network"
                    else if (elt[1] === "L") res.MAV = "Local"
                    else if (elt[1] === "P") res.MAV = "Physical"
                    res.MAV = $t(res.MAV)
                    break;
                case "MAC":
                    if (elt[1] === "L") res.MAC = "Low"
                    else if (elt[1] === "H") res.MAC = "High"
                    res.MAC = $t(res.MAC)
                    break;
                case "MPR":
                    if (elt[1] === "N") res.MPR = "None"
                    else if (elt[1] === "L") res.MPR = "Low"
                    else if (elt[1] === "H") res.MPR = "High"
                    res.MPR = $t(res.MPR)
                    break;
                case "MUI":
                    if (elt[1] === "N") res.MUI = "None"
                    else if (elt[1] === "R") res.MUI = "Required"
                    res.MUI = $t(res.MUI)
                    break;
                case "MS":
                    if (elt[1] === "U") res.MS = "Unchanged"
                    else if (elt[1] === "C") res.MS = "Changed"
                    res.MS = $t(res.MS)
                    break;
                case "MC":
                    if (elt[1] === "N") res.MC = "None"
                    else if (elt[1] === "L") res.MC = "Low"
                    else if (elt[1] === "H") res.MC = "High"
                    res.MC = $t(res.MC)
                    break;
                case "MI":
                    if (elt[1] === "N") res.MI = "None"
                    else if (elt[1] === "L") res.MI = "Low"
                    else if (elt[1] === "H") res.MI = "High"
                    res.MI = $t(res.MI)
                    break;
                case "MA":
                    if (elt[1] === "N") res.MA = "None"
                    else if (elt[1] === "L") res.MA = "Low"
                    else if (elt[1] === "H") res.MA = "High"
                    res.MA = $t(res.MA)
                    break;
                default:
                    break;
            }
        }
    }
    return res
}
// Severity of the CVSS 3.1 subscores (impact, exploitability) for their colors in the report (#410). CVSS defines no
// severity for the subscores: each one is scaled to the range of the scores (0-10) by its maximum and rated with the
// qualitative severity scale of the scores (CVSS 3.1 specification, section 5: None 0, Low 0.1-3.9, Medium 4.0-6.9,
// High 7.0-8.9, Critical 9.0-10.0). Maximums of the CVSS 3.1 formulas, rounded up like the subscores of the report: base
// impact 6.1 (6.05, scope changed), environmental modified impact 6.2 (6.13, high security requirements), exploitability
// 3.9 (3.89). Thresholds below: first subscore (one decimal) of Medium, High and Critical, e.g. a base impact of 4.3 is
// 7.05 on the 0-10 range (High) and 4.2 is 6.89 (Medium)
var SUBSCORE_THRESHOLDS = {
    impact: [2.5, 4.3, 5.5],
    modifiedImpact: [2.5, 4.4, 5.6],
    exploitability: [1.6, 2.8, 3.6]
};
exports.SUBSCORE_THRESHOLDS = SUBSCORE_THRESHOLDS;

function subscoreSeverity(value, thresholds) {
    if (typeof value !== 'number' || value <= 0)
        return 'None';
    return value < thresholds[0] ? 'Low' : value < thresholds[1] ? 'Medium' : value < thresholds[2] ? 'High' : 'Critical';
}
exports.subscoreSeverity = subscoreSeverity;

function stripParagraphTags(input) {
    return input
        .replace(/<\/?p[^>]*>/gi, '') // remove all <p> or </p> tags
        .trim();
}
async function prepAuditData(data, settings) {
    /** CVSS Colors for table cells */
    var noneColor = settings.report.public.cvssColors.noneColor.replace('#', ''); //default of blue ("#4A86E8")
    var lowColor = settings.report.public.cvssColors.lowColor.replace('#', ''); //default of green ("#008000")
    var mediumColor = settings.report.public.cvssColors.mediumColor.replace('#', ''); //default of yellow ("#f9a009")
    var highColor = settings.report.public.cvssColors.highColor.replace('#', ''); //default of red ("#fe0000")
    var criticalColor = settings.report.public.cvssColors.criticalColor.replace('#', ''); //default of black ("#212121")

    var cellNoneColor = '<w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="' + noneColor + '"/></w:tcPr>';
    var cellLowColor = '<w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="'+lowColor+'"/></w:tcPr>';
    var cellMediumColor = '<w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="'+mediumColor+'"/></w:tcPr>';
    var cellHighColor = '<w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="'+highColor+'"/></w:tcPr>';
    var cellCriticalColor = '<w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="'+criticalColor+'"/></w:tcPr>';
    var cellSeverityColors = {Low: cellLowColor, Medium: cellMediumColor, High: cellHighColor, Critical: cellCriticalColor};

    /** Remediation complexity  Colors for table cells */
    
    var lowColorRemediationComplexity = settings.report.public.remediationColorsComplexity.lowColor.replace('#', ''); 
    var mediumColorRemediationComplexity = settings.report.public.remediationColorsComplexity.mediumColor.replace('#', '');
    var highColorRemediationComplexity = settings.report.public.remediationColorsComplexity.highColor.replace('#', ''); 

    var cellLowColorRemediationComplexity = '<w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="'+lowColorRemediationComplexity+'"/></w:tcPr>';
    var cellMediumColorRemediationComplexity = '<w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="'+mediumColorRemediationComplexity+'"/></w:tcPr>';
    var cellHighColorRemediationComplexity = '<w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="'+highColorRemediationComplexity+'"/></w:tcPr>';


    /** Remediation priority Colors for table cells */

    var lowColorRemediationPriority = settings.report.public.remediationColorsPriority.lowColor.replace('#', ''); 
    var mediumColorRemediationPriority = settings.report.public.remediationColorsPriority.mediumColor.replace('#', ''); 
    var highColorRemediationPriority = settings.report.public.remediationColorsPriority.highColor.replace('#', ''); 
    var urgentColorRemediationPriority = settings.report.public.remediationColorsPriority.urgentColor.replace('#', ''); 

    var cellLowColorRemediationPriority = '<w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="'+lowColorRemediationPriority+'"/></w:tcPr>';
    var cellMediumColorRemediationPriority = '<w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="'+mediumColorRemediationPriority+'"/></w:tcPr>';
    var cellHighColorRemediationPriority = '<w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="'+highColorRemediationPriority+'"/></w:tcPr>';
    var cellUrgentColorRemediationPriority = '<w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="'+urgentColorRemediationPriority+'"/></w:tcPr>';


    var result = {}
    result.name = data.name || "undefined"
    result.auditType = $t(data.auditType) || "undefined"
    result.date = data.date || "undefined"
    result.date_start = data.date_start || "undefined"
    result.date_end = data.date_end || "undefined"
    var customFields = {} // Existing custom fields by identifier
    for (const customField of await CustomField.find().select('label fieldType').lean())
        customFields[String(customField._id)] = customField
    if (data.customFields) {
        for (const field of data.customFields) {
            var definition = customFieldDefinition(field, customFields)
            if (!definition) continue
            var fieldType = definition.fieldType
            var label = definition.label

            if (fieldType === 'text')
                result[_.deburr(label.toLowerCase()).replace(/\s/g, '')] = await splitHTMLParagraphs(field.text)
            else if (fieldType !== 'space')
                result[_.deburr(label.toLowerCase()).replace(/\s/g, '')] = field.text
        }
    }

    result.company = {}
    if (data.company) {
        result.company.name = data.company.name || "undefined"
        result.company.shortName = data.company.shortName || result.company.name
        result.company.logo = data.company.logo || "undefined"
        result.company.logo_small = data.company.logo || "undefined"
        result.company.address = data.company.address || ""
        result.company.postalCode = data.company.postalCode || ""
        result.company.city = data.company.city || ""
    }

    result.client = {}
    if (data.client) {
        result.client.email = data.client.email || "undefined"
        result.client.firstname = data.client.firstname || "undefined"
        result.client.lastname = data.client.lastname || "undefined"
        result.client.phone = data.client.phone || "undefined"
        result.client.cell = data.client.cell || "undefined"
        result.client.title = data.client.title || "undefined"
    }

    result.collaborators = []
    data.collaborators.forEach(collab => {
        result.collaborators.push({
            username: collab.username || "undefined",
            firstname: collab.firstname || "undefined",
            lastname: collab.lastname || "undefined",
            email: collab.email || "undefined",
            phone: collab.phone || "undefined",
            role: collab.role || "undefined"
        })
    })

    result.reviewers = []
    data.reviewers.forEach(reviewer => {
        result.reviewers.push({
            username: reviewer.username || "undefined",
            firstname: reviewer.firstname || "undefined",
            lastname: reviewer.lastname || "undefined",
            email: reviewer.email || "undefined",
            phone: reviewer.phone || "undefined",
            role: reviewer.role || "undefined"
        })
    })


    result.language = data.language || "undefined"
    result.scope = data.scope.toObject() || []

    // Descriptions of vulnerability types in the audit language (findings[i].vulnTypeDescription)
    var vulnTypeDescriptions = {}
    for (const vulnType of await VulnerabilityType.getAll()) {
        if (vulnType.locale === data.language)
            vulnTypeDescriptions[vulnType.name] = vulnType.description || ""
    }

    result.findings = []
    for (const finding of data.findings) {
        var tmpCVSS = CVSS31.calculateCVSSFromVector(finding.cvssv3);
        var tmpFinding = {
            title: finding.title || "",
            vulnType: $t(finding.vulnType) || "",
            vulnTypeDescription: await splitHTMLParagraphs(vulnTypeDescriptions[finding.vulnType]), // HTML with images
            description: await splitHTMLParagraphs(finding.description),
            observation: await splitHTMLParagraphs(finding.observation),
            remediation: await splitHTMLParagraphs(finding.remediation),
            remediationComplexity: finding.remediationComplexity || "",
            priority: finding.priority || "",
            references: finding.references || [],
            poc: await splitHTMLParagraphs(finding.poc),
            affected: finding.scope || "",
            //affected: stripParagraphTags(finding.scope) || [],
            status: finding.status || "",
            category: $t(finding.category) || $t("No Category"),
            identifier: "IDX-" + utils.lPad(finding.identifier),
            unique_id: finding._id.toString()
        }
        // Remediation Complexity color 
        if (tmpFinding.remediationComplexity === 1) tmpFinding.remediation.cellColorComplexity = cellLowColorRemediationComplexity
        else if (tmpFinding.remediationComplexity === 2) tmpFinding.remediation.cellColorComplexity = cellMediumColorRemediationComplexity
        else if (tmpFinding.remediationComplexity === 3) tmpFinding.remediation.cellColorComplexity = cellHighColorRemediationComplexity
        else tmpFinding.remediation.cellColorComplexity = cellNoneColor

        // Remediation Priority color 
        if (tmpFinding.priority === 1) tmpFinding.remediation.cellColorPriority = cellLowColorRemediationPriority
        else if (tmpFinding.priority === 2) tmpFinding.remediation.cellColorPriority = cellMediumColorRemediationPriority
        else if (tmpFinding.priority === 3) tmpFinding.remediation.cellColorPriority = cellHighColorRemediationPriority
        else if (tmpFinding.priority === 4) tmpFinding.remediation.cellColorPriority = cellUrgentColorRemediationPriority
        else tmpFinding.remediation.cellColorPriority = cellNoneColor

        // Handle CVSS
        tmpFinding.cvss = {
            vectorString: tmpCVSS.vectorString || "",
            baseMetricScore: tmpCVSS.baseMetricScore || "",
            baseSeverity: tmpCVSS.baseSeverity || "",
            temporalMetricScore: tmpCVSS.temporalMetricScore || "",
            temporalSeverity: tmpCVSS.temporalSeverity || "",
            environmentalMetricScore: tmpCVSS.environmentalMetricScore || "",
            environmentalSeverity: tmpCVSS.environmentalSeverity || ""
        }
        if (tmpCVSS.baseImpact)
            tmpFinding.cvss.baseImpact = CVSS31.roundUp1(tmpCVSS.baseImpact)
        else
            tmpFinding.cvss.baseImpact = ""
        if (tmpCVSS.baseExploitability)
            tmpFinding.cvss.baseExploitability = CVSS31.roundUp1(tmpCVSS.baseExploitability)
        else
            tmpFinding.cvss.baseExploitability = ""

        if (tmpCVSS.environmentalModifiedImpact)
            tmpFinding.cvss.environmentalModifiedImpact = CVSS31.roundUp1(tmpCVSS.environmentalModifiedImpact)
        else
            tmpFinding.cvss.environmentalModifiedImpact = ""
        if (tmpCVSS.environmentalModifiedExploitability)
            tmpFinding.cvss.environmentalModifiedExploitability = CVSS31.roundUp1(tmpCVSS.environmentalModifiedExploitability)
        else
            tmpFinding.cvss.environmentalModifiedExploitability = ""

        if (tmpCVSS.baseSeverity === "Low") tmpFinding.cvss.cellColor = cellLowColor
        else if (tmpCVSS.baseSeverity === "Medium") tmpFinding.cvss.cellColor = cellMediumColor
        else if (tmpCVSS.baseSeverity === "High") tmpFinding.cvss.cellColor = cellHighColor
        else if (tmpCVSS.baseSeverity === "Critical") tmpFinding.cvss.cellColor = cellCriticalColor
        else tmpFinding.cvss.cellColor = cellNoneColor

        if (tmpCVSS.temporalSeverity === "Low") tmpFinding.cvss.temporalCellColor = cellLowColor
        else if (tmpCVSS.temporalSeverity === "Medium") tmpFinding.cvss.temporalCellColor = cellMediumColor
        else if (tmpCVSS.temporalSeverity === "High") tmpFinding.cvss.temporalCellColor = cellHighColor
        else if (tmpCVSS.temporalSeverity === "Critical") tmpFinding.cvss.temporalCellColor = cellCriticalColor
        else tmpFinding.cvss.temporalCellColor = cellNoneColor

        if (tmpCVSS.environmentalSeverity === "Low") tmpFinding.cvss.environmentalCellColor = cellLowColor
        else if (tmpCVSS.environmentalSeverity === "Medium") tmpFinding.cvss.environmentalCellColor = cellMediumColor
        else if (tmpCVSS.environmentalSeverity === "High") tmpFinding.cvss.environmentalCellColor = cellHighColor
        else if (tmpCVSS.environmentalSeverity === "Critical") tmpFinding.cvss.environmentalCellColor = cellCriticalColor
        else tmpFinding.cvss.environmentalCellColor = cellNoneColor

        // Colors of the subscores (#410), same colors as the scores
        var subscoreColor = (value, thresholds) => cellSeverityColors[subscoreSeverity(value, thresholds)] || cellNoneColor
        tmpFinding.cvss.baseImpactColor = subscoreColor(tmpFinding.cvss.baseImpact, SUBSCORE_THRESHOLDS.impact)
        tmpFinding.cvss.baseExploitabilityColor = subscoreColor(tmpFinding.cvss.baseExploitability, SUBSCORE_THRESHOLDS.exploitability)
        tmpFinding.cvss.environmentalModifiedImpactColor = subscoreColor(tmpFinding.cvss.environmentalModifiedImpact, SUBSCORE_THRESHOLDS.modifiedImpact)
        tmpFinding.cvss.environmentalModifiedExploitabilityColor = subscoreColor(tmpFinding.cvss.environmentalModifiedExploitability, SUBSCORE_THRESHOLDS.exploitability)

        tmpFinding.cvssObj = cvssStrToObject(tmpCVSS.vectorString)

        if (finding.customFields) {
            for (const field of finding.customFields) {
                var definition = customFieldDefinition(field, customFields)
                if (!definition) continue
                var fieldType = definition.fieldType
                var label = definition.label
                if (fieldType === 'text')
                    tmpFinding[_.deburr(label.toLowerCase()).replace(/\s/g, '').replace(/[^\w]/g, '_')] = await splitHTMLParagraphs(field.text)
                else if (fieldType !== 'space')
                    tmpFinding[_.deburr(label.toLowerCase()).replace(/\s/g, '').replace(/[^\w]/g, '_')] = field.text
            }
        }
        result.findings.push(tmpFinding)
    }

    result.categories = _
        .chain(result.findings)
        .groupBy("category")
        .map((value,key) => {return {categoryName:key, categoryFindings:value}})
        .value()

    result.creator = {}
    if (data.creator) {
        result.creator.username = data.creator.username || "undefined"
        result.creator.firstname = data.creator.firstname || "undefined"
        result.creator.lastname = data.creator.lastname || "undefined"
        result.creator.email = data.creator.email || "undefined"
        result.creator.phone = data.creator.phone || "undefined"
        result.creator.role = data.creator.role || "undefined"
    }

    for (const section of data.sections) {
        var formatSection = {
            name: $t(section.name)
        }
        if (section.text) // keep text for retrocompatibility
            formatSection.text = await splitHTMLParagraphs(section.text)
        // If only because section has "any" inside its text attribute and then skip the section.customFields
        if (section.customFields) {
            for (const field of section.customFields) {
                var definition = customFieldDefinition(field, customFields)
                if (!definition) continue
                var fieldType = definition.fieldType
                var label = definition.label
                if (fieldType === 'text')
                    formatSection[_.deburr(label.toLowerCase()).replace(/\s/g, '').replace(/[^\w]/g, '_')] = await splitHTMLParagraphs(field.text)
                else if (fieldType !== 'space')
                    formatSection[_.deburr(label.toLowerCase()).replace(/\s/g, '').replace(/[^\w]/g, '_')] = field.text
            }
        }
        result[section.field] = formatSection
    }
    replaceSubTemplating(result)
    return result
}

// Type and label of the custom field of a value: custom field populated (audit, findings), copy stored with the value
// (sections) or identifier (accepted by the API, not populated). A deleted custom field is populated as null: the label
// stored with the value (old format of the findings) is used if any, otherwise the value is left out of the report.
function customFieldDefinition(field, customFields) {
    var customField = field.customField
    var definition = null
    if (customField && typeof customField.label === 'string')
        definition = customField
    else if (customField)
        definition = customFields[String(customField._id || customField)] || null
    else if (typeof field.label === 'string')
        definition = {fieldType: field.fieldType, label: field.label}
    return definition && typeof definition.label === 'string' ? definition : null
}

async function splitHTMLParagraphs(data) {
    var result = []
    if (!data)
        return result

    var splitted = data.split(/(<img.+?src=".*?".+?alt=".*?".*?>)/)

    for (const value of splitted){
        if (value.startsWith("<img")) {
            var src = value.match(/<img.+src="(.*?)"/) || ""
            var alt = value.match(/<img.+alt="(.*?)"/) || ""
            if (src && src.length > 1) src = src[1]
            if (alt && alt.length > 1) alt = _.unescape(alt[1])

            // Width chosen in the editor (data-width), default width from settings otherwise
            var width = value.match(/<img.+data-width="(.*?)"/)
            width = (width && IMAGE_WIDTH_RATIOS[width[1]]) ? width[1] : 'default'

            var imageFound = true
            if (!src.startsWith('data')){
                try {
                    src = (await Image.getOne(src)).value
                } catch (error) {
                    src = "data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA="
                    imageFound = false // Keep the 1px placeholder small
                }
            }
            if (imageFound)
                src = setImageWidthParam(src, width)
            if (result.length === 0)
                result.push({text: "", images: []})
            result[result.length-1].images.push({image: src, caption: alt})
        }
        else if (value === "") {
            continue
        }
        else {
            result.push({text: value, images: []})
        }
    }
    return result
}

function replaceSubTemplating(o, originalData = o){
    var regexp = /\{_\{([a-zA-Z0-9\[\]\_\.]{1,})\}_\}/gm;
    if (Array.isArray(o))
        o.forEach(key => replaceSubTemplating(key, originalData))
    else if (typeof o === 'object' && !!o) {
        Object.keys(o).forEach(key => {
            if (typeof o[key] === 'string') o[key] = o[key].replace(regexp, (match, word) =>  _.get(originalData,word.trim(),''))
            else replaceSubTemplating(o[key], originalData)
        })
    }
}
