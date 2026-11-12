/*
  html2ooxml: conversion of the HTML of the editors (TipTap 3) to OOXML (WordprocessingML) inserted in the reports by
  the convertHTML filter. Pure function: no database, no HTTP.
  The HTML below is the HTML produced by the editors (frontend/test/fixtures/editor-html.json and the extensions of
  frontend/src/components/editor-extensions.js), then combinations, malformed and hostile HTML.
*/

module.exports = function () {
  var html2ooxml = require('../src/lib/html2ooxml')
  var helpers = require('./helpers')()
  var text = helpers.ooxmlText
  var paragraphs = helpers.ooxmlParagraphs
  var values = helpers.ooxmlValues

  // HTML of the editors (getHTML of TipTap 3), see frontend/test/fixtures/editor-html.json
  var EDITOR_HTML = [
    '<p>Simple paragraph</p>',
    '<p></p>',
    '<p>Texte <strong>gras</strong>, <em>italique</em>, <u>souligné</u>, <s>barré</s>, <code>code</code> et <strong><em><u>tout</u></em></strong>.</p>',
    '<p>Un <a target="_blank" rel="noopener noreferrer nofollow" href="https://example.com">lien</a>, un <a target="_blank" rel="noopener noreferrer nofollow" href="mailto:a@b.c">mail</a>.</p>',
    '<p><mark data-color="#ffff00" style="background-color: rgb(255, 255, 0); color: inherit;">surligné jaune</mark> <mark>surligné défaut</mark></p>',
    '<h1>Titre 1</h1><h2>Titre 2</h2><h3>Titre 3</h3><h4>Titre 4</h4><h5>Titre 5</h5><h6>Titre 6</h6>',
    '<ul><li><p>Un</p></li><li><p>Deux</p><ul><li><p>Deux point un</p></li></ul></li></ul>',
    '<ol><li><p>Premier</p></li><li><p>Second</p><ol><li><p>Imbriqué</p></li></ol></li></ol>',
    '<ol start="3"><li><p>Trois</p></li></ol>',
    '<ul><li><p>Sans paragraphe</p></li></ul>',
    '<blockquote><p>Citation</p></blockquote>',
    '<p>Ligne 1<br>Ligne 2</p>',
    '<hr>',
    '<pre><code class="language-http">GET / HTTP/1.1\nHost: example.com</code></pre>',
    '<pre><code>sans langage</code></pre>',
    '<p>Avant</p><pre><code class="language-bash">echo \'x\'</code></pre>',
    '<table style="min-width: 50px;"><colgroup><col style="min-width: 25px;"><col style="min-width: 25px;"></colgroup><tbody><tr><th><p>A</p></th><th><p>B</p></th></tr><tr><td><p>1</p></td><td><p>2</p></td></tr></tbody></table>',
    '<table style="min-width: 50px;"><colgroup><col style="min-width: 25px;"><col style="min-width: 25px;"></colgroup><tbody><tr><td colspan="2"><p>fusion</p></td></tr><tr><td><p>x</p></td><td colwidth="150"><p>y</p></td></tr></tbody></table>',
    '<p>Avant image</p><img class="custom-image" src="6aef2c3a3b1d4e5f60718293" alt="Capture"><p>Après image</p>',
    '<img class="custom-image" src="6aef2c3a3b1d4e5f60718293" alt="Large" data-width="large">',
    '<img class="custom-image" src="data:image/png;base64,iVBORw0KGgo=" alt="base64">',
    '<p>Fin par une image</p><img class="custom-image" src="6aef2c3a3b1d4e5f60718293" alt="">',
    '<table style="min-width: 25px;"><colgroup><col style="min-width: 25px;"></colgroup><tbody><tr><td><p>Fin par un tableau</p></td></tr></tbody></table>',
    '<figure><img src="6aef2c3a3b1d4e5f60718293" alt="fig" draggable="false" contenteditable="false"><figcaption>Légende</figcaption></figure>',
    '<legend label="Figure" alt="légende"></legend>',
    '<p>Texte avec &lt;script&gt; échappé &amp; entités</p>',
    '<p>div inconnue</p><p>span</p>',
    '<p>espaces multiples</p>'
  ]

  // Tags of the HTML that must not be left in the OOXML
  var HTML_TAG = /<\/?(p|strong|b|em|i|u|s|strike|code|pre|a|mark|span|div|h[1-6]|ul|ol|li|table|thead|tbody|tr|td|th|colgroup|col|img|figure|figcaption|legend|br|hr|blockquote|script|style|iframe)\b/i

  // Well-formed OOXML made of paragraphs and tables only
  var expectValidOoxml = (ooxml) => {
    expect(helpers.xmlErrors(ooxml)).toEqual([])
    expect(ooxml).not.toMatch(HTML_TAG)
    var elements = (ooxml.match(/<\/?([A-Za-z_][\w:.-]*)/g) || []).map(tag => tag.replace(/^<\/?/, ''))
    expect(elements.filter(name => !name.startsWith('w:'))).toEqual([])
    expect(ooxml).not.toContain('undefined')
    expect(ooxml).not.toContain('[object Object]')
  }

  // Run properties (w:rPr) of the run containing a text
  var runProperties = (ooxml, runText) => {
    var run = (ooxml.match(/<w:r>[\s\S]*?<\/w:r>/g) || []).find(r => text(r) === runText)
    if (!run) throw new Error(`No run with the text ${runText} in ${ooxml}`)
    var properties = run.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/)
    return properties ? properties[1] : ''
  }

  // Numbering (numId, ilvl) of each paragraph: [text, numId, ilvl]
  var numbering = (ooxml) => paragraphs(ooxml).map(p => [text(p), values(p, 'w:numId', 'w:val')[0], values(p, 'w:ilvl', 'w:val')[0]])

  // Widths of the cells of each row of a table, in percent (w:tcW of type pct: fiftieths of a percent or "n%")
  var cellWidths = (ooxml) => (ooxml.match(/<w:tr>[\s\S]*?<\/w:tr>/g) || []).map(row =>
    [...row.matchAll(/<w:tcW w:type="pct" w:w="([^"]+)"\/>/g)].map(m => m[1].endsWith('%') ? parseFloat(m[1]) : parseInt(m[1], 10) / 50))

  describe('html2ooxml Suite Tests', () => {

    describe('Content of the editors', () => {
      it('Converts every content produced by the editors to well-formed OOXML without HTML left', () => {
        EDITOR_HTML.forEach(html => {
          var ooxml = html2ooxml(html, '', [101, 102, 103])
          expect(typeof ooxml).toBe('string')
          expectValidOoxml(ooxml)
        })
      })

      it('Keeps the text of the editors contents', () => {
        var convert = (html) => text(html2ooxml(html, '', [101, 102]))
        expect(convert(EDITOR_HTML[0])).toBe('Simple paragraph')
        expect(convert(EDITOR_HTML[2])).toBe('Texte gras, italique, souligné, barré, code et tout.')
        expect(convert(EDITOR_HTML[5])).toBe('Titre 1Titre 2Titre 3Titre 4Titre 5Titre 6')
        expect(convert(EDITOR_HTML[6])).toBe('UnDeuxDeux point un')
        expect(convert(EDITOR_HTML[7])).toBe('PremierSecondImbriqué')
        expect(convert(EDITOR_HTML[10])).toBe('Citation')
        expect(convert(EDITOR_HTML[11])).toBe('Ligne 1Ligne 2')
        expect(convert(EDITOR_HTML[16])).toBe('AB12')
        expect(convert(EDITOR_HTML[25])).toBe('Texte avec <script> échappé & entités')
      })

      it('Empty contents', () => {
        expect(html2ooxml('')).toBe('')
        expect(html2ooxml('<p></p>')).toBe('<w:p/>')
        expect(html2ooxml('<p></p><p></p>')).toBe('<w:p/><w:p/>')
        expect(html2ooxml('<h1></h1>')).toBe('<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr></w:p>')
        expect(html2ooxml('<hr>')).toBe('<w:p><w:r><w:t xml:space="preserve"></w:t></w:r></w:p>') // At least one paragraph
      })

      it('Text without paragraph is put in a paragraph', () => {
        expect(html2ooxml('Plain text & more')).toBe('<w:p><w:r><w:t xml:space="preserve">Plain text &amp; more</w:t></w:r></w:p>')
      })

      it('Blockquotes and unknown block elements keep their paragraphs', () => {
        expect(html2ooxml('<blockquote><p>Quote</p></blockquote>')).toBe('<w:p><w:r><w:t xml:space="preserve">Quote</w:t></w:r></w:p>')
        expect(text(html2ooxml('<div>In a div</div>'))).toBe('In a div')
        expect(text(html2ooxml('<section><p>In a section</p></section>'))).toBe('In a section')
      })

      it('Paragraph style given by the template', () => {
        var ooxml = html2ooxml('<h2>Title</h2><p>Text</p><ul><li><p>Item</p></li></ul>', 'Normal10')
        var [heading, paragraph, item] = paragraphs(ooxml)
        expect(values(heading, 'w:pStyle', 'w:val')).toEqual(['Heading2']) // Headings keep their style
        expect(values(paragraph, 'w:pStyle', 'w:val')).toEqual(['Normal10'])
        expect(values(item, 'w:pStyle', 'w:val')).toEqual(['Normal10'])
        expect(values(item, 'w:numId', 'w:val')).toEqual(['1']) // Still a list item
        // Not a string: ignored
        expect(html2ooxml('<p>Text</p>', {style: 'x'})).toBe('<w:p><w:r><w:t xml:space="preserve">Text</w:t></w:r></w:p>')
      })
    })

    describe('Marks', () => {
      it('Each mark gives its run property', () => {
        var ooxml = html2ooxml(EDITOR_HTML[2])
        expect(runProperties(ooxml, 'Texte ')).toBe('')
        expect(runProperties(ooxml, 'gras')).toBe('<w:b/><w:bCs/>')
        expect(runProperties(ooxml, 'italique')).toBe('<w:i/><w:iCs/>')
        expect(runProperties(ooxml, 'souligné')).toBe('<w:u w:val="single"/>')
        expect(runProperties(ooxml, 'barré')).toBe('<w:strike/>')
        expect(runProperties(ooxml, 'code')).toBe('<w:rStyle w:val="CodeChar"/>')
        expect(runProperties(ooxml, 'tout')).toBe('<w:b/><w:bCs/><w:i/><w:iCs/><w:u w:val="single"/>')
        expect(runProperties(ooxml, '.')).toBe('')
      })

      it('Legacy tags of the marks (b, i, strike)', () => {
        var ooxml = html2ooxml('<p><b>b</b><i>i</i><strike>s</strike></p>')
        expect(runProperties(ooxml, 'b')).toBe('<w:b/><w:bCs/>')
        expect(runProperties(ooxml, 'i')).toBe('<w:i/><w:iCs/>')
        expect(runProperties(ooxml, 's')).toBe('<w:strike/>')
      })

      it('Nested marks are combined and end with their tag', () => {
        var ooxml = html2ooxml('<p><strong>b<em>bi<u>biu<s>bius</s></u>bi2</em>b2</strong>plain <em>i</em></p>')
        expect(runProperties(ooxml, 'b')).toBe('<w:b/><w:bCs/>')
        expect(runProperties(ooxml, 'bi')).toBe('<w:b/><w:bCs/><w:i/><w:iCs/>')
        expect(runProperties(ooxml, 'biu')).toBe('<w:b/><w:bCs/><w:i/><w:iCs/><w:u w:val="single"/>')
        expect(runProperties(ooxml, 'bius')).toBe('<w:b/><w:bCs/><w:i/><w:iCs/><w:strike/><w:u w:val="single"/>') // Order of the OOXML schema
        expect(runProperties(ooxml, 'bi2')).toBe('<w:b/><w:bCs/><w:i/><w:iCs/>')
        expect(runProperties(ooxml, 'b2')).toBe('<w:b/><w:bCs/>')
        expect(runProperties(ooxml, 'plain ')).toBe('')
        expect(runProperties(ooxml, 'i')).toBe('<w:i/><w:iCs/>')
      })

      it('Marks do not continue in the next paragraphs', () => {
        var ooxml = html2ooxml('<p><strong>bold</strong></p><p>next</p><h3><em>title</em></h3><p>after</p>')
        expect(runProperties(ooxml, 'next')).toBe('')
        expect(runProperties(ooxml, 'title')).toBe('<w:i/><w:iCs/>')
        expect(runProperties(ooxml, 'after')).toBe('')
      })

      it('Highlight colors of the editor', () => {
        var ooxml = html2ooxml('<p>' +
          '<mark data-color="#ffff00" style="background-color: #ffff00; color: inherit">yellow</mark>' +
          '<mark data-color="#fe0000" style="background-color: #fe0000; color: inherit">red</mark>' +
          '<mark data-color="#00ff00" style="background-color: #00ff00; color: inherit">green</mark>' +
          '<mark data-color="#00ffff" style="background-color: #00ffff; color: inherit">cyan</mark>' +
          '<mark>default</mark><mark data-color="#123456">other</mark> plain</p>')
        expectValidOoxml(ooxml)
        expect(runProperties(ooxml, 'yellow')).toBe('<w:highlight w:val="yellow"/>')
        expect(runProperties(ooxml, 'red')).toBe('<w:highlight w:val="red"/>')
        expect(runProperties(ooxml, 'green')).toBe('<w:highlight w:val="green"/>')
        expect(runProperties(ooxml, 'cyan')).toBe('<w:highlight w:val="cyan"/>')
        // Colors not proposed by the editor: text kept without highlight
        expect(runProperties(ooxml, 'default')).toBe('')
        expect(runProperties(ooxml, 'other')).toBe('')
        expect(runProperties(ooxml, ' plain')).toBe('')
      })

      it('Highlight combined with other marks', () => {
        var ooxml = html2ooxml('<p><strong><mark data-color="#fe0000">alert</mark></strong></p>')
        expect(runProperties(ooxml, 'alert')).toBe('<w:b/><w:bCs/><w:highlight w:val="red"/>')
      })
    })

    describe('Headings and breaks', () => {
      it('Headings 1 to 6 with marks', () => {
        for (var level = 1; level <= 6; level++) {
          var ooxml = html2ooxml(`<h${level}>Title <strong>${level}</strong></h${level}>`)
          expect(ooxml).toBe(`<w:p><w:pPr><w:pStyle w:val="Heading${level}"/></w:pPr><w:r><w:t xml:space="preserve">Title </w:t></w:r><w:r><w:rPr><w:b/><w:bCs/></w:rPr><w:t xml:space="preserve">${level}</w:t></w:r></w:p>`)
        }
      })

      it('Line breaks: br and new lines', () => {
        var ooxml = html2ooxml('<p>One<br>Two<br/>Three\nFour</p>')
        expect(paragraphs(ooxml)).toHaveLength(1)
        expect(ooxml.match(/<w:br\/>/g)).toHaveLength(3)
        expect(text(ooxml)).toBe('OneTwoThreeFour')
      })

      it('Break outside of a paragraph is ignored', () => {
        expect(html2ooxml('<br><p>x</p>')).toBe('<w:p><w:r><w:t xml:space="preserve">x</w:t></w:r></w:p>')
      })
    })

    describe('Bullet lists', () => {
      it('Items use the bullet numbering of the template (numId 1)', () => {
        expect(numbering(html2ooxml('<ul><li><p>One</p></li><li><p>Two</p></li></ul>'))).toEqual([['One', '1', '0'], ['Two', '1', '0']])
        expect(values(html2ooxml('<ul><li><p>One</p></li></ul>'), 'w:pStyle', 'w:val')).toEqual(['ListParagraph'])
      })

      it('Item without paragraph', () => {
        expect(numbering(html2ooxml('<ul><li>Direct text</li></ul>'))).toEqual([['Direct text', '1', '0']])
      })

      it('Nested lists: one level per list', () => {
        expect(numbering(html2ooxml(EDITOR_HTML[6]))).toEqual([['Un', '1', '0'], ['Deux', '1', '0'], ['Deux point un', '1', '1']])
      })

      it('Deep lists: level limited to the 9 levels of Word', () => {
        var html = ''
        for (var i = 1; i <= 11; i++) html += `<ul><li><p>${i}</p>`
        for (var i = 1; i <= 11; i++) html += '</li></ul>'
        var levels = numbering(html2ooxml(html)).map(item => item[2])
        expect(levels).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8', '8', '8'])
      })

      it('Paragraphs after a list are not list items', () => {
        var ooxml = html2ooxml('<ul><li><p>Item</p></li></ul><p>After</p><h2>Title</h2>')
        expect(numbering(ooxml)).toEqual([['Item', '1', '0'], ['After', undefined, undefined], ['Title', undefined, undefined]])
      })

      it('Item with formatted text and several paragraphs: one bullet per item', () => {
        var ooxml = html2ooxml('<ul><li><p>First <strong>bold</strong></p><p>Second</p></li><li><p>Next</p></li></ul>')
        expect(numbering(ooxml)).toEqual([['First bold', '1', '0'], ['Second', undefined, undefined], ['Next', '1', '0']])
        expect(runProperties(ooxml, 'bold')).toBe('<w:b/><w:bCs/>')
      })
    })

    describe('Numbered lists', () => {
      it('Items of a list share the identifier given for the list', () => {
        expect(numbering(html2ooxml('<ol><li><p>One</p></li><li><p>Two</p></li></ol>', '', [42]))).toEqual([['One', '42', '0'], ['Two', '42', '0']])
      })

      it('Each list has its own identifier: numbering restarts', () => {
        var ooxml = html2ooxml('<ol><li><p>A</p></li></ol><p>Text</p><ol><li><p>B</p></li><li><p>C</p></li></ol>', '', [42, 43])
        expect(numbering(ooxml)).toEqual([['A', '42', '0'], ['Text', undefined, undefined], ['B', '43', '0'], ['C', '43', '0']])
      })

      // Numbering instance of the parent list at the next level: Word numbers the nested items under their parent item
      // (2.1 with a multilevel list) and restarts them after the next item of the parent
      it('Nested list: identifier of its parent list at the next level', () => {
        expect(numbering(html2ooxml(EDITOR_HTML[7], '', [42, 43]))).toEqual([['Premier', '42', '0'], ['Second', '42', '0'], ['Imbriqué', '42', '1']])
        var ooxml = html2ooxml('<ol><li><p>A</p><ol><li><p>A1</p></li></ol></li><li><p>B</p><ol><li><p>B1</p></li></ol></li></ol><ol><li><p>C</p></li></ol>', '', [1, 2, 3])
        expect(numbering(ooxml)).toEqual([['A', '1', '0'], ['A1', '1', '1'], ['B', '1', '0'], ['B1', '1', '1'], ['C', '2', '0']])
      })

      it('Identifiers generated when not given (5 digits), one per list', () => {
        var ooxml = html2ooxml('<ol><li><p>A</p></li><li><p>B</p></li></ol><ol><li><p>C</p></li></ol>')
        var ids = numbering(ooxml).map(item => item[1])
        ids.forEach(id => expect(id).toMatch(/^[1-9]\d{4}$/))
        expect(ids[0]).toBe(ids[1])
        // More lists than identifiers given
        ids = numbering(html2ooxml('<ol><li><p>A</p></li></ol><ol><li><p>B</p></li></ol>', '', [7])).map(item => item[1])
        expect(ids[0]).toBe('7')
        expect(ids[1]).toMatch(/^[1-9]\d{4}$/)
      })

      it('Start attribute: same list numbering', () => {
        expect(numbering(html2ooxml(EDITOR_HTML[8], '', [42]))).toEqual([['Trois', '42', '0']])
      })

      it('Mixed lists: bullets in a numbered list and numbers in a bullet list', () => {
        var ooxml = html2ooxml('<ol><li><p>N1</p><ul><li><p>B1</p></li></ul></li><li><p>N2</p></li></ol>', '', [42])
        expect(numbering(ooxml).map(item => item.slice(0, 2))).toEqual([['N1', '42'], ['B1', '1'], ['N2', '42']])
        ooxml = html2ooxml('<ul><li><p>B1</p><ol><li><p>N1</p></li></ol></li><li><p>B2</p></li></ul>', '', [42])
        expect(numbering(ooxml).map(item => item.slice(0, 2))).toEqual([['B1', '1'], ['N1', '1'], ['B2', '1']])
        expectValidOoxml(ooxml)
      })
    })

    describe('Code', () => {
      it('Inline code: character style', () => {
        var ooxml = html2ooxml('<p>Run <code>ls -la</code> now</p>')
        expect(runProperties(ooxml, 'ls -la')).toBe('<w:rStyle w:val="CodeChar"/>')
        expect(runProperties(ooxml, ' now')).toBe('')
      })

      it('Code block: paragraph style, one break per line, indentation kept', () => {
        var ooxml = html2ooxml('<pre><code class="language-python">def f():\n    return 1\n</code></pre>')
        expect(paragraphs(ooxml)).toHaveLength(1)
        expect(values(ooxml, 'w:pStyle', 'w:val')).toEqual(['Code'])
        expect(ooxml.match(/<w:br\/>/g)).toHaveLength(2)
        expect(ooxml).toContain('<w:t xml:space="preserve">    return 1</w:t>')
      })

      it('Code block with the language of the editor', () => {
        var ooxml = html2ooxml(EDITOR_HTML[13])
        expect(text(ooxml)).toBe('GET / HTTP/1.1Host: example.com')
        expect(values(ooxml, 'w:pStyle', 'w:val')).toEqual(['Code'])
      })

      it('Code block with the syntax highlighting of the editor (hljs classes): colors', () => {
        var ooxml = html2ooxml('<pre><code class="language-js"><span class="hljs-keyword">const</span> a = <span class="hljs-string">"x"</span>;</code></pre>')
        expectValidOoxml(ooxml)
        expect(runProperties(ooxml, 'const')).toBe('<w:color w:val="569CD6"/>')
        expect(runProperties(ooxml, '"x"')).toBe('<w:color w:val="CE9178"/>')
        expect(text(ooxml)).toBe('const a = "x";')
      })

      it('Code block content is escaped', () => {
        var ooxml = html2ooxml('<pre><code class="language-xml">&lt;a href="x"&gt;&amp;&lt;/a&gt; {title} </w:t></code></pre>')
        expect(helpers.xmlErrors(ooxml)).toEqual([])
        expect(text(ooxml)).toBe('<a href="x">&</a> {title} ')
      })

      it('Paragraphs after a code block are not in the code style', () => {
        var ooxml = html2ooxml('<pre><code>x</code></pre><p>after <strong>bold</strong></p><ul><li><p>item</p></li></ul>')
        expect(runProperties(ooxml, 'after ')).toBe('')
        expect(runProperties(ooxml, 'bold')).toBe('<w:b/><w:bCs/>')
        expect(runProperties(ooxml, 'item')).toBe('')
      })

      it('Paragraphs after a code block: text and paragraph style kept', () => {
        var ooxml = html2ooxml('<pre><code>x</code></pre><p>after</p>')
        var [code, after] = paragraphs(ooxml)
        expect(values(code, 'w:pStyle', 'w:val')).toEqual(['Code'])
        expect(values(after, 'w:pStyle', 'w:val')).toEqual([])
        expect(text(after)).toBe('after')
      })
    })

    describe('Tables', () => {
      // Table style of the templates (#244): borders and header row customizable, no direct borders overriding the style
      it('Converted tables use the table style PwndocTable, header row formatting when the first row is a header', () => {
        var ooxml = html2ooxml(EDITOR_HTML[16])
        expect(html2ooxml.TABLE_STYLE).toBe('PwndocTable')
        expect(values(ooxml, 'w:tblStyle', 'w:val')).toEqual(['PwndocTable'])
        expect(ooxml).not.toContain('<w:tblBorders>')
        expect(values(ooxml, 'w:tblLook', 'w:firstRow')).toEqual(['true'])
        ooxml = html2ooxml('<table><tbody><tr><td><p>a</p></td></tr></tbody></table><table><tbody><tr><td><p>b</p></td></tr></tbody></table>')
        expect(values(ooxml, 'w:tblStyle', 'w:val')).toEqual(['PwndocTable', 'PwndocTable'])
        expect(values(ooxml, 'w:tblLook', 'w:firstRow')).toEqual(['false', 'false'])
        expectValidOoxml(ooxml)
      })

      it('Header row repeated on each page, table at full width', () => {
        var ooxml = html2ooxml(EDITOR_HTML[16])
        expectValidOoxml(ooxml)
        expect(ooxml).toContain('<w:tblW w:type="pct" w:w="5000"/>')
        var rows = ooxml.match(/<w:tr>[\s\S]*?<\/w:tr>/g)
        expect(rows).toHaveLength(2)
        expect(rows[0]).toContain('<w:tblHeader/>')
        expect(rows[1]).toContain('<w:tblHeader w:val="off"/>')
        expect(rows.map(row => (row.match(/<w:tc>/g) || []).length)).toEqual([2, 2])
        expect(rows.map(text)).toEqual(['AB', '12'])
      })

      it('Empty cells contain an empty paragraph', () => {
        var ooxml = html2ooxml('<table><tbody><tr><td></td><td><p></p></td><td><p>x</p></td></tr></tbody></table>')
        expectValidOoxml(ooxml)
        var cells = ooxml.match(/<w:tc>[\s\S]*?<\/w:tc>/g)
        expect(cells).toHaveLength(3)
        cells.forEach(cell => expect(paragraphs(cell)).toHaveLength(1)) // A cell must end with a paragraph
      })

      it('Lists, marks, code and several paragraphs in cells', () => {
        var ooxml = html2ooxml('<table><tbody><tr>' +
          '<td><ul><li><p>bullet</p></li></ul><ol><li><p>number</p></li></ol></td>' +
          '<td><p><strong>bold</strong> <code>code</code></p><p>second</p></td>' +
          '</tr></tbody></table><p>after</p>', '', [42])
        expectValidOoxml(ooxml)
        var cells = ooxml.match(/<w:tc>[\s\S]*?<\/w:tc>/g)
        expect(numbering(cells[0])).toEqual([['bullet', '1', '0'], ['number', '42', '0']])
        expect(paragraphs(cells[1]).map(text)).toEqual(['bold code', 'second'])
        expect(runProperties(cells[1], 'bold')).toBe('<w:b/><w:bCs/>')
        // Paragraph after the table: outside of the table
        expect(ooxml.endsWith('</w:tbl><w:p><w:r><w:t xml:space="preserve">after</w:t></w:r></w:p>')).toBe(true)
      })

      it('Consecutive tables', () => {
        var table = (content) => `<table><tbody><tr><td><p>${content}</p></td></tr></tbody></table>`
        var ooxml = html2ooxml(table('one') + table('two'))
        expectValidOoxml(ooxml)
        var tables = ooxml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g)
        expect(tables.map(text)).toEqual(['one', 'two'])
      })

      it('Table without tbody and table not closed', () => {
        var ooxml = html2ooxml('<table><tr><td><p>x</p></td></tr></table>')
        expect(text(ooxml)).toBe('x')
        expectValidOoxml(ooxml)
        ooxml = html2ooxml('<table><tbody><tr><td><p>y</p></td></tr>')
        expect(text(ooxml)).toBe('y')
        expectValidOoxml(ooxml)
      })

      it('Column widths of the editor (colwidth) kept as percentages of the table width', () => {
        expect(cellWidths(html2ooxml('<table><tbody><tr><td><p>a</p></td><td><p>b</p></td></tr></tbody></table>'))).toEqual([[50, 50]])
        expect(cellWidths(html2ooxml('<table><tbody><tr><td colwidth="100"><p>a</p></td><td colwidth="300"><p>b</p></td></tr></tbody></table>'))).toEqual([[25, 75]])
      })

      it('Cells widths: same width for cells of the same width', () => {
        var widths = cellWidths(html2ooxml('<table><tbody><tr><td><p>a</p></td><td><p>b</p></td><td><p>c</p></td></tr></tbody></table>'))
        expect(widths).toHaveLength(1)
        expect(new Set(widths[0]).size).toBe(1)
      })

      it('Merged cells (colspan, rowspan)', () => {
        var ooxml = html2ooxml(EDITOR_HTML[17])
        expect(ooxml).toContain('<w:gridSpan w:val="2"/>')
        ooxml = html2ooxml('<table><tbody><tr><td rowspan="2"><p>r</p></td><td><p>1</p></td></tr><tr><td><p>2</p></td></tr></tbody></table>')
        expect(ooxml).toContain('<w:vMerge w:val="restart"/>')
        expect(ooxml.match(/<w:tr>[\s\S]*?<\/w:tr>/g).map(row => (row.match(/<w:tc>/g) || []).length)).toEqual([2, 2])
      })

      it('Merged cells: content kept, well-formed table', () => {
        var ooxml = html2ooxml(EDITOR_HTML[17])
        expectValidOoxml(ooxml)
        expect(text(ooxml)).toBe('fusionxy')
      })
    })

    describe('Images and captions', () => {
      // Images are taken out of the HTML by the report generator (splitHTMLParagraphs) and inserted by the template
      it('Images are not converted, the text around is kept', () => {
        var ooxml = html2ooxml(EDITOR_HTML[18])
        expectValidOoxml(ooxml)
        expect(paragraphs(ooxml).map(text)).toEqual(['Avant image', 'Après image'])
        expect(ooxml).not.toContain('6aef2c3a3b1d4e5f60718293')
        // Field with an image only: no paragraph (the template inserts the image)
        expect(html2ooxml('<img class="custom-image" src="data:image/png;base64,iVBORw0KGgo=" alt="base64" data-width="small">')).toBe('')
      })

      it('Caption: style, label, SEQ field numbered by Word and text', () => {
        var ooxml = html2ooxml('<legend label="Figure" alt="Login page"></legend>')
        expect(ooxml).toBe(
          '<w:p><w:pPr><w:pStyle w:val="Caption"/><w:jc w:val="center"/></w:pPr>' +
          '<w:r><w:t xml:space="preserve">Figure </w:t></w:r>' +
          '<w:fldSimple w:instr="SEQ Figure"><w:r><w:t xml:space="preserve">1</w:t></w:r></w:fldSimple>' +
          '<w:r><w:t xml:space="preserve"> - Login page</w:t></w:r></w:p>')
      })

      it('Captions of tables and code blocks: own sequence', () => {
        var ooxml = html2ooxml('<legend label="Table" alt="Accounts"></legend><p>x</p><legend label="Listing" alt="Request"></legend>')
        expect(values(ooxml, 'w:fldSimple', 'w:instr')).toEqual(['SEQ Table', 'SEQ Listing'])
        expect(paragraphs(ooxml).map(text)).toEqual(['Table 1 - Accounts', 'x', 'Listing 1 - Request'])
      })

      it('Caption without label: Figure', () => {
        expect(values(html2ooxml('<legend alt="Text"></legend>'), 'w:fldSimple', 'w:instr')).toEqual(['SEQ Figure'])
      })

      it('Caption text and label escaped', () => {
        var ooxml = html2ooxml('<legend label=\'Fig" w:instr="INCLUDETEXT x\' alt="a &amp; b &lt;c&gt; &quot;d&quot;"></legend>')
        expectValidOoxml(ooxml)
        expect(values(ooxml, 'w:fldSimple', 'w:instr')).toEqual(['SEQ Fig&quot; w:instr=&quot;INCLUDETEXT x'])
        expect(text(ooxml)).toBe('Fig" w:instr="INCLUDETEXT x 1 - a & b <c> "d"')
      })

      it('Figure of the editor: caption text from the image', () => {
        // The caption of a figure is the alt text of its image (template), the figcaption is not repeated
        var ooxml = html2ooxml(EDITOR_HTML[23])
        expectValidOoxml(ooxml)
      })
    })

    describe('Links', () => {
      it('Link text and target in the paragraph', () => {
        var ooxml = html2ooxml('<p>See <a target="_blank" rel="noopener noreferrer nofollow" href="https://example.com/a?b=1&amp;c=2">the site</a> now</p>')
        expect(helpers.xmlErrors(ooxml)).toEqual([])
        expect(ooxml).toContain('HYPERLINK')
        expect(ooxml).toContain('https://example.com/a?b=1&amp;c=2')
        expect(ooxml).toContain('the site')
        expect(ooxml).toContain('<w:rStyle w:val="PwndocLink"/>')
        expect(ooxml).not.toContain('_|link|_')
      })

      it('Link: field runs at the paragraph level, text kept as written', () => {
        var ooxml = html2ooxml('<p>See <a href="https://example.com/?a=1&amp;b=2">Smith &amp; <strong>Co</strong></a> now</p>')
        expect(helpers.xmlErrors(ooxml)).toEqual([])
        expect(ooxml).not.toMatch(/<w:t(?:\s[^>]*)?>[^<]*<w:/) // No element in a w:t
        expect(ooxml.match(/HYPERLINK/g)).toHaveLength(1)
        expect(text(ooxml)).toBe('See Smith & Co now')
        expect(values(ooxml, 'w:fldChar', 'w:fldCharType')).toEqual(['begin', 'separate', 'end'])
        expect(values(ooxml, 'w:instrText', 'xml:space')).toEqual(['preserve'])
        expect(ooxml).toContain('<w:instrText xml:space="preserve"> HYPERLINK "https://example.com/?a=1&amp;b=2" </w:instrText>')
        // Text of the link: result of the field, with the link style and its own marks
        expect(runProperties(ooxml, 'Smith ')).toBe('<w:rStyle w:val="PwndocLink"/>')
        expect(runProperties(ooxml, 'Co')).toBe('<w:rStyle w:val="PwndocLink"/><w:b/><w:bCs/>')
        expect(runProperties(ooxml, ' now')).toBe('')
        // Characters of the former link markers in the text and the target
        ooxml = html2ooxml('<p><a href="https://e.com/}_|link|_}">a|-|b</a></p>')
        expect(text(ooxml)).toBe('a|-|b')
        expect(ooxml).toContain('<w:instrText xml:space="preserve"> HYPERLINK "https://e.com/}_|link|_}" </w:instrText>')
      })

      it('Link not closed in its paragraph: field ended with the paragraph', () => {
        var ooxml = html2ooxml('<p><a href="https://e.com">unclosed</p><p>next</p>')
        expectValidOoxml(ooxml)
        var [link, next] = paragraphs(ooxml)
        expect(values(link, 'w:fldChar', 'w:fldCharType')).toEqual(['begin', 'separate', 'end'])
        expect(runProperties(next, 'next')).toBe('')
        // Links in table cells
        ooxml = html2ooxml('<table><tbody><tr><td><p><a href="https://t.com">in cell</a></p></td></tr></tbody></table>')
        expectValidOoxml(ooxml)
        expect(values(ooxml, 'w:fldChar', 'w:fldCharType')).toEqual(['begin', 'separate', 'end'])
      })

      it('Links with other protocols', () => {
        var ooxml = html2ooxml('<p><a href="mailto:a@b.c">mail</a> <a href="ftp://x.y/z">ftp</a></p>')
        expect(helpers.xmlErrors(ooxml)).toEqual([])
        expect(ooxml).toContain('HYPERLINK "mailto:a@b.c"')
        expect(ooxml).toContain('HYPERLINK "ftp://x.y/z"')
        expect(text(ooxml)).toBe('mail ftp')
      })

      it('Link target escaped (XML and field instruction)', () => {
        var ooxml = html2ooxml('<p><a href=\'https://e.com/"&gt;&lt;w:r&gt;\\x\'>t</a></p>')
        expect(helpers.xmlErrors(ooxml)).toEqual([])
        // " and \ escaped with \ in the field instruction, then escaped for XML
        expect(ooxml).toContain('HYPERLINK "https://e.com/\\&quot;&gt;&lt;w:r&gt;\\\\x" ')
      })

      it('Internal link (":::" menu of the editors): link to the bookmark of the finding in the document', () => {
        var ooxml = html2ooxml('<p>See <a target="_blank" rel="noopener noreferrer nofollow" href="#6af573f15a4b2128f82dfede">SQL injection</a> </p>')
        expectValidOoxml(ooxml)
        expect(ooxml).toContain('<w:instrText xml:space="preserve"> HYPERLINK \\l "B_6af573f15a4b2128f82dfede" </w:instrText>')
        expect(text(ooxml)).toBe('See SQL injection ')
        // Bookmark names as created by bookmarkCreate: characters replaced, letter first, 40 characters at most
        expect(html2ooxml('<p><a href="#VULN-1">v</a></p>')).toContain('HYPERLINK \\l "VULN_1"')
        expect(html2ooxml('<p><a href="#a&quot;&gt;b">v</a></p>')).toContain('HYPERLINK \\l "a__b"')
        expect(html2ooxml(`<p><a href="#${'x'.repeat(50)}">v</a></p>`)).toContain(`HYPERLINK \\l "${'x'.repeat(40)}"`)
      })
    })

    describe('Characters', () => {
      it('XML special characters are escaped', () => {
        var ooxml = html2ooxml('<p>a &amp; b &lt; c &gt; d &quot;e&quot; \'f\' &apos;g&apos;</p>')
        expectValidOoxml(ooxml)
        expect(text(ooxml)).toBe('a & b < c > d "e" \'f\' \'g\'')
      })

      it('Text looking like OOXML or template tags stays text', () => {
        var ooxml = html2ooxml('<p>&lt;/w:t&gt;&lt;/w:r&gt;&lt;/w:p&gt;&lt;w:p&gt;&lt;w:r&gt;&lt;w:t&gt;injected {#findings}{title}{/findings} {@raw}</p>')
        expectValidOoxml(ooxml)
        expect(paragraphs(ooxml)).toHaveLength(1)
        expect(text(ooxml)).toBe('</w:t></w:r></w:p><w:p><w:r><w:t>injected {#findings}{title}{/findings} {@raw}')
      })

      it('Unicode, emoji and non-breaking spaces', () => {
        var ooxml = html2ooxml('<p>Vulnérabilité ü ß 中文 العربية 😀 a&nbsp;b &#x1F512; &#233;</p>')
        expectValidOoxml(ooxml)
        expect(text(ooxml)).toBe('Vulnérabilité ü ß 中文 العربية 😀 a\u00a0b 🔒 é')
      })

      it('Spaces kept (xml:space="preserve")', () => {
        var ooxml = html2ooxml('<p>  two  spaces\tand tab  </p>')
        expect(ooxml).toBe('<w:p><w:r><w:t xml:space="preserve">  two  spaces\tand tab  </w:t></w:r></w:p>')
      })

      // Control characters (e.g. the vertical tab of a text copied from PowerPoint): a document containing them cannot be opened
      it('Control characters forbidden in XML are not copied', () => {
        var ooxml = html2ooxml('<p>a\u0001b\u000bc\u001fd\uffffe</p><legend label="Fig\u0002" alt="x\u0003y"></legend><p><a href="https://e.com/\u0004">l\u0005</a></p>')
        expect(helpers.xmlErrors(ooxml)).toEqual([])
        expect(paragraphs(ooxml).map(text)).toEqual(['abcde', 'Fig 1 - xy', 'l'])
        expect(ooxml).toContain('HYPERLINK "https://e.com/"')
      })

      it('Very long text', () => {
        var long = 'A long line with <special> & "characters" '.repeat(5000)
        var html = `<p>${long.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`
        var start = Date.now()
        var ooxml = html2ooxml(html)
        expect(Date.now() - start).toBeLessThan(5000)
        expect(helpers.xmlErrors(ooxml)).toEqual([])
        expect(text(ooxml)).toBe(long)
      })

      it('Many paragraphs', () => {
        var html = Array.from({length: 2000}, (_, i) => `<p>Paragraph ${i}</p>`).join('')
        var ooxml = html2ooxml(html)
        expect(paragraphs(ooxml)).toHaveLength(2000)
        expect(text(paragraphs(ooxml)[1999])).toBe('Paragraph 1999')
      })
    })

    describe('Malformed and hostile HTML', () => {
      it('Unclosed tags', () => {
        var ooxml = html2ooxml('<p>unclosed <strong>bold')
        expectValidOoxml(ooxml)
        expect(text(ooxml)).toBe('unclosed bold')
        ooxml = html2ooxml('<p>one<p>two')
        expect(paragraphs(ooxml).map(text)).toEqual(['one', 'two'])
        ooxml = html2ooxml('<ul><li><p>a<li><p>b')
        expectValidOoxml(ooxml)
        expect(text(ooxml)).toContain('b')
      })

      it('Closing tags without opening tag', () => {
        expectValidOoxml(html2ooxml('</p>text</strong>'))
        var ooxml = html2ooxml('<p>a</p></td></tr></table></ol></ul><p>b</p>')
        expectValidOoxml(ooxml)
        expect(paragraphs(ooxml).map(text)).toEqual(['a', 'b'])
      })

      it('Comments, CDATA, doctype and processing instructions', () => {
        var ooxml = html2ooxml('<!-- comment --><p>a<!-- inner --></p><![CDATA[x]]><!DOCTYPE html><?xml version="1.0"?>')
        expectValidOoxml(ooxml)
        expect(text(ooxml)).toBe('a')
      })

      it('Unquoted attributes and invalid nesting', () => {
        var ooxml = html2ooxml('<p class=x id=y>unquoted <strong>bold <em>both</strong> italic?</em></p>')
        expectValidOoxml(ooxml)
        expect(text(ooxml)).toBe('unquoted bold both italic?')
        expectValidOoxml(html2ooxml('<<p>>x'))
      })

      it('Script, style and frames: no markup in the document', () => {
        var ooxml = html2ooxml('<p>a<script>alert("<w:p>")</script>b<style>p{}</style><iframe src="https://evil"></iframe><object data="x"></object>c</p>')
        expect(helpers.xmlErrors(ooxml)).toEqual([])
        expect(ooxml).not.toMatch(/<(script|style|iframe|object)/)
        expect(paragraphs(ooxml)).toHaveLength(1)
        expect(text(ooxml)).toContain('a')
        expect(text(ooxml)).toContain('c')
      })

      it('Event handlers and javascript URLs are not kept', () => {
        var ooxml = html2ooxml('<p onclick="alert(1)" style="color:red" onmouseover="x()">click</p><img src="x" onerror="alert(1)">')
        expectValidOoxml(ooxml)
        expect(ooxml).not.toMatch(/onclick|onerror|onmouseover|alert|color:red/)
        expect(text(ooxml)).toBe('click')
      })

      it('Attributes of the editor elements cannot add OOXML', () => {
        var ooxml = html2ooxml('<p><mark data-color=\'"/><w:b/><w:x a="\'>m</mark></p><h1 class=\'"><w:p>\'>t</h1>')
        expectValidOoxml(ooxml)
        expect(ooxml).not.toContain('<w:x')
        expect(text(ooxml)).toBe('mt')
      })

      it('Only paragraphs and tables at the top level', () => {
        var html = EDITOR_HTML.join('') + '<p>end</p>'
        var ooxml = html2ooxml(html, '', [1, 2, 3])
        expectValidOoxml(ooxml)
        // Remove the tables and the paragraphs: nothing left
        var rest = ooxml.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, '').replace(/<w:p(?:\s[^>]*)?\/>|<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g, '')
        expect(rest).toBe('')
      })

      it('Non-string input', () => {
        expect(() => html2ooxml(undefined)).toThrow()
        expect(html2ooxml('42')).toBe('<w:p><w:r><w:t xml:space="preserve">42</w:t></w:r></w:p>')
      })
    })
  })
}
