// components/ai-assist-button.vue: assisted writing on the selection or the whole field, proposal shown then applied by
// the user only (real TipTap editor, API service mocked)
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Notify } from 'quasar'

vi.mock('boot/axios', () => import('../../helpers/api-mock'))

import AiAssistButton from 'components/ai-assist-button'
import AiService from '@/services/ai'

let wrapper
let editor

function mountButton(content = '<p>Le parametre est renvoyer.</p><p>Second</p>') {
  editor = new Editor({ element: document.createElement('div'), extensions: [StarterKit], content })
  wrapper = mount(AiAssistButton, { props: { editor, auditId: 'a1' }, attachTo: document.body })
  return wrapper.vm
}
const proposal = (html) => vi.spyOn(AiService, 'assist').mockResolvedValue({ data: { datas: { html } } })

afterEach(() => {
  wrapper && wrapper.unmount()
  wrapper = null
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

  it('cancels without changing the text', async () => {
    proposal('<p>Other</p>')
    const vm = mountButton()
    vm.run('shorten')
    await flushPromises()
    vm.proposalDialog = false
    expect(editor.getHTML()).toBe('<p>Le parametre est renvoyer.</p><p>Second</p>')
  })
})
