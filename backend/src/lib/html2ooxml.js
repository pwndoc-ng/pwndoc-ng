let docx = require("docx");
let xml = require("xml");
let htmlparser = require("htmlparser2");
const { Paragraph } = require("docx");
const { Document, Packer } = require("docx");
const HIGHLIGHT_COLOR_MAP = {
  'hljs-keyword': '#569CD6', // Bleu vif
  'hljs-built_in': '#DCDCAA', // Jaune clair
  'hljs-type': '#4EC9B0', // Vert turquoise
  'hljs-literal': '#569CD6', // Bleu vif
  'hljs-number': '#B5CEA8', // Pale green
  'hljs-regexp': '#D16969', // Rouge clair
  'hljs-string': '#CE9178', // Pale orange
  'hljs-subst': '#D4D4D4', // Light gray
  'hljs-symbol': '#569CD6', // Bleu vif
  'hljs-class': '#4EC9B0', // Turquoise green
  'hljs-function': '#DCDCAA', // Light yellow
  'hljs-title': '#DCDCAA', // Light yellow
  'hljs-params': '#9CDCFE', // Light blue
  'hljs-comment': '#6A9955', // Dark green
  'hljs-doctag': '#C586C0', // Violet
  'hljs-meta': '#D4D4D4', // Light gray
  'hljs-meta-keyword': '#569CD6', // Bleu vif
  'hljs-meta-string': '#CE9178', // Pale orange
  'hljs-section': '#DCDCAA', // Light yellow
  'hljs-tag': '#569CD6', // Bleu vif
  'hljs-name': '#9CDCFE', // Light blue
  'hljs-attribute': '#9CDCFE', // Bleu clair
  'hljs-variable': '#9CDCFE', // Bleu clair
  'hljs-template-variable': '#9CDCFE', // Bleu clair
  'hljs-builtin-name': '#DCDCAA', // Jaune clair
  'hljs-bullet': '#D7BA7D', // Beige
  'hljs-code': '#D4D4D4', // Gris clair
  'hljs-emphasis': '#D4D4D4', // Gris clair
  'hljs-strong': '#D4D4D4', // Gris clair
  'hljs-formula': '#D4D4D4', // Gris clair
  'hljs-link': '#569CD6', // Bleu vif
  'hljs-operator': '#D4D4D4', // Gris clair
  'hljs-punctuation': '#D4D4D4', // Gris clair
  'hljs-selector-tag': '#569CD6', // Bleu vif
  'hljs-selector-id': '#DCDCAA', // Jaune clair
  'hljs-selector-class': '#9CDCFE', // Bleu clair
  'hljs-selector-attr': '#CE9178', // Pale orange
  'hljs-selector-pseudo': '#CE9178', // Pale orange
  'hljs-addition': '#B5CEA8', // Pale green
  'hljs-deletion': '#D16969', // Rouge clair
  'hljs-char': '#CE9178', // Pale orange
  'hljs-selector': '#DCDCAA', // Light yellow
  'hljs-template-tag': '#569CD6', // Bleu vif
  'hljs-template-variable': '#9CDCFE', // Bleu clair
  'hljs-root': '#D4D4D4', // Gris clair
  'hljs-brace': '#D4D4D4', // Gris clair
};

// Characters forbidden in XML 1.0 (control characters of texts pasted from other applications, e.g. the vertical tab of
// PowerPoint): a document containing them cannot be opened by Word
const INVALID_XML_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

// Links are written as HYPERLINK fields. The runs of the field cannot be created with docx: marker runs are written
// instead and replaced in the XML. The control character U+0001 cannot come from the HTML (removed from the texts).
const LINK_BEGIN_MARKER = /<w:r><w:t xml:space="preserve">\u0001L(\d+)\u0001<\/w:t><\/w:r>/g;
const LINK_END_MARKER = /<w:r><w:t xml:space="preserve">\u0001E\u0001<\/w:t><\/w:r>/g;
const escapeXml = (value) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

