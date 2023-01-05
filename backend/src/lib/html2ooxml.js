var docx = require("docx");
var xml = require("xml");
var htmlparser = require("htmlparser2");

function html2ooxml(html, style = "") {
  if (html === "") return html;
  if (!html.match(/^<.+>/)) html = `<p>${html}</p>`;
  var doc = new docx.Document({ sections: [] });
  var paragraphs = [];
  var cParagraph = null;
  var cRunProperties = {};
  var cParagraphProperties = {};
  var list_state = [];
  var inCodeBlock = false;
  var inTable = false;
  var inTableRow = false;
  var tmpTable = [];
  var tmpCells = [];
  var parser = new htmlparser.Parser(
    {
      onopentag(tag, attribs) {
        if (tag === "h1") {
          cParagraph = new docx.Paragraph({ heading: "Heading1" });
        } else if (tag === "h2") {
          cParagraph = new docx.Paragraph({ heading: "Heading2" });
        } else if (tag === "h3") {
          cParagraph = new docx.Paragraph({ heading: "Heading3" });
        } else if (tag === "h4") {
          cParagraph = new docx.Paragraph({ heading: "Heading4" });
        } else if (tag === "h5") {
          cParagraph = new docx.Paragraph({ heading: "Heading5" });
        } else if (tag === "h6") {
          cParagraph = new docx.Paragraph({ heading: "Heading6" });
        } else if (tag === "div" || tag === "p") {
          cParagraphProperties.style = style;
          cParagraph = new docx.Paragraph(cParagraphProperties);
        } else if (tag === "table") {
          inTable = true;
        } else if (tag === "td") {
        } else if (tag === "tr") {
          inTableRow = true;
        } else if (tag === "pre") {
          inCodeBlock = true;
          cParagraph = new docx.Paragraph({ style: "Code" });
        } else if (tag === "b" || tag === "strong") {
          cRunProperties.bold = true;
        } else if (tag === "i" || tag === "em") {
          cRunProperties.italics = true;
        } else if (tag === "u") {
          cRunProperties.underline = {};
        } else if (tag === "strike" || tag === "s") {
          cRunProperties.strike = true;
        } else if (tag === "mark") {
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
        } else if (tag === "br") {
          if (inCodeBlock) {
            paragraphs.push(cParagraph);
            cParagraph = new docx.Paragraph({ style: "Code" });
          } else cParagraph.addChildElement(new docx.Run({ break: 1 }));
        } else if (tag === "ul") {
          list_state.push("bullet");
        } else if (tag === "ol") {
          list_state.push("number");
        } else if (tag === "li") {
          var level = list_state.length - 1;
          if (level >= 0 && list_state[level] === "bullet")
            cParagraphProperties.bullet = { level: level };
          else if (level >= 0 && list_state[level] === "number")
            cParagraphProperties.numbering = { reference: 2, level: level };
          else cParagraphProperties.bullet = { level: 0 };
        } else if (tag === "code") {
          cRunProperties.style = "CodeChar";
        } else if (tag === "legend" && attribs && attribs.alt !== "undefined") {
          var label = attribs.label || "Figure";
          cParagraph = new docx.Paragraph({
            style: "Caption",
            alignment: docx.AlignmentType.CENTER,
          });
          cParagraph.addChildElement(new docx.TextRun(`${label} `));
          cParagraph.addChildElement(new docx.SimpleField(`SEQ ${label}`, "1"));
          cParagraph.addChildElement(new docx.TextRun(` - ${attribs.alt}`));
        }
      },

      ontext(text) {
        if (text && inTableRow) {
          tmpCells.push(text);
        } else if (text && cParagraph && !inTable) {
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
            "legend",
            //"table",
            /* "tr",
            "th", */
          ].includes(tag)
        && !inTable) {
          paragraphs.push(cParagraph);
          cParagraph = null;
          cParagraphProperties = {};
          if (tag === "pre") inCodeBlock = false;
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
        } else if (tag === "ul" || tag === "ol") {
          list_state.pop();
          if (list_state.length === 0) cParagraphProperties = {};
        } else if (tag === "code") {
          delete cRunProperties.style;
        } else if (tag === "tr") {
          inTableRow = false;
          tmpTable.push(tmpCells);
          tmpCells = [];
        } else if (tag === "table") {
          inTable = false;
          var tblRows = [];
          tmpTable.map((row, rowIndex) => {
            var tmpCells = [];
            row.map((cell, cellIndex) => {
              tmpCells.push(new docx.TableCell({
                width: {
                  size: 3505,
                  type: "auto",
                },
                children: [new docx.Paragraph(cell)],
              }))
            });
            tblRows.push(new docx.TableRow({
              children: tmpCells
            }))
          });
          // build table and push to paragraphs array
          cParagraph = new docx.Table({
            rows: tblRows
          });

          paragraphs.push(cParagraph);
          cParagraph = null;
          cParagraphProperties = {};
          tmpTable = [];
          tmpCells = [];
        }
      },

      onend() {
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

  var prepXml = doc.documentWrapper.document.body.prepForXml({});
  var filteredXml = prepXml["w:body"].filter((e) => {
    return Object.keys(e)[0] === "w:p" || Object.keys(e)[0] === "w:tbl" ;
  });
  var dataXml = xml(filteredXml);
  dataXml = dataXml.replace(/w:numId w:val="{2-0}"/g, 'w:numId w:val="2"'); // Replace numbering to have correct value

  return dataXml;
}

module.exports = html2ooxml;
