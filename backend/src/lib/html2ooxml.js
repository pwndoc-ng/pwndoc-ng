let docx = require("docx");
let xml = require("xml");
let htmlparser = require("htmlparser2");

function html2ooxml(html, style = "") {
  if (html === "") return html;
  if (!html.match(/^<.+>/)) html = `<p>${html}</p>`;
  let doc = new docx.Document({ sections: [] });
  let paragraphs = [];
  let cParagraph = null;
  let cRunProperties = {};
  let cParagraphProperties = {};
  let list_state = [];
  let inCodeBlock = false;
  let inTable = false;
  let inTableRow = false;
  let cellHasText = false;
  let tmpAttribs = {};
  let tableHeader = false
  let tmpTable = [];
  let tmpCells = [];
  let parser = new htmlparser.Parser(
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
          if (style && typeof style === 'string')
            cParagraphProperties.style = style
          cParagraph = new docx.Paragraph(cParagraphProperties)
        } else if (tag === "table") {
          inTable = true;
        } else if (tag === "td") {
          tmpAttribs = attribs;
          cellHasText = false;
        } else if (tag === "th") {
          tableHeader = true;
          tmpAttribs = attribs;
          cellHasText = false;
        } else if (tag === "tr") {
          inTableRow = true;
        } else if (tag === "pre") {
          inCodeBlock = true;
          cParagraph = new docx.Paragraph({style: "Code"});
        } else if (tag === "br") {
            if (inCodeBlock) {
              paragraphs.push(cParagraph)
              cParagraph = new docx.Paragraph({style: "Code"})
            } else {
              cParagraph.addChildElement(new docx.Run({break: 1}))
            }
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
        } else if (tag ==="a") {
          cRunProperties.link = attribs.href;
        }else if (tag === "br") {
          if (inCodeBlock) {
            paragraphs.push(cParagraph);
            cParagraph = new docx.Paragraph({ style: "Code" });
          } else cParagraph.addChildElement(new docx.Run({ break: 1 }));
        } else if (tag === "ul") {
          list_state.push("bullet");
        } else if (tag === "ol") {
          list_state.push("number");
        } else if (tag === "li") {
          let level = list_state.length - 1;
          if (level >= 0 && list_state[level] === "bullet")
            cParagraphProperties.bullet = { level: level };
          else if (level >= 0 && list_state[level] === "number")
            cParagraphProperties.numbering = { reference: 2, level: level };
          else cParagraphProperties.bullet = { level: 0 };
        } else if (tag === "code") {
          cRunProperties.style = "CodeChar";
        } else if (tag === "legend" && attribs && attribs.alt !== "undefined") {
          let label = attribs.label || "Figure";
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
          cellHasText = true;
          tmpCells.push({
            text: text,
            width: tmpAttribs.colwidth ? tmpAttribs.colwidth : "250",
            header: tableHeader,
          });
        } else if(cRunProperties.link){
          cParagraph.addChildElement(new docx.TextRun({"text":`{_|link|_{${text}|-|${cRunProperties.link}}_|link|_}`, "style": "Hyperlink"}));

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
          tableHeader = false;
          tmpTable.push(tmpCells);
          tmpCells = []
        } else if (tag === "a") {
          delete cRunProperties.link
        } else if (tag === "td" || tag === "th") {
          if(cellHasText === false) {
            tmpCells.push({
              text: "",
              width: tmpAttribs.colwidth ? tmpAttribs.colwidth : "250",
              header: tableHeader,
            });
          }
          tmpAttribs = {};
        } else if (tag === "table") {
          inTable = false;
          let tblRows = [];
          tmpTable.map((row) => {
            let tmpCells = [];
            let isHeader = false
            let widthTotal = row.map(cell => parseInt(cell.width)).reduce((prev, next) => prev + next);

            row.map((cell) => {
              isHeader = cell.header;
              tmpCells.push(new docx.TableCell({
                width: {
                  size: Math.round(parseFloat(cell.width / widthTotal)),
                  type: "pct",
                },
                children: [new docx.Paragraph(cell.text)],
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

  let prepXml = doc.documentWrapper.document.body.prepForXml({});
  let filteredXml = prepXml["w:body"].filter((e) => {
    return Object.keys(e)[0] === "w:p" || Object.keys(e)[0] === "w:tbl" ;
  });
  let dataXml = xml(filteredXml);
  dataXml = dataXml.replace(/w:numId w:val="{2-0}"/g, 'w:numId w:val="2"'); // Replace numbering to have correct value
  //a little dirty but until we do better it works
  dataXml = dataXml.replace(/\{_\|link\|_\{(.*?)\|\-\|(.*?)\}_\|link\|_\}/gm, '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> HYPERLINK $2 </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t> $1 </w:t> </w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>')
  console.log(dataXml)
  return dataXml;
}

module.exports = html2ooxml;
