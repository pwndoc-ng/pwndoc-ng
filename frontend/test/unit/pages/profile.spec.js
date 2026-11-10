// pages/profile: user information, password change, two-factor authentication (TOTP), auto correction toggle
// (API services mocked)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { QInput, QToggle, QChip, QBtn, QImg } from 'quasar'

vi.mock('boot/axios', () => import('../../helpers/api-mock'))
vi.mock('@/router', () => ({ default: { push: vi.fn() } }))

import ProfilePage from 'pages/profile'
import UserService from '@/services/user'
import AutoCorrectionService from '@/services/autoCorrection'
import { mockNotify, lastNotification } from '../../helpers/quasar'

const PROFILE = (extra = {}) => ({ _id: 'u1', username: 'jdoe', firstname: 'Zoë', lastname: '王', email: 'zoe@example.com', phone: '', role: 'user', totpEnabled: false, ...extra })
const QRCODE = { totpQrCode: 'data:image/png;base64,iVBORw0KGgo=', totpSecret: 'JBSWY3DPEHPK3PXP' }

let wrapper
let notify

async function mountPage(profile = PROFILE()) {
  vi.spyOn(UserService, 'getProfile').mockResolvedValue({ data: { datas: profile } })
  vi.spyOn(UserService, 'getTotpQrCode').mockResolvedValue({ data: { datas: { ...QRCODE } } })
  vi.spyOn(UserService, 'refreshToken').mockResolvedValue()
  wrapper = mount(ProfilePage, { attachTo: document.body })
  await flushPromises()
  return wrapper
}

const inputByLabel = (label) => wrapper.findAllComponents(QInput).find((input) => input.props('label') === label)
const toggleByLabel = (label) => wrapper.findAllComponents(QToggle).find((toggle) => toggle.props('label') === label)
const buttonByLabel = (label) => wrapper.findAllComponents(QBtn).find((button) => button.props('label') === label)
const totpToggle = () => toggleByLabel('Two-factor authentication')

// Valid form: current password given
function fillForm(values = {}) {
  Object.assign(wrapper.vm.user, { currentPassword: 'Current1', ...values })
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  notify = mockNotify()
  sessionStorage.clear()
  AutoCorrectionService.enable()
})
afterEach(() => {
  wrapper && wrapper.unmount()
  wrapper = null
})

describe('profile loading', () => {
  it('shows the information of the user', async () => {
    await mountPage()
    expect(UserService.getProfile).toHaveBeenCalledTimes(1)
    expect(inputByLabel(wrapper.vm.$t('username')).props('modelValue')).toBe('jdoe')
    expect(inputByLabel(wrapper.vm.$t('firstname')).props('modelValue')).toBe('Zoë')
    expect(inputByLabel(wrapper.vm.$t('lastname')).props('modelValue')).toBe('王')
    expect(inputByLabel('Email').props('modelValue')).toBe('zoe@example.com')
    expect(wrapper.findComponent(QChip).props()).toMatchObject({ label: 'user', color: 'info' })
    expect(totpToggle().props('modelValue')).toBe(false)
    expect(UserService.getTotpQrCode).not.toHaveBeenCalled() // 2FA disabled: no secret requested
  })

  it('shows the admin role in orange', async () => {
    await mountPage(PROFILE({ role: 'admin' }))
    expect(wrapper.findComponent(QChip).props('color')).toBe('orange')
  })

  it('shows the current QR code when the 2FA is enabled', async () => {
    await mountPage(PROFILE({ totpEnabled: true }))
    expect(totpToggle().props('modelValue')).toBe(true)
    expect(UserService.getTotpQrCode).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('Your account is currently protected by 2 factor authentication.')
    expect(wrapper.text()).toContain('Your current 2FA QR Code')
    expect(wrapper.findComponent(QImg).props('src')).toBe(QRCODE.totpQrCode)
  })

  it('hides and shows again the current QR code', async () => {
    await mountPage(PROFILE({ totpEnabled: true }))
    await buttonByLabel('Hide QR Code').trigger('click')
    expect(wrapper.vm.totpQrcode).toBe('')
    expect(wrapper.findComponent(QImg).exists()).toBe(false)
    await buttonByLabel('Show QR Code').trigger('click')
    await flushPromises()
    expect(UserService.getTotpQrCode).toHaveBeenCalledTimes(2)
    expect(wrapper.findComponent(QImg).exists()).toBe(true)
  })

  it('keeps an empty form when the profile cannot be loaded', async () => {
    vi.spyOn(UserService, 'getProfile').mockRejectedValue({ response: { status: 500, data: { datas: 'Internal error' } } })
    wrapper = mount(ProfilePage)
    await flushPromises()
    expect(wrapper.vm.user).toEqual({})
    expect(wrapper.vm.totpEnabled).toBe(false)
    // Nothing to update without the profile: the form stays locked and the user is told why
    expect(inputByLabel(wrapper.vm.$t('username')).props('disable')).toBe(true)
    expect(lastNotification(notify)).toMatchObject({ message: 'Internal error', color: 'negative' })
  })
})

