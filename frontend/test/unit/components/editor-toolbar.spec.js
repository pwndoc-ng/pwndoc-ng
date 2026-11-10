// components/editor.vue: toolbar (text formats, marks, highlight, lists, code, tables, image, captions, links,
// undo / redo) applied to a real TipTap editor. The dropdowns of the toolbar are rendered inline.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { QIcon, Notify } from 'quasar'

vi.mock('boot/axios', () => import('../../helpers/api-mock'))

import { api, resetApi } from '../../helpers/api-mock'
import Utils from '@/services/utils'
import { closeHistory } from '@tiptap/pm/history'
import { mockNotify } from '../../helpers/quasar'
import { mountEditor, settle, toolbarButton, dropdownItems, selectText, lastValue, polyfillLayout, fetchNoMatch, waitBubbleMenuTimers } from '../../helpers/editor-component'

let wrapper
const editor = () => wrapper.vm.editor
const html = () => editor().getHTML()
const click = async (icon) => {
  await toolbarButton(wrapper, icon).trigger('click')
  await settle()
}
// Icons of the toolbar (the formatting menu of the selection has its own buttons)
const icons = () => [
  ...wrapper.findAllComponents(QIcon).filter((icon) => icon.element.closest('.editor-toolbar')).map((icon) => icon.props('name')),
  ...wrapper.findAll('.editor-toolbar .q-btn-dropdown-stub').map((dropdown) => dropdown.attributes('data-icon'))
]
const formatDropdown = () => wrapper.findAll('.q-btn-dropdown-stub')[0]

beforeAll(polyfillLayout)
afterAll(waitBubbleMenuTimers)
beforeEach(() => {
  resetApi()
  sessionStorage.setItem('autoCorrectionEnabled', 'false') // No LanguageTool request
  vi.stubGlobal('fetch', fetchNoMatch())
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  wrapper && wrapper.unmount()
  wrapper = null
  window.history.replaceState({}, '', '/')
})

describe('editor toolbar content', () => {
  const ALL = ['fa fa-paragraph', 'fa fa-highlighter', 'format_bold', 'format_italic', 'format_underline', 'format_strikethrough',
    'mdi-link', 'mdi-link-off', 'format_list_bulleted', 'format_list_numbered', 'code', 'mdi-console', 'mdi-table',
    'mdi-table-column-plus-after', 'mdi-table-row-plus-after', 'mdi-call-merge', 'mdi-table-row-remove',
    'mdi-table-column-remove', 'delete', 'image', 'subtitles', 'undo', 'redo']

  it('shows all the groups of the default toolbar', async () => {
    wrapper = await mountEditor({ modelValue: '<p>Texte</p>' })
    expect(icons()).toEqual(expect.arrayContaining(ALL))
    expect(wrapper.find('input[type=file]').attributes('accept')).toBe('image/*')
  })

  it.each([
    [['marks'], ['format_bold', 'mdi-link', 'fa fa-highlighter'], ['fa fa-paragraph', 'format_list_bulleted', 'mdi-table', 'subtitles', 'code']],
    [['format', 'list'], ['fa fa-paragraph', 'format_list_numbered'], ['format_bold', 'mdi-table', 'subtitles']],
    [['code', 'table'], ['code', 'mdi-console', 'mdi-table', 'delete'], ['format_bold', 'image', 'subtitles']],
    [['image', 'caption'], ['image', 'subtitles'], ['format_bold', 'mdi-table', 'code']],
    [[], [], ['format_bold', 'fa fa-paragraph', 'mdi-table', 'image', 'subtitles']]
  ])('shows only the groups of the toolbar %j (undo / redo always)', async (toolbar, shown, hidden) => {
    wrapper = await mountEditor({ modelValue: '<p>Texte</p>', toolbar })
    expect(icons()).toEqual(expect.arrayContaining([...shown, 'undo', 'redo']))
    hidden.forEach((icon) => expect(icons()).not.toContain(icon))
    expect(wrapper.find('input[type=file]').exists()).toBe(toolbar.includes('image'))
  })

  it('shows the toolbar in a read-only editor (dashed border)', async () => {
    wrapper = await mountEditor({ modelValue: '<p>Texte</p>', editable: false })
    expect(icons()).toContain('format_bold')
    expect(wrapper.find('.editor').attributes('style')).toContain('dashed')
    expect(wrapper.find('input[type=file]').attributes('disabled')).toBeDefined()
  })
})

