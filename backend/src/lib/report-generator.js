var fs = require('fs');
var Docxtemplater = require('docxtemplater');
var PizZip = require("pizzip");
var expressions = require('angular-expressions');
var ImageModule = require('docxtemplater-image-module-pwndoc');
var sizeOf = require('image-size');
var customGenerator = require('./custom-generator');
var chartGenerator = require('./chart-generator');
var utils = require('./utils');
var html2ooxml = require('./html2ooxml');
var _ = require('lodash');
var Image = require('mongoose').model('Image');
var Settings = require('mongoose').model('Settings');
var CVSS31 = require('./cvsscalc31.js');
var CVSS40 = require('./cvsscalc40.js');
var translate = require('../translate')
var $t
var pieChartXML
var barChartXML
var zip
var numberOfPieChart = 0
var numberOfBarChart = 0
var chartRelXml = ''
var chartContentTypeXml = ''

const encodeHTMLEntities = s => s.replace(/[\u00A0-\u9999<>&]/g, i => '&#'+i.charCodeAt(0)+';')

// Generate document with docxtemplater
async function generateDoc(audit) {

    var templatePath = `${__basedir}/../report-templates/${audit.template.name}.${audit.template.ext || 'docx'}`
    var content = fs.readFileSync(templatePath, "binary");

    zip = new PizZip(content);

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
    var doc = new Docxtemplater(zip, {
        modules: [imageModule],
        parser: parser,
        paragraphLoop: true
    });
    
    customGenerator.apply(preppedAudit);

    try {
        doc.render(preppedAudit);
    }
    catch (error) {
        if (error.properties.id === 'multi_error') {
            error.properties.errors.forEach(function(err) {
                console.log(err);
            });
        }
        else
            console.log(error)
        if (error.properties && error.properties.errors instanceof Array) {
            const errorMessages = error.properties.errors.map(function (error) {
                return `Explanation: ${error.properties.explanation}\nScope: ${JSON.stringify(error.properties.scope).substring(0,142)}...`
            }).join("\n\n");
            // errorMessages is a humanly readable message looking like this :
            // 'The tag beginning with "foobar" is unopened'
            throw `Template Error:\n${errorMessages}`;
        }
        else {
            throw error
        }
    }

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
exports.generateDoc = generateDoc;

// *** Angular parser filters ***

// Keep only first finding with a given title
expressions.filters.uniqFindings = function (findings) {
    if (!findings) return findings;
    titles = [];
    filtered_findings = [];
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

    if (start_date.getYear() != end_date.getYear()) {
        options = {day: '2-digit', month: '2-digit', year: 'numeric'};
        start_str = start_date.toLocaleDateString(locale, options);
    }
    else if (start_date.getMonth() != end_date.getMonth()) {
        options = {day: '2-digit', month: '2-digit'};
        start_str = start_date.toLocaleDateString(locale, options);
    }
    else if (start_date.getDay() != end_date.getDay()) {
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
            (rv[x[key]] = rv[x[key]] || []).push(x);
            return rv;
        }, {})
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
    // Ne pas créer de paragraphe si le contenu est vide
    if (!input || input === "" || input === "undefined" || input === null) {
        return "";
    }

    // Si l'input contient déjà un paragraphe, ne pas en créer un nouveau
    if (input.includes('<w:p>') && input.includes('</w:p>')) {
        // Si un style est demandé, l'ajouter au paragraphe existant
        if (style) {
            let style_parsed = style.replaceAll(' ', '');
            if (style_parsed === 'Bullets') {
                return input.replace('<w:p>', '<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>');
            }
        }
        return input;
    }

    // Créer un nouveau paragraphe si nécessaire
    let result = '<w:p>';
    if (style !== null) {
        let style_parsed = style.replaceAll(' ', '');
        if (style_parsed === 'Bullets') {
            result += '<w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>';
        } else {
            result += '<w:pPr><w:pStyle w:val="' + style_parsed + '"/></w:pPr>';
        }
    }
    result += '<w:r><w:t>' + input + '</w:t></w:r></w:p>';
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
        return input.sort(function(a, b) {
            return _getPropertyValue(a, key) < _getPropertyValue(b, key);
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
        return expressions.compile(query)(item);
    });
};

