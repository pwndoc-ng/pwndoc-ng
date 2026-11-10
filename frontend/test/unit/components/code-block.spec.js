// components/CodeBlockComponent.vue: node view of the code blocks (language choice, syntax highlighting), configured as in
// the editor component (CodeBlockLowlight with this node view), in real TipTap editors
import { describe, it, expect, vi, afterEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { VueNodeViewRenderer } from '@tiptap/vue-3'

vi.mock('boot/axios', () => import('../../helpers/api-mock'))

import { contentExtensions, lowlight } from 'components/editor-extensions'
import CodeBlockComponent from 'components/CodeBlockComponent.vue'
import { mountEditor, nodeViews, nodeViewComponent } from '../../helpers/misc'

const codeBlock = CodeBlockLowlight.extend({ addNodeView: () => VueNodeViewRenderer(CodeBlockComponent) }).configure({ lowlight })

let current
async function editorWith(content, editable = true) {
  current = await mountEditor({ extensions: contentExtensions({ codeBlock }), content, editable })
  return current.editor
}

const select = (editor, index = 0) => editor.view.dom.querySelectorAll('.code-block select')[index]
const choose = async (element, value) => {
  element.value = value
  element.dispatchEvent(new Event('change'))
  await flushPromises()
}

afterEach(() => {
  current && current.destroy()
  current = null
})

describe('code block language', () => {
  it('offers the automatic detection and the languages of lowlight', async () => {
    const editor = await editorWith('<pre><code>SELECT 1;</code></pre>')
    const options = [...select(editor).options]
    expect(options[0].textContent.trim()).toBe('auto')
    expect(options[1].disabled).toBe(true)
    const languages = options.slice(2).map((option) => option.textContent.trim())
    expect(languages).toEqual(lowlight.listLanguages())
    expect(languages).toEqual(expect.arrayContaining(['sql', 'bash', 'json', 'http', 'xml', 'javascript', 'python']))
  })

  it('selects the language of the code block, automatic without language', async () => {
    const editor = await editorWith('<pre><code class="language-sql">SELECT 1;</code></pre><pre><code>ls -la</code></pre>')
    const [sql, auto] = nodeViews(editor).map(nodeViewComponent)
    expect(sql.selectedLanguage).toBe('sql')
    expect(select(editor, 0).value).toBe('sql')
    expect(auto.selectedLanguage).toBeNull()
    expect(select(editor, 1).selectedIndex).toBe(0)
  })

  it('changes the language of the code block (class read by the report generator)', async () => {
    const editor = await editorWith('<pre><code>curl -k https://srv</code></pre>')
    await choose(select(editor), 'bash')
    expect(editor.getHTML()).toBe('<pre><code class="language-bash">curl -k https://srv</code></pre>')
  })

  it('goes back to the automatic detection', async () => {
    const editor = await editorWith('<pre><code class="language-json">{"a": 1}</code></pre>')
    nodeViewComponent(nodeViews(editor)[0]).selectedLanguage = null
    await flushPromises()
    expect(editor.getHTML()).toBe('<pre><code>{"a": 1}</code></pre>')
  })

  it('keeps the code (special characters and unicode) in the editable content of the node view', async () => {
    const code = '<script>alert("été")</script> && echo 漢字 | grep -v \'$x\''
    const editor = await editorWith(`<pre><code class="language-bash">${code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>`)
    const content = editor.view.dom.querySelector('.code-block pre code [data-node-view-content]')
    expect(content.textContent).toBe(code)
    expect(editor.view.dom.querySelector('.code-block script')).toBeNull()
    expect(editor.state.doc.firstChild.textContent).toBe(code)
  })

  it('highlights the code with the classes of highlight.js', async () => {
    const editor = await editorWith('<pre><code class="language-sql">SELECT name FROM users;</code></pre>')
    const highlighted = [...editor.view.dom.querySelectorAll('.code-block [class^="hljs-"]')].map((span) => span.className)
    expect(highlighted).toContain('hljs-keyword')
  })

  it('does not let the language be changed in a read-only editor', async () => {
    const editor = await editorWith('<pre><code class="language-sql">SELECT 1;</code></pre>', false)
    expect(select(editor).disabled).toBe(true)
  })

  it('follows the editor made read-only or editable after the creation', async () => {
    const editor = await editorWith('<pre><code class="language-sql">SELECT 1;</code></pre>')
    expect(select(editor).disabled).toBe(false)
    editor.setEditable(false)
    await flushPromises()
    expect(select(editor).disabled).toBe(true)
  })
})
