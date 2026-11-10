// Hurried user on pages/settings, pages/profile and layouts/home: API answers delayed and given by the test (in any
// order), double clicks, typing before the end of the loading, navigation while a request is in progress
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import _ from 'lodash'
import { createRouter, createMemoryHistory } from 'vue-router'
import { QBtn, QInput, QBadge } from 'quasar'

vi.mock('boot/axios', () => import('../../helpers/api-mock'))
vi.mock('@/router', () => ({ default: { push: vi.fn() } }))

import SettingsPage from 'pages/settings'
import ProfilePage from 'pages/profile'
import HomeLayout from 'layouts/home'
import SettingsService from '@/services/settings'
import DataService from '@/services/data'
import UserService from '@/services/user'
import VulnerabilityService from '@/services/vulnerability'
import { mockDialog, mockNotify, lastNotification } from '../../helpers/quasar'
import { deferred, deferredCalls, catchWindowErrors } from '../../helpers/misc'
import { trackFileReads } from '../../helpers/data-pages'

const ok = (datas) => ({ data: { datas } })

let wrapper
let notify
let fileReadsDone

// Keydown listeners of the settings page: also removed after each test (page left mounted by a failed test)
const keydownListeners = []
beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  notify = mockNotify()
  fileReadsDone = trackFileReads()
  vi.spyOn(document, 'addEventListener').mockImplementation(function (type, listener, options) {
    if (type === 'keydown') keydownListeners.push(listener)
    return EventTarget.prototype.addEventListener.call(this, type, listener, options)
  })
})
afterEach(() => {
  wrapper && wrapper.unmount()
  wrapper = null
  keydownListeners.splice(0).forEach((listener) => EventTarget.prototype.removeEventListener.call(document, 'keydown', listener, false))
})