describe('text formats', () => {
  it.each([1, 2, 3, 4, 5, 6])('sets the heading level %i from the format menu, shown in its label', async (level) => {
    wrapper = await mountEditor({ modelValue: '<p>Titre</p>' })
    selectText(editor(), 'Titre')
    await dropdownItems(wrapper, 'fa fa-paragraph')[level].trigger('click')
    await settle()
    expect(html()).toBe(`<h${level}>Titre</h${level}>`)
    expect(lastValue(wrapper)).toBe(`<h${level}>Titre</h${level}>`)
    expect(formatDropdown().attributes('data-label')).toBe(`H${level}`)
    expect(formatDropdown().attributes('data-icon')).toBeUndefined() // Paragraph icon only for paragraphs
  })

  it('goes back to a paragraph with the paragraph item or the same heading item', async () => {
    wrapper = await mountEditor({ modelValue: '<h2>Titre</h2><h3>Sous-titre</h3>' })
    selectText(editor(), 'Titre')
    await formatDropdown().findAll('.q-item')[0].trigger('click')
    await settle()
    expect(html()).toBe('<p>Titre</p><h3>Sous-titre</h3>')
    expect(formatDropdown().attributes('data-icon')).toBe('fa fa-paragraph')
    selectText(editor(), 'Sous-titre')
    await settle()
    expect(formatDropdown().attributes('data-label')).toBe('H3')
    await formatDropdown().findAll('.q-item')[3].trigger('click') // H3 again: toggled
    await settle()
    expect(html()).toBe('<p>Titre</p><p>Sous-titre</p>')
  })

  it('marks the current format as active in the menu', async () => {
    wrapper = await mountEditor({ modelValue: '<h1>Titre</h1>' })
    selectText(editor(), 'Titre')
    await settle()
    const items = formatDropdown().findAll('.q-item')
    expect(items[1].classes()).toContain('is-active')
    expect(items[0].classes()).not.toContain('is-active')
  })
})

describe('marks', () => {
  it.each([
    ['format_bold', 'strong'],
    ['format_italic', 'em'],
    ['format_underline', 'u'],
    ['format_strikethrough', 's'],
    ['code', 'code']
  ])('%s applies <%s> to the selection and removes it', async (icon, tag) => {
    wrapper = await mountEditor({ modelValue: '<p>Le mot important</p>' })
    selectText(editor(), 'important')
    await click(icon)
    expect(html()).toBe(`<p>Le mot <${tag}>important</${tag}></p>`)
    expect(lastValue(wrapper)).toBe(`<p>Le mot <${tag}>important</${tag}></p>`)
    expect(toolbarButton(wrapper, icon).classes()).toContain('is-active')
    await click(icon)
    expect(html()).toBe('<p>Le mot important</p>')
    expect(toolbarButton(wrapper, icon).classes()).not.toContain('is-active')
  })

  it('combines several marks on unicode text', async () => {
    wrapper = await mountEditor({ modelValue: '<p>Élévation de privilèges 漢字 🔒</p>' })
    selectText(editor(), 'privilèges 漢字')
    await click('format_bold')
    await click('format_italic')
    expect(html()).toBe('<p>Élévation de <strong><em>privilèges 漢字</em></strong> 🔒</p>')
  })

  it.each(['#ffff00', '#fe0000', '#00ff00', '#00ffff'])('highlights the selection in %s', async (color) => {
    wrapper = await mountEditor({ modelValue: '<p>Le mot important</p>' })
    selectText(editor(), 'important')
    const colors = ['#ffff00', '#fe0000', '#00ff00', '#00ffff']
    await dropdownItems(wrapper, 'fa fa-highlighter')[colors.indexOf(color)].trigger('click')
    await settle()
    expect(html()).toMatch(new RegExp(`<p>Le mot <mark data-color="${color}"[^>]*>important</mark></p>`))
    expect(lastValue(wrapper)).toContain(`data-color="${color}"`)
  })
})