describe('profile update', () => {
  it('requires the username, first name, last name and current password', async () => {
    vi.spyOn(UserService, 'updateProfile')
    await mountPage(PROFILE({ username: '', firstname: '', lastname: '' }))
    await buttonByLabel(wrapper.vm.$t('btn.update')).trigger('click')
    expect(wrapper.vm.errors).toEqual({
      username: wrapper.vm.$t('msg.usernameRequired'),
      firstname: wrapper.vm.$t('msg.firstnameRequired'),
      lastname: wrapper.vm.$t('msg.lastnameRequired'),
      currentPassword: wrapper.vm.$t('msg.currentPasswordRequired'),
      newPassword: ''
    })
    expect(UserService.updateProfile).not.toHaveBeenCalled()
    await flushPromises()
    expect(wrapper.text()).toContain(wrapper.vm.$t('msg.currentPasswordRequired'))
  })

  it('clears the previous errors when the form is valid', async () => {
    vi.spyOn(UserService, 'updateProfile').mockResolvedValue({})
    await mountPage()
    wrapper.vm.updateProfile()
    expect(wrapper.vm.errors.currentPassword).not.toBe('')
    fillForm()
    wrapper.vm.updateProfile()
    expect(wrapper.vm.errors).toEqual({ username: '', firstname: '', lastname: '', currentPassword: '', newPassword: '' })
    expect(UserService.updateProfile).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['short', 'short'],
    ['alllowercase1', 'alllowercase1'],
    ['ALLUPPERCASE1', 'ALLUPPERCASE1'],
    ['NoDigitsHere', 'NoDigitsHere'],
    ['Abc1', 'Abc1']
  ])('refuses the weak new password %j', async (newPassword, confirmPassword) => {
    vi.spyOn(UserService, 'updateProfile')
    await mountPage()
    fillForm({ newPassword, confirmPassword })
    wrapper.vm.updateProfile()
    expect(wrapper.vm.errors.newPassword).toBe(wrapper.vm.$t('msg.passwordComplexity'))
    expect(UserService.updateProfile).not.toHaveBeenCalled()
  })

  it('refuses a confirmation different from the new password', async () => {
    vi.spyOn(UserService, 'updateProfile')
    await mountPage()
    fillForm({ newPassword: 'NewPassw0rd', confirmPassword: 'NewPassw0rD' })
    wrapper.vm.updateProfile()
    expect(wrapper.vm.errors.newPassword).toBe(wrapper.vm.$t('msg.confirmPasswordDifferents'))
    expect(UserService.updateProfile).not.toHaveBeenCalled()
  })

  it('refuses a confirmation without new password', async () => {
    vi.spyOn(UserService, 'updateProfile')
    await mountPage()
    fillForm({ confirmPassword: 'NewPassw0rd' })
    wrapper.vm.updateProfile()
    expect(wrapper.vm.errors.newPassword).not.toBe('')
    expect(UserService.updateProfile).not.toHaveBeenCalled()
  })

  it('updates the profile with a new strong password and refreshes the token', async () => {
    vi.spyOn(UserService, 'updateProfile').mockResolvedValue({ data: { datas: 'User updated successfully' } })
    await mountPage()
    fillForm({ newPassword: 'NouveauMotDeP4sse', confirmPassword: 'NouveauMotDeP4sse', firstname: 'Zoé-Ève' })
    wrapper.vm.updateProfile()
    await flushPromises()
    expect(UserService.updateProfile).toHaveBeenCalledWith(expect.objectContaining({
      username: 'jdoe', firstname: 'Zoé-Ève', lastname: '王', currentPassword: 'Current1', newPassword: 'NouveauMotDeP4sse'
    }))
    expect(UserService.refreshToken).toHaveBeenCalled()
    expect(lastNotification(notify)).toMatchObject({ message: wrapper.vm.$t('msg.profileUpdateOk'), color: 'positive' })
  })

  it('updates the profile with Enter in the current password field', async () => {
    vi.spyOn(UserService, 'updateProfile').mockResolvedValue({})
    await mountPage()
    fillForm()
    await inputByLabel(wrapper.vm.$t('currentPassword')).find('input').trigger('keyup', { key: 'Enter' })
    expect(UserService.updateProfile).toHaveBeenCalledTimes(1)
  })

  it('notifies the error of the server (wrong current password)', async () => {
    vi.spyOn(UserService, 'updateProfile').mockRejectedValue({ response: { status: 401, data: { datas: 'Current password is invalid' } } })
    await mountPage()
    fillForm({ currentPassword: 'wrong' })
    wrapper.vm.updateProfile()
    await flushPromises()
    expect(lastNotification(notify)).toMatchObject({ message: 'Current password is invalid', color: 'negative' })
    expect(UserService.refreshToken).not.toHaveBeenCalled()
  })

  it('notifies a network error', async () => {
    vi.spyOn(UserService, 'updateProfile').mockRejectedValue(new Error('Network Error'))
    await mountPage()
    fillForm()
    wrapper.vm.updateProfile()
    await flushPromises()
    expect(lastNotification(notify)).toMatchObject({ message: 'Network Error', color: 'negative' })
  })

  it('clears the password fields after a successful update', async () => {
    vi.spyOn(UserService, 'updateProfile').mockResolvedValue({})
    await mountPage()
    fillForm({ newPassword: 'NouveauMotDeP4sse', confirmPassword: 'NouveauMotDeP4sse' })
    wrapper.vm.updateProfile()
    await flushPromises()
    expect(wrapper.vm.user.currentPassword).toBeFalsy()
    expect(wrapper.vm.user.newPassword).toBeFalsy()
    expect(wrapper.vm.user.confirmPassword).toBeFalsy()
  })
})

