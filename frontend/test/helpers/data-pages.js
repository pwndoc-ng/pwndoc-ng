// Helpers of the tests of the data pages (clients, companies, collaborators, templates, custom data)
import { vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import _ from 'lodash'

import UserService from '@/services/user'
import DataService from '@/services/data'
import TemplateService from '@/services/template'

// QDialog replaced by a stub rendering its content while open (the forms of the dialogs can be tested).
// hide() emits 'hide' like the real dialog (the pages clean their errors / forms on hide).
export const DialogStub = {
  name: 'QDialog',
  emits: ['hide', 'show'],
  data: () => ({ open: false }),
  methods: {
    show() {
      this.open = true
      this.$emit('show')
    },
    hide() {
      if (!this.open) return
      this.open = false
      this.$emit('hide')
    }
  },
  template: '<div class="dialog-stub" :data-open="open"><slot v-if="open" /></div>'
}

// QUploader replaced by a stub: the test emits 'added' with the files
export const UploaderStub = {
  name: 'QUploader',
  props: ['label', 'accept'],
  emits: ['added'],
  template: '<div class="uploader-stub" :data-accept="accept">{{ label }}</div>'
}

// Mounts a data page with the given permissions of the connected user
export async function mountPage(component, { roles = '*', username = 'admin', stubs = {}, mocks = {} } = {}) {
  UserService.user = { username, roles }
  const wrapper = mount(component, {
    global: {
      mocks: { $_: _, ...mocks },
      stubs: { QDialog: DialogStub, QUploader: UploaderStub, ...stubs }
    }
  })
  await flushPromises()
  return wrapper
}

// Answer of the API ({data: {datas}})
export const ok = (datas) => Promise.resolve({ data: { datas } })

// Error of axios with an answer of the API (4xx / 5xx)
export function apiError(status, datas) {
  const error = new Error(`Request failed with status code ${status}`)
  error.response = { status, data: { datas } }
  return error
}

// Texts of the cells of the rows of the table (search row of the top-row slot excluded)
export function tableRows(wrapper) {
  return wrapper.findAll('tbody tr')
    .filter((row) => !row.find('input').exists())
    .map((row) => row.findAll('td').map((cell) => cell.text()))
}

// Dialog stub of a ref of the page (createModal, editModal)
export const dialog = (wrapper, ref) => wrapper.vm.$refs[ref]

// File read by FileReader (asynchronous in jsdom): waits until the value read is set
export async function waitFileReader(value) {
  await vi.waitFor(() => {
    if (!value()) throw new Error('File not read yet')
  }, { timeout: 3000, interval: 10 })
  await flushPromises()
}

// Readings of files by the pages (FileReader, asynchronous in jsdom) started after the call (in a beforeEach: the
// spies are restored after each test). The function returned waits for the end of all these readings and for the
// handlers of the page, however slow the machine is (a fixed delay lets a late reading reach the next test).
export function trackFileReads() {
  const pending = []
  for (const method of ['readAsText', 'readAsDataURL']) {
    const original = FileReader.prototype[method]
    vi.spyOn(FileReader.prototype, method).mockImplementation(function (...args) {
      // Listener added after the onloadend handler of the page (set before the reading): called after it
      pending.push(new Promise((resolve) => this.addEventListener('loadend', resolve, { once: true })))
      return original.apply(this, args)
    })
  }
  return async function fileReadsDone() {
    while (pending.length)
      await Promise.all(pending.splice(0))
    await flushPromises()
  }
}

// Data of the custom data page (pages/data/custom)
export const CUSTOM_DATA = {
  templates: [{ _id: 't-en', name: 'Default EN', ext: 'docx' }, { _id: 't-fr', name: 'Modèle FR', ext: 'docx' }],
  languages: [{ locale: 'en', language: 'English' }, { locale: 'fr', language: 'Français' }],
  auditTypes: [],
  vulnTypes: [],
  categories: [],
  sections: [],
  customFields: []
}

// Mounts pages/data/custom with the given data (services of the API spied)
export async function mountCustomPage(component, data = {}, options = {}) {
  const datas = { ...CUSTOM_DATA, ...data }
  // Methods already mocked by the test (controlled answers) are kept
  const spy = (service, method, value) => vi.isMockFunction(service[method]) || vi.spyOn(service, method).mockImplementation(() => ok(_.cloneDeep(value)))
  spy(TemplateService, 'getTemplates', datas.templates)
  spy(DataService, 'getLanguages', datas.languages)
  spy(DataService, 'getAuditTypes', datas.auditTypes)
  spy(DataService, 'getVulnerabilityTypes', datas.vulnTypes)
  spy(DataService, 'getVulnerabilityCategories', datas.categories)
  spy(DataService, 'getSections', datas.sections)
  spy(DataService, 'getCustomFields', datas.customFields)
  const wrapper = await mountPage(component, options)
  if (options.tab) {
    wrapper.vm.selectedTab = options.tab
    await flushPromises()
  }
  return wrapper
}

// Answer of the API resolved or rejected by the test (hurried user, answers in disorder)
export function deferred() {
  const call = {}
  call.promise = new Promise((resolve, reject) => {
    call.resolve = (datas) => {
      resolve({ data: { datas } })
      return flushPromises()
    }
    call.reject = (status, datas) => {
      reject(apiError(status, datas))
      return flushPromises()
    }
  })
  return call
}

// Calls of a method of a service answered by the test: calls[i].args (copy), calls[i].resolve(datas), calls[i].reject(status, datas)
export function controlled(service, method) {
  const calls = []
  vi.spyOn(service, method).mockImplementation((...args) => {
    const call = deferred()
    call.args = JSON.parse(JSON.stringify(args))
    calls.push(call)
    return call.promise
  })
  return calls
}

// Rejections not handled by the page (exceptions thrown in the callbacks of the requests)
export function trackUnhandledRejections() {
  const errors = []
  const listener = (reason) => errors.push(reason)
  process.on('unhandledRejection', listener)
  Object.defineProperty(errors, 'stop', { value: () => process.off('unhandledRejection', listener) }) // Not enumerable
  return errors
}

// Lets the unhandled rejections be reported
export const settle = () => new Promise((resolve) => setTimeout(resolve, 20))