describe('lists and code blocks', () => {
  it.each([
    ['format_list_bulleted', '<ul><li><p>Point</p></li></ul>'],
    ['format_list_numbered', '<ol><li><p>Point</p></li></ol>']
  ])('%s turns the paragraph into a list and back', async (icon, expected) => {
    wrapper = await mountEditor({ modelValue: '<p>Point</p>' })
    selectText(editor(), 'Point')
    await click(icon)
    expect(html()).toBe(expected)
    expect(toolbarButton(wrapper, icon).classes()).toContain('is-active')
    await click(icon)
    expect(html()).toBe('<p>Point</p>')
  })

  it('switches between bulleted and numbered lists', async () => {
    wrapper = await mountEditor({ modelValue: '<ul><li><p>Point</p></li></ul>' })
    selectText(editor(), 'Point')
    await click('format_list_numbered')
    expect(html()).toBe('<ol><li><p>Point</p></li></ol>')
  })

  it('turns the paragraph into a code block and back', async () => {
    wrapper = await mountEditor({ modelValue: '<p>SELECT 1;</p>' })
    selectText(editor(), 'SELECT')
    await click('mdi-console')
    expect(html()).toBe('<pre><code>SELECT 1;</code></pre>')
    expect(lastValue(wrapper)).toBe('<pre><code>SELECT 1;</code></pre>')
    await click('mdi-console')
    expect(html()).toBe('<p>SELECT 1;</p>')
  })
})

describe('tables', () => {
  const count = (tag) => (html().match(new RegExp(`<${tag}[ >]`, 'g')) || []).length
  const insertTable = async () => {
    editor().commands.setTextSelection(1)
    await click('mdi-table')
  }

  it('inserts a table of 3 x 3 cells with a header row', async () => {
    wrapper = await mountEditor({ modelValue: '<p>Texte</p>' })
    await insertTable()
    expect(count('table')).toBe(1)
    expect(count('tr')).toBe(3)
    expect(count('th')).toBe(3)
    expect(count('td')).toBe(6)
    expect(lastValue(wrapper)).toContain('<table')
  })

  it('adds a column and a row after the current cell', async () => {
    wrapper = await mountEditor({ modelValue: '<p>Texte</p>' })
    await insertTable()
    await click('mdi-table-column-plus-after')
    expect(count('th')).toBe(4)
    expect(count('td')).toBe(8)
    await click('mdi-table-row-plus-after')
    expect(count('tr')).toBe(4)
  })

  it('merges the selected cells', async () => {
    wrapper = await mountEditor({ modelValue: '<table><tbody><tr><td><p>a</p></td><td><p>b</p></td></tr><tr><td><p>c</p></td><td><p>d</p></td></tr></tbody></table>' })
    const cells = []
    editor().state.doc.descendants((node, pos) => { if (node.type.name === 'tableCell') cells.push(pos) })
    editor().commands.setCellSelection({ anchorCell: cells[0], headCell: cells[1] })
    await click('mdi-call-merge')
    expect(html()).toContain('colspan="2"')
    expect(count('td')).toBe(3)
  })

  it('disables the deletion buttons outside of a table', async () => {
    wrapper = await mountEditor({ modelValue: '<p>Texte</p>' })
    for (const icon of ['mdi-table-row-remove', 'mdi-table-column-remove', 'delete'])
      expect(toolbarButton(wrapper, icon).attributes('disabled'), icon).toBeDefined()
  })

  it('deletes the current row, column and table', async () => {
    wrapper = await mountEditor({ modelValue: '<p>Texte</p>' })
    await insertTable()
    expect(toolbarButton(wrapper, 'mdi-table-row-remove').attributes('disabled')).toBeUndefined()
    await click('mdi-table-row-remove')
    expect(count('tr')).toBe(2)
    await click('mdi-table-column-remove')
    expect(count('th') + count('td')).toBe(4)
    await click('delete')
    expect(count('table')).toBe(0)
    expect(html()).toContain('Texte')
    expect(toolbarButton(wrapper, 'delete').attributes('disabled')).toBeDefined()
  })
})

