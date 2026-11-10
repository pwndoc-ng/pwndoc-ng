// pages/data/collaborators: users table (enabled / disabled accounts, filters, permissions), creation and update
// dialogs (validation, password policy, roles, account activation, 2FA status). Dialogs stubbed, API services mocked.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { QInput, QBtn, QSelect, QToggle } from 'quasar'

vi.mock('boot/axios', () => import('../../helpers/api-mock'))
vi.mock('@/router', () => ({ default: { push: vi.fn() } }))

import CollaboratorsPage from 'pages/data/collaborators'
import CollabService from '@/services/collaborator'
import DataService from '@/services/data'
import { api, resetApi } from '../../helpers/api-mock'
import { mockNotify, lastNotification } from '../../helpers/quasar'
import { mountPage, ok, apiError, tableRows, dialog } from '../../helpers/data-pages'

const ROLES = ['user', 'admin', 'reviewer']
const USERS = [
  { _id: 'u1', username: 'admin', firstname: 'Ada', lastname: 'Lovelace', email: 'ada@corp.io', role: 'admin', enabled: true, totpEnabled: true },
  { _id: 'u2', username: 'jdoe', firstname: 'John', lastname: 'Doe', email: 'john@corp.io', role: 'user', enabled: true, totpEnabled: false },
  { _id: 'u3', username: 'élise', firstname: 'Élise', lastname: 'Brontë', email: '', role: 'reviewer', enabled: false, totpEnabled: false }
]

let wrapper

async function mountCollaborators({ users = USERS, roles = '*' } = {}) {
  vi.spyOn(CollabService, 'getCollabs').mockImplementation(() => ok(users))
  vi.spyOn(DataService, 'getRoles').mockImplementation(() => ok(ROLES))
  wrapper = await mountPage(CollaboratorsPage, { roles })
  return wrapper
}

const t = (key, ...args) => wrapper.vm.$t(key, ...args)
const input = (label) => wrapper.findAllComponents(QInput).find((component) => component.props('label') === label)
const button = (label) => wrapper.findAllComponents(QBtn).filter((component) => component.text() === label).at(-1)
const usernames = () => tableRows(wrapper).map((row) => row[0])
const filter = (terms) => wrapper.vm.customFilter(USERS, { username: '', firstname: '', lastname: '', role: '', email: '', enabled: true, ...terms }).map((u) => u._id)

async function openCreation() {
  await button(t('addCollaborator')).trigger('click')
}
const fillCollab = (values) => Object.assign(wrapper.vm.currentCollab, values)
const VALID = { username: 'new.user', firstname: 'Nouvel', lastname: 'Utilisateur', password: 'Str0ngPassword' }

beforeEach(() => {
  resetApi()
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  wrapper && wrapper.unmount()
  wrapper = null
})

