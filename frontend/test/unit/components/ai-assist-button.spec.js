// components/ai-assist-button.vue: assisted writing on the selection, the caption being written or the whole field,
// proposal shown then applied by the user only (real TipTap editor, API service mocked)
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Notify } from 'quasar'

vi.mock('boot/axios', () => import('../../helpers/api-mock'))

import AiAssistButton from 'components/ai-assist-button'
import { contentExtensions } from 'components/editor-extensions'
import AiService from '@/services/ai'
import { i18n } from '@/boot/i18n'
import { mountEditor } from '../../helpers/misc'

const ID = '6aef2c3a3b1d4e5f60718293'
let wrapper
let editor

function mountButton(content = '<p>Le parametre est renvoyer.</p><p>Second</p>') {
  editor = new Editor({ element: document.createElement('div'), extensions: [StarterKit], content })
  wrapper = mount(AiAssistButton, { props: { editor, auditId: 'a1' }, attachTo: document.body })
  return wrapper.vm
}
// Editor with the images and captions of the editors (no view: node views of the images not mounted)
function mountImageButton(content) {
  editor = new Editor({ element: null, extensions: contentExtensions(), content })
  wrapper = mount(AiAssistButton, { props: { editor, auditId: 'a1' }, attachTo: document.body })
  return wrapper.vm
}
// Editor shown, with the node views of the captions (inputs)
let mounted
async function mountCaptionButton(content) {
  mounted = await mountEditor({ extensions: contentExtensions(), content })
  editor = mounted.editor
  wrapper = mount(AiAssistButton, { props: { editor, auditId: 'a1' }, attachTo: document.body })
  return wrapper.vm
}
const captionInput = () => editor.view.dom.querySelector('.editor-caption__input')
const captionAlt = () => {
  let alt = null
  editor.state.doc.descendants((node) => { if (node.type.name === 'caption') alt = node.attrs.alt })
  return alt
}
const proposal = (html) => vi.spyOn(AiService, 'assist').mockResolvedValue({ data: { datas: { html } } })

afterEach(() => {
  wrapper && wrapper.unmount()
  wrapper = null
  if (mounted) mounted.wrapper.unmount()
  mounted = null
  editor && editor.destroy()
})