describe('images', () => {
  const image = (name = 'capture été.png') => new File([new Uint8Array([137, 80, 78, 71])], name, { type: 'image/png' })

  // Image chosen in the file input of the toolbar (read by FileReader, resized, uploaded)
  async function chooseImage(file) {
    const input = wrapper.find('input[type=file]')
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
    await input.trigger('change')
    await vi.waitFor(() => expect(Utils.resizeImg).toHaveBeenCalled())
    await flushPromises()
    await settle()
  }

  beforeEach(() => {
    vi.spyOn(Utils, 'resizeImg').mockResolvedValue('data:image/png;base64,iVBORw0KGgo=')
  })

  it('uploads the chosen image with the audit of the page and inserts it with its file name as caption', async () => {
    window.history.replaceState({}, '', '/audits/a1/findings/f1')
    api.post.mockResolvedValue({ data: { datas: { _id: '6aef2c3a3b1d4e5f60718293' } } })
    wrapper = await mountEditor({ modelValue: '<p>Preuve</p>' })
    await chooseImage(image())
    expect(Utils.resizeImg).toHaveBeenCalledWith(expect.stringMatching(/^data:image\/png;base64,/))
    expect(api.post).toHaveBeenCalledWith('images', { value: 'data:image/png;base64,iVBORw0KGgo=', name: 'capture été.png', auditId: 'a1' })
    expect(html()).toContain('<img class="custom-image" src="6aef2c3a3b1d4e5f60718293" alt="capture été.png">')
    expect(lastValue(wrapper)).toContain('src="6aef2c3a3b1d4e5f60718293"')
  })

  it('uploads the images without audit outside of the audits (vulnerabilities)', async () => {
    window.history.replaceState({}, '', '/vulnerabilities')
    api.post.mockResolvedValue({ data: { datas: { _id: '6aef2c3a3b1d4e5f60718294' } } })
    wrapper = await mountEditor({ modelValue: '<p>Preuve</p>' })
    await chooseImage(image('poc.png'))
    expect(api.post).toHaveBeenCalledWith('images', expect.objectContaining({ name: 'poc.png', auditId: null }))
    expect(html()).toContain('src="6aef2c3a3b1d4e5f60718294"')
  })

  it('inserts nothing when the upload fails', async () => {
    api.post.mockRejectedValue({ response: { status: 413, data: { datas: 'Image too large' } } })
    wrapper = await mountEditor({ modelValue: '<p>Preuve</p>' })
    const before = html()
    await chooseImage(image())
    expect(html()).toBe(before)
  })

  it('inserts the image where the cursor was when the file was chosen, not over the text selected during the upload', async () => {
    let answer
    api.post.mockImplementation(() => new Promise((resolve) => { answer = resolve }))
    wrapper = await mountEditor({ modelValue: '<p>Texte important</p>' })
    editor().commands.setTextSelection(editor().state.doc.content.size - 1)
    const input = wrapper.find('input[type=file]')
    Object.defineProperty(input.element, 'files', { value: [image('poc.png')], configurable: true })
    await input.trigger('change')
    await vi.waitFor(() => expect(api.post).toHaveBeenCalled())
    selectText(editor(), 'important') // Selected meanwhile to be formatted
    answer({ data: { datas: { _id: '6aef2c3a3b1d4e5f60718293' } } })
    await flushPromises()
    expect(html()).toBe('<p>Texte important</p><img class="custom-image" src="6aef2c3a3b1d4e5f60718293" alt="poc.png">')
  })

  it('puts the cursor after the uploaded image: a caption chosen right after goes after it, the image is kept', async () => {
    api.post.mockResolvedValue({ data: { datas: { _id: '6aef2c3a3b1d4e5f60718293' } } })
    wrapper = await mountEditor({ modelValue: '<p>Capture :</p>' })
    editor().commands.setTextSelection(editor().state.doc.content.size - 1)
    await chooseImage(image('proof.png'))
    expect(editor().state.selection.from).toBe(editor().state.doc.content.size) // After the image
    await dropdownItems(wrapper, 'subtitles')[0].trigger('click')
    await settle()
    expect(html()).toBe('<p>Capture :</p><img class="custom-image" src="6aef2c3a3b1d4e5f60718293" alt="proof.png"><legend label="Figure" alt=""></legend>')
  })

  it('keeps a selected image when a caption is chosen: the caption is inserted after it', async () => {
    wrapper = await mountEditor({ modelValue: '<p>Capture :</p><img src="6aef2c3a3b1d4e5f60718293" alt="proof.png"><p>Suite</p>' })
    let imagePos
    editor().state.doc.descendants((node, pos) => { if (node.type.name === 'custom_image') imagePos = pos })
    editor().commands.setNodeSelection(imagePos)
    await dropdownItems(wrapper, 'subtitles')[1].trigger('click')
    await settle()
    expect(html()).toBe('<p>Capture :</p><img class="custom-image" src="6aef2c3a3b1d4e5f60718293" alt="proof.png"><legend label="Table" alt=""></legend><p>Suite</p>')
  })

  it('text typed right after an upload goes after the image', async () => {
    api.post.mockResolvedValue({ data: { datas: { _id: '6aef2c3a3b1d4e5f60718293' } } })
    wrapper = await mountEditor({ modelValue: '<p>Capture :</p>' })
    editor().commands.setTextSelection(editor().state.doc.content.size - 1)
    await chooseImage(image('proof.png'))
    editor().commands.insertContent('Suite')
    expect(html()).toBe('<p>Capture :</p><img class="custom-image" src="6aef2c3a3b1d4e5f60718293" alt="proof.png"><p>Suite</p>')
  })

  it('notifies the upload errors', async () => {
    const notify = mockNotify()
    api.post.mockRejectedValue({ response: { status: 413, data: { datas: 'Image too large' } } })
    wrapper = await mountEditor({ modelValue: '<p>Preuve</p>' })
    await chooseImage(image())
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ color: 'negative' }))
  })
})