// Convert HTML data to Open Office XML format: {@input | convertHTML: 'customStyle'}
expressions.filters.convertHTML = function(input, style) {
    if (typeof input === 'undefined')
        var result = html2ooxml('')
    else
        var result = html2ooxml(input.replace(/(<p><\/p>)+$/, ''), style)
    return result;
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

    valueXML = `<c:ptCount val="${Object.keys(dataTypeCount).length}"/>`;
    legendXML = `<c:ptCount val="${Object.keys(dataTypeCount).length}"/>`;

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
// Source: https://stackoverflow.com/a/37510735
function _getPropertyValue(obj, dataToRetrieve) {
  return dataToRetrieve
    .split('.')
    .reduce(function(o, k) {
      return o && o[k];
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

// Compile all angular expressions
var angularParser = function(tag) {
    expressions = {...expressions, ...customGenerator.expressions};
    if (tag === '.') {
        return {
            get: function(s){ return s;}
        };
    }
    const expr = expressions.compile(
        tag.replace(/(’|‘)/g, "'").replace(/(“|”)/g, '"')
    );
    return {
        get: function(scope, context) {
            let obj = {};
            const scopeList = context.scopeList;
            const num = context.num;
            for (let i = 0, len = num + 1; i < len; i++) {
                obj = _.merge(obj, scopeList[i]);
            }
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

// Parse CVSS 4.0 vector string to object for document generation
function cvssStrToObject40(cvss) {
    var initialState = 'Not Defined'
    var res = {
        // Base metrics
        AV: initialState, AC: initialState, AT: initialState, PR: initialState, UI: initialState,
        VC: initialState, VI: initialState, VA: initialState, SC: initialState, SI: initialState, SA: initialState,
        // Threat metrics (replacing Temporal)
        E: initialState,
        // Environmental metrics - Requirements
        CR: initialState, IR: initialState, AR: initialState,
        // Environmental metrics - Modified Base Metrics
        MAV: initialState, MAC: initialState, MAT: initialState, MPR: initialState, MUI: initialState,
        MVC: initialState, MVI: initialState, MVA: initialState, MSC: initialState, MSI: initialState, MSA: initialState,
        // Supplemental metrics
        S: initialState, AU: initialState, R: initialState, V: initialState, RE: initialState, U: initialState
    };
    
    if (cvss) {
        var temp = cvss.split('/');
        for (var i = 0; i < temp.length; i++) {
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
                case "AT": // New in CVSS 4.0
                    if (elt[1] === "N") res.AT = "None"
                    else if (elt[1] === "P") res.AT = "Present"
                    res.AT = $t(res.AT)
                    break;
                case "PR":
                    if (elt[1] === "N") res.PR = "None"
                    else if (elt[1] === "L") res.PR = "Low"
                    else if (elt[1] === "H") res.PR = "High"
                    res.PR = $t(res.PR)
                    break;
                case "UI":
                    if (elt[1] === "N") res.UI = "None"
                    else if (elt[1] === "P") res.UI = "Passive"
                    else if (elt[1] === "A") res.UI = "Active"
                    res.UI = $t(res.UI)
                    break;
                // Vulnerable System Impact
                case "VC":
                    if (elt[1] === "N") res.VC = "None"
                    else if (elt[1] === "L") res.VC = "Low"
                    else if (elt[1] === "H") res.VC = "High"
                    res.VC = $t(res.VC)
                    break;
                case "VI":
                    if (elt[1] === "N") res.VI = "None"
                    else if (elt[1] === "L") res.VI = "Low"
                    else if (elt[1] === "H") res.VI = "High"
                    res.VI = $t(res.VI)
                    break;
                case "VA":
                    if (elt[1] === "N") res.VA = "None"
                    else if (elt[1] === "L") res.VA = "Low"
                    else if (elt[1] === "H") res.VA = "High"
                    res.VA = $t(res.VA)
                    break;
                // Subsequent System Impact (New in CVSS 4.0)
                case "SC":
                    if (elt[1] === "N") res.SC = "None"
                    else if (elt[1] === "L") res.SC = "Low"
                    else if (elt[1] === "H") res.SC = "High"
                    res.SC = $t(res.SC)
                    break;
                case "SI":
                    if (elt[1] === "N") res.SI = "None"
                    else if (elt[1] === "L") res.SI = "Low"
                    else if (elt[1] === "H") res.SI = "High"
                    res.SI = $t(res.SI)
                    break;
                case "SA":
                    if (elt[1] === "N") res.SA = "None"
                    else if (elt[1] === "L") res.SA = "Low"
                    else if (elt[1] === "H") res.SA = "High"
                    res.SA = $t(res.SA)
                    break;
                // Threat metrics (replacing Temporal in CVSS 3.1)
                case "E":
                    if (elt[1] === "X") res.E = "Not Defined"
                    else if (elt[1] === "A") res.E = "Attacked"
                    else if (elt[1] === "U") res.E = "Unreported"
                    else if (elt[1] === "P") res.E = "Proof-of-Concept"
                    else if (elt[1] === "F") res.E = "Functional"
                    else if (elt[1] === "H") res.E = "High"
                    res.E = $t(res.E)
                    break;
                // Environmental metrics
                case "CR":
                    if (elt[1] === "X") res.CR = "Not Defined"
                    else if (elt[1] === "L") res.CR = "Low"
                    else if (elt[1] === "M") res.CR = "Medium"
                    else if (elt[1] === "H") res.CR = "High"
                    res.CR = $t(res.CR)
                    break;
                case "IR":
                    if (elt[1] === "X") res.IR = "Not Defined"
                    else if (elt[1] === "L") res.IR = "Low"
                    else if (elt[1] === "M") res.IR = "Medium"
                    else if (elt[1] === "H") res.IR = "High"
                    res.IR = $t(res.IR)
                    break;
                case "AR":
                    if (elt[1] === "X") res.AR = "Not Defined"
                    else if (elt[1] === "L") res.AR = "Low"
                    else if (elt[1] === "M") res.AR = "Medium"
                    else if (elt[1] === "H") res.AR = "High"
                    res.AR = $t(res.AR)
                    break;
                // Modified Base Metrics (Environmental)
                case "MAV":
                    if (elt[1] === "X") res.MAV = "Not Defined"
                    else if (elt[1] === "N") res.MAV = "Network"
                    else if (elt[1] === "A") res.MAV = "Adjacent Network"
                    else if (elt[1] === "L") res.MAV = "Local"
                    else if (elt[1] === "P") res.MAV = "Physical"
                    res.MAV = $t(res.MAV)
                    break;
                case "MAC":
                    if (elt[1] === "X") res.MAC = "Not Defined"
                    else if (elt[1] === "L") res.MAC = "Low"
                    else if (elt[1] === "H") res.MAC = "High"
                    res.MAC = $t(res.MAC)
                    break;
                case "MAT":
                    if (elt[1] === "X") res.MAT = "Not Defined"
                    else if (elt[1] === "N") res.MAT = "None"
                    else if (elt[1] === "P") res.MAT = "Present"
                    res.MAT = $t(res.MAT)
                    break;
                case "MPR":
                    if (elt[1] === "X") res.MPR = "Not Defined"
                    else if (elt[1] === "N") res.MPR = "None"
                    else if (elt[1] === "L") res.MPR = "Low"
                    else if (elt[1] === "H") res.MPR = "High"
                    res.MPR = $t(res.MPR)
                    break;
                case "MUI":
                    if (elt[1] === "X") res.MUI = "Not Defined"
                    else if (elt[1] === "N") res.MUI = "None"
                    else if (elt[1] === "P") res.MUI = "Passive"
                    else if (elt[1] === "A") res.MUI = "Active"
                    res.MUI = $t(res.MUI)
                    break;
                case "MVC":
                    if (elt[1] === "X") res.MVC = "Not Defined"
                    else if (elt[1] === "N") res.MVC = "None"
                    else if (elt[1] === "L") res.MVC = "Low"
                    else if (elt[1] === "H") res.MVC = "High"
                    res.MVC = $t(res.MVC)
                    break;
                case "MVI":
                    if (elt[1] === "X") res.MVI = "Not Defined"
                    else if (elt[1] === "N") res.MVI = "None"
                    else if (elt[1] === "L") res.MVI = "Low"
                    else if (elt[1] === "H") res.MVI = "High"
                    res.MVI = $t(res.MVI)
                    break;
                case "MVA":
                    if (elt[1] === "X") res.MVA = "Not Defined"
                    else if (elt[1] === "N") res.MVA = "None"
                    else if (elt[1] === "L") res.MVA = "Low"
                    else if (elt[1] === "H") res.MVA = "High"
                    res.MVA = $t(res.MVA)
                    break;
                case "MSC":
                    if (elt[1] === "X") res.MSC = "Not Defined"
                    else if (elt[1] === "N") res.MSC = "None"
                    else if (elt[1] === "L") res.MSC = "Low"
                    else if (elt[1] === "H") res.MSC = "High"
                    res.MSC = $t(res.MSC)
                    break;
                case "MSI":
                    if (elt[1] === "X") res.MSI = "Not Defined"
                    else if (elt[1] === "N") res.MSI = "None"
                    else if (elt[1] === "L") res.MSI = "Low"
                    else if (elt[1] === "H") res.MSI = "High"
                    res.MSI = $t(res.MSI)
                    break;
                case "MSA":
                    if (elt[1] === "X") res.MSA = "Not Defined"
                    else if (elt[1] === "N") res.MSA = "None"
                    else if (elt[1] === "L") res.MSA = "Low"
                    else if (elt[1] === "H") res.MSA = "High"
                    res.MSA = $t(res.MSA)
                    break;
                // Supplemental Metrics
                case "S":
                    if (elt[1] === "X") res.S = "Not Defined"
                    else if (elt[1] === "N") res.S = "None"
                    else if (elt[1] === "P") res.S = "Present"
                    else if (elt[1] === "H") res.S = "High"
                    res.S = $t(res.S)
                    break;
                case "AU":
                    if (elt[1] === "X") res.AU = "Not Defined"
                    else if (elt[1] === "N") res.AU = "None"
                    else if (elt[1] === "Y") res.AU = "Yes"
                    res.AU = $t(res.AU)
                    break;
                case "R":
                    if (elt[1] === "X") res.R = "Not Defined"
                    else if (elt[1] === "A") res.R = "Automatic"
                    else if (elt[1] === "U") res.R = "User"
                    else if (elt[1] === "I") res.R = "Irrecoverable"
                    res.R = $t(res.R)
                    break;
                case "V":
                    if (elt[1] === "X") res.V = "Not Defined"
                    else if (elt[1] === "D") res.V = "Diffuse"
                    else if (elt[1] === "C") res.V = "Concentrated"
                    res.V = $t(res.V)
                    break;
                case "RE":
                    if (elt[1] === "X") res.RE = "Not Defined"
                    else if (elt[1] === "L") res.RE = "Low"
                    else if (elt[1] === "M") res.RE = "Medium"
                    else if (elt[1] === "H") res.RE = "High"
                    res.RE = $t(res.RE)
                    break;
                case "U":
                    if (elt[1] === "X") res.U = "Not Defined"
                    else if (elt[1] === "C") res.U = "Clear"
                    else if (elt[1] === "G") res.U = "Green"
                    else if (elt[1] === "F") res.U = "Functional"
                    else if (elt[1] === "R") res.U = "Red"
                    res.U = $t(res.U)
                    break;
            }
        }
    }
    return res
}

function stripParagraphTags(input) {
    console.log("JE STRIP MES PARAMETRES")
    return input
        .replace(/<\/?p[^>]*>/gi, '') // supprime toutes les balises <p> ou </p>
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
    if (data.customFields) {
        for (field of data.customFields) {
            var fieldType = field.customField.fieldType
            var label = field.customField.label

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

    result.findings = []
    for (finding of data.findings) {
        // Determine which CVSS version to use
        var useCVSS40 = finding.cvssv4 && finding.cvssv4.startsWith('CVSS:4.0');
        var tmpCVSS;
        
        if (useCVSS40) {
            tmpCVSS = CVSS40.calculateCVSSFromVector(finding.cvssv4);
        } else {
            tmpCVSS = CVSS31.calculateCVSSFromVector(finding.cvssv3);
        }
        var tmpFinding = {
            title: finding.title || "",
            vulnType: $t(finding.vulnType) || "",
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
        console.log(tmpFinding)
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

        // Always create CVSS 3.1 object for backward compatibility
        var tmpCVSS31 = CVSS31.calculateCVSSFromVector(finding.cvssv3);
        tmpFinding.cvss = {
            version: "3.1",
            vectorString: tmpCVSS31.vectorString || "",
            baseMetricScore: tmpCVSS31.baseMetricScore || "",
            baseSeverity: tmpCVSS31.baseSeverity || "",
            temporalMetricScore: tmpCVSS31.temporalMetricScore || "",
            temporalSeverity: tmpCVSS31.temporalSeverity || "",
            environmentalMetricScore: tmpCVSS31.environmentalMetricScore || "",
            environmentalSeverity: tmpCVSS31.environmentalSeverity || ""
        }

        // Create CVSS 4.0 object if CVSS 4.0 data exists
        if (useCVSS40) {
            tmpFinding.cvss4 = {
                version: "4.0",
                vectorString: tmpCVSS.vectorString || finding.cvssv4 || "",
                baseMetricScore: tmpCVSS.baseMetricScore || "",
                baseSeverity: tmpCVSS.baseSeverity || "",
                threatMetricScore: tmpCVSS.threatMetricScore || "",
                threatSeverity: tmpCVSS.threatSeverity || "",
                environmentalMetricScore: tmpCVSS.environmentalMetricScore || "",
                environmentalSeverity: tmpCVSS.environmentalSeverity || "",
                exploitability: tmpCVSS.exploitability || "",
                vulnerableSystemImpact: tmpCVSS.vulnerableSystemImpact || "",
                subsequentSystemImpact: tmpCVSS.subsequentSystemImpact || ""
            }
        }
        // Always handle CVSS 3.1 sub-scores
        if (tmpCVSS31.baseImpact)
            tmpFinding.cvss.baseImpact = CVSS31.roundUp1(tmpCVSS31.baseImpact)
        else
            tmpFinding.cvss.baseImpact = ""
        if (tmpCVSS31.baseExploitability)
            tmpFinding.cvss.baseExploitability = CVSS31.roundUp1(tmpCVSS31.baseExploitability)
        else
            tmpFinding.cvss.baseExploitability = ""

        if (tmpCVSS31.environmentalModifiedImpact)
            tmpFinding.cvss.environmentalModifiedImpact = CVSS31.roundUp1(tmpCVSS31.environmentalModifiedImpact)
        else
            tmpFinding.cvss.environmentalModifiedImpact = ""
        if (tmpCVSS31.environmentalModifiedExploitability)
            tmpFinding.cvss.environmentalModifiedExploitability = CVSS31.roundUp1(tmpCVSS31.environmentalModifiedExploitability)
        else
            tmpFinding.cvss.environmentalModifiedExploitability = ""

        // Handle CVSS 4.0 sub-scores if CVSS 4.0 data exists
        if (useCVSS40) {
            if (tmpCVSS.exploitability)
                tmpFinding.cvss4.exploitability = CVSS40.roundUp1(tmpCVSS.exploitability)
            else
                tmpFinding.cvss4.exploitability = ""
            if (tmpCVSS.vulnerableSystemImpact)
                tmpFinding.cvss4.vulnerableSystemImpact = CVSS40.roundUp1(tmpCVSS.vulnerableSystemImpact)
            else
                tmpFinding.cvss4.vulnerableSystemImpact = ""
            if (tmpCVSS.subsequentSystemImpact)
                tmpFinding.cvss4.subsequentSystemImpact = CVSS40.roundUp1(tmpCVSS.subsequentSystemImpact)
            else
                tmpFinding.cvss4.subsequentSystemImpact = ""
        }

        // CVSS 3.1 colors (always present for backward compatibility)
        if (tmpCVSS31.baseSeverity === "Low") tmpFinding.cvss.cellColor = cellLowColor
        else if (tmpCVSS31.baseSeverity === "Medium") tmpFinding.cvss.cellColor = cellMediumColor
        else if (tmpCVSS31.baseSeverity === "High") tmpFinding.cvss.cellColor = cellHighColor
        else if (tmpCVSS31.baseSeverity === "Critical") tmpFinding.cvss.cellColor = cellCriticalColor
        else tmpFinding.cvss.cellColor = cellNoneColor

        if (tmpCVSS31.temporalSeverity === "Low") tmpFinding.cvss.temporalCellColor = cellLowColor
        else if (tmpCVSS31.temporalSeverity === "Medium") tmpFinding.cvss.temporalCellColor = cellMediumColor
        else if (tmpCVSS31.temporalSeverity === "High") tmpFinding.cvss.temporalCellColor = cellHighColor
        else if (tmpCVSS31.temporalSeverity === "Critical") tmpFinding.cvss.temporalCellColor = cellCriticalColor
        else tmpFinding.cvss.temporalCellColor = cellNoneColor

        if (tmpCVSS31.environmentalSeverity === "Low") tmpFinding.cvss.environmentalCellColor = cellLowColor
        else if (tmpCVSS31.environmentalSeverity === "Medium") tmpFinding.cvss.environmentalCellColor = cellMediumColor
        else if (tmpCVSS31.environmentalSeverity === "High") tmpFinding.cvss.environmentalCellColor = cellHighColor
        else if (tmpCVSS31.environmentalSeverity === "Critical") tmpFinding.cvss.environmentalCellColor = cellCriticalColor
        else tmpFinding.cvss.environmentalCellColor = cellNoneColor

        // CVSS 4.0 colors (only if CVSS 4.0 data exists)
        if (useCVSS40) {
            if (tmpCVSS.baseSeverity === "Low") tmpFinding.cvss4.cellColor = cellLowColor
            else if (tmpCVSS.baseSeverity === "Medium") tmpFinding.cvss4.cellColor = cellMediumColor
            else if (tmpCVSS.baseSeverity === "High") tmpFinding.cvss4.cellColor = cellHighColor
            else if (tmpCVSS.baseSeverity === "Critical") tmpFinding.cvss4.cellColor = cellCriticalColor
            else tmpFinding.cvss4.cellColor = cellNoneColor

            if (tmpCVSS.threatSeverity === "Low") tmpFinding.cvss4.threatCellColor = cellLowColor
            else if (tmpCVSS.threatSeverity === "Medium") tmpFinding.cvss4.threatCellColor = cellMediumColor
            else if (tmpCVSS.threatSeverity === "High") tmpFinding.cvss4.threatCellColor = cellHighColor
            else if (tmpCVSS.threatSeverity === "Critical") tmpFinding.cvss4.threatCellColor = cellCriticalColor
            else tmpFinding.cvss4.threatCellColor = cellNoneColor

            if (tmpCVSS.environmentalSeverity === "Low") tmpFinding.cvss4.environmentalCellColor = cellLowColor
            else if (tmpCVSS.environmentalSeverity === "Medium") tmpFinding.cvss4.environmentalCellColor = cellMediumColor
            else if (tmpCVSS.environmentalSeverity === "High") tmpFinding.cvss4.environmentalCellColor = cellHighColor
            else if (tmpCVSS.environmentalSeverity === "Critical") tmpFinding.cvss4.environmentalCellColor = cellCriticalColor
            else tmpFinding.cvss4.environmentalCellColor = cellNoneColor
        }

        // Always create CVSS 3.1 object for backward compatibility
        tmpFinding.cvssObj = cvssStrToObject(tmpCVSS31.vectorString);

        // Create CVSS 4.0 object if CVSS 4.0 data exists
        if (useCVSS40) {
            tmpFinding.cvss4Obj = cvssStrToObject40(finding.cvssv4);
        }

        if (finding.customFields) {
            for (field of finding.customFields) {
                // For retrocompatibility of findings with old customFields
                // or if custom field has been deleted, last saved custom fields will be available
                if (field.customField) {
                    var fieldType = field.customField.fieldType
                    var label = field.customField.label
                }
                else {
                    var fieldType = field.fieldType
                    var label = field.label
                }
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

    for (section of data.sections) {
        var formatSection = {
            name: $t(section.name)
        }
        if (section.text) // keep text for retrocompatibility
            formatSection.text = await splitHTMLParagraphs(section.text)
        // If only because section has "any" inside its text attribute and then skip the section.customFields
        if (section.customFields) {
            for (field of section.customFields) {
                var fieldType = field.customField.fieldType
                var label = field.customField.label
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

async function splitHTMLParagraphs(data) {
    var result = []
    if (!data)
        return result

    var splitted = data.split(/(<img.+?src=".*?".+?alt=".*?".*?>)/)

    for (value of splitted){
        if (value.startsWith("<img")) {
            var src = value.match(/<img.+src="(.*?)"/) || ""
            var alt = value.match(/<img.+alt="(.*?)"/) || ""
            if (src && src.length > 1) src = src[1]
            if (alt && alt.length > 1) alt = _.unescape(alt[1])

            if (!src.startsWith('data')){
                try {
                    src = (await Image.getOne(src)).value
                } catch (error) {
                    src = "data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA="
                }
            }
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