// Default width (px) of a column whose width was not chosen in the editor
const DEFAULT_COLUMN_WIDTH = 250;
// Width of the table grid in twips (text width of an A4 page with 2 cm margins): the table is at full width (100 %), the
// grid gives the proportions of the columns
const TABLE_GRID_WIDTH = 9600;
// Table style of the converted tables (borders, header row): defined in the templates to customize them, added to the
// report by the report generator when the template does not define it (report-generator.js declareTableStyle)
const TABLE_STYLE = "PwndocTable";

// Table from the rows of cells of the HTML table. Cells spanning several rows are omitted from the next rows in HTML:
// their columns are skipped when placing the cells of these rows (docx adds the merged cells). The widths of the
// columns are the widths chosen in the editor (colwidth), in percent of the table width.
function buildTable(rows) {
  let occupied = rows.map(() => new Set()); // Columns of each row taken by a cell of a previous row
  let columnWidths = [];
  let placed = rows.map((row, rowIndex) => {
    let column = 0;
    return row.map(cell => {
      while (occupied[rowIndex].has(column)) column++;
      for (let i = 0; i < cell.colspan; i++) {
        if (columnWidths[column + i] === undefined && cell.widths[i] > 0) columnWidths[column + i] = cell.widths[i];
        for (let next = rowIndex + 1; next < Math.min(rows.length, rowIndex + cell.rowspan); next++)
          occupied[next].add(column + i);
      }
      let placedCell = { ...cell, column: column };
      column += cell.colspan;
      return placedCell;
    });
  });
  let columnCount = Math.max(1, ...placed.map(row => row.reduce((end, cell) => Math.max(end, cell.column + cell.colspan), 0)),
    ...occupied.map(columns => Math.max(0, ...columns) + 1));
  let widths = Array.from({ length: columnCount }, (_, column) => columnWidths[column] || DEFAULT_COLUMN_WIDTH);
  let total = widths.reduce((sum, width) => sum + width, 0);

  // Conditional formatting of the header row of the table style when the first row is a header row (th)
  let header = placed.length > 0 && placed[0].length > 0 && placed[0][placed[0].length - 1].header;
  return new docx.Table({
    style: TABLE_STYLE, // No direct borders: they would override the borders of the style
    tableLook: { firstRow: header, lastRow: false, firstColumn: false, lastColumn: false, noHBand: false, noVBand: true },
    rows: placed.map(row => new docx.TableRow({
      children: row.map(cell => new docx.TableCell({
        width: { size: Math.round(100 * widths.slice(cell.column, cell.column + cell.colspan).reduce((sum, width) => sum + width, 0) / total), type: "pct" },
        columnSpan: cell.colspan > 1 ? cell.colspan : undefined,
        rowSpan: cell.rowspan > 1 ? cell.rowspan : undefined,
        children: cell.text,
      })),
      tableHeader: row.length > 0 && row[row.length - 1].header,
    })),
    columnWidths: widths.map(width => Math.round(TABLE_GRID_WIDTH * width / total)),
    width: { size: 100, type: "pct" },
  });
}