describe('captions', () => {
  it('lists the captions of the settings and inserts the chosen one', async () => {
    wrapper = await mountEditor({ modelValue: '<p>Texte</p>' })
    const items = dropdownItems(wrapper, 'subtitles')
    expect(items.map((item) => item.text())).toEqual(['Figure', 'Table', 'Listing'])
    editor().commands.setTextSelection(editor().state.doc.content.size)
    await items[1].trigger('click')
    await settle()
    expect(html()).toBe('<p>Texte</p><legend label="Table" alt=""></legend>')
    expect(lastValue(wrapper)).toBe('<p>Texte</p><legend label="Table" alt=""></legend>')
  })

  it('inserts the unicode labels of the settings', async () => {
    wrapper = await mountEditor({ modelValue: '<p>Texte</p>' }, { settings: { report: { public: { captions: ['Capture d’écran', '表'] } } } })
    editor().commands.setTextSelection(editor().state.doc.content.size)
    await dropdownItems(wrapper, 'subtitles')[0].trigger('click')
    await settle()
    expect(html()).toContain('<legend label="Capture d’écran" alt=""></legend>')
  })

  it('shows an empty menu without captions in the settings', async () => {
    wrapper = await mountEditor({ modelValue: '<p>Texte</p>' }, { settings: { report: { public: {} } } })
    expect(dropdownItems(wrapper, 'subtitles')).toHaveLength(0)
    expect(editor().isEditable).toBe(true)
  })
})

