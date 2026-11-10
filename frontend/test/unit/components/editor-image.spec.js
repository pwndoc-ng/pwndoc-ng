// components/editor-image.js: images of the editors (commands, paste and drop of image files and image URLs uploaded to
// the audit), in real TipTap editors (image service and resizing mocked)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'

vi.mock('boot/axios', () => import('../../helpers/api-mock'))

import { contentExtensions } from 'components/editor-extensions'
import ImageService from '@/services/image'
import Utils from '@/services/utils'
import { mountEditor, nodePosition } from '../../helpers/misc'
import { mockNotify } from '../../helpers/quasar'
import { trackFileReads } from '../../helpers/editor-component'

const ID = '6aef2c3a3b1d4e5f60718293'
const RESIZED = 'data:image/jpeg;base64,/9j/4AAQ'

let current
async function editorWith(content = '<p>Texte</p>') {
  current = await mountEditor({ extensions: contentExtensions(), content, mocks: { $settings: {} } })
  return current.editor
}

// Handlers of the DOM events of the image extension (paste, drop)
const handlers = (editor) => editor.state.plugins.find((plugin) => plugin.key.startsWith('eventHandler$')).props.handleDOMEvents
const imageFile = (name = 'capture.png', type = 'image/png') => new File([new Uint8Array([137, 80, 78, 71])], name, { type })
// Clipboard / drag data (DataTransfer): text items call their callback asynchronously, as the browsers do, getData answers
// at once
const textItem = (text) => ({ type: 'text/plain', kind: 'string', text, getAsString: (callback) => setTimeout(() => callback(text)) })
const fileItem = (file) => ({ type: file.type, kind: 'file', getAsFile: () => file })
const dataTransfer = (items, files = []) => ({ items, files, getData: (type) => (items.find((item) => item.type === type && item.kind === 'string') || {}).text || '' })
const pasteEvent = (items) => ({ clipboardData: dataTransfer(items), preventDefault: vi.fn() })
const dropEvent = (files, items = files.map(fileItem)) => ({ dataTransfer: dataTransfer(items, files), preventDefault: vi.fn() })

// FileReader (asynchronous in jsdom), resizing and upload
let settle

const imagesOf = (editor) => {
  const images = []
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'custom_image') images.push({ src: node.attrs.src, alt: node.attrs.alt, width: node.attrs.width })
  })
  return images
}

beforeEach(() => {
  settle = trackFileReads()
  // Used by ProseMirror to find the drop position (missing in jsdom: position of the selection used instead)
  if (!document.elementFromPoint) document.elementFromPoint = () => null
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(Utils, 'resizeImg').mockResolvedValue(RESIZED)
  vi.spyOn(ImageService, 'createImage').mockResolvedValue({ data: { datas: { _id: ID } } })
})
afterEach(() => {
  current && current.destroy()
  current = null
  window.history.replaceState({}, '', '/')
})

describe('image commands', () => {
  it('inserts an image at the selection', async () => {
    const editor = await editorWith('<p>Texte</p>')
    editor.commands.setTextSelection(editor.state.doc.content.size)
    expect(editor.commands.setImage({ src: ID, alt: 'Capture' })).toBe(true)
    expect(editor.getHTML()).toBe(`<p>Texte</p><img class="custom-image" src="${ID}" alt="Capture">`)
  })

  it('replaces the selected content with the image', async () => {
    const editor = await editorWith('<p>abc</p>')
    editor.commands.setTextSelection({ from: 1, to: 4 })
    editor.commands.setImage({ src: ID, alt: '' })
    expect(imagesOf(editor)).toEqual([{ src: ID, alt: '', width: null }])
    expect(editor.state.doc.textContent).toBe('')
  })

  it('can be checked without changing the document', async () => {
    const editor = await editorWith('<p>abc</p>')
    expect(editor.can().setImage({ src: ID })).toBe(true)
    expect(imagesOf(editor)).toEqual([])
  })

  it('changes the attributes of the selected image', async () => {
    const editor = await editorWith(`<p>a</p><img src="${ID}" alt="Old">`)
    editor.commands.setNodeSelection(nodePosition(editor, 'custom_image'))
    expect(editor.commands.setImageAttrs({ alt: 'New', width: 'small' })).toBe(true)
    expect(imagesOf(editor)).toEqual([{ src: ID, alt: 'New', width: 'small' }])
  })
})