describe('collaborators list', () => {
  it('loads the users and the roles and shows the enabled accounts', async () => {
    await mountCollaborators()
    expect(CollabService.getCollabs).toHaveBeenCalledTimes(1)
    expect(DataService.getRoles).toHaveBeenCalledTimes(1)
    expect(wrapper.vm.loading).toBe(false)
    expect(usernames().sort()).toEqual(['admin', 'jdoe'])
    expect(tableRows(wrapper)).toContainEqual(expect.arrayContaining(['jdoe', 'John', 'Doe', 'john@corp.io', 'user']))
    expect(wrapper.findAllComponents(QToggle)[0].props('label')).toBe('Enabled accounts')
  })

  it('shows the disabled accounts with the toggle', async () => {
    await mountCollaborators()
    await wrapper.findAllComponents(QToggle)[0].vm.$emit('update:modelValue', false)
    await flushPromises()
    expect(usernames()).toEqual(['élise'])
    expect(wrapper.findAllComponents(QToggle)[0].props('label')).toBe('Disabled accounts')
  })

  it('filters by username, names, email and role (case and accent insensitive)', async () => {
    await mountCollaborators()
    expect(filter({ firstname: 'ADA' })).toEqual(['u1'])
    expect(filter({ lastname: 'bronte', enabled: false })).toEqual(['u3'])
    expect(filter({ username: 'elise', enabled: false })).toEqual(['u3'])
    expect(filter({ email: 'corp' })).toEqual(['u1', 'u2'])
    expect(filter({ role: 'admin' })).toEqual(['u1'])
    expect(filter({ role: null, username: null })).toEqual(['u1', 'u2'])
  })

  it('hides the accounts without enabled value from the enabled accounts', async () => {
    await mountCollaborators()
    expect(wrapper.vm.customFilter([{ username: 'legacy' }], { enabled: true })).toEqual([])
    expect(wrapper.vm.customFilter([{ username: 'legacy' }], { enabled: false })).toHaveLength(1)
  })

  it('offers the roles in the role search', async () => {
    await mountCollaborators()
    const search = wrapper.findAllComponents(QSelect).find((select) => select.props('label') === t('search'))
    expect(search.props('options')).toEqual(ROLES)
  })

  it('filters the table with the search inputs', async () => {
    await mountCollaborators()
    const searchRow = wrapper.findAll('tbody tr').find((row) => row.find('input').exists())
    await searchRow.findAll('input')[0].setValue('JD')
    expect(usernames()).toEqual(['jdoe'])
  })

  it('shows the plural count of the users', async () => {
    await mountCollaborators()
    expect(wrapper.text()).toContain('3 Collaborators')
  })

  it('shows the singular count of the users', async () => {
    await mountCollaborators({ users: [USERS[0]] })
    expect(wrapper.text()).toContain('1 Collaborator')
    expect(wrapper.text()).not.toContain('Collatorator')
  })

  it('does not crash when the users cannot be loaded', async () => {
    vi.spyOn(CollabService, 'getCollabs').mockRejectedValue(apiError(403, 'Insufficient privileges'))
    vi.spyOn(DataService, 'getRoles').mockRejectedValue(apiError(500, 'Internal error'))
    wrapper = await mountPage(CollaboratorsPage)
    expect(wrapper.vm.collabs).toEqual([])
    expect(wrapper.vm.roles).toEqual([])
    expect(console.log).toHaveBeenCalledTimes(2)
  })
})

describe('collaborators permissions', () => {
  it.each([
    ['*', true, true],
    [['users:read'], false, false],
    [['users:read', 'users:create'], true, false],
    [['users:read', 'users:update'], false, true]
  ])('shows the actions allowed by the roles %j', async (roles, canCreate, canUpdate) => {
    await mountCollaborators({ roles })
    expect(wrapper.findAllComponents(QBtn).some((b) => b.text() === t('addCollaborator'))).toBe(canCreate)
    expect(wrapper.findAllComponents(QBtn).some((b) => b.props('icon') === 'fa fa-edit')).toBe(canUpdate)
  })

  it('opens the user with a double click for the administrators', async () => {
    await mountCollaborators()
    await wrapper.findAll('tbody tr').find((tr) => tr.text().includes('jdoe')).trigger('dblclick')
    expect(dialog(wrapper, 'editModal').open).toBe(true)
    expect(wrapper.vm.idUpdate).toBe('u2')
  })

  it('does not open the user with a double click without update permission', async () => {
    await mountCollaborators({ roles: ['users:read'] })
    wrapper.vm.dblClick(null, USERS[1])
    expect(dialog(wrapper, 'editModal').open).toBe(false)
  })

  it('opens the user with a double click with the users:update permission', async () => {
    await mountCollaborators({ roles: ['users:read', 'users:update'] })
    wrapper.vm.dblClick(null, USERS[1])
    expect(dialog(wrapper, 'editModal').open).toBe(true)
  })
})

