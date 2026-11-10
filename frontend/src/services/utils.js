var _ = require("lodash");
import { $t } from "boot/i18n";
import DOMPurify from "dompurify";

// HTML of the editors displayed with v-html (previews, differences between versions): only the tags and
// attributes produced by the editor are kept, everything else is removed (scripts, event handlers, unknown tags...)
const EDITOR_TAGS = [
  'p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'hr',
  'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'mark', 'code', 'pre', 'span',
  'ul', 'ol', 'li', 'a',
  'table', 'colgroup', 'col', 'thead', 'tbody', 'tr', 'th', 'td',
  'img', 'figure', 'figcaption', 'legend'
];

const TAG_ATTRIBUTES = {
  A: ['href', 'target', 'rel'],
  IMG: ['src', 'alt', 'title', 'class', 'data-width'],
  LEGEND: ['label', 'alt'], // Captions
  MARK: ['data-color', 'style'], // Highlight colors
  CODE: ['class'],
  SPAN: ['class'],
  OL: ['start'],
  TABLE: ['style'],
  COL: ['style'],
  TH: ['colspan', 'rowspan', 'colwidth'],
  TD: ['colspan', 'rowspan', 'colwidth']
};

const EDITOR_ATTRIBUTES = [...new Set(Object.values(TAG_ATTRIBUTES).flat())];