describe('hurried user on the settings', () => {
  const SETTINGS = (minReviewers = 1, captions = ['Figure']) => ({
    report: {
      public: {
        cvssColors: {}, remediationColorsComplexity: {}, remediationColorsPriority: {}, captions,
        extendCvssTemporalEnvironment: false, findingSidebarTemplate: '{title}', imageDefaultWidth: 'large'
      },
      private: { imageBorder: false, imageBorderColor: '#000000' }
    },
    reviews: { enabled: true, public: { mandatoryReview: false, minReviewers, blockApprovalWithOpenComments: false }, private: { removeApprovalsUponUpdate: false } },
    danger: { enabled: false, public: { nbdaydelete: 30 } }
  })
  let loads
  let $settings

  function mountSettings() {
    UserService.user = { username: 'admin', roles: '*' }
    $settings = { refresh: vi.fn(() => Promise.resolve()) }
    loads = deferredCalls(vi.spyOn(SettingsService, 'getSettings'))
    vi.spyOn(DataService, 'getCustomFields').mockResolvedValue(ok([]))
    wrapper = mount(SettingsPage, { global: { mocks: { $_: _, $settings }, stubs: { LanguageSelector: true } } })
  }

  async function mountLoaded(settings = SETTINGS()) {
    mountSettings()
    loads[0].resolve(ok(settings))
    await flushPromises()
  }

  function pressSave() {
    const event = new KeyboardEvent('keydown', { ctrlKey: true, cancelable: true })
    Object.defineProperty(event, 'keyCode', { value: 83 })
    document.dispatchEvent(event)
  }

  const saveButton = () => wrapper.findAllComponents(QBtn).find((button) => button.props('label') === wrapper.vm.$t('saveSettings'))

  it('shows no field before the settings are loaded (nothing to type in)', async () => {
    mountSettings()
    await flushPromises()
    expect(wrapper.findAllComponents(QInput)).toHaveLength(0)
    loads[0].resolve(ok(SETTINGS()))
    await flushPromises()
    expect(wrapper.findAllComponents(QInput).length).toBeGreaterThan(0)
  })

  it('sends nothing on Ctrl+S before the settings are loaded', async () => {
    const update = vi.spyOn(SettingsService, 'updateSettings').mockResolvedValue({})
    mountSettings()
    await catchWindowErrors(() => pressSave())
    expect(update).not.toHaveBeenCalled()
  })

  it('throws no error on Ctrl+S before the settings are loaded', async () => {
    vi.spyOn(SettingsService, 'updateSettings').mockResolvedValue({})
    mountSettings()
    const errors = await catchWindowErrors(() => pressSave())
    expect(errors).toEqual([])
  })

  it('keeps a consistent state after a double save (button and Ctrl+S)', async () => {
    const saves = deferredCalls(vi.spyOn(SettingsService, 'updateSettings'))
    await mountLoaded()
    wrapper.vm.settings.reviews.public.minReviewers = 3
    await saveButton().trigger('click')
    pressSave()
    expect(saves.length).toBeGreaterThanOrEqual(1)
    SettingsService.updateSettings.mock.calls.forEach(([sent]) => expect(sent.reviews.public.minReviewers).toBe(3))
    saves.slice().reverse().forEach((save) => save.resolve({}))
    await flushPromises()
    expect(wrapper.vm.unsavedChanges()).toBe(false)
    expect(notify.mock.calls.every(([options]) => options.color === 'positive')).toBe(true)
  })

  it('completes a save answered after leaving the page (no error, notification shown)', async () => {
    const saves = deferredCalls(vi.spyOn(SettingsService, 'updateSettings'))
    await mountLoaded()
    wrapper.vm.updateSettings()
    wrapper.unmount()
    wrapper = null
    saves[0].resolve({})
    await flushPromises()
    expect($settings.refresh).toHaveBeenCalled()
    expect(lastNotification(notify)).toMatchObject({ color: 'positive' })
  })

  it('keeps the changes made during a save as unsaved', async () => {
    const saves = deferredCalls(vi.spyOn(SettingsService, 'updateSettings'))
    await mountLoaded()
    wrapper.vm.settings.reviews.public.minReviewers = 2
    wrapper.vm.updateSettings()
    wrapper.vm.settings.reviews.public.minReviewers = 5 // Typed while the save is in progress
    saves[0].resolve({})
    await flushPromises()
    expect(wrapper.vm.unsavedChanges()).toBe(true)
  })

  it('asks a confirmation when leaving the page right after a click on save (save in progress)', async () => {
    const dialogs = mockDialog()
    const saves = deferredCalls(vi.spyOn(SettingsService, 'updateSettings'))
    await mountLoaded()
    wrapper.vm.settings.danger.enabled = true
    wrapper.vm.updateSettings()
    const next = vi.fn()
    SettingsPage.beforeRouteLeave.call(wrapper.vm, {}, {}, next)
    expect(dialogs).toHaveLength(1) // The change is not saved yet
    saves[0].resolve({})
    await flushPromises()
    dialogs[0].ok()
    expect(next).toHaveBeenCalled()
    expect(SettingsService.updateSettings).toHaveBeenCalledTimes(1)
  })

  it('shows the settings of the last loading when two loadings answer out of order', async () => {
    const dialogs = mockDialog()
    vi.spyOn(SettingsService, 'revertDefaults').mockResolvedValue({})
    vi.spyOn(SettingsService, 'updateSettings').mockResolvedValue({})
    await mountLoaded()
    wrapper.vm.revertToDefaults()
    await dialogs[0].ok() // Load 1: settings after the revert
    wrapper.vm.importSettings([new File([JSON.stringify(SETTINGS(4, ['Imported']))], 'settings.json')])
    await fileReadsDone()
    await dialogs[1].ok() // Load 2: settings after the import
    await flushPromises()
    loads[2].resolve(ok(SETTINGS(4, ['Imported'])))
    await flushPromises()
    loads[1].resolve(ok(SETTINGS(1, ['Figure'])))
    await flushPromises()
    expect(wrapper.vm.settings.report.public.captions).toEqual(['Imported'])
  })
})