describe('two-factor authentication', () => {
  it('shows the QR code and the token input when the 2FA is switched on', async () => {
    await mountPage()
    wrapper.vm.totpEnabled = true
    wrapper.vm.getTotpQrcode()
    await flushPromises()
    expect(wrapper.vm.totpSecret).toBe(QRCODE.totpSecret)
    expect(wrapper.findComponent(QImg).props('src')).toBe(QRCODE.totpQrCode)
    expect(wrapper.text()).toContain('Install an Authenticator App')
    expect(buttonByLabel('Enable')).toBeTruthy()
  })

  it('requests the QR code when the toggle is clicked', async () => {
    await mountPage()
    await totpToggle().trigger('click')
    await flushPromises()
    expect(UserService.getTotpQrCode).toHaveBeenCalled()
    expect(wrapper.vm.totpEnabled).toBe(true)
    expect(wrapper.vm.totpQrcode).toBe(QRCODE.totpQrCode)
  })

  it('requests a single QR code per click on the toggle', async () => {
    await mountPage()
    await totpToggle().trigger('click')
    await flushPromises()
    expect(UserService.getTotpQrCode).toHaveBeenCalledTimes(1)
  })

  it('resets the QR code, secret and token when the toggle is switched off before enabling', async () => {
    await mountPage()
    wrapper.vm.totpEnabled = true
    wrapper.vm.getTotpQrcode()
    await flushPromises()
    wrapper.vm.totpToken = '123'
    wrapper.vm.totpEnabled = false
    wrapper.vm.getTotpQrcode()
    expect(wrapper.vm.totpQrcode).toBe('')
    expect(wrapper.vm.totpSecret).toBe('')
    expect(wrapper.vm.totpToken).toBe('')
  })

  it('notifies the error of the QR code request', async () => {
    await mountPage()
    UserService.getTotpQrCode.mockRejectedValue({ response: { status: 500, data: { datas: 'TOTP generation failed' } } })
    wrapper.vm.totpEnabled = true
    wrapper.vm.getTotpQrcode()
    await flushPromises()
    expect(lastNotification(notify)).toMatchObject({ message: 'Failed to get TOTP QR code: TOTP generation failed', color: 'negative' })
    UserService.getTotpQrCode.mockRejectedValue(new Error('Network Error'))
    wrapper.vm.getTotpQrcode()
    await flushPromises()
    expect(lastNotification(notify).message).toBe('Failed to get TOTP QR code: Network Error')
  })

  it('does not send the token without secret (QR code not loaded)', async () => {
    vi.spyOn(UserService, 'setupTotp')
    await mountPage()
    wrapper.vm.totpToken = '123456'
    wrapper.vm.setupTotp()
    expect(UserService.setupTotp).not.toHaveBeenCalled()
    expect(lastNotification(notify).color).toBe('negative')
  })

  it('enables the 2FA with the token of the authenticator', async () => {
    vi.spyOn(UserService, 'setupTotp').mockResolvedValue({ data: { status: 'success', datas: 'TOTP enabled' } })
    await mountPage()
    wrapper.vm.totpEnabled = true
    wrapper.vm.getTotpQrcode()
    await flushPromises()
    await inputByLabel('TOTP Token').setValue('123456')
    await buttonByLabel('Enable').trigger('click')
    await flushPromises()
    expect(UserService.setupTotp).toHaveBeenCalledWith('123456', QRCODE.totpSecret)
    expect(wrapper.vm.user.totpEnabled).toBe(true)
    expect(wrapper.vm.totpToken).toBe('')
    expect(lastNotification(notify)).toMatchObject({ message: 'TOTP successfully enabled', color: 'positive' })
    expect(wrapper.text()).toContain('Your account is currently protected by 2 factor authentication.')
  })

  it('enables the 2FA with Enter in the token input', async () => {
    vi.spyOn(UserService, 'setupTotp').mockResolvedValue({ data: { status: 'success' } })
    await mountPage()
    wrapper.vm.totpEnabled = true
    wrapper.vm.getTotpQrcode()
    await flushPromises()
    wrapper.vm.totpToken = '654321'
    await inputByLabel('TOTP Token').find('input').trigger('keyup', { key: 'Enter' })
    expect(UserService.setupTotp).toHaveBeenCalledWith('654321', QRCODE.totpSecret)
  })

  it('keeps the 2FA disabled when the server answers with an error status', async () => {
    vi.spyOn(UserService, 'setupTotp').mockResolvedValue({ data: { status: 'error', datas: 'Wrong TOTP token' } })
    await mountPage()
    Object.assign(wrapper.vm, { totpEnabled: true, totpSecret: QRCODE.totpSecret, totpToken: '000000' })
    wrapper.vm.setupTotp()
    await flushPromises()
    expect(wrapper.vm.user.totpEnabled).toBe(false)
    expect(lastNotification(notify)).toMatchObject({ message: 'TOTP verification failed: Wrong TOTP token', color: 'negative' })
  })

  it.each([
    [{ response: { status: 400, data: { datas: 'Wrong TOTP token' } } }, 'TOTP verification failed: Wrong TOTP token'],
    [new Error('Network Error'), 'TOTP verification failed: Network Error'],
    [{}, 'TOTP verification failed']
  ])('notifies the HTTP errors of the 2FA activation %#', async (error, message) => {
    vi.spyOn(UserService, 'setupTotp').mockRejectedValue(error)
    await mountPage()
    Object.assign(wrapper.vm, { totpEnabled: true, totpSecret: QRCODE.totpSecret, totpToken: '000000' })
    wrapper.vm.setupTotp()
    await flushPromises()
    expect(wrapper.vm.user.totpEnabled).toBe(false)
    expect(lastNotification(notify)).toMatchObject({ message, color: 'negative' })
  })

  it('does not write the TOTP secret in the console', async () => {
    vi.spyOn(UserService, 'setupTotp').mockResolvedValue({ data: { status: 'success' } })
    await mountPage()
    Object.assign(wrapper.vm, { totpEnabled: true, totpSecret: QRCODE.totpSecret, totpToken: '123456' })
    wrapper.vm.setupTotp()
    await flushPromises()
    const logged = JSON.stringify([...console.log.mock.calls, ...console.error.mock.calls])
    expect(logged).not.toContain(QRCODE.totpSecret)
  })

  it('asks the token to disable the 2FA when the toggle is switched off', async () => {
    await mountPage(PROFILE({ totpEnabled: true }))
    wrapper.vm.totpEnabled = false
    wrapper.vm.getTotpQrcode()
    await flushPromises()
    expect(wrapper.vm.totpQrcode).toBe('')
    expect(wrapper.text()).toContain('This action will disable the second authentication factor.')
    expect(buttonByLabel('Disable')).toBeTruthy()
    expect(buttonByLabel('Enable')).toBeUndefined()
  })

  it('disables the 2FA with the token of the authenticator', async () => {
    vi.spyOn(UserService, 'cancelTotp').mockResolvedValue({ data: { status: 'success', datas: 'TOTP cancelled' } })
    await mountPage(PROFILE({ totpEnabled: true }))
    wrapper.vm.totpEnabled = false
    wrapper.vm.getTotpQrcode()
    await flushPromises()
    await inputByLabel('TOTP Token').setValue('112233')
    await buttonByLabel('Disable').trigger('click')
    await flushPromises()
    expect(UserService.cancelTotp).toHaveBeenCalledWith('112233')
    expect(wrapper.vm.user.totpEnabled).toBe(false)
    expect(wrapper.vm.totpToken).toBe('')
    expect(lastNotification(notify)).toMatchObject({ message: 'TOTP successfully disabled', color: 'positive' })
    expect(wrapper.text()).not.toContain('This action will disable the second authentication factor.')
  })

  it('keeps the 2FA enabled when the token is refused', async () => {
    vi.spyOn(UserService, 'cancelTotp').mockResolvedValue({ data: { status: 'error', datas: 'Wrong TOTP token' } })
    await mountPage(PROFILE({ totpEnabled: true }))
    wrapper.vm.totpEnabled = false
    wrapper.vm.totpToken = '000000'
    wrapper.vm.cancelTotp()
    await flushPromises()
    expect(wrapper.vm.user.totpEnabled).toBe(true)
    expect(lastNotification(notify)).toMatchObject({ message: 'Failed to cancel TOTP: Wrong TOTP token', color: 'negative' })
  })

  it('notifies the HTTP error of the 2FA deactivation', async () => {
    vi.spyOn(UserService, 'cancelTotp').mockRejectedValue({ response: { status: 400, data: { datas: 'Wrong TOTP token' } } })
    await mountPage(PROFILE({ totpEnabled: true }))
    wrapper.vm.cancelTotp()
    await flushPromises()
    expect(wrapper.vm.user.totpEnabled).toBe(true)
    expect(lastNotification(notify)).toMatchObject({ message: 'TOTP verification failed: Wrong TOTP token', color: 'negative' })
  })
})

describe('auto correction toggle', () => {
  const toggle = () => toggleByLabel(wrapper.vm.$t('autoCorrection'))

  it('is unchecked while the auto correction is enabled (toggle to disable it)', async () => {
    await mountPage()
    expect(toggle().props('modelValue')).toBe(false)
  })

  it('is checked when the auto correction was disabled in the session', async () => {
    AutoCorrectionService.disable()
    await mountPage()
    expect(toggle().props('modelValue')).toBe(true)
  })

  it('disables and enables the auto correction and notifies the editors', async () => {
    const events = []
    const listener = (event) => events.push(event.detail)
    window.addEventListener('autoCorrectionToggleChanged', listener)
    await mountPage()
    await toggle().trigger('click')
    expect(AutoCorrectionService.isAutoCorrectionEnabled()).toBe(false)
    expect(sessionStorage.getItem('autoCorrectionEnabled')).toBe('false')
    await toggle().trigger('click')
    expect(AutoCorrectionService.isAutoCorrectionEnabled()).toBe(true)
    expect(sessionStorage.getItem('autoCorrectionEnabled')).toBe('true')
    expect(events).toEqual([{ enabled: false }, { enabled: true }])
    window.removeEventListener('autoCorrectionToggleChanged', listener)
  })
})