describe('AI assist button', () => {
  it('sends the whole field when nothing is selected, shows the sanitized proposal, then replaces the field once applied', async () => {
    proposal('<p>Le paramètre est renvoyé.</p><script>alert(1)</script><img src=x onerror="alert(2)">')
    const vm = mountButton()
    vm.run('correct')
    await flushPromises()
    expect(AiService.assist).toHaveBeenCalledWith('correct', '<p>Le parametre est renvoyer.</p><p>Second</p>', { instruction: undefined, auditId: 'a1' })
    expect(vm.proposalDialog).toBe(true)
    expect(vm.range).toBeNull()
    expect(vm.proposal).not.toContain('script')
    expect(vm.proposal).not.toContain('onerror')
    expect(editor.getHTML()).toBe('<p>Le parametre est renvoyer.</p><p>Second</p>') // Not applied before the user choice
    vm.apply()
    expect(editor.getHTML()).toContain('<p>Le paramètre est renvoyé.</p>')
    expect(editor.getHTML()).not.toContain('Second')
    expect(vm.proposalDialog).toBe(false)
  })

  it('sends and replaces only the selected text', async () => {
    proposal('<p>renvoyé</p>')
    const vm = mountButton()
    editor.commands.setTextSelection({ from: 18, to: 26 }) // "renvoyer"
    expect(vm.hasSelection()).toBe(true)
    vm.run('correct')
    await flushPromises()
    expect(AiService.assist.mock.calls[0][1]).toBe('renvoyer')
    expect(vm.range).toEqual({ from: 18, to: 26 })
    expect(vm.inline).toBe(true)
    vm.apply()
    expect(editor.getHTML()).toBe('<p>Le parametre est renvoyé.</p><p>Second</p>') // Inserted in the line
  })

  it('replaces selected paragraphs by the paragraphs of the proposal', async () => {
    proposal('<p>One</p><p>Two</p>')
    const vm = mountButton('<p>First</p><p>Second</p><p>Third</p>')
    editor.commands.setTextSelection({ from: 1, to: 15 }) // First and Second
    vm.run('rephrase')
    await flushPromises()
    expect(AiService.assist.mock.calls[0][1]).toBe('<p>First</p><p>Second</p>')
    expect(vm.inline).toBe(false)
    vm.apply()
    expect(editor.getHTML()).toBe('<p>One</p><p>Two</p><p>Third</p>')
  })

  it('sends a custom instruction of the user', async () => {
    proposal('<p>Arr</p>')
    const vm = mountButton()
    vm.askInstruction()
    expect(vm.instructionDialog).toBe(true)
    vm.instruction = '  Talk like a pirate  '
    vm.runInstruction()
    await flushPromises()
    expect(AiService.assist).toHaveBeenCalledWith('custom', expect.any(String), { instruction: 'Talk like a pirate', auditId: 'a1' })
    expect(vm.instructionDialog).toBe(false)
    expect(vm.proposalDialog).toBe(true)
  })

  it('notifies the errors of the AI and changes nothing', async () => {
    const notify = vi.spyOn(Notify, 'create').mockImplementation(() => {})
    vi.spyOn(AiService, 'assist').mockRejectedValue({ response: { data: { datas: 'The AI server is not available' } } })
    const vm = mountButton()
    vm.run('rephrase')
    await flushPromises()
    expect(notify.mock.calls[0][0]).toMatchObject({ message: 'The AI server is not available', color: 'negative' })
    expect(vm.proposalDialog).toBe(false)
    expect(vm.loading).toBe(false)
  })

  it('keeps the images and captions put back by the server, shows them with their download URL', async () => {
    const image = `<img class="custom-image" src="${ID}" alt="preuve.png" data-width="large"><legend label="Figure" alt="Preuve"></legend>`
    proposal(`<p>Le paramètre est renvoyé.</p>${image}<p>Suite</p>`)
    const vm = mountImageButton(`<p>Le parametre est renvoyer.</p>${image}<p>Suite</p>`)
    vm.run('correct')
    await flushPromises()
    expect(AiService.assist.mock.calls[0][1]).toContain(`src="${ID}"`) // Replaced by a token by the server, never sent to the AI
    expect(vm.missing).toBe(0)
    expect(document.querySelector('.ai-missing')).toBeNull()
    expect(document.querySelector('.ai-proposed img').getAttribute('src')).toBe(`api/images/download/${ID}`)
    expect(document.querySelector('.ai-original img').getAttribute('src')).toBe(`api/images/download/${ID}`)
    vm.apply()
    expect(editor.getHTML()).toBe(`<p>Le paramètre est renvoyé.</p>${image}<p>Suite</p>`)
    // Caption corrected with the field (text of the AI put in the caption by the server)
    proposal(`<p>Suite.</p>${image.replace('alt="Preuve"', 'alt="Preuve corrigée"')}`)
    editor.commands.setContent(`<p>Suite</p>${image}`)
    editor.commands.setTextSelection(2) // Cursor in the text: whole field
    vm.run('correct')
    await flushPromises()
    vm.apply()
    expect(editor.getHTML()).toBe(`<p>Suite.</p>${image.replace('alt="Preuve"', 'alt="Preuve corrigée"')}`)
  })

  it('warns when images or captions not kept by the AI were put back at the end', async () => {
    vi.spyOn(AiService, 'assist').mockResolvedValue({ data: { datas: { html: `<p>Texte</p><img class="custom-image" src="${ID}" alt="x">`, missing: 1 } } })
    const vm = mountImageButton(`<img class="custom-image" src="${ID}" alt="x"><p>Txte</p>`)
    editor.commands.setTextSelection(4) // Cursor in the text (the image starting the field is selected first)
    vm.run('correct')
    expect(vm.hasSelection()).toBe(false)
    await flushPromises()
    expect(vm.missing).toBe(1)
    expect(document.querySelector('.ai-missing').textContent).toContain('(1)')
    vm.apply()
    expect(editor.getHTML()).toBe(`<p>Texte</p><img class="custom-image" src="${ID}" alt="x">`)
  })

  it('does not apply the proposal when the text changed during the request (another passage would be replaced)', async () => {
    const notify = vi.spyOn(Notify, 'create').mockImplementation(() => {})
    proposal('<p>renvoyé</p>')
    const vm = mountButton()
    editor.commands.setTextSelection({ from: 18, to: 26 }) // "renvoyer"
    vm.run('correct')
    await flushPromises()
    editor.commands.insertContentAt(1, 'Ici, ') // Typed, or written by another user, before the proposal is applied
    vm.apply()
    expect(editor.getHTML()).toBe('<p>Ici, Le parametre est renvoyer.</p><p>Second</p>')
    expect(notify.mock.calls[0][0]).toMatchObject({ message: i18n.global.t('ai.textChanged'), color: 'warning' })
    expect(vm.proposalDialog).toBe(true)
    // Whole field changed
    vm.range = null
    vm.source = '<p>Old</p>'
    vm.apply()
    expect(editor.getHTML()).toBe('<p>Ici, Le parametre est renvoyer.</p><p>Second</p>')
    expect(notify).toHaveBeenCalledTimes(2)
  })

  it('applies the action to the part of the caption selected in its input when the button is pressed', async () => {
    const image = `<img class="custom-image" src="${ID}" alt="capture.png">`
    const vm = await mountCaptionButton(`<p>Texte</p>${image}<legend label="Figure" alt="Captur du serveur"></legend>`)
    const input = captionInput()
    input.focus()
    input.setSelectionRange(0, 6) // "Captur": selection of the input, not of the editor
    await wrapper.find('.ai-assist').trigger('mousedown') // Press on the button: the input still has the focus
    input.blur()
    expect(vm.targetKey()).toBe('ai.onSelection')
    proposal('<p>Capture</p>')
    vm.run('correct')
    await flushPromises()
    expect(AiService.assist.mock.calls[0][1]).toBe('<p>Captur</p>')
    expect(vm.replaceKey()).toBe('ai.replaceSelection')
    vm.apply()
    expect(captionAlt()).toBe('Capture du serveur')
    expect(editor.getHTML()).toBe(`<p>Texte</p>${image}<legend label="Figure" alt="Capture du serveur"></legend>`)
    await flushPromises()
    expect(captionInput().value).toBe('Capture du serveur')
    expect(vm.proposalDialog).toBe(false)
  })

  it('applies the action to the whole caption being written, or to the caption selected in the editor', async () => {
    const vm = await mountCaptionButton('<p>Texte</p><legend label="Table" alt="Port ouvert &amp; <filtrés>"></legend>')
    const input = captionInput()
    input.focus()
    input.setSelectionRange(3, 3) // Cursor only: the whole caption
    await wrapper.find('.ai-assist').trigger('mousedown')
    expect(vm.targetKey()).toBe('ai.onCaption')
    proposal('<p>Ports ouverts &amp; &lt;filtrés&gt;</p>\n<p>du serveur</p>')
    vm.run('correct')
    await flushPromises()
    expect(AiService.assist.mock.calls[0][1]).toBe('<p>Port ouvert &amp; &lt;filtrés&gt;</p>') // Text escaped
    expect(vm.replaceKey()).toBe('ai.replaceCaption')
    vm.apply()
    expect(captionAlt()).toBe('Ports ouverts & <filtrés> du serveur')
    // Caption selected as a node of the editor
    editor.commands.setNodeSelection(7)
    vm.forgetCaption()
    expect(vm.targetKey()).toBe('ai.onCaption')
    expect(vm.sourceHtml().html).toBe('<p>Ports ouverts &amp; &lt;filtrés&gt; du serveur</p>')
  })

  it('forgets the caption when the button is pressed out of it or opened with the keyboard', async () => {
    const vm = await mountCaptionButton('<p>Texte</p><legend label="Figure" alt="Légende"></legend>')
    captionInput().focus()
    captionInput().setSelectionRange(0, 3)
    await wrapper.find('.ai-assist').trigger('mousedown')
    expect(vm.targetKey()).toBe('ai.onSelection')
    editor.commands.setTextSelection(2) // Cursor in the text of the editor
    await wrapper.find('.ai-assist').trigger('keydown', { key: 'Enter' })
    expect(vm.targetKey()).toBe('ai.onField')
    captionInput().focus()
    await wrapper.find('.ai-assist').trigger('mousedown')
    editor.view.dom.focus() // Back in the text of the editor
    editor.commands.setTextSelection(2)
    await wrapper.find('.ai-assist').trigger('mousedown')
    expect(vm.targetKey()).toBe('ai.onField')
    expect(vm.sourceHtml().html).toBe('<p>Texte</p><legend label="Figure" alt="Légende"></legend>')
  })

  it('applies the action to the caption of the selected image (its alt), not to a selected image without caption', async () => {
    const image = `<img class="custom-image" src="${ID}" alt="Requete du serveur">`
    const vm = await mountCaptionButton(`<p>Texte</p>${image}<p>Fin</p><img class="custom-image" src="${ID}" alt=""><p>Encore</p>`)
    editor.commands.setNodeSelection(7) // Image selected (click on it or on its caption)
    await wrapper.find('.ai-assist').trigger('mousedown')
    expect(vm.targetKey()).toBe('ai.onCaption')
    proposal('<p>Requête du serveur</p>')
    vm.run('correct')
    await flushPromises()
    expect(AiService.assist.mock.calls[0][1]).toBe('<p>Requete du serveur</p>')
    expect(vm.replaceKey()).toBe('ai.replaceCaption')
    vm.apply()
    expect(editor.getHTML()).toBe(`<p>Texte</p>${image.replace('Requete', 'Requête')}<p>Fin</p><img class="custom-image" src="${ID}" alt=""><p>Encore</p>`)
    editor.commands.setNodeSelection(13) // Image without caption: the selection
    expect(editor.state.selection.node.type.name).toBe('custom_image')
    await wrapper.find('.ai-assist').trigger('mousedown')
    expect(vm.targetKey()).toBe('ai.onSelection')
  })

  it('keeps the caption taken when the button is pressed, even if its input is rendered again before the action', async () => {
    const vm = await mountCaptionButton('<p>Texte</p><legend label="Figure" alt="Captur du serveur"></legend>')
    const input = captionInput()
    input.focus()
    input.setSelectionRange(0, 6)
    await wrapper.find('.ai-assist').trigger('mousedown')
    input.setSelectionRange(0, 0) // New input of a collaborative editor, without the selection
    input.remove()
    editor.commands.setTextSelection(2)
    proposal('<p>Capture</p>')
    vm.run('correct')
    await flushPromises()
    expect(AiService.assist.mock.calls[0][1]).toBe('<p>Captur</p>')
    vm.apply()
    expect(captionAlt()).toBe('Capture du serveur')
  })

  it('does not change a caption changed during the request', async () => {
    const notify = vi.spyOn(Notify, 'create').mockImplementation(() => {})
    const vm = await mountCaptionButton('<p>Texte</p><legend label="Figure" alt="Legende"></legend>')
    captionInput().focus()
    await wrapper.find('.ai-assist').trigger('mousedown')
    proposal('<p>Légende</p>')
    vm.run('correct')
    await flushPromises()
    vm.caption = { ...vm.caption, alt: 'Autre' } // Typed in the input meanwhile
    vm.apply()
    expect(captionAlt()).toBe('Legende')
    expect(notify.mock.calls[0][0]).toMatchObject({ message: i18n.global.t('ai.textChanged'), color: 'warning' })
  })

  it('cancels without changing the text', async () => {
    proposal('<p>Other</p>')
    const vm = mountButton()
    vm.run('shorten')
    await flushPromises()
    vm.proposalDialog = false
    expect(editor.getHTML()).toBe('<p>Le parametre est renvoyer.</p><p>Second</p>')
  })
})