// Images: ID of an uploaded image, base64 image (old data) or external image
const IMAGE_SOURCE = /^(?:[a-f0-9]{24}|data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+|https?:\/\/[^\s"'<>]+)$/i;

const CLASS_VALUES = {
  IMG: /^custom-image$/,
  CODE: /^language-[\w#+-]+$/, // Language of the code blocks
  SPAN: /^hljs-[\w-]+(?:\s+[\w-]+)*$/ // Syntax highlighting of the code blocks
};

// Differences between versions (editor.vue): parts added, removed or unchanged
const DIFF_CLASS = /^diff(?:add|rem|eq)$/;

// Inline styles produced by the editor: highlight colors and table column widths
const STYLE_VALUE = /^(?:\s*(?:background-color|color|width|min-width)\s*:\s*[#\w%.,()\s-]+;?)*\s*$/i;

function isValidAttribute(tag, name, value, allowDiffClass) {
  if (!(TAG_ATTRIBUTES[tag] || []).includes(name))
    return false;
  if (name === 'src')
    return IMAGE_SOURCE.test(value);
  if (name === 'class')
    return CLASS_VALUES[tag].test(value) || (allowDiffClass && tag === 'SPAN' && DIFF_CLASS.test(value));
  if (name === 'style')
    return STYLE_VALUE.test(value) && !/url\s*\(|expression\s*\(|\\/i.test(value);
  if (name === 'target')
    return value === '_blank';
  return true;
}

// Dedicated DOMPurify instances: their hooks do not affect other uses of DOMPurify
function createPurifier(allowDiffClass) {
  const purifier = DOMPurify(window);
  purifier.addHook('uponSanitizeAttribute', (node, data) => {
    if (!isValidAttribute(node.nodeName, data.attrName, data.attrValue, allowDiffClass))
      data.keepAttr = false; // Values kept are then checked by DOMPurify (URLs of the links...)
  });
  return purifier;
}

const PURIFY_CONFIG = { ALLOWED_TAGS: EDITOR_TAGS, ALLOWED_ATTR: EDITOR_ATTRIBUTES, ALLOW_DATA_ATTR: false };
let editorPurifier = null;
let diffPurifier = null;

export default {
  // Sanitizes the HTML of an editor before displaying it with v-html
  htmlEncode(html) {
    if (typeof html !== "string") return "";
    editorPurifier = editorPurifier || createPurifier(false);
    return editorPurifier.sanitize(html, PURIFY_CONFIG);
  },

  // Sanitizes the differences between two versions of an editor (HTML with the diff markers) before displaying them
  htmlEncodeDiff(html) {
    if (typeof html !== "string") return "";
    diffPurifier = diffPurifier || createPurifier(true);
    return diffPurifier.sanitize(html, PURIFY_CONFIG);
  },

  // Message of the server for a failed request (JSON in a Blob for the downloads), else the message of the error
  async requestErrorMessage(err) {
    var data = err.response && err.response.data;
    if (data instanceof Blob) {
      try { data = JSON.parse(await data.text()) } catch (e) { data = null }
    }
    return (data && data.datas) || err.message;
  },

  // Update all basic-editor when noSync is necessary for performance (text with images).
  syncEditors: function (refs) {
    Object.keys(refs).forEach((key) => {
      if (key.startsWith("basiceditor_") && refs[key]) {
        // ref must start with 'basiceditor_'
        Array.isArray(refs[key])
          ? refs[key].forEach((elt) => elt.updateHTML())
          : refs[key].updateHTML();
      } else if (refs[key] && refs[key].$refs) {
        // check for editors in child components
        this.syncEditors(refs[key].$refs);
      }
    });
  },

  // Compress images to allow more storage in database since limit in a mongo document is 16MB
  resizeImg: function (imageB64) {
    return new Promise((resolve, reject) => {
      var oldSize = JSON.stringify(imageB64).length;
      var max_width = 1920;

      var img = new Image();
      img.src = imageB64;
      img.onload = function () {
        //scale the image and keep aspect ratio
        var resize_width = this.width > max_width ? max_width : this.width;
        var scaleFactor = resize_width / this.width;
        var resize_height = this.height * scaleFactor;

        // Create a temporary canvas to draw the downscaled image on.
        var canvas = document.createElement("canvas");
        canvas.width = resize_width;
        canvas.height = resize_height;

        //draw in canvas
        var ctx = canvas.getContext("2d");
        ctx.drawImage(this, 0, 0, resize_width, resize_height);

        // Detect original format to preserve transparency
        var originalFormat = "image/jpeg"; // default
        if (imageB64.startsWith("data:")) {
          var formatMatch = imageB64.match(/data:([^;]+)/);
          if (formatMatch) {
            originalFormat = formatMatch[1];
          }
        }

        // Choose output format based on original format
        var outputFormat = "image/jpeg";
        var quality = 0.9;
        
        // Preserve transparency for formats that support it
        if (originalFormat === "image/png" || 
            originalFormat === "image/webp" || 
            originalFormat === "image/gif") {
          outputFormat = "image/png";
          // PNG doesn't use quality parameter, so we don't pass it
          var result = canvas.toDataURL(outputFormat);
        } else {
          // Use JPEG with quality for photos without transparency
          var result = canvas.toDataURL(outputFormat, quality);
        }

        var newSize = JSON.stringify(result).length;
        if (newSize >= oldSize) resolve(imageB64);
        else resolve(result);
      };
    });
  },

  customFilter: function (rows, terms) {
    var result =
      rows &&
      rows.filter((row) => {
        for (const [key, value] of Object.entries(terms)) {
          // for each search term
          var searchString = _.get(row, key) || "";
          if (typeof searchString === "string")
            searchString = searchString
              .toLowerCase()
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "");
          var termString = value || "";
          if (typeof termString === "string")
            termString = termString
              .toLowerCase()
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "");
          if (
            typeof searchString !== "string" ||
            typeof termString !== "string"
          )
            return searchString === termString;
          if (searchString.indexOf(termString) < 0) {
            return false;
          }
        }
        return true;
      });
    return result;
  },

  filterCustomFields: function (
    page,
    displaySub,
    customFields = [],
    objectFields = [],
    locale = ""
  ) {
    var cFields = [];
    var display = [];

    customFields.forEach((field) => {
      switch (page) {
        case "finding":
          display = ["finding", "vulnerability"];
          break;
        case "vulnerability":
          display = ["vulnerability"];
          break;
        case "audit-general":
          display = ["general"];
          break;
        case "section":
          display = ["section"];
          break;
      }

      if (
        display.includes(field.display) &&
        (field.displaySub === "" || field.displaySub === displaySub)
      ) {
        // wanted field
        var fieldText = "";
        if (["select-multiple", "checkbox"].includes(field.fieldType))
          fieldText = [];
        if (locale && Array.isArray(field.text)) {
          // set default text for locale if it exists
          let textLocale = field.text.find((e) => e.locale === locale);
          if (textLocale) fieldText = textLocale.value;
        }
        for (var i = 0; i < objectFields.length; i++) {
          // Set corresponding text value
          var customFieldId = "";
          if (typeof objectFields[i].customField === "object")
            customFieldId = objectFields[i].customField._id;
          else customFieldId = objectFields[i].customField;
          if (customFieldId && customFieldId === field._id) {
            // found correct field for text
            if (objectFields[i].text) {
              // text already exists
              fieldText = objectFields[i].text;
            }
            break;
          }
        }

        cFields.push({
          customField: _.omit(field, ["text"]),
          text: fieldText,
        });
      }
    });

    return cFields;
  },

  normalizeString: function (value) {
    return value
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  },

  // Render a text template with {variable} placeholders (e.g. findings label in the audit sidebar)
  // - variables: {name: value or function returning the value}, names are case insensitive
  // - {custom.Label}: value of the custom field with this label (case insensitive), empty if not set
  // Unknown variables are left as is so that typos stay visible.
  // The result is plain text: it must be displayed with text interpolation, never with v-html.
  renderTemplate: function (template, variables, customFields = []) {
    if (typeof template !== "string") return "";
    var vars = {};
    Object.keys(variables).forEach((name) => {
      vars[name.toLowerCase()] = variables[name];
    });

    return template.replace(/\{([^{}]+)\}/g, (match, name) => {
      var key = name.trim().toLowerCase();
      var value;
      if (key.startsWith("custom.")) {
        var label = key.substring("custom.".length).trim();
        var field = (customFields || []).find(
          (f) => f && f.customField && typeof f.customField.label === "string" && f.customField.label.trim().toLowerCase() === label
        );
        value = field ? this.customFieldToText(field) : "";
      }
      else if (Object.prototype.hasOwnProperty.call(vars, key)) {
        value = typeof vars[key] === "function" ? vars[key]() : vars[key];
      }
      else {
        return match;
      }
      return value === null || value === undefined ? "" : String(value);
    });
  },

  // Variables available in the findings sidebar template (Settings > General Settings)
  // context: {index: position of the finding in the audit (gives the report identifier), cvss: function returning {severity, score}}
  // Values needing computation are functions: they are only evaluated if used in the template
  findingTemplateVariables: function (finding, context) {
    var priorities = { 1: $t("low"), 2: $t("medium"), 3: $t("high"), 4: $t("urgent") };
    var complexities = { 1: $t("easy"), 2: $t("medium"), 3: $t("complex") };
    var severities = { Critical: $t("critical"), High: $t("high"), Medium: $t("medium"), Low: $t("low") };
    return {
      title: finding.title,
      identifier: () => (context.index >= 0 ? "IDX-" + String(context.index + 1).padStart(3, "0") : ""), // Same as report
      vulnType: finding.vulnType,
      category: finding.category,
      severity: () => severities[context.cvss().severity] || "",
      cvssScore: () => context.cvss().score,
      cvssVector: finding.cvssv3,
      priority: priorities[finding.priority],
      remediationComplexity: complexities[finding.remediationComplexity],
      affected: () => this.htmlToText(finding.scope),
    };
  },

  // Text value of a custom field: lists are joined, editor (HTML) content is converted to plain text
  customFieldToText: function (field) {
    var value = field.text;
    if (Array.isArray(value)) return value.join(", ");
    if (field.customField.fieldType === "text") return this.htmlToText(value);
    return value;
  },

  // Convert HTML to plain text (DOMParser documents are inert: no script execution nor resource loading)
  htmlToText: function (html) {
    if (typeof html !== "string" || !html) return "";
    // Separate blocks (paragraphs, list items, line breaks...) so that their texts are not glued together
    html = html.replace(/<\/(p|div|li|h[1-6]|pre|blockquote|td|th|tr)>|<br\s*\/?>/gi, "$& ");
    var doc = new DOMParser().parseFromString(html, "text/html");
    return (doc.body.textContent || "").replace(/\s+/g, " ").trim();
  },

  AUDIT_VIEW_STATE: {
    EDIT: 0,
    EDIT_READONLY: 1,
    REVIEW: 2,
    REVIEW_EDITOR: 3,
    REVIEW_APPROVED: 4,
    REVIEW_ADMIN: 5,
    REVIEW_ADMIN_APPROVED: 6,
    REVIEW_READONLY: 7,
    APPROVED: 8,
    APPROVED_APPROVED: 9,
    APPROVED_READONLY: 10,
  },

  strongPassword: function (value) {
    const regExp = /(?=.*\d)(?=.*[a-z])(?=.*[A-Z]).{8,}/;
    return regExp.test(value)
  },

  // Detect if a string is a valid image URL
  isImageUrl: function (url) {
    if (!url || typeof url !== 'string') return false;
    
    // Check URL format
    const urlPattern = /^https?:\/\/.+/i;
    if (!urlPattern.test(url)) return false;
    
    // Check image file extension
    const imageExtensions = /\.(jpg|jpeg|png|gif|webp|svg|bmp|tiff|ico)(\?.*)?$/i;
    if (imageExtensions.test(url)) return true;
    
    // Check MIME types in URL (for APIs)
    const mimePattern = /[?&]type=(image\/[^&]+)/i;
    if (mimePattern.test(url)) return true;
    
    // Check common image API patterns
    const apiPatterns = [
      /\/api\/attachments\.redirect/i,
      /\/api\/images\//i,
      /\/api\/files\//i,
      /\/media\//i,
      /\/uploads\//i
    ];
    
    return apiPatterns.some(pattern => pattern.test(url));
  },

  // Normalize an image URL for display
  normalizeImageUrl: function (url) {
    if (!url) return '';
    
    // If it's already a complete URL, return it
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    
    // If it's a local ID, build the API URL
    if (!url.startsWith('data:')) {
      return `api/images/download/${url}`;
    }
    
    // If it's base64, return it as is
    return url;
  }

};