function html2ooxml(html, style = "", listIds = []) {;
  if (html === "") return html;
  if (!html.match(/^<.+>/)) html = `<p>${html}</p>`;
  let doc = new docx.Document({ sections: [] });
  let paragraphs = [];
  let cParagraph = null;
  let cRunProperties = {};
  let cParagraphProperties = {};
  let list_state = [];
  let bullet_state = []; // Separate state for bullets
  let availableListIds = [...listIds]; // Copy of available IDs for numbered lists
  let currentListId = 0; // ID of the current top-level numbered list (its nested numbered lists share it)
  let links = []; // Targets of the links (HYPERLINK fields)
  let linkParagraph = null; // Paragraph of the link being written (its field is ended in this paragraph)
  let inCodeBlock = false;
  let inCodeBlockHighlight = false;
  let inTable = false;
  let inTableRow = false;
  let inTableCell = false;
  let cellHasText = false;
  let tmpAttribs = {};
  let tableHeader = false
  let tmpTable = [];
  let tmpCells = [];
  let tmpCellContent = [];
  let parser = new htmlparser.Parser(
    {
      onopentag(tag, attribs) {
        switch (tag) {
          case 'h1':
            cParagraph = new docx.Paragraph({ heading: "Heading1" });
            break;
          case 'h2':
            cParagraph = new docx.Paragraph({ heading: "Heading2" });
            break;
          case 'h3':
            cParagraph = new docx.Paragraph({ heading: "Heading3" });
            break;
          case 'h4':
            cParagraph = new docx.Paragraph({ heading: "Heading4" });
            break;
          case 'h5':
            cParagraph = new docx.Paragraph({ heading: "Heading5" });
            break;
          case 'h6':
            cParagraph = new docx.Paragraph({ heading: "Heading6" });
            break;
          case 'div':
          case 'p':
            if (style && typeof style === 'string') {
              cParagraphProperties.style = style
            }
            cParagraph = new docx.Paragraph(cParagraphProperties)
            break;
          case 'table':
            inTable = true;
            break;
          case 'td':
            tmpAttribs = attribs;
            inTableCell = true;
            cellHasText = false;
            tmpCellContent = [];
            break;
          case 'th':
            inTableCell = true;
            tableHeader = true;
            tmpAttribs = attribs;
            tmpCellContent = [];
            cellHasText = false;
            break;
          case 'tr':
            inTableRow = true;
            break;
          case 'pre':
            inCodeBlock = true;
            inCodeBlockHighlight = true
            cParagraph = new docx.Paragraph({ style: "Code" });
            break;
          case 'br':
            if (cParagraph) {
              cParagraph.addChildElement(new docx.Run({ break: 1 }));
            }
            break;
          case 'b':
          case 'strong':
            cRunProperties.bold = true;
            break;
          case 'i':
          case 'em':
            cRunProperties.italics = true;
            break;
          case 'span':
            if (inCodeBlock && attribs.class && HIGHLIGHT_COLOR_MAP[attribs.class]) {
              cRunProperties.color = HIGHLIGHT_COLOR_MAP[attribs.class];
            }
            break;
          case 'u':
            cRunProperties.underline = {};
            break;
          case 'strike':
          case 's':
            cRunProperties.strike = true;
            break;
          case 'mark':
            //Possible values are: black, blue, cyan, darkBlue, darkCyan, darkGray, darkGreen, darkMagenta, darkRed, darkYellow, green, lightGray, magenta, none, red, white, yellow
            let color;
            switch (attribs["data-color"]) {
              case "#ffff00":
                color = "yellow";
                break;
              case "#fe0000":
                color = "red";
                break;
              case "#00ff00":
                color = "green";
                break;
              case "#00ffff":
                color = "cyan";
                break;
            }
            cRunProperties.highlight = color;
            break;
          case 'a':
            // Beginning of the HYPERLINK field, at the paragraph level: the text of the link (with its marks) is the result
            if (cParagraph && attribs.href && !linkParagraph) {
              links.push(attribs.href.replace(INVALID_XML_CHARACTERS, ''));
              cParagraph.addChildElement(new docx.TextRun(`\u0001L${links.length - 1}\u0001`));
              linkParagraph = cParagraph;
            }
            break;
          case 'ul':
            // Stack in the separate bullet system
            bullet_state.push("bullet");
            break;
          case 'ol':
            // Stack the list type to handle nesting
            list_state.push("number");

            // Each top-level list has its own numbering instance (it starts at 1). A nested numbered list continues the
            // instance of its parent list at the next level: Word numbers it under the current item of the parent
            // (e.g. 2.1) and restarts it after the next item of the parent
            if (list_state.length === 1)
              currentListId = availableListIds.length > 0 ? availableListIds.shift() : Math.floor(Math.random() * 90000) + 10000;
            break;
          case 'li':
            // Determine if we're in a bullet or numbered list
            if (bullet_state.length > 0) {
              // We're in a bullet list - use existing template definition (numId="1")
              let bulletLevel = Math.min(bullet_state.length - 1, 8);
              const bulletId = 1; // Use existing template definition
              cParagraphProperties.numbering = { reference: String(bulletId), level: bulletLevel }; // docx 9: string reference (a number is read as a definition)
            } else if (list_state.length > 0) {
              // We're in a numbered list
              let numberLevel = Math.min(list_state.length - 1, 8);
              cParagraphProperties.numbering = { reference: String(currentListId), level: numberLevel };
            } else {
              // No numbering if we're not in a real list - leave as default
            }
            
            // Create paragraph with list properties
            cParagraph = new docx.Paragraph(cParagraphProperties);
            break;
          case 'code':
            if (inCodeBlockHighlight) {
              cRunProperties.style = "Code";
            } else {
              cRunProperties.style = "CodeChar";
            }
            break;
          case 'legend':
            if (attribs && attribs.alt !== "undefined") {
              let label = (attribs.label || "Figure").replace(INVALID_XML_CHARACTERS, '');
              cParagraph = new docx.Paragraph({
                style: "Caption",
                alignment: docx.AlignmentType.CENTER,
              });
              cParagraph.addChildElement(new docx.TextRun(`${label} `));
              cParagraph.addChildElement(new docx.SimpleField(`SEQ ${label}`, "1"));
              cParagraph.addChildElement(new docx.TextRun(` - ${attribs.alt}`.replace(INVALID_XML_CHARACTERS, '')));
            }
            break;
        }
      },
      
      ontext(text) {
        text = text.replace(INVALID_XML_CHARACTERS, '');
        if (!text || !cParagraph) return;
        if (inCodeBlock) {
          if (cRunProperties.color) {
            cParagraph.addChildElement(
              new docx.TextRun({
                text,
                color: cRunProperties.color,
              })
            );
          } else {
            cParagraph.addChildElement(
              new docx.TextRun({
                text
              })
            );
          }
        } else {
          if (inTableCell) {
            cellHasText = true;
          }
          cParagraph.addChildElement(new docx.TextRun(linkParagraph === cParagraph ? { ...cRunProperties, text, style: "PwndocLink" } : { ...cRunProperties, text }));
        }
      },

      onclosetag(tag) {
        
        // Handle lists first
        if (tag === "ul") {
          bullet_state.pop();
          
          if (bullet_state.length === 0) {
            cParagraphProperties = {};
          }
        } else if (tag === "ol") {
          list_state.pop();

          if (list_state.length === 0) {
            cParagraphProperties = {};
            currentListId = 0;
          }
        }
        else if (
          [
            "h1",
            "h2",
            "h3",
            "h4",
            "h5",
            "h6",
            "div",
            "p",
            "pre",
            "img",
            //"code",
            "legend",
            "table",
             "tr",
            "th", 
            "td",
            "li"
          ].includes(tag)) {

          // A link not closed before the end of its paragraph ends with it
          if (linkParagraph) {
            linkParagraph.addChildElement(new docx.TextRun("\u0001E\u0001"));
            linkParagraph = null;
          }
          if (inTableCell) {
            tmpCellContent.push(cParagraph)
          } else {
            paragraphs.push(cParagraph);
          }

          cParagraph = null;
          cParagraphProperties = {};
          if (tag === "b" || tag === "strong") {
            delete cRunProperties.bold;
          } else if (tag === "pre") {
            inCodeBlockHighlight = false;
            inCodeBlock = false;
            if (cParagraph) {
              paragraphs.push(cParagraph);
            }
            cParagraph = null;
          } else if (tag === "span") {
            if (inCodeBlock) {
              delete cRunProperties.color;
            }
          } else if (tag === "li") {
            // Reset paragraph properties after each list item
            // to prevent bullet properties from persisting
            cParagraphProperties = {};
          } else if (tag === "tr") {
            inTableRow = false;
            tableHeader = false;
            tmpTable.push(tmpCells);
            tmpCells = []
          } else if (tag === "td" || tag === "th") {
            tmpCells.push({
              text: tmpCellContent.filter(p => p !== null).length > 0 ? tmpCellContent.filter(p => p !== null) : [new docx.Paragraph("")],
              // Merged cells: number of columns and rows; colwidth of the editor: width (px) of each column of the cell
              colspan: Math.max(1, parseInt(tmpAttribs.colspan, 10) || 1),
              rowspan: Math.max(1, parseInt(tmpAttribs.rowspan, 10) || 1),
              widths: String(tmpAttribs.colwidth || "").split(",").map(width => parseInt(width, 10)),
              header: tableHeader,
            });
            tmpAttribs = {};
            tmpCellContent = [];
            inTableCell = false;
          } else if (tag === "table") {
            inTable = false;
            cParagraph = buildTable(tmpTable);
            paragraphs.push(cParagraph);
            cParagraph = null;
            cParagraphProperties = {};
            tmpTable = [];
            tmpCells = [];
          }
        }
        if (tag === "code") {
          inCodeBlock = false;
          delete cRunProperties.style; // Code style of the inline code or of the code block: not for the next texts
          delete cRunProperties.color;
        } else if (tag === "a") {
          delete cRunProperties.color;
          delete cRunProperties.style;
          // End of the HYPERLINK field
          if (linkParagraph) {
            linkParagraph.addChildElement(new docx.TextRun("\u0001E\u0001"));
            linkParagraph = null;
          }
        } else if (tag === "b" || tag === "strong") {
          delete cRunProperties.bold;
        } else if (tag === "i" || tag === "em") {
          delete cRunProperties.italics;
        } else if (tag === "u") {
          delete cRunProperties.underline;
        } else if (tag === "mark") {
          delete cRunProperties.highlight;
        } else if (tag === "strike" || tag === "s") {
          delete cRunProperties.strike;
        }
      },

      onend() {
        if (paragraphs.length === 0) {
    paragraphs.push(new docx.Paragraph("")); // Ajoute au moins un paragraphe vide
  }

  doc.addSection({
    children: paragraphs,
  });
      },
    },
    { decodeEntities: true }
  );

  // For multiline code blocks
  html = html.replace(/\n/g, "<br>");
  parser.write(html);
  parser.end();

  // docx 9: a numbered paragraph registers its numbering instance in the file. The lists use the numbering
  // definitions of the report template (numId of the template), not definitions created by docx: nothing to register
  const xmlContext = { stack: [], file: { Numbering: { createConcreteNumberingInstance: () => {} } } };
  let prepXml = doc.documentWrapper.document.body.prepForXml(xmlContext);

  if (!prepXml || !prepXml["w:body"]) {
    throw new Error("Le document généré est vide ou mal formé");
  }
let filteredXml = prepXml["w:body"].filter((e) => {
  return e && (Object.keys(e)[0] === "w:p" || Object.keys(e)[0] === "w:tbl");
});

  let dataXml = xml(filteredXml);
  dataXml = dataXml.replace(/w:numId w:val="{(\d+)-0}"/g, 'w:numId w:val="$1"'); // Replace numbering to have correct value
  // HYPERLINK fields: target quoted in the field instruction (\ and " escaped), then escaped for XML
  dataXml = dataXml.replace(LINK_BEGIN_MARKER, (match, index) =>
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
    `<w:r><w:instrText xml:space="preserve"> HYPERLINK "${escapeXml(links[index].replace(/\\/g, '\\\\').replace(/"/g, '\\"'))}" </w:instrText></w:r>` +
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r>');
  dataXml = dataXml.replace(LINK_END_MARKER, '<w:r><w:fldChar w:fldCharType="end"/></w:r>');
  return dataXml;
}

module.exports = html2ooxml;
module.exports.TABLE_STYLE = TABLE_STYLE;