describe('paste of images', () => {
  it('uploads a pasted image file in the audit of the page and inserts it', async () => {
    window.history.replaceState({}, '', '/audits/a1b2c3/findings/f1')
    const editor = await editorWith('<p>Texte</p>')
    editor.commands.setTextSelection(editor.state.doc.content.size)
    const event = pasteEvent([fileItem(imageFile('capture réseau.png'))])
    expect(handlers(editor).paste(editor.view, event)).toBe(true)
    expect(event.preventDefault).toHaveBeenCalled()
    await settle()
    expect(Utils.resizeImg).toHaveBeenCalledWith(expect.stringMatching(/^data:image\/png;base64,/))
    expect(ImageService.createImage).toHaveBeenCalledWith({ value: RESIZED, name: 'capture réseau.png', auditId: 'a1b2c3' })
    expect(imagesOf(editor)).toEqual([{ src: ID, alt: 'capture réseau.png', width: null }])
  })

  it('uploads the image without audit outside the audit pages (vulnerabilities)', async () => {
    window.history.replaceState({}, '', '/vulnerabilities')
    const editor = await editorWith()
    handlers(editor).paste(editor.view, pasteEvent([fileItem(imageFile())]))
    await settle()
    expect(ImageService.createImage).toHaveBeenCalledWith(expect.objectContaining({ auditId: null }))
  })

  it('names "image" the pasted images without name (screenshots)', async () => {
    const editor = await editorWith()
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
    handlers(editor).paste(editor.view, pasteEvent([{ type: 'image/png', kind: 'file', getAsFile: () => blob }]))
    await settle()
    expect(ImageService.createImage).toHaveBeenCalledWith(expect.objectContaining({ name: 'image' }))
    expect(imagesOf(editor)[0].alt).toBe('image')
  })

  it('uploads only the first image of the clipboard', async () => {
    const editor = await editorWith()
    handlers(editor).paste(editor.view, pasteEvent([fileItem(imageFile('a.png')), fileItem(imageFile('b.png'))]))
    await settle()
    expect(ImageService.createImage).toHaveBeenCalledTimes(1)
    expect(imagesOf(editor)).toHaveLength(1)
  })

  it('inserts nothing when the upload fails', async () => {
    ImageService.createImage.mockRejectedValue({ response: { status: 413, data: { datas: 'Payload too large' } } })
    const editor = await editorWith('<p>Texte</p>')
    expect(handlers(editor).paste(editor.view, pasteEvent([fileItem(imageFile())]))).toBe(true)
    await settle()
    expect(imagesOf(editor)).toEqual([])
    expect(editor.getHTML()).toBe('<p>Texte</p>')
  })

  it('notifies the upload errors with the message of the server', async () => {
    const notify = mockNotify()
    ImageService.createImage.mockRejectedValue({ response: { status: 413, data: { datas: 'Payload too large' } } })
    const editor = await editorWith('<p>Texte</p>')
    handlers(editor).paste(editor.view, pasteEvent([fileItem(imageFile())]))
    await settle()
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ message: 'The image could not be uploaded', caption: 'Payload too large', color: 'negative' }))
  })

  it('inserts nothing when the image cannot be resized', async () => {
    Utils.resizeImg.mockRejectedValue(new Error('Invalid image'))
    const editor = await editorWith()
    handlers(editor).paste(editor.view, pasteEvent([fileItem(imageFile('broken.png'))]))
    await settle()
    expect(ImageService.createImage).not.toHaveBeenCalled()
    expect(imagesOf(editor)).toEqual([])
  })

  it('lets the editor paste the texts which are not image URLs', async () => {
    const editor = await editorWith()
    const event = pasteEvent([textItem('Une phrase avec https://example.com/page')])
    expect(handlers(editor).paste(editor.view, event)).toBeFalsy()
    expect(event.preventDefault).not.toHaveBeenCalled()
    await settle()
    expect(imagesOf(editor)).toEqual([])
  })

  it('inserts an image for a pasted image URL', async () => {
    const editor = await editorWith('<p>Texte</p>')
    editor.commands.setTextSelection(editor.state.doc.content.size)
    handlers(editor).paste(editor.view, pasteEvent([textItem('https://example.com/schéma.png')]))
    await settle()
    expect(ImageService.createImage).not.toHaveBeenCalled() // External image: not uploaded
    expect(imagesOf(editor)).toEqual([{ src: 'https://example.com/schéma.png', alt: 'External Image', width: null }])
  })

  it('handles the paste of an image URL (no URL text pasted in addition)', async () => {
    const editor = await editorWith()
    const event = pasteEvent([textItem('https://example.com/schema.png')])
    expect(handlers(editor).paste(editor.view, event)).toBe(true)
    expect(event.preventDefault).toHaveBeenCalled()
  })
})

describe('drop of images', () => {
  it('uploads a dropped image file and inserts it', async () => {
    window.history.replaceState({}, '', '/audits/a9/sections/s1')
    const editor = await editorWith('<p>Texte</p>')
    const event = dropEvent([imageFile('scan.jpg', 'image/jpeg')])
    expect(handlers(editor).drop(editor.view, event)).toBe(true)
    expect(event.preventDefault).toHaveBeenCalled()
    await settle()
    expect(ImageService.createImage).toHaveBeenCalledWith({ value: RESIZED, name: 'scan.jpg', auditId: 'a9' })
    expect(imagesOf(editor)).toEqual([{ src: ID, alt: 'scan.jpg', width: null }])
  })

  it('lets the editor handle the drop of other files and texts', async () => {
    const editor = await editorWith()
    const pdf = new File(['%PDF'], 'rapport.pdf', { type: 'application/pdf' })
    expect(handlers(editor).drop(editor.view, dropEvent([pdf]))).toBeFalsy()
    expect(handlers(editor).drop(editor.view, dropEvent([], [textItem('du texte')]))).toBeFalsy()
    await settle()
    expect(ImageService.createImage).not.toHaveBeenCalled()
    expect(imagesOf(editor)).toEqual([])
  })

  it('inserts an image for a dropped image URL', async () => {
    const editor = await editorWith()
    handlers(editor).drop(editor.view, dropEvent([], [textItem('https://example.com/logo.svg?v=2')]))
    await settle()
    expect(imagesOf(editor)).toEqual([{ src: 'https://example.com/logo.svg?v=2', alt: 'External Image', width: null }])
  })
})