describe('collaborator creation', () => {
  it('opens the creation dialog with an empty user of the role user', async () => {
    await mountCollaborators()
    wrapper.vm.clone(USERS[0])
    await openCreation()
    expect(dialog(wrapper, 'createModal').open).toBe(true)
    expect(wrapper.vm.currentCollab).toMatchObject({ username: '', firstname: '', lastname: '', email: '', phone: '', password: '', role: 'user' })
    expect(wrapper.findAllComponents(QSelect).find((s) => s.props('label') === `${t('role')} *`).props('options')).toEqual(ROLES)
  })

  it('requires the username, firstname, lastname and a strong password', async () => {
    vi.spyOn(CollabService, 'createCollab')
    await mountCollaborators()
    await openCreation()
    await button(t('btn.create')).trigger('click')
    expect(wrapper.vm.errors).toEqual({
      lastname: 'Lastname required', firstname: 'Firstname required', username: 'Username required',
      password: t('msg.passwordComplexity')
    })
    expect(CollabService.createCollab).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Username required')
  })

  it.each([
    ['Sh0rtPw', false], // 7 characters
    ['alllowercase1', false],
    ['ALLUPPERCASE1', false],
    ['NoDigitsInside', false],
    ['Str0ngPassword', true],
    ['Pässw0rdÉté', true]
  ])('checks the complexity of the password %j', async (password, valid) => {
    vi.spyOn(CollabService, 'createCollab').mockImplementation(() => ok('created'))
    mockNotify()
    await mountCollaborators()
    await openCreation()
    fillCollab({ ...VALID, password })
    wrapper.vm.createCollab()
    expect(wrapper.vm.errors.password).toBe(valid ? '' : t('msg.passwordComplexity'))
    expect(CollabService.createCollab).toHaveBeenCalledTimes(valid ? 1 : 0)
  })

  it('creates the user, reloads the list and closes the dialog', async () => {
    const notify = mockNotify()
    vi.spyOn(CollabService, 'createCollab').mockImplementation(() => ok('User created'))
    await mountCollaborators()
    await openCreation()
    await input(`${t('username')} *`).find('input').setValue('zoë')
    await input(`${t('firstname')} *`).find('input').setValue('Zoë')
    await input(`${t('lastname')} *`).find('input').setValue('Ōtsuka')
    await input(t('email')).find('input').setValue('zoe@corp.io')
    await input(`${t('password')} *`).find('input').setValue('Str0ngPassword')
    wrapper.findAllComponents(QSelect).find((s) => s.props('label') === `${t('role')} *`).vm.$emit('update:modelValue', 'reviewer')
    await input(`${t('password')} *`).find('input').trigger('keyup', { key: 'Enter' })
    await flushPromises()
    expect(CollabService.createCollab).toHaveBeenCalledWith([expect.objectContaining({
      username: 'zoë', firstname: 'Zoë', lastname: 'Ōtsuka', email: 'zoe@corp.io', role: 'reviewer', password: 'Str0ngPassword'
    })])
    expect(CollabService.getCollabs).toHaveBeenCalledTimes(2)
    expect(dialog(wrapper, 'createModal').open).toBe(false)
    expect(lastNotification(notify)).toMatchObject({ message: 'Collaborator created successfully', color: 'positive' })
  })

  it('sends the creation to the API of the users', async () => {
    mockNotify()
    await mountCollaborators()
    await openCreation()
    fillCollab(VALID)
    wrapper.vm.createCollab()
    await flushPromises()
    expect(api.post).toHaveBeenCalledWith('users', [expect.objectContaining({ username: 'new.user' })])
  })

  it.each([
    [422, 'Username already exists'],
    [422, 'Password does not match the password policy'],
    [403, 'Insufficient privileges']
  ])('notifies the error %i "%s" and keeps the dialog open', async (status, message) => {
    const notify = mockNotify()
    vi.spyOn(CollabService, 'createCollab').mockRejectedValue(apiError(status, message))
    await mountCollaborators()
    await openCreation()
    fillCollab(VALID)
    wrapper.vm.createCollab()
    await flushPromises()
    expect(lastNotification(notify)).toMatchObject({ message, color: 'negative' })
    expect(dialog(wrapper, 'createModal').open).toBe(true)
  })

  it('cleans the errors when the dialog is closed', async () => {
    await mountCollaborators()
    await openCreation()
    wrapper.vm.createCollab()
    dialog(wrapper, 'createModal').hide()
    expect(wrapper.vm.errors).toEqual({ lastname: '', firstname: '', username: '', password: '' })
  })
})

