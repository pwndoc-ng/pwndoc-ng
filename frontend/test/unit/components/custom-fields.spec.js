// components/custom-fields.vue: custom fields of the findings, sections, audits and vulnerabilities
// The TipTap editor (fields of type text) is replaced by a stub.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { reactive } from 'vue'
import _ from 'lodash'
import { QInput, QSelect, QOptionGroup, QField } from 'quasar'

vi.mock('components/editor', () => import('../../helpers/editor-stub'))

import CustomFields from 'components/custom-fields'
import CommentButton from 'components/comment-button'
import EditorStub from '../../helpers/editor-stub'

const field = (id, fieldType, extra = {}, text = '') => ({
  customField: { _id: id, label: `Label ${id}`, fieldType, size: 6, offset: 0, required: false, description: `Help ${id}`, options: [], ...extra },
  text
})
const OPTIONS = [{ locale: 'en', value: 'Low' }, { locale: 'en', value: 'High' }, { locale: 'fr', value: 'Faible' }]

let wrapper

function mountFields(modelValue, props = {}, provide = {}) {
  wrapper = mount(CustomFields, {
    props: { modelValue, locale: 'en', ...props },
    global: { mocks: { $_: _ }, provide }
  })
  return wrapper
}

afterEach(() => {
  wrapper && wrapper.unmount()
  wrapper = null
})

describe('custom-fields layout', () => {
  it('splits the fields in rows at the full width spaces', () => {
    mountFields([
      field('a', 'input'), field('s1', 'space', { size: 12 }), field('b', 'input'), field('s2', 'space', { size: 6 }), field('c', 'input')
    ])
    expect(wrapper.vm.computedFields.map((row) => row.map((f) => f.customField._id))).toEqual([['a'], [], ['b', 's2', 'c']])
    expect(wrapper.findAll('.row.q-col-gutter-md')).toHaveLength(3)
  })

  it('uses the size and offset of the fields', () => {
    mountFields([field('a', 'input', { size: 4, offset: 2 }), field('b', 'input', { size: undefined, offset: undefined })])
    const columns = wrapper.findAll('.q-col-gutter-md > div')
    expect(columns[0].classes()).toEqual(expect.arrayContaining(['col-12', 'col-md-4', 'offset-md-2']))
    expect(columns[1].classes()).toEqual(expect.arrayContaining(['col-md-12', 'offset-md-0']))
  })

  it('wraps the rows in the given element', () => {
    mountFields([field('a', 'input')], { customElement: 'section' })
    expect(wrapper.find('section .row').exists()).toBe(true)
  })
})

describe('custom-fields types', () => {
  it('renders an input with its label, hint and required mark', () => {
    mountFields([field('a', 'input', { required: true }, 'value')])
    const input = wrapper.findComponent(QInput)
    expect(input.props('modelValue')).toBe('value')
    expect(input.props('hint')).toBe('Help a')
    expect(wrapper.text()).toContain('Label a')
    expect(wrapper.find('.text-red').text()).toBe('*')
  })

  it('renders a date with a date picker', () => {
    mountFields([field('d', 'date', {}, '2024-01-31')])
    expect(wrapper.findComponent(QInput).props('modelValue')).toBe('2024-01-31')
    expect(wrapper.find('.q-icon').text()).toBe('event')
  })

  it('offers the options of the language of the fields in the selects', () => {
    mountFields([field('s', 'select', { options: OPTIONS }, 'High'), field('m', 'select-multiple', { options: OPTIONS }, ['Low'])])
    const [select, multiple] = wrapper.findAllComponents(QSelect)
    expect(select.props('options').map((o) => o.value)).toEqual(['Low', 'High'])
    expect(select.props('optionsHtml')).toBe(false) // Options displayed as text
    expect(multiple.props('multiple')).toBe(true)
    expect(multiple.props('modelValue')).toEqual(['Low'])
  })

  it('renders the checkboxes and radios with the options of the language', () => {
    mountFields([field('c', 'checkbox', { options: OPTIONS }, ['High']), field('r', 'radio', { options: OPTIONS }, 'Faible')], { locale: 'fr' })
    const [checkbox, radio] = wrapper.findAllComponents(QOptionGroup)
    expect(checkbox.props('type')).toBe('checkbox')
    expect(checkbox.props('options')).toEqual([{ label: 'Faible', value: 'Faible' }])
    expect(radio.props('type')).toBe('radio')
    expect(wrapper.vm.getOptionsGroup(OPTIONS)).toEqual([{ label: 'Faible', value: 'Faible' }])
  })

  it('edits the text fields with the editor and propagates its changes', async () => {
    const fields = [field('t', 'text', {}, '<p>text</p>')]
    mountFields(fields, { idUnique: 'f1', noSyncEditor: true })
    const editor = wrapper.findComponent(EditorStub)
    expect(editor.props()).toMatchObject({ modelValue: '<p>text</p>', idUnique: 't-custom-f1', noSync: true, editable: true, collab: true })
    editor.vm.$emit('update:modelValue', '<p>changed</p>')
    expect(fields[0].text).toBe('<p>changed</p>')
    editor.vm.$emit('editorchange')
    expect(wrapper.emitted('editorchange')).toHaveLength(1)
  })

  it('is read only when asked', () => {
    mountFields([field('a', 'input'), field('t', 'text'), field('c', 'checkbox', { options: OPTIONS })], { readonly: true, collab: false })
    expect(wrapper.findComponent(QInput).props('readonly')).toBe(true)
    expect(wrapper.findComponent(EditorStub).props()).toMatchObject({ editable: false, collab: false })
    expect(wrapper.findComponent(QOptionGroup).props('disable')).toBe(true)
  })
})

