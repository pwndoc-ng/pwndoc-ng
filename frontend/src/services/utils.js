var _ = require("lodash");
import { $t } from "boot/i18n";

export default {
  htmlEncode(html) {
    if (typeof html !== "string") return "";
    var result = html
      .replace(/</g, "ΩΠг")
      .replace(/>/g, "ΏΠг")
      .replace(
        /ΩΠгimg.+?src="(.*?)".+?alt="(.*?)".*?ΏΠг/g,
        '<img src="$1" alt="$2">'
      )
      .replace(
        /ΩΠгlegend.+?label="(.*?)".+?alt="(.*?)".*?ΏΠг/g,
        '<legend label="$1" alt="$2">'
      )
      .replace(/ΩΠг\/legendΏΠг/g, "</legend>")
      .replace(/ΩΠгpΏΠг/g, "<p>")
      .replace(/ΩΠг\/pΏΠг/g, "</p>")
      .replace(/ΩΠгpreΏΠг/g, "<pre>")
      .replace(/ΩΠг\/preΏΠг/g, "</pre>")
      .replace(/ΩΠгbΏΠг/g, "<b>")
      .replace(/ΩΠг\/bΏΠг/g, "</b>")
      .replace(/ΩΠгstrongΏΠг/g, "<strong>")
      .replace(/ΩΠг\/strongΏΠг/g, "</strong>")
      .replace(/ΩΠгiΏΠг/g, "<i>")
      .replace(/ΩΠг\/iΏΠг/g, "</i>")
      .replace(/ΩΠгemΏΠг/g, "<em>")
      .replace(/ΩΠг\/emΏΠг/g, "</em>")
      .replace(/ΩΠгuΏΠг/g, "<u>")
      .replace(/ΩΠг\/uΏΠг/g, "</u>")
      .replace(/ΩΠгsΏΠг/g, "<s>")
      .replace(/ΩΠг\/sΏΠг/g, "</s>")
      .replace(/ΩΠгstrikeΏΠг/g, "<strike>")
      .replace(/ΩΠг\/strikeΏΠг/g, "</strike>")
      .replace(/ΩΠгmark(.*?)ΏΠг/g, "<mark$1>")
      .replace(/ΩΠг\/markΏΠг/g, "</mark>")
      .replace(/ΩΠгtableΏΠг/g, "<table>")
      .replace(/ΩΠг\/tableΏΠг/g, "</table>")
      .replace(/ΩΠгtbodyΏΠг/g, "<tbody>")
      .replace(/ΩΠг\/tbodyΏΠг/g, "</tbody>")
      .replace(/ΩΠгtrΏΠг/g, "<tr>")
      .replace(/ΩΠг\/trΏΠг/g, "</tr>")
      .replace(
        /ΩΠгth.+?colspan="(.?)".+?rowspan="(.*?)".*?ΏΠг/g,
        '<th colspan="$1" rowspan="$2">'
      )
      .replace(/ΩΠг\/thΏΠг/g, "</th>")
      .replace(/ΩΠгbrΏΠг/g, "<br>")
      .replace(/ΩΠгcodeΏΠг/g, "<code>")
      .replace(/ΩΠг\/codeΏΠг/g, "</code>")
      .replace(/ΩΠгbrΏΠг/g, "<br>")
      .replace(/ΩΠгulΏΠг/g, "<ul>")
      .replace(/ΩΠг\/ulΏΠг/g, "</ul>")
      .replace(/ΩΠгolΏΠг/g, "<ol>")
      .replace(/ΩΠг\/olΏΠг/g, "</ol>")
      .replace(/ΩΠгliΏΠг/g, "<li>")
      .replace(/ΩΠг\/liΏΠг/g, "</li>")
      .replace(/ΩΠгh1ΏΠг/g, "<h1>")
      .replace(/ΩΠг\/h1ΏΠг/g, "</h1>")
      .replace(/ΩΠгh2ΏΠг/g, "<h2>")
      .replace(/ΩΠг\/h2ΏΠг/g, "</h2>")
      .replace(/ΩΠгh3ΏΠг/g, "<h3>")
      .replace(/ΩΠг\/h3ΏΠг/g, "</h3>")
      .replace(/ΩΠгh4ΏΠг/g, "<h4>")
      .replace(/ΩΠг\/h4ΏΠг/g, "</h4>")
      .replace(/ΩΠгh5ΏΠг/g, "<h5>")
      .replace(/ΩΠг\/h5ΏΠг/g, "</h5>")
      .replace(/ΩΠгh6ΏΠг/g, "<h6>")
      .replace(/ΩΠг\/h6ΏΠг/g, "</h6>")
      .replace(/ΩΠгa.+?href="(.*?)".*?rel="(.*?)".*?ΏΠг/g, '<a href="$1" rel="$2">')
      .replace(/ΩΠгa.+?rel="(.*?)".*?href="(.*?)".*?ΏΠг/g, '<a href="$2" rel="$1">')
      .replace(/ΩΠг\/aΏΠг/g, '</a>')
      .replace(/ΩΠг/g, "&lt;")
      .replace(/ΏΠг/g, "&gt;");


    return result;
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