describe('links', () => {
  it('adds a link on the selection with the URL typed by the user', async () => {
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('https://owasp.org/Top10/')
    wrapper = await mountEditor({ modelValue: '<p>Voir le guide</p>' })
    selectText(editor(), 'guide')
    await click('mdi-link')
    expect(prompt).toHaveBeenCalledWith('URL', undefined)
    expect(html()).toMatch(/<p>Voir le <a [^>]*href="https:\/\/owasp\.org\/Top10\/"[^>]*>guide<\/a><\/p>/)
    expect(toolbarButton(wrapper, 'mdi-link').classes()).toContain('is-active')
  })

  it('proposes the current URL of a link and updates the whole link', async () => {
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('https://cwe.mitre.org/data/definitions/79.html')
    wrapper = await mountEditor({ modelValue: '<p>Voir <a href="https://owasp.org">le guide OWASP</a></p>' })
    selectText(editor(), 'guide') // Part of the link
    await click('mdi-link')
    expect(prompt).toHaveBeenCalledWith('URL', 'https://owasp.org')
    expect(html()).toMatch(/<a [^>]*href="https:\/\/cwe\.mitre\.org\/data\/definitions\/79\.html"[^>]*>le guide OWASP<\/a>/)
    expect(html()).not.toContain('owasp.org"')
  })

  it('removes the link when the URL is emptied', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('')
    wrapper = await mountEditor({ modelValue: '<p>Voir <a href="https://owasp.org">le guide</a></p>' })
    selectText(editor(), 'guide')
    await click('mdi-link')
    expect(html()).toBe('<p>Voir le guide</p>')
  })

  it('changes nothing when the prompt is cancelled', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue(null)
    wrapper = await mountEditor({ modelValue: '<p>Voir <a href="https://owasp.org">le guide</a></p>' })
    const before = html()
    const emitted = (wrapper.emitted('update:modelValue') || []).length
    selectText(editor(), 'guide')
    await click('mdi-link')
    expect(html()).toBe(before)
    expect((wrapper.emitted('update:modelValue') || []).length).toBe(emitted)
  })

  it('accepts the mailto and ftp links', async () => {
    wrapper = await mountEditor({ modelValue: '<p>Contact et miroir</p>' })
    vi.spyOn(window, 'prompt').mockReturnValueOnce('mailto:security@example.com').mockReturnValueOnce('ftp://ftp.example.com/patch')
    selectText(editor(), 'Contact')
    await click('mdi-link')
    selectText(editor(), 'miroir')
    await click('mdi-link')
    expect(html()).toContain('href="mailto:security@example.com"')
    expect(html()).toContain('href="ftp://ftp.example.com/patch"')
  })

  it('refuses the javascript: links', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('javascript:alert(document.cookie)')
    wrapper = await mountEditor({ modelValue: '<p>Cliquer ici</p>' })
    selectText(editor(), 'ici')
    await click('mdi-link')
    expect(html()).not.toContain('javascript:')
    expect(html()).not.toContain('<a')
  })

  it('removes a link with the unlink button, disabled outside of the links', async () => {
    wrapper = await mountEditor({ modelValue: '<p>Texte et <a href="https://owasp.org">lien</a></p>' })
    selectText(editor(), 'Texte')
    await settle()
    expect(toolbarButton(wrapper, 'mdi-link-off').attributes('disabled')).toBeDefined()
    selectText(editor(), 'lien')
    await settle()
    expect(toolbarButton(wrapper, 'mdi-link-off').attributes('disabled')).toBeUndefined()
    await click('mdi-link-off')
    expect(html()).toBe('<p>Texte et lien</p>')
  })
})

describe('undo / redo', () => {
  it('undoes and redoes the last change', async () => {
    wrapper = await mountEditor({ modelValue: '<p>Texte</p>' })
    editor().view.dispatch(closeHistory(editor().state.tr)) // Change made later by the user: new undo step
    editor().commands.insertContentAt(editor().state.doc.content.size - 1, ' ajouté')
    expect(html()).toBe('<p>Texte ajouté</p>')
    await click('undo')
    expect(html()).toBe('<p>Texte</p>')
    expect(lastValue(wrapper)).toBe('<p>Texte</p>')
    await click('redo')
    expect(html()).toBe('<p>Texte ajouté</p>')
  })

  // Loading not recorded in the undo history of the non collaborative editors (vulnerabilities, custom data)
  it('does not undo the loading of the initial value', async () => {
    wrapper = await mountEditor({ modelValue: '<p>Valeur chargée</p>' })
    await click('undo')
    expect(html()).toBe('<p>Valeur chargée</p>')
  })

  it('undoes a format applied with the toolbar', async () => {
    wrapper = await mountEditor({ modelValue: '<p>Le mot important</p>' })
    selectText(editor(), 'important')
    await click('format_bold')
    await click('undo')
    expect(html()).toBe('<p>Le mot important</p>')
  })
})

describe('read-only editor', () => {
  // The toolbar is shown in the read-only editors (audit in review or approved, user without the update permission)
  it('keeps the read-only editor unchanged by typing (ProseMirror)', async () => {
    wrapper = await mountEditor({ modelValue: '<p>Texte relu</p>', editable: false })
    expect(editor().isEditable).toBe(false)
    expect(wrapper.find('.ProseMirror').attributes('contenteditable')).toBe('false')
  })

  // The buttons are disabled: the commands of TipTap ignore the read-only state
  it.each([
    ['format_bold'],
    ['format_list_bulleted'],
    ['mdi-console'],
    ['mdi-table']
  ])('%s of the toolbar does not change a read-only editor', async (icon) => {
    wrapper = await mountEditor({ modelValue: '<p>Texte relu</p>', editable: false })
    const emitted = (wrapper.emitted('update:modelValue') || []).length
    selectText(editor(), 'relu')
    await click(icon)
    expect(html()).toBe('<p>Texte relu</p>')
    expect((wrapper.emitted('update:modelValue') || []).length).toBe(emitted)
  })
})
