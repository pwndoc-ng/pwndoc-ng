module.exports = function () {
  var html2ooxml = require("../src/lib/html2ooxml")
  var utils = require("../src/lib/utils")
  var reportGenerator = require("../src/lib/report-generator")

  describe('Lib functions Suite Tests', () => {

    describe('Name format validation tests', () => {
      it('Valid Filename', () => {
        var filename = "Vulnerability 1"
        var result = utils.validFilename(filename)
        expect(result).toEqual(true)
      })

      it('Valid Latin Filename', () => {
        var filename = "Vulnerabilité 1"
        var result = utils.validFilename(filename)
        expect(result).toEqual(true)
      })

      it('Valid Latvian Filename', () => {
        var filename = "Pažeidžiamumas 1"
        var result = utils.validFilename(filename)
        expect(result).toEqual(true)
      })

      it('Valid Filename with special chars', () => {
        var filename = "Vulnerability_1-test"
        var result = utils.validFilename(filename)
        expect(result).toEqual(true)
      })

      it('Invalid Filename', () => {
        var filename = "<Vulnerability> 1"
        var result = utils.validFilename(filename)
        expect(result).toEqual(false)
      })
    })

    describe('html2ooxml tests', () => {
      it('Simple Paragraph', () => {
        var html = "<p>Paragraph Text</p>"
        var expected = `<w:p><w:r><w:t xml:space="preserve">Paragraph Text</w:t></w:r></w:p>`
        var ooxml = html2ooxml(html)
        expect(ooxml).toEqual(expected)
      })

      it('Text without tag', () => {
        var html = "Paragraph Text"
        var expected = `<w:p><w:r><w:t xml:space="preserve">Paragraph Text</w:t></w:r></w:p>`
        var ooxml = html2ooxml(html)
        expect(ooxml).toEqual(expected)
      })

      it('Bold without wrapping paragraph', () => {
        var html = "<b>Paragraph Bold</b>"
        var expected = "<w:p><w:r><w:t xml:space=\"preserve\"></w:t></w:r></w:p>"
        var ooxml = html2ooxml(html)
        expect(ooxml).toEqual(expected)
      })

      it('Bold', () => {
        var html = "<p>Paragraph <b>Bold</b></p>"
        var expected =
        `<w:p>`+
          `<w:r>`+
            `<w:t xml:space="preserve">Paragraph </w:t>`+
          `</w:r>`+
          `<w:r>`+
            `<w:rPr>`+
              `<w:b/>`+
              `<w:bCs/>`+
            `</w:rPr>`+
            `<w:t xml:space="preserve">Bold</w:t>`+
          `</w:r>`+
        `</w:p>`
        var ooxml = html2ooxml(html)
        expect(ooxml).toEqual(expected)
      })

      it('Italic', () => {
        var html = "<p>Paragraph <i>Italic</i></p>"
        var expected =
        `<w:p>`+
          `<w:r>`+
            `<w:t xml:space="preserve">Paragraph </w:t>`+
          `</w:r>`+
          `<w:r>`+
            `<w:rPr>`+
              `<w:i/>`+
              `<w:iCs/>`+
            `</w:rPr>`+
            `<w:t xml:space="preserve">Italic</w:t>`+
          `</w:r>`+
        `</w:p>`
        var ooxml = html2ooxml(html)
        expect(ooxml).toEqual(expected)
      })

      it('Underline', () => {
        var html = "<p>Paragraph <u>Underline</u></p>"
        var expected =
        `<w:p>`+
          `<w:r>`+
            `<w:t xml:space="preserve">Paragraph </w:t>`+
          `</w:r>`+
          `<w:r>`+
            `<w:rPr>`+
              `<w:u w:val="single"/>`+
            `</w:rPr>`+
            `<w:t xml:space="preserve">Underline</w:t>`+
          `</w:r>`+
        `</w:p>`
        var ooxml = html2ooxml(html)
        expect(ooxml).toEqual(expected)
      })

      it('Strike', () => {
        var html = "<p>Paragraph <s>Strike</s></p>"
        var expected =
        `<w:p>`+
          `<w:r>`+
            `<w:t xml:space="preserve">Paragraph </w:t>`+
          `</w:r>`+
          `<w:r>`+
            `<w:rPr>`+
              `<w:strike/>`+
            `</w:rPr>`+
            `<w:t xml:space="preserve">Strike</w:t>`+
          `</w:r>`+
        `</w:p>`
        var ooxml = html2ooxml(html)
        expect(ooxml).toEqual(expected)
      })

      it('Bold and Italics', () => {
        var html = "<p>Paragraph <b><i>Mark</i></b></p>"
        var expected =
        `<w:p>`+
          `<w:r>`+
            `<w:t xml:space="preserve">Paragraph </w:t>`+
          `</w:r>`+
          `<w:r>`+
            `<w:rPr>`+
              `<w:b/>`+
              `<w:bCs/>`+
              `<w:i/>`+
              `<w:iCs/>`+
            `</w:rPr>`+
            `<w:t xml:space="preserve">Mark</w:t>`+
          `</w:r>`+
        `</w:p>`
        var ooxml = html2ooxml(html)
        expect(ooxml).toEqual(expected)
      })

      it('All marks', () => {
        var html = "<p>Paragraph <b><i><u><s>Mark</s></u></i></b></p>"
        var expected =
        `<w:p>`+
          `<w:r>`+
            `<w:t xml:space="preserve">Paragraph </w:t>`+
          `</w:r>`+
          `<w:r>`+
            `<w:rPr>`+
              `<w:b/>`+
              `<w:bCs/>`+
              `<w:i/>`+
              `<w:iCs/>`+
              `<w:strike/>`+ // OOXML schema order (docx 9): strike before u
              `<w:u w:val="single"/>`+
            `</w:rPr>`+
            `<w:t xml:space="preserve">Mark</w:t>`+
          `</w:r>`+
        `</w:p>`
        var ooxml = html2ooxml(html)
        expect(ooxml).toEqual(expected)
      })

      it('Heading 1', () => {
        var html = "<h1>Heading</h1>"
        var expected =
        `<w:p>`+
          `<w:pPr>`+
            `<w:pStyle w:val="Heading1"/>`+
          `</w:pPr>`+
          `<w:r>`+
            `<w:t xml:space="preserve">Heading</w:t>`+
          `</w:r>`+
        `</w:p>`
        var ooxml = html2ooxml(html)
        expect(ooxml).toEqual(expected)
      })

      it('Heading 2', () => {
        var html = "<h2>Heading</h2>"
        var expected =
        `<w:p>`+
          `<w:pPr>`+
            `<w:pStyle w:val="Heading2"/>`+
          `</w:pPr>`+
          `<w:r>`+
            `<w:t xml:space="preserve">Heading</w:t>`+
          `</w:r>`+
        `</w:p>`
        var ooxml = html2ooxml(html)
        expect(ooxml).toEqual(expected)
      })

      it('Heading 3', () => {
        var html = "<h3>Heading</h3>"
        var expected =
        `<w:p>`+
          `<w:pPr>`+
            `<w:pStyle w:val="Heading3"/>`+
          `</w:pPr>`+
          `<w:r>`+
            `<w:t xml:space="preserve">Heading</w:t>`+
          `</w:r>`+
        `</w:p>`
        var ooxml = html2ooxml(html)
        expect(ooxml).toEqual(expected)
      })

      it('Heading 4', () => {
        var html = "<h4>Heading</h4>"
        var expected =
        `<w:p>`+
          `<w:pPr>`+
            `<w:pStyle w:val="Heading4"/>`+
          `</w:pPr>`+
          `<w:r>`+
            `<w:t xml:space="preserve">Heading</w:t>`+
          `</w:r>`+
        `</w:p>`
        var ooxml = html2ooxml(html)
        expect(ooxml).toEqual(expected)
      })

      it('Heading 5', () => {
        var html = "<h5>Heading</h5>"
        var expected =
        `<w:p>`+
          `<w:pPr>`+
            `<w:pStyle w:val="Heading5"/>`+
          `</w:pPr>`+
          `<w:r>`+
            `<w:t xml:space="preserve">Heading</w:t>`+
          `</w:r>`+
        `</w:p>`
        var ooxml = html2ooxml(html)
        expect(ooxml).toEqual(expected)
      })

      it('Heading 6', () => {
        var html = "<h6>Heading</h6>"
        var expected =
        `<w:p>`+
          `<w:pPr>`+
            `<w:pStyle w:val="Heading6"/>`+
          `</w:pPr>`+
          `<w:r>`+
            `<w:t xml:space="preserve">Heading</w:t>`+
          `</w:r>`+
        `</w:p>`
        var ooxml = html2ooxml(html)
        expect(ooxml).toEqual(expected)
      })

      it('Simple Bullets', () => {
        var html = 
        `<ul>`+
          `<li>`+
            `<p>Bullet1</p>`+
          `</li>`+
          `<li>`+
            `<p>Bullet2</p>`+
          `</li>`+
        `</ul>`
        var expected =
        `<w:p>`+
          `<w:pPr>`+
            `<w:pStyle w:val="ListParagraph"/>`+
            `<w:numPr>`+
              `<w:ilvl w:val="0"/>`+
              `<w:numId w:val="1"/>`+
            `</w:numPr>`+
          `</w:pPr>`+
          `<w:r>`+
            `<w:t xml:space="preserve">Bullet1</w:t>`+
          `</w:r>`+
        `</w:p>`+
        `<w:p>`+
          `<w:pPr>`+
            `<w:pStyle w:val="ListParagraph"/>`+
            `<w:numPr>`+
              `<w:ilvl w:val="0"/>`+
              `<w:numId w:val="1"/>`+
            `</w:numPr>`+
          `</w:pPr>`+
          `<w:r>`+
            `<w:t xml:space="preserve">Bullet2</w:t>`+
          `</w:r>`+
        `</w:p>`
        var ooxml = html2ooxml(html)
        expect(ooxml).toEqual(expected)
      })

      // Expected value updated: since 547fa46 ("fix #318"), a <li> outside of a <ul> or <ol> (never produced by the editor)
      // is not numbered ("No numbering if we're not in a real list" in html2ooxml.js): its paragraphs are kept as normal
      // paragraphs. The previous expected value put them in the bullet list of the template (numId 1).
      it('Simple Bullets without ul tag', () => {
        var html = 
        `<li>`+
          `<p>Bullet1</p>`+
        `</li>`+
        `<li>`+
          `<p>Bullet2</p>`+
        `</li>`
        var expected =
        `<w:p>`+
          `<w:r>`+
            `<w:t xml:space="preserve">Bullet1</w:t>`+
          `</w:r>`+
        `</w:p>`+
        `<w:p>`+
          `<w:r>`+
            `<w:t xml:space="preserve">Bullet2</w:t>`+
          `</w:r>`+
        `</w:p>`
        var ooxml = html2ooxml(html)
        expect(ooxml).toEqual(expected)
      })

      // Expected value updated: since bac18e8 ("fix bullet level"), a nested bullet list is at the next level of the
      // bullet numbering of the template (w:ilvl 1, indented in Word). The previous expected value put the nested item at
      // the level of its parent list (w:ilvl 0), the nesting was lost in the report.
      it('Nested Bullets', () => {
        var html =
        `<ul>`+
          `<li>`+
            `<p>Bullet1</p>`+
          `</li>`+
          `<ul>`+
            `<li>`+
              `<p>BulletNested</p>`+
            `</li>`+
          `</ul>`+
          `<li>`+
            `<p>Bullet2</p>`+
          `</li>`+
        `</ul>`
        var item = (level, content) =>
        `<w:p>`+
          `<w:pPr>`+
            `<w:pStyle w:val="ListParagraph"/>`+
            `<w:numPr>`+
              `<w:ilvl w:val="${level}"/>`+
              `<w:numId w:val="1"/>`+
            `</w:numPr>`+
          `</w:pPr>`+
          `<w:r>`+
            `<w:t xml:space="preserve">${content}</w:t>`+
          `</w:r>`+
        `</w:p>`
        var expected = item(0, 'Bullet1') + item(1, 'BulletNested') + item(0, 'Bullet2')
        var ooxml = html2ooxml(html)
        expect(ooxml).toEqual(expected)
      })

      // Numbered list item: numbering identifier (numId) and level
      var numberedItem = (numId, level, content) =>
        `<w:p>`+
          `<w:pPr>`+
            `<w:pStyle w:val="ListParagraph"/>`+
            `<w:numPr>`+
              `<w:ilvl w:val="${level}"/>`+
              `<w:numId w:val="${numId}"/>`+
            `</w:numPr>`+
          `</w:pPr>`+
          `<w:r>`+
            `<w:t xml:space="preserve">${content}</w:t>`+
          `</w:r>`+
        `</w:p>`
      var numIds = (ooxml) => [...ooxml.matchAll(/<w:numId w:val="(\d+)"\/>/g)].map(m => m[1])

      // Expected value updated: since 547fa46 ("fix #318", numbering continued from one list to the next), each numbered
      // list has its own numbering identifier so that it restarts at 1: identifiers given by the convertHTML filter
      // (listIds), generated (5 digits) when not given. The previous expected value used the numbered list of the template
      // (numId 2) for every list. The definitions of these identifiers in numbering.xml are checked by report-content.test.js.
      it('Simple Numbering', () => {
        var html =
        `<ol>`+
          `<li>`+
            `<p>Number1</p>`+
          `</li>`+
          `<li>`+
            `<p>Number2</p>`+
          `</li>`+
        `</ol>`
        expect(html2ooxml(html, "", [2])).toEqual(numberedItem(2, 0, 'Number1') + numberedItem(2, 0, 'Number2'))
        var ooxml = html2ooxml(html)
        var numId = numIds(ooxml)[0]
        expect(numId).toMatch(/^[1-9]\d{4}$/)
        expect(ooxml).toEqual(numberedItem(numId, 0, 'Number1') + numberedItem(numId, 0, 'Number2'))
      })

      // Expected value updated (see Simple Numbering): the nested list continues the numbering instance of its parent list at
      // the next level (w:ilvl 1): Word numbers it under the current item of its parent (2.1 with a multilevel list) and
      // restarts it after the next item of the parent. The previous expected value put all the items at the level 0 of the
      // numbered list of the template (numId 2): the nested item continued the numbering of its parent list.
      it('Nested Numbering', () => {
        var html =
        `<ol>`+
          `<li>`+
            `<p>Number1</p>`+
          `</li>`+
          `<ol>`+
            `<li>`+
              `<p>NumberNested</p>`+
            `</li>`+
          `</ol>`+
          `<li>`+
            `<p>Number2</p>`+
          `</li>`+
        `</ol>`
        expect(html2ooxml(html, "", [2, 3])).toEqual(numberedItem(2, 0, 'Number1') + numberedItem(2, 1, 'NumberNested') + numberedItem(2, 0, 'Number2'))
        var ooxml = html2ooxml(html)
        var numId = numIds(ooxml)[0]
        expect(numId).toMatch(/^[1-9]\d{4}$/)
        expect(ooxml).toEqual(numberedItem(numId, 0, 'Number1') + numberedItem(numId, 1, 'NumberNested') + numberedItem(numId, 0, 'Number2'))
      })

      it('Break', () => {
        var html = "<p>Paragraph<br>Break</p>"
        var expected =
        `<w:p>`+
          `<w:r>`+
            `<w:t xml:space="preserve">Paragraph</w:t>`+
          `</w:r>`+
          `<w:r>`+
            `<w:br/>`+
          `</w:r>`+
          `<w:r>`+
            `<w:t xml:space="preserve">Break</w:t>`+
          `</w:r>`+
        `</w:p>`
        var ooxml = html2ooxml(html)
        expect(ooxml).toEqual(expected)
      })

      it('Break with newline', () => {
        var html = "<p>Paragraph\nBreak</p>"
        var expected =
        `<w:p>`+
          `<w:r>`+
            `<w:t xml:space="preserve">Paragraph</w:t>`+
          `</w:r>`+
          `<w:r>`+
            `<w:br/>`+
          `</w:r>`+
          `<w:r>`+
            `<w:t xml:space="preserve">Break</w:t>`+
          `</w:r>`+
        `</w:p>`
        var ooxml = html2ooxml(html)
        expect(ooxml).toEqual(expected)
      })

      it('Code', () => {
        var html = "<p>Paragraph <code>Code</code> Paragraph</p>"
        var expected =
        `<w:p><w:r><w:t xml:space=\"preserve\">Paragraph </w:t></w:r><w:r><w:rPr><w:rStyle w:val=\"CodeChar\"/></w:rPr><w:t xml:space=\"preserve\">Code</w:t></w:r><w:r><w:t xml:space=\"preserve\"> Paragraph</w:t></w:r></w:p>`
        var ooxml = html2ooxml(html)
        expect(ooxml).toEqual(expected)
      })

      it('CodeBlock', () => {
        var html = "<pre><code>Code Block</code></pre>"
        var expected =
        `<w:p><w:pPr><w:pStyle w:val=\"Code\"/></w:pPr><w:r><w:t xml:space=\"preserve\">Code Block</w:t></w:r></w:p>`
        var ooxml = html2ooxml(html)
        expect(ooxml).toEqual(expected)
      })

      // Lists use the numbering definitions of the report template (numId)
      it('Numbered list uses the numbering of the template', () => {
        var ooxml = html2ooxml("<ol><li><p>One</p></li><li><p>Two</p></li></ol>", "", ["42"])
        expect(ooxml.match(/<w:numId w:val="42"\/>/g)).toHaveLength(2)
        expect(ooxml).not.toContain('undefined')
      })

      it('Bullet list uses the bullet numbering of the template', () => {
        var ooxml = html2ooxml("<ul><li><p>A</p><ul><li><p>B</p></li></ul></li></ul>")
        expect(ooxml.match(/<w:numId w:val="1"\/>/g)).toHaveLength(2)
        expect(ooxml).toContain('<w:ilvl w:val="1"/>')
      })

      it('Table at full width', () => {
        var ooxml = html2ooxml("<table><tbody><tr><td><p>A</p></td><td><p>B</p></td></tr></tbody></table>")
        expect(ooxml).toContain('<w:tblW w:type="pct" w:w="5000"/>') // 5000 fiftieths of a percent: 100%
        expect(ooxml).toContain('<w:t xml:space="preserve">B</w:t>')
      })

    })

    describe('Report expressions', () => {
      var expressions = require('angular-expressions')
      var evaluate = (tag, scope) => reportGenerator.parser(tag).get(scope, {scopeList: [scope], num: 0})

      it('Rejects sandbox-escape expressions (CVE-2026-44643)', () => {
        expect(require('angular-expressions/package.json').version).not.toMatch(/^1\.5\.[01]$/)
        expect(() => expressions.compile('a | __proto__')({}, {})).toThrow(/Filter '__proto__' is not defined/)
      })

      it('Accepts template expressions longer than 250 characters', () => {
        var tag = Array.from({length: 30}, (_, i) => `v${i} = (count + ${i})`).join('; ') + '; v29'
        expect(tag.length).toBeGreaterThan(250)
        expect(evaluate(tag, {count: 1})).toBe(30)
      })

      it('Template expressions with filters', () => {
        expect(evaluate("title | upper", {title: 'sql injection'})).toBe('SQL INJECTION')
        expect(evaluate("(findings | where: 'severity == \"High\"').length", {findings: [{severity: 'High'}, {severity: 'Low'}]})).toBe(1)
      })

      it('Filters read own properties only', () => {
        var scope = {findings: [{title: 'XSS', cvss: {score: 6.1}}, {title: 'SQLi', cvss: {score: 9.8}}]}
        expect(evaluate("findings | select: 'title'", scope)).toEqual(['XSS', 'SQLi'])
        expect(evaluate("findings | select: 'cvss.score'", scope)).toEqual([6.1, 9.8])
        expect(evaluate("findings | select: 'constructor'", scope)).toEqual([undefined, undefined])
        expect(evaluate("findings | select: 'constructor.constructor'", scope)).toEqual([undefined, undefined])
        expect(evaluate("findings | select: 'title.constructor'", scope)).toEqual([undefined, undefined])
        expect(() => evaluate("findings | map: 'constructor'", scope)).toThrow(/Filter 'constructor' is not defined/)
        expect(evaluate("findings | select: 'title' | map: 'upper'", scope)).toEqual(['XSS', 'SQLI'])
      })

      it('Groups findings whatever the value of the attribute', () => {
        var scope = {findings: [{title: 'A', severity: '__proto__'}, {title: 'B', severity: 'High'}, {title: 'C', severity: 'High'}]}
        var groups = evaluate("findings | groupBy: 'severity'", scope)
        expect(groups.map(g => [g.key, g.value.map(f => f.title)])).toEqual([['__proto__', ['A']], ['High', ['B', 'C']]])
      })
    })

    describe('Translations', () => {
      var translate = require('../src/translate').translate

      it('Translates with the dictionaries', () => {
        expect(translate('Attack Vector', 'fr')).toBe("Vecteur d'attaque")
        expect(translate('Not translated', 'fr')).toBe('Not translated')
        expect(translate('Attack Vector', 'unknown')).toBe('Attack Vector')
      })

      it('Returns translations only, not the properties of the dictionary object', () => {
        expect(translate('constructor', 'fr')).toBe('constructor')
        expect(translate('__proto__', 'fr')).toBe('__proto__')
        expect(translate('hasOwnProperty', 'fr')).toBe('hasOwnProperty')
      })

      it('Reads the dictionaries of the translate folder only', () => {
        expect(translate('dev', '../config/config')).toBe('dev')
        expect(translate('name', '../../package')).toBe('name')
        expect(translate('Attack Vector', 'fr.json')).toBe('Attack Vector')
      })
    })

    describe('Report images width', () => {
      var PizZip = require("pizzip")
      var documentWith = (sectPr) => {
        var zip = new PizZip()
        zip.file('word/document.xml', `<w:document><w:body><w:p/>${sectPr}</w:body></w:document>`)
        return zip
      }

      it('Width parameter in image data URI', () => {
        var src = "data:image/png;base64,iVBORw0KGgo="
        var withWidth = reportGenerator.setImageWidthParam(src, 'medium')
        expect(withWidth).toEqual("data:image/png;pwndoc-width=medium;base64,iVBORw0KGgo=")
        expect(reportGenerator.getImageWidthParam(withWidth)).toEqual('medium')
        expect(withWidth.split(",")[1]).toEqual("iVBORw0KGgo=") // Data read by the image module unchanged
        expect(reportGenerator.getImageWidthParam(src)).toEqual(null)
        expect(reportGenerator.setImageWidthParam("https://example.com/a.png", 'small')).toEqual("https://example.com/a.png")
      })

      it('Template text area from the last section', () => {
        var zip = documentWith(
          `<w:p><w:pPr><w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="1418" w:right="1418" w:bottom="1418" w:left="1418"/></w:sectPr></w:pPr></w:p>` +
          `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1418" w:right="1418" w:bottom="1418" w:left="1418" w:header="284" w:footer="0" w:gutter="0"/></w:sectPr>`
        )
        // A4 portrait with 2.5cm margins: (11906 - 2 * 1418) / 15 = 604.6px
        expect(reportGenerator.getTemplateTextArea(zip)).toEqual({width: 604, height: 933})
      })

      it('Template text area fallback', () => {
        expect(reportGenerator.getTemplateTextArea(documentWith(''))).toEqual({width: 600, height: null})
      })
    })
  })
}