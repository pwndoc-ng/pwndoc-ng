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
  'hljs-number': '#B5CEA8', // Vert pâle
  'hljs-regexp': '#D16969', // Rouge clair
  'hljs-string': '#CE9178', // Orange pâle
  'hljs-subst': '#D4D4D4', // Gris clair
  'hljs-symbol': '#569CD6', // Bleu vif
  'hljs-class': '#4EC9B0', // Vert turquoise
  'hljs-function': '#DCDCAA', // Jaune clair
  'hljs-title': '#DCDCAA', // Jaune clair
  'hljs-params': '#9CDCFE', // Bleu clair
  'hljs-comment': '#6A9955', // Vert foncé
  'hljs-doctag': '#C586C0', // Violet
  'hljs-meta': '#D4D4D4', // Gris clair
  'hljs-meta-keyword': '#569CD6', // Bleu vif
  'hljs-meta-string': '#CE9178', // Orange pâle
  'hljs-section': '#DCDCAA', // Jaune clair
  'hljs-tag': '#569CD6', // Bleu vif
  'hljs-name': '#9CDCFE', // Bleu clair
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
  'hljs-selector-attr': '#CE9178', // Orange pâle
  'hljs-selector-pseudo': '#CE9178', // Orange pâle
  'hljs-addition': '#B5CEA8', // Vert pâle
  'hljs-deletion': '#D16969', // Rouge clair
  'hljs-char': '#CE9178', // Orange pâle
  'hljs-selector': '#DCDCAA', // Jaune clair
  'hljs-template-tag': '#569CD6', // Bleu vif
  'hljs-template-variable': '#9CDCFE', // Bleu clair
  'hljs-root': '#D4D4D4', // Gris clair
  'hljs-brace': '#D4D4D4', // Gris clair
};




function html2ooxml(html, style = "") {;
  if (html === "") return html;
  if (!html.match(/^<.+>/)) html = `<p>${html}</p>`;
  console.log(html);
  let doc = new docx.Document({ sections: [] });
  let paragraphs = [];
  let cParagraph = null;
  let cRunProperties = {};
  let cParagraphProperties = {};
  let list_state = [];
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
        console.log("Mon tag actuel est : " + tag);
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
            cParagraph.addChildElement(new docx.Run({ break: 1 }))
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
            cRunProperties.link = attribs.href;
            break;
          case 'ul':
            list_state.push("bullet");
            break;
          case 'ol':
            list_state.push("number");
            break;
          case 'li':
	    let level = Math.min(list_state.length - 1, 8); // Limite à 8 (niveaux 0-8, max Word = 9)
            if (level >= 0 && list_state[level] === "bullet")
              cParagraphProperties.bullet = { level: level };
            else if (level >= 0 && list_state[level] === "number")
              cParagraphProperties.numbering = { reference: 2, level: level };
            else cParagraphProperties.bullet = { level: 0 };
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
              let label = attribs.label || "Figure";
              cParagraph = new docx.Paragraph({
                style: "Caption",
                alignment: docx.AlignmentType.CENTER,
              });
              cParagraph.addChildElement(new docx.TextRun(`${label} `));
              cParagraph.addChildElement(new docx.SimpleField(`SEQ ${label}`, "1"));
              cParagraph.addChildElement(new docx.TextRun(` - ${attribs.alt}`));
            }
            break;
        }
      },
      
      ontext(text) {
        console.log(text);
        if (cRunProperties.link) {
          cParagraph.addChildElement(new docx.TextRun({ "text": `{_|link|_{${text}|-|${cRunProperties.link}}_|link|_}`, "style": "PwndocLink" }));
        } else if (inCodeBlock) {
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
        } else if (text && cParagraph) {
          if (inTableCell) {
            cellHasText = true;
          }
          cRunProperties.text = text;
          cParagraph.addChildElement(new docx.TextRun(cRunProperties));
        }
      },

      onclosetag(tag) {
        if (
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
            "td"
          ].includes(tag)) {

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
          }  else if (tag === "ul" || tag === "ol") {
            list_state.pop();
            if (list_state.length === 0) cParagraphProperties = {};
          } else if (tag === "tr") {
            inTableRow = false;
            tableHeader = false;
            tmpTable.push(tmpCells);
            tmpCells = []
          } else if (tag === "a") {
            delete cRunProperties.link
          } else if (tag === "td" || tag === "th") {
const sanitizedContent = (Array.isArray(tmpCellContent) && tmpCellContent.length > 0)
  ? tmpCellContent.filter(p => p !== null)
  : [new docx.Paragraph("")];

tmpCells.push({
  text: sanitizedContent,
  width: tmpAttribs.colwidth || "250",
  header: tableHeader,
});


            tmpAttribs = {};
            tmpCellContent = [];
            inTableCell = false;
          } else if (tag === "table") {
            inTable = false;
            let tblRows = [];
            tmpTable.map((row) => {
              let tmpCells = [];
              let isHeader = false
              let widthTotal = row
  .map(cell => parseInt(cell.width || "250", 10))
  .reduce((prev, next) => prev + next, 0) || 1; // évite division par zéro


              row.map((cell) => {
                isHeader = cell.header;
                tmpCells.push(new docx.TableCell({
                  width: {
                    size: Math.round(parseFloat(cell.width / widthTotal)),
                    type: "pct",
                  },
                  children: cell.text,
                }))
              });

              tblRows.push(new docx.TableRow({
                children: tmpCells,
                tableHeader: isHeader,
              }))
            });
            // build table and push to paragraphs array
            cParagraph = new docx.Table({
              rows: tblRows,
              width: {
                size: 100,
                type: "pct"
              }
            });
            paragraphs.push(cParagraph);
            cParagraph = null;
            cParagraphProperties = {};
            tmpTable = [];
            tmpCells = [];
          }
        }
        if (tag === "code") {
          inCodeBlock = false;
          if(!inCodeBlockHighlight){
            delete cRunProperties.style;
          }
          delete cRunProperties.color;
        } else if (tag === "a") {
          delete cRunProperties.color;
          delete cRunProperties.style;
          delete cRunProperties.link;
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

  let prepXml = doc.documentWrapper.document.body.prepForXml({});

  if (!prepXml || !prepXml["w:body"]) {
    throw new Error("Le document généré est vide ou mal formé");
  }
let filteredXml = prepXml["w:body"].filter((e) => {
  return e && (Object.keys(e)[0] === "w:p" || Object.keys(e)[0] === "w:tbl");
});

  let dataXml = xml(filteredXml);
  dataXml = dataXml.replace(/w:numId w:val="{2-0}"/g, 'w:numId w:val="2"'); // Replace numbering to have correct value
  //a little dirty but until we do better it works
  dataXml = dataXml.replace(/\{_\|link\|_\{(.*?)\|\-\|(.*?)\}_\|link\|_\}/gm, '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> HYPERLINK $2 </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:rPr><w:rStyle w:val="PwndocLink"/></w:rPr><w:t> $1 </w:t> </w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>')
  console.log(dataXml)
  return dataXml;
}

module.exports = html2ooxml;