describe('collaborator update', () => {
  it('opens a copy of the user with the edit button and shows its 2FA status and account state', async () => {
    await mountCollaborators()
    const row = wrapper.findAll('tbody tr').find((tr) => tr.text().includes('admin'))
    await row.findAllComponents(QBtn).find((b) => b.props('icon') === 'fa fa-edit').trigger('click')
    expect(dialog(wrapper, 'editModal').open).toBe(true)
    expect(wrapper.vm.idUpdate).toBe('u1')
    expect(wrapper.vm.currentCollab).toEqual(USERS[0])
    expect(wrapper.vm.currentCollab).not.toBe(USERS[0])
    expect(wrapper.text()).toContain('2FA enabled for this user')
    expect(wrapper.findAllComponents(QToggle).at(-1).props('label')).toBe('Account enabled')
  })

  it('shows the disabled 2FA and account', async () => {
    await mountCollaborators()
    wrapper.vm.dblClick(null, USERS[2])
    await flushPromises()
    expect(wrapper.text()).toContain('2FA disabled for this user')
    expect(wrapper.findAllComponents(QToggle).at(-1).props('label')).toBe('Account disabled')
  })

  it('disables an account', async () => {
    const notify = mockNotify()
    vi.spyOn(CollabService, 'updateCollab').mockImplementation(() => ok('User updated'))
    await mountCollaborators()
    wrapper.vm.dblClick(null, USERS[1])
    await flushPromises()
    await wrapper.findAllComponents(QToggle).at(-1).vm.$emit('update:modelValue', false)
    await button(t('btn.update')).trigger('click')
    await flushPromises()
    expect(CollabService.updateCollab).toHaveBeenCalledWith('u2', expect.objectContaining({ username: 'jdoe', enabled: false }))
    expect(CollabService.getCollabs).toHaveBeenCalledTimes(2)
    expect(dialog(wrapper, 'editModal').open).toBe(false)
    expect(lastNotification(notify)).toMatchObject({ message: 'Collaborator updated successfully', color: 'positive' })
  })

  it('enables a disabled account and changes its role', async () => {
    mockNotify()
    vi.spyOn(CollabService, 'updateCollab').mockImplementation(() => ok('User updated'))
    await mountCollaborators()
    wrapper.vm.dblClick(null, USERS[2])
    await flushPromises()
    await wrapper.findAllComponents(QToggle).at(-1).vm.$emit('update:modelValue', true)
    wrapper.findAllComponents(QSelect).find((s) => s.props('label') === `${t('role')} *`).vm.$emit('update:modelValue', 'admin')
    wrapper.vm.updateCollab()
    await flushPromises()
    expect(CollabService.updateCollab).toHaveBeenCalledWith('u3', expect.objectContaining({ enabled: true, role: 'admin' }))
  })

  it('updates the user without password', async () => {
    mockNotify()
    vi.spyOn(CollabService, 'updateCollab').mockImplementation(() => ok('User updated'))
    await mountCollaborators()
    wrapper.vm.dblClick(null, USERS[1])
    wrapper.vm.updateCollab()
    await flushPromises()
    expect(wrapper.vm.errors.password).toBe('')
    expect(CollabService.updateCollab.mock.calls[0][1].password).toBeUndefined()
    expect(api.put).not.toHaveBeenCalled()
  })

  it('requires the username, firstname and lastname', async () => {
    vi.spyOn(CollabService, 'updateCollab')
    await mountCollaborators()
    wrapper.vm.dblClick(null, USERS[1])
    await flushPromises()
    await input(`${t('username')} *`).find('input').setValue('')
    await input(`${t('lastname')} *`).find('input').setValue('')
    await button(t('btn.update')).trigger('click')
    expect(wrapper.vm.errors).toMatchObject({ username: 'Username required', lastname: 'Lastname required', firstname: '' })
    expect(CollabService.updateCollab).not.toHaveBeenCalled()
  })

  it('refuses a weak numeric password', async () => {
    vi.spyOn(CollabService, 'updateCollab')
    await mountCollaborators()
    wrapper.vm.dblClick(null, USERS[1])
    wrapper.vm.currentCollab.password = '12345678'
    wrapper.vm.updateCollab()
    expect(wrapper.vm.errors.password).toBe(t('msg.passwordComplexity'))
    expect(CollabService.updateCollab).not.toHaveBeenCalled()
  })

  it('refuses a weak new password in the update dialog', async () => {
    vi.spyOn(CollabService, 'updateCollab')
    await mountCollaborators()
    wrapper.vm.dblClick(null, USERS[1])
    wrapper.vm.currentCollab.password = 'weak'
    wrapper.vm.updateCollab()
    expect(wrapper.vm.errors.password).toBe(t('msg.passwordComplexity'))
    expect(CollabService.updateCollab).not.toHaveBeenCalled()
  })

  it('sends a strong new password', async () => {
    mockNotify()
    vi.spyOn(CollabService, 'updateCollab').mockImplementation(() => ok('User updated'))
    await mountCollaborators()
    wrapper.vm.dblClick(null, USERS[1])
    await flushPromises()
    await input(t('password')).find('input').setValue('N3wStrongPass')
    wrapper.vm.updateCollab()
    await flushPromises()
    expect(CollabService.updateCollab).toHaveBeenCalledWith('u2', expect.objectContaining({ password: 'N3wStrongPass' }))
  })

  it('does not send the password erased in the update dialog', async () => {
    mockNotify()
    vi.spyOn(CollabService, 'updateCollab').mockImplementation(() => ok('User updated'))
    await mountCollaborators()
    wrapper.vm.dblClick(null, USERS[1])
    await flushPromises()
    await input(t('password')).find('input').setValue('typo')
    await input(t('password')).find('input').setValue('')
    wrapper.vm.updateCollab()
    await flushPromises()
    expect(CollabService.updateCollab).toHaveBeenCalledTimes(1)
    expect(CollabService.updateCollab.mock.calls[0][1].password).toBeFalsy()
    expect('password' in CollabService.updateCollab.mock.calls[0][1]).toBe(false)
  })

  it('notifies the error of the update and keeps the dialog open', async () => {
    const notify = mockNotify()
    vi.spyOn(CollabService, 'updateCollab').mockRejectedValue(apiError(422, 'Username already exists'))
    await mountCollaborators()
    wrapper.vm.dblClick(null, USERS[1])
    wrapper.vm.currentCollab.username = 'admin'
    wrapper.vm.updateCollab()
    await flushPromises()
    expect(lastNotification(notify)).toMatchObject({ message: 'Username already exists', color: 'negative' })
    expect(dialog(wrapper, 'editModal').open).toBe(true)
    expect(CollabService.getCollabs).toHaveBeenCalledTimes(1)
  })

  it('sends the update to the API of the users', async () => {
    mockNotify()
    await mountCollaborators()
    wrapper.vm.dblClick(null, USERS[0])
    wrapper.vm.updateCollab()
    await flushPromises()
    expect(api.put).toHaveBeenCalledWith('users/u1', expect.objectContaining({ username: 'admin', totpEnabled: true }))
  })
})