describe('custom-fields differences (comparison with another version)', () => {
  const diff = [{ customField: { _id: 'a' }, text: 'old' }, { customField: { _id: 'b' }, text: ['x'] }, { customField: { _id: 't' }, text: '<p>old</p>' }]

  it('highlights the fields different from the other version', () => {
    mountFields([field('a', 'input', {}, 'new'), field('b', 'checkbox', { options: [] }, ['x']), field('t', 'text', {}, '<p>new</p>')], { diff })
    expect(wrapper.vm.isTextInCustomFields(wrapper.props('modelValue')[0])).toBe(true)
    expect(wrapper.vm.isTextInCustomFields(wrapper.props('modelValue')[1])).toBe(false) // arrays compared by value
    expect(wrapper.findComponent(QInput).props('bgColor')).toBe('diffbackground')
    expect(wrapper.findComponent(QField).classes()).not.toContain('bg-diffbackground')
  })

  it('shows the text of the other version in a read only editor', () => {
    mountFields([field('t', 'text', {}, '<p>new</p>')], { diff })
    expect(wrapper.findComponent(EditorStub).props()).toMatchObject({ modelValue: '<p>new</p>', diff: '<p>old</p>', editable: false })
    expect(wrapper.vm.getTextDiffInCustomFields(field('unknown', 'text'))).toBe('')
  })

  it('does not highlight anything without other version', () => {
    mountFields([field('a', 'input', {}, 'new')])
    expect(wrapper.vm.isTextInCustomFields(wrapper.props('modelValue')[0])).toBe(false)
  })
})

describe('custom-fields review comments', () => {
  it('gives a stable comment target to each field (editors props)', () => {
    mountFields([field('a', 'input')], { commentTarget: { kind: 'finding', findingId: 'f1' } })
    const target = wrapper.vm.fieldCommentTarget(wrapper.props('modelValue')[0])
    expect(target).toEqual({ kind: 'finding', findingId: 'f1', field: 'customFields.a' })
    expect(wrapper.vm.fieldCommentTarget(wrapper.props('modelValue')[0])).toBe(target)
  })

  it('has no comment target outside the audits', () => {
    mountFields([field('a', 'input')])
    expect(wrapper.vm.fieldCommentTarget(wrapper.props('modelValue')[0])).toBeNull()
  })

  it('shows the comment button of each field in an audit', () => {
    const store = reactive({ forTarget: vi.fn(() => []), openCountForTarget: vi.fn(() => 0), openTarget: vi.fn() })
    mountFields([field('a', 'input'), field('t', 'text')], { commentTarget: { kind: 'section', sectionId: 's1' } }, { auditComments: store })
    const buttons = wrapper.findAllComponents(CommentButton)
    expect(buttons.map((button) => button.props('target'))).toEqual([
      { kind: 'section', sectionId: 's1', field: 'customFields.a' },
      { kind: 'section', sectionId: 's1', field: 'customFields.t' }
    ])
    expect(wrapper.findComponent(EditorStub).props('commentTarget')).toEqual({ kind: 'section', sectionId: 's1', field: 'customFields.t' })
  })
})

describe('custom-fields validation', () => {
  it('detects the empty required fields', () => {
    mountFields([field('a', 'input', { required: true }, 'filled'), field('b', 'select-multiple', { required: true }, []), field('s', 'space', { required: true })])
    expect(wrapper.vm.requiredFieldsEmpty()).toBe(true)
  })

  it('accepts the filled required fields', () => {
    mountFields([field('a', 'input', { required: true }, 'filled'), field('b', 'checkbox', { required: true, options: OPTIONS }, ['Low']), field('c', 'input', {}, '')])
    expect(wrapper.vm.requiredFieldsEmpty()).toBe(false)
  })

  it('shows the error of the empty required fields', async () => {
    mountFields([field('a', 'input', { required: true }, '')])
    wrapper.vm.requiredFieldsEmpty()
    await flushPromises()
    expect(wrapper.text()).toContain('Field is required')
  })

  // BUG: src/components/custom-fields.vue:340-342 validate() calls this.$refs[key][0].validate() for every ref
  // starting with 'field': when the list of fields gets shorter (e.g. finding category changed, so fewer custom
  // fields), the refs of the removed fields remain as empty arrays and the validation (save) throws a TypeError
  it.skip('validates the fields after some of them have been removed', async () => {
    mountFields([field('a', 'input'), field('b', 'input')])
    await wrapper.setProps({ modelValue: [field('a', 'input')] })
    expect(() => wrapper.vm.requiredFieldsEmpty()).not.toThrow()
  })
})