describe('hurried user on the profile', () => {
  const PROFILE = { username: 'jdoe', firstname: 'Zoë', lastname: '王', role: 'user', totpEnabled: false }
  let profiles

  function mountProfile() {
    profiles = deferredCalls(vi.spyOn(UserService, 'getProfile'))
    vi.spyOn(UserService, 'refreshToken').mockResolvedValue()
    wrapper = mount(ProfilePage)
  }

  async function mountLoaded(profile = PROFILE) {
    mountProfile()
    profiles[0].resolve(ok({ ...profile }))
    await flushPromises()
  }

  const input = (label) => wrapper.findAllComponents(QInput).find((i) => i.props('label') === label)
  const button = (label) => wrapper.findAllComponents(QBtn).find((b) => b.props('label') === label)

  it('does not lose what is typed before the profile is loaded', async () => {
    mountProfile()
    await flushPromises()
    const firstname = input(wrapper.vm.$t('firstname'))
    const locked = firstname.props('disable') || firstname.props('readonly')
    await firstname.find('input').setValue('Zoé typed')
    profiles[0].resolve(ok({ ...PROFILE }))
    await flushPromises()
    expect(locked || wrapper.vm.user.firstname === 'Zoé typed').toBe(true)
  })

  it('sends nothing when update is clicked before the profile is loaded', async () => {
    const update = vi.spyOn(UserService, 'updateProfile')
    mountProfile()
    await button(wrapper.vm.$t('btn.update')).trigger('click')
    expect(update).not.toHaveBeenCalled()
    expect(wrapper.vm.errors.username).toBe(wrapper.vm.$t('msg.usernameRequired'))
  })

  it('sends a single update for a double click', async () => {
    deferredCalls(vi.spyOn(UserService, 'updateProfile'))
    await mountLoaded()
    Object.assign(wrapper.vm.user, { currentPassword: 'Current1', newPassword: 'NouveauP4ss', confirmPassword: 'NouveauP4ss' })
    await button(wrapper.vm.$t('btn.update')).trigger('click')
    await button(wrapper.vm.$t('btn.update')).trigger('click')
    expect(UserService.updateProfile).toHaveBeenCalledTimes(1)
  })

  it('completes an update answered after leaving the page', async () => {
    const updates = deferredCalls(vi.spyOn(UserService, 'updateProfile'))
    await mountLoaded()
    wrapper.vm.user.currentPassword = 'Current1'
    wrapper.vm.updateProfile()
    wrapper.unmount()
    wrapper = null
    updates[0].resolve({})
    await flushPromises()
    expect(UserService.refreshToken).toHaveBeenCalled()
    expect(lastNotification(notify)).toMatchObject({ color: 'positive' })
  })

  it('notifies an update error answered after leaving the page without exception', async () => {
    const updates = deferredCalls(vi.spyOn(UserService, 'updateProfile'))
    await mountLoaded()
    wrapper.vm.user.currentPassword = 'wrong'
    wrapper.vm.updateProfile()
    wrapper.unmount()
    wrapper = null
    updates[0].reject({ response: { status: 401, data: { datas: 'Current password is invalid' } } })
    await flushPromises()
    expect(lastNotification(notify)).toMatchObject({ message: 'Current password is invalid', color: 'negative' })
  })

  it.each([
    ['Enable', 'setupTotp', false],
    ['Disable', 'cancelTotp', true]
  ])('sends a single 2FA request for a double click on %s', async (label, method, totpEnabled) => {
    deferredCalls(vi.spyOn(UserService, method))
    vi.spyOn(UserService, 'getTotpQrCode').mockResolvedValue(ok({ totpQrCode: 'data:image/png;base64,AA==', totpSecret: 'JBSWY3DPEHPK3PXP' }))
    await mountLoaded({ ...PROFILE, totpEnabled })
    Object.assign(wrapper.vm, { totpEnabled: !totpEnabled, totpSecret: 'JBSWY3DPEHPK3PXP', totpToken: '123456' })
    await flushPromises()
    await button(label).trigger('click')
    await button(label).trigger('click')
    expect(UserService[method]).toHaveBeenCalledTimes(1)
  })

  it('ignores a QR code answered after the toggle was switched off', async () => {
    const qrcodes = deferredCalls(vi.spyOn(UserService, 'getTotpQrCode'))
    await mountLoaded()
    wrapper.vm.totpEnabled = true
    wrapper.vm.getTotpQrcode()
    wrapper.vm.totpEnabled = false
    wrapper.vm.getTotpQrcode()
    qrcodes[0].resolve(ok({ totpQrCode: 'data:image/png;base64,AA==', totpSecret: 'JBSWY3DPEHPK3PXP' }))
    await flushPromises()
    expect(wrapper.vm.totpQrcode).toBe('')
    expect(wrapper.vm.totpSecret).toBe('')
  })

  it('shows the QR code and the secret of the same answer when two QR codes answer out of order', async () => {
    const qrcodes = deferredCalls(vi.spyOn(UserService, 'getTotpQrCode'))
    await mountLoaded()
    wrapper.vm.totpEnabled = true
    wrapper.vm.getTotpQrcode()
    wrapper.vm.getTotpQrcode()
    qrcodes[1].resolve(ok({ totpQrCode: 'data:image/png;base64,B', totpSecret: 'SECRETB' }))
    await flushPromises()
    qrcodes[0].resolve(ok({ totpQrCode: 'data:image/png;base64,A', totpSecret: 'SECRETA' }))
    await flushPromises()
    const pairs = { 'data:image/png;base64,A': 'SECRETA', 'data:image/png;base64,B': 'SECRETB' }
    expect(pairs[wrapper.vm.totpQrcode]).toBe(wrapper.vm.totpSecret) // The secret sent with the token is the one of the QR code shown
  })

  it('ignores a QR code answered after leaving the page', async () => {
    const qrcodes = deferredCalls(vi.spyOn(UserService, 'getTotpQrCode'))
    await mountLoaded()
    wrapper.vm.totpEnabled = true
    wrapper.vm.getTotpQrcode()
    wrapper.unmount()
    wrapper = null
    qrcodes[0].resolve(ok({ totpQrCode: 'data:image/png;base64,AA==', totpSecret: 'X' }))
    await flushPromises()
    expect(notify).not.toHaveBeenCalled()
  })

  // GET /api/users/totp answers the same secret on repeated calls (S8, fixed and tested in the backend: it used to
  // generate a new secret at each call); the page shows each time the QR code answered, with its own secret
  it('shows the same current QR code each time (secret of the account)', async () => {
    const account = { totpQrCode: 'data:image/png;base64,QUNDT1VOVA==', totpSecret: 'ACCOUNTSECRET' }
    vi.spyOn(UserService, 'getTotpQrCode').mockImplementation(() => Promise.resolve(ok({ ...account })))
    await mountLoaded({ ...PROFILE, totpEnabled: true })
    const first = wrapper.vm.totpQrcode
    expect(first).toBe(account.totpQrCode)
    wrapper.vm.hideTotpQrCode()
    wrapper.vm.showExistingTotpQrCode()
    await flushPromises()
    expect(wrapper.vm.totpQrcode).toBe(first)
    expect(wrapper.vm.totpSecret).toBe(account.totpSecret)
  })

  it('sends the secret of the QR code displayed when the toggle is switched off and on again during the requests', async () => {
    const qrcodes = deferredCalls(vi.spyOn(UserService, 'getTotpQrCode'))
    vi.spyOn(UserService, 'setupTotp').mockResolvedValue(ok({}))
    await mountLoaded()
    for (const enabled of [true, false, true]) {
      wrapper.vm.totpEnabled = enabled
      wrapper.vm.getTotpQrcode()
    }
    expect(qrcodes).toHaveLength(2) // One request per activation, none for the deactivation
    qrcodes[1].resolve(ok({ totpQrCode: 'data:image/png;base64,Qg==', totpSecret: 'SECRETB' }))
    qrcodes[0].resolve(ok({ totpQrCode: 'data:image/png;base64,QQ==', totpSecret: 'SECRETA' }))
    await flushPromises()
    expect(wrapper.vm.totpQrcode).toBe('data:image/png;base64,Qg==')
    wrapper.vm.totpToken = '123456'
    wrapper.vm.setupTotp()
    expect(UserService.setupTotp).toHaveBeenCalledWith('123456', 'SECRETB')
  })
})

