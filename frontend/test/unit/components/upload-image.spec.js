// components/uploadImage.vue: node view of the images of the editors (source, width, caption, review comments, load
// errors), rendered in real TipTap editors
import { describe, it, expect, vi, afterEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { reactive } from 'vue'

vi.mock('boot/axios', () => import('../../helpers/api-mock'))

import { contentExtensions } from 'components/editor-extensions'
import { CommentHighlight } from 'components/comment-highlight'
import { mountEditor, nodeViews, nodeViewComponent, findInstances, nodePosition } from '../../helpers/misc'

const ID = '6aef2c3a3b1d4e5f60718293'

let current
async function editorWith(content, { editable = true, settings = { report: { public: { imageDefaultWidth: 'medium' } } }, comments = false } = {}) {
  const extensions = [...contentExtensions(), ...(comments ? [CommentHighlight.configure()] : [])]
  current = await mountEditor({ extensions, content, editable, mocks: { $settings: settings } })
  return current.editor
}

const images = (editor) => nodeViews(editor).map(nodeViewComponent)
const figures = (editor) => [...editor.view.dom.querySelectorAll('figure.editor-image')]

afterEach(() => {
  current && current.destroy()
  current = null
})

describe('image source', () => {
  it.each([
    [ID, `api/images/download/${ID}`],
    ['https://example.com/capture.png', 'https://example.com/capture.png'],
    ['data:image/png;base64,iVBORw0KGgo=', 'data:image/png;base64,iVBORw0KGgo=']
  ])('shows the image %s from %s', async (src, shown) => {
    const editor = await editorWith(`<img src="${src}" alt="Capture">`)
    const [image] = images(editor)
    expect(image.src).toBe(shown)
    expect(image.alt).toBe('Capture')
  })

  it('renders one node view per image', async () => {
    const editor = await editorWith(`<img src="${ID}" alt="a"><p>x</p><img src="${ID}" alt="b">`)
    expect(images(editor).map((image) => image.alt)).toEqual(['a', 'b'])
    expect(figures(editor)).toHaveLength(2)
  })
})

describe('image width', () => {
  it.each([
    ['small', '50%'],
    ['medium', '75%'],
    ['large', '100%']
  ])('displays the width %s as %s of the text width', async (width, percent) => {
    const editor = await editorWith(`<img src="${ID}" alt="" data-width="${width}">`)
    expect(images(editor)[0].width).toBe(width)
    expect(figures(editor)[0].style.width).toBe(percent)
  })

  it('uses the default width of the settings for the images without width', async () => {
    const editor = await editorWith(`<img src="${ID}" alt="">`)
    expect(images(editor)[0].width).toBe('medium')
    expect(figures(editor)[0].style.width).toBe('75%')
  })

  it.each([
    [{}, 'large'],
    [{ report: {} }, 'large'],
    [{ report: { public: {} } }, 'large'],
    [null, 'large']
  ])('uses the large width without default width in the settings %j', async (settings, width) => {
    const editor = await editorWith(`<img src="${ID}" alt="">`, { settings })
    expect(images(editor)[0].width).toBe(width)
    expect(figures(editor)[0].style.width).toBe('100%')
  })

  it('shows the width choice when the image is selected in an editable editor', async () => {
    const editor = await editorWith(`<p>a</p><img src="${ID}" alt="">`)
    editor.commands.setTextSelection(1)
    await flushPromises()
    expect(editor.view.dom.querySelector('.editor-image__width')).toBeNull()
    editor.commands.setNodeSelection(nodePosition(editor, 'custom_image'))
    await flushPromises()
    const choice = editor.view.dom.querySelector('.editor-image__width')
    expect(choice).not.toBeNull()
    expect([...choice.querySelectorAll('button')].map((button) => button.textContent.trim())).toEqual(['Small', 'Medium', 'Large'])
  })

  it('changes the width of the image (data-width read by the report generator)', async () => {
    const editor = await editorWith(`<p>a</p><img src="${ID}" alt="Capture">`)
    editor.commands.setNodeSelection(nodePosition(editor, 'custom_image'))
    await flushPromises()
    const small = [...editor.view.dom.querySelectorAll('.editor-image__width button')].find((button) => button.textContent.trim() === 'Small')
    small.click()
    await flushPromises()
    expect(editor.getHTML()).toBe(`<p>a</p><img class="custom-image" src="${ID}" alt="Capture" data-width="small">`)
    expect(figures(editor)[0].style.width).toBe('50%')
  })

  it('does not show the width choice in a read-only editor', async () => {
    const editor = await editorWith(`<p>a</p><img src="${ID}" alt="">`, { editable: false })
    editor.commands.setNodeSelection(nodePosition(editor, 'custom_image'))
    await flushPromises()
    expect(editor.view.dom.querySelector('.editor-image__width')).toBeNull()
  })
})

describe('image caption', () => {
  it('shows the caption in a read-only input and edits it in a popup', async () => {
    const editor = await editorWith(`<img src="${ID}" alt="Capture">`)
    const [image] = images(editor)
    const input = figures(editor)[0].querySelector('input')
    expect(input.value).toBe('Capture')
    expect(input.readOnly).toBe(true)
    expect(findInstances(image, 'QPopupEdit')).toHaveLength(1)
  })

  it('saves the caption edited in the popup in the document (unicode included)', async () => {
    const editor = await editorWith(`<img src="${ID}" alt="Capture">`)
    const [image] = images(editor)
    const [popup] = findInstances(image, 'QPopupEdit')
    popup.$emit('update:modelValue', 'Capture « réseau » 漢字')
    await flushPromises()
    expect(editor.getHTML()).toBe(`<img class="custom-image" src="${ID}" alt="Capture « réseau » 漢字">`)
  })

  it('does not let the caption be edited in a read-only editor', async () => {
    const editor = await editorWith(`<img src="${ID}" alt="Capture">`, { editable: false })
    const [popup] = findInstances(images(editor)[0], 'QPopupEdit')
    expect(popup.$props.disable).toBe(true)
  })

  it('follows the editor made read-only or editable after the creation (audit sent to review)', async () => {
    const editor = await editorWith(`<img src="${ID}" alt="Capture">`)
    const popup = () => findInstances(images(editor)[0], 'QPopupEdit')[0]
    expect(popup().$props.disable).toBe(false)
    editor.setEditable(false)
    await flushPromises()
    expect(popup().$props.disable).toBe(true)
    editor.setEditable(true)
    await flushPromises()
    expect(popup().$props.disable).toBe(false)
  })
})

describe('image load error', () => {
  it('shows an error with a retry button when the image cannot be loaded', async () => {
    const editor = await editorWith(`<img src="${ID}" alt="Capture">`)
    const [image] = images(editor)
    expect(figures(editor)[0].querySelector('.text-negative')).toBeNull()
    image.handleImageError()
    await flushPromises()
    expect(figures(editor)[0].querySelector('.text-caption.text-negative')).not.toBeNull()
    figures(editor)[0].querySelector('.text-center.q-pa-md button').click()
    await flushPromises()
    expect(image.imageError).toBe(false)
    expect(figures(editor)[0].querySelector('.text-caption.text-negative')).toBeNull()
  })
})

describe('image review comments', () => {
  const target = { kind: 'finding', findingId: 'f1', field: 'description' }

  function commentsStore(items) {
    return reactive({ items, forTarget: vi.fn(() => items), startComment: vi.fn(), show: vi.fn() })
  }

  async function editorWithComments(content, store) {
    const editor = await editorWith('', { comments: true })
    editor.storage.commentHighlight.target = target
    editor.storage.commentHighlight.store = store
    editor.commands.setContent(content)
    await flushPromises()
    return editor
  }

  it('shows no comment button outside the audits (no comments store)', async () => {
    const editor = await editorWith(`<img src="${ID}" alt="Capture">`, { comments: true })
    expect(figures(editor)[0].querySelector('.editor-image__comments')).toBeNull()
    expect(images(editor)[0].imageOpenComments).toEqual([])
  })

  it('counts the open comments of this image only', async () => {
    const store = commentsStore([
      { _id: 'c1', image: { src: ID, alt: 'A', occurrence: 0 }, resolved: false },
      { _id: 'c2', image: { src: ID, alt: 'A', occurrence: 0 }, resolved: true },
      { _id: 'c3', image: { src: ID, alt: 'B', occurrence: 0 }, resolved: false },
      { _id: 'c4', quote: { exact: 'texte' }, resolved: false }
    ])
    const editor = await editorWithComments(`<img src="${ID}" alt="A"><p>texte</p><img src="${ID}" alt="B">`, store)
    const [first, second] = images(editor)
    expect(first.imageOpenComments.map((comment) => comment._id)).toEqual(['c1'])
    expect(second.imageOpenComments.map((comment) => comment._id)).toEqual(['c3'])
    expect(store.forTarget).toHaveBeenCalledWith(target)
    expect(figures(editor)[0].querySelector('.q-badge').textContent).toBe('1')
  })

  it('starts a comment anchored on the image', async () => {
    const store = commentsStore([])
    const editor = await editorWithComments(`<p>x</p><img src="${ID}" alt="Capture"><img src="${ID}" alt="Capture">`, store)
    const buttons = figures(editor).map((figure) => figure.querySelector('.editor-image__comment-add'))
    buttons[1].click()
    expect(store.startComment).toHaveBeenCalledWith(target, null, { src: ID, alt: 'Capture', occurrence: 1 })
    expect(figures(editor)[0].querySelector('.q-badge')).toBeNull() // No open comment
  })

  it('shows the first open comment of the image', async () => {
    const store = commentsStore([{ _id: 'c9', image: { src: ID, alt: '', occurrence: 0 }, resolved: false }])
    const editor = await editorWithComments(`<img src="${ID}" alt="">`, store)
    images(editor)[0].showImageComments()
    expect(store.show).toHaveBeenCalledWith('c9')
  })
})