describe('hurried user on the home layout', () => {
  let counts
  let router

  async function mountHome() {
    UserService.user = { username: 'jdoe', roles: ['vulnerabilities:update'] }
    counts = deferredCalls(vi.spyOn(VulnerabilityService, 'getProposalsCount'))
    router = createRouter({
      history: createMemoryHistory(),
      routes: ['/audits', '/vulnerabilities', '/settings', '/profile'].map((path) => ({ path, component: { template: '<div class="page" />' } }))
    })
    router.push('/audits')
    await router.isReady()
    wrapper = mount(HomeLayout, { global: { plugins: [router] } })
    await flushPromises()
  }

  const badge = () => wrapper.findComponent(QBadge)

  it('shows the count of the last navigation when the answers come in order', async () => {
    await mountHome()
    await router.push('/vulnerabilities')
    await router.push('/settings')
    counts.forEach((count, index) => count.resolve(ok({ pending: index + 1 })))
    await flushPromises()
    expect(badge().text()).toBe('3')
  })

  it('shows the count of the last request when the answers come out of order', async () => {
    await mountHome()
    await router.push('/vulnerabilities')
    await router.push('/settings')
    counts[2].resolve(ok({ pending: 0 }))
    await flushPromises()
    counts[1].resolve(ok({ pending: 7 }))
    counts[0].resolve(ok({ pending: 7 }))
    await flushPromises()
    expect(badge().exists()).toBe(false)
  })

  it('ignores a count answered after the layout was unmounted', async () => {
    await mountHome()
    wrapper.unmount()
    wrapper = null
    const errors = await catchWindowErrors(async () => {
      counts[0].resolve(ok({ pending: 3 }))
      window.dispatchEvent(new Event('proposals-changed'))
      await flushPromises()
    })
    expect(errors).toEqual([])
    expect(counts).toHaveLength(1) // No request after the unmount
  })

  it('requests the count again for each proposals change, even quickly repeated', async () => {
    await mountHome()
    window.dispatchEvent(new Event('proposals-changed'))
    window.dispatchEvent(new Event('proposals-changed'))
    expect(counts).toHaveLength(3)
    counts.forEach((count) => count.resolve(ok({ pending: 2 })))
    await flushPromises()
    expect(badge().text()).toBe('2')
  })
})
