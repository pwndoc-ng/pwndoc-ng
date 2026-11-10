// components/backups-manager.vue: list, creation (data selection with dependencies), upload, download, restore, deletion
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { QCheckbox, QBtn, QTable } from 'quasar'

vi.mock('boot/axios', () => import('../../helpers/api-mock'))
vi.mock('@/router', () => ({ default: { push: vi.fn() } }))

import BackupsManager from 'components/backups-manager'
import BackupService from '@/services/backup'
import UserService from '@/services/user'
import { mockDialog, mockNotify, lastNotification } from '../../helpers/quasar'

const BACKUPS = [
  { id: '20240131-130500-aaaaaaaa', name: 'Weekly', type: 'full', createdAt: '2024-01-31T13:05:00', size: 3 * 1048576 + 104858, encrypted: false, origin: 'created',
    categories: ['audits', 'vulnerabilities', 'images', 'users', 'companies', 'clients', 'templates', 'languages', 'auditTypes', 'vulnerabilityTypes', 'vulnerabilityCategories', 'customFields', 'customSections', 'settings'],
    collections: { Audit: 12, Image: 30, Vulnerability: 40, User: 3, Company: 2, Client: 5, Template: 1, Settings: 1 } },
  { id: '20240201-080000-bbbbbbbb', name: 'Customers only', type: 'partial', createdAt: '2024-02-01T08:00:00', size: 2048, encrypted: false, origin: 'created',
    categories: ['companies', 'clients'], collections: { Company: 2, Client: 5 } },
  { id: '20240202-090000-cccccccc', name: 'external.enc', type: null, addedAt: '2024-02-02T09:00:00', size: 500, encrypted: true, origin: 'uploaded',
    categories: null, collections: {} }
]

let wrapper

function setRoles(roles) {
  UserService.user = { username: 'admin', roles }
}

async function mountManager() {
  wrapper = mount(BackupsManager, { attachTo: document.body })
  await flushPromises()
  return wrapper
}

// Checkboxes of the selection tree of the open dialog: {label: component}
function checkboxes() {
  return Object.fromEntries(wrapper.findAllComponents(QCheckbox).map((box) => [box.props('label'), box]))
}

function buttonByLabel(label) {
  return wrapper.findAllComponents(QBtn).find((button) => button.props('label') === label)
}

beforeEach(() => {
  setRoles('*')
  vi.spyOn(BackupService, 'getBackups').mockResolvedValue({ data: { datas: BACKUPS } })
})

afterEach(() => {
  wrapper && wrapper.unmount()
  wrapper = null
})

describe('backups list', () => {
  it('loads and displays the backups', async () => {
    await mountManager()
    expect(BackupService.getBackups).toHaveBeenCalledTimes(1)
    const rows = wrapper.findAll('tbody tr')
    expect(rows).toHaveLength(3)
    expect(rows[0].text()).toContain('Weekly')
    expect(rows[0].text()).toContain('2024-01-31 13:05')
    expect(rows[0].text()).toContain('All the data')
    expect(rows[0].text()).toContain('3.1 MB')
    expect(rows[1].text()).toContain('Partial')
    expect(rows[1].text()).toContain('2 KB')
    expect(rows[2].text()).toContain('Encrypted (content unknown)')
    expect(rows[2].text()).toContain('Uploaded')
    expect(rows[2].text()).toContain('2024-02-02 09:00') // addedAt for the uploaded backups
    expect(rows[2].find('.q-icon.mdi-lock').exists()).toBe(true)
    expect(rows[0].find('.q-icon.mdi-lock').exists()).toBe(false)
  })

  it('notifies the error when the list cannot be loaded', async () => {
    const notify = mockNotify()
    BackupService.getBackups.mockRejectedValueOnce({ message: 'Request failed', response: { data: { datas: 'Backups directory not writable' } } })
    await mountManager()
    expect(lastNotification(notify)).toMatchObject({ message: 'Backups directory not writable', color: 'negative' })
    expect(wrapper.findComponent(QTable).props('loading')).toBe(false)
  })

  it.each([
    [['backups:read'], { list: true, create: false, download: true, restore: false, delete: false }],
    [['backups:read', 'backups:create'], { list: true, create: true, download: true, restore: false, delete: false }],
    [['backups:read', 'backups:restore', 'backups:delete'], { list: true, create: false, download: true, restore: true, delete: true }],
    [['backups:create'], { list: false, create: true, download: false, restore: false, delete: false }],
    ['*', { list: true, create: true, download: true, restore: true, delete: true }]
  ])('shows the actions allowed by the permissions %j', async (roles, expected) => {
    setRoles(roles)
    await mountManager()
    expect(BackupService.getBackups).toHaveBeenCalledTimes(expected.list ? 1 : 0)
    const icons = wrapper.findAllComponents(QBtn).map((button) => button.props('icon'))
    expect(icons.includes('mdi-database-export')).toBe(expected.create)
    expect(icons.includes('mdi-upload')).toBe(expected.create)
    expect(icons.includes('mdi-download')).toBe(expected.download)
    expect(icons.includes('mdi-backup-restore')).toBe(expected.restore)
    expect(icons.includes('delete')).toBe(expected.delete)
  })
})

describe('display helpers', () => {
  it.each([
    [0, '1 KB'], [500, '1 KB'], [1536, '2 KB'], [1047552, '1023 KB'], [1048576, '1.0 MB'], [5.5 * 1048576, '5.5 MB'], [1073741824, '1024.0 MB']
  ])('formats %d bytes as %s', async (bytes, expected) => {
    await mountManager()
    expect(wrapper.vm.formatSize(bytes)).toBe(expected)
  })

  it('formats the dates and the categories', async () => {
    await mountManager()
    expect(wrapper.vm.formatDate(new Date(2024, 0, 31, 13, 5))).toBe('2024-01-31 13:05')
    expect(wrapper.vm.formatDate(null)).toBe('')
    expect(wrapper.vm.categoryList(['audits', 'images'])).toBe('Audits (findings, sections, comments), Images')
    expect(wrapper.vm.categoryList(null)).toBe('')
  })

  it('counts the documents of a category in a backup', async () => {
    await mountManager()
    const backup = BACKUPS[0]
    expect(wrapper.vm.countOf(backup, 'audits')).toBe(' (12)')
    expect(wrapper.vm.countOf(backup, 'vulnerabilities')).toBe(' (40)')
    expect(wrapper.vm.countOf(backup, 'languages')).toBe('') // collection not counted
    expect(wrapper.vm.countOf(backup, 'settings')).toBe('')
    expect(wrapper.vm.countOf({ collections: { Audit: 0 } }, 'audits')).toBe(' (0)')
    expect(wrapper.vm.countOf({}, 'audits')).toBe('')
  })
})

describe('creation of a backup', () => {
  async function openCreate(type = 'partial') {
    await mountManager()
    await wrapper.findAllComponents(QBtn).find((button) => button.props('icon') === 'mdi-database-export').trigger('click')
    wrapper.vm.create.type = type
    await flushPromises()
  }

  it('opens the dialog with a default name and all the data selected', async () => {
    await openCreate('full')
    expect(wrapper.vm.create).toMatchObject({ show: true, type: 'full', categories: [], password: '', confirm: '' })
    expect(wrapper.vm.create.name).toMatch(/^Backup \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
    expect(Object.keys(checkboxes())).toEqual([]) // No selection tree for a full backup
  })

  it('shows the selection tree of a partial backup, with a group checkbox for the groups of several categories', async () => {
    await openCreate()
    expect(Object.keys(checkboxes())).toEqual([
      'Audits (findings, sections, comments)', 'Vulnerabilities and proposals', 'Images', 'Users (password hashes and 2FA secrets)',
      'Customers', 'Companies', 'Clients', 'Report templates',
      'Custom data', 'Languages', 'Audit types', 'Vulnerability types', 'Vulnerability categories', 'Custom fields', 'Custom sections',
      'Settings'
    ])
  })

  it('selects the images with the audits and locks them while the audits are selected', async () => {
    await openCreate()
    await checkboxes()['Audits (findings, sections, comments)'].trigger('click')
    expect(wrapper.vm.create.categories).toEqual(['audits', 'images'])
    const images = checkboxes()['Images']
    expect(images.props('modelValue')).toBe(true)
    expect(images.props('disable')).toBe(true)
    expect(wrapper.vm.requiredBy('images', wrapper.vm.create.categories)).toEqual(['audits'])
    // Unchecking a locked category does nothing
    wrapper.vm.toggleCategory(wrapper.vm.create, 'images', false, true)
    expect(wrapper.vm.create.categories).toEqual(['audits', 'images'])
    // Images kept (and unlocked) when the audits are unchecked
    await checkboxes()['Audits (findings, sections, comments)'].trigger('click')
    expect(wrapper.vm.create.categories).toEqual(['images'])
    expect(checkboxes()['Images'].props('disable')).toBe(false)
    await checkboxes()['Images'].trigger('click')
    expect(wrapper.vm.create.categories).toEqual([])
  })

  it('keeps the images locked while the audits or the vulnerabilities need them', async () => {
    await openCreate()
    const { create, toggleCategory } = wrapper.vm
    toggleCategory(create, 'audits', true, true)
    toggleCategory(create, 'vulnerabilities', true, true)
    toggleCategory(create, 'audits', false, true)
    expect(create.categories).toEqual(['vulnerabilities', 'images'])
    expect(wrapper.vm.requiredBy('images', create.categories)).toEqual(['vulnerabilities'])
  })

  it('selects the companies with the clients', async () => {
    await openCreate()
    await checkboxes()['Clients'].trigger('click')
    expect(wrapper.vm.create.categories).toEqual(['companies', 'clients'])
    expect(checkboxes()['Companies'].props('disable')).toBe(true)
    expect(checkboxes()['Clients'].props('disable')).toBe(false)
  })

  it('keeps the categories in the order of the server, whatever the selection order', async () => {
    await openCreate()
    const { create, toggleCategory } = wrapper.vm
    for (const category of ['settings', 'users', 'templates', 'languages'])
      toggleCategory(create, category, true, true)
    expect(create.categories).toEqual(['users', 'templates', 'languages', 'settings'])
  })

  it('shows the state of a group: unchecked, partial (null) or checked', async () => {
    await openCreate()
    const customers = () => checkboxes()['Customers'].props('modelValue')
    expect(customers()).toBe(false)
    wrapper.vm.toggleCategory(wrapper.vm.create, 'companies', true, true)
    await flushPromises()
    expect(customers()).toBe(null)
    wrapper.vm.toggleCategory(wrapper.vm.create, 'clients', true, true)
    await flushPromises()
    expect(customers()).toBe(true)
  })

  it('selects a whole group, also when it is partially selected', async () => {
    await openCreate()
    await checkboxes()['Custom data'].trigger('click')
    expect(wrapper.vm.create.categories).toEqual(['languages', 'auditTypes', 'vulnerabilityTypes', 'vulnerabilityCategories', 'customFields', 'customSections'])
    await checkboxes()['Custom data'].trigger('click')
    expect(wrapper.vm.create.categories).toEqual([])
    wrapper.vm.toggleCategory(wrapper.vm.create, 'companies', true, true)
    wrapper.vm.toggleGroup(wrapper.vm.create, { key: 'customers', categories: ['companies', 'clients'] }, null, true)
    expect(wrapper.vm.create.categories).toEqual(['companies', 'clients'])
  })

  it('unselects a whole group whose categories depend on each other', async () => {
    await openCreate()
    await checkboxes()['Clients'].trigger('click')
    expect(checkboxes()['Customers'].props('modelValue')).toBe(true)
    await checkboxes()['Customers'].trigger('click')
    expect(wrapper.vm.create.categories).toEqual([])
  })

  it('disables the creation without selected data or with mismatching passwords', async () => {
    await openCreate()
    const createButton = () => buttonByLabel('Create the backup')
    expect(createButton().props('disable')).toBe(true)
    wrapper.vm.toggleCategory(wrapper.vm.create, 'users', true, true)
    await flushPromises()
    expect(createButton().props('disable')).toBe(false)
    wrapper.vm.create.password = 'S3cret!'
    await flushPromises()
    expect(createButton().props('disable')).toBe(true)
    wrapper.vm.create.confirm = 'S3cret'
    await flushPromises()
    expect(createButton().props('disable')).toBe(true)
    wrapper.vm.create.confirm = 'S3cret!'
    await flushPromises()
    expect(createButton().props('disable')).toBe(false)
    wrapper.vm.create.type = 'full'
    wrapper.vm.create.categories = []
    await flushPromises()
    expect(createButton().props('disable')).toBe(false)
  })

  it('creates a full backup (no categories sent), then refreshes the list', async () => {
    const notify = mockNotify()
    vi.spyOn(BackupService, 'createBackup').mockResolvedValue({ data: { datas: {} } })
    await openCreate('full')
    wrapper.vm.create.name = 'Before migration'
    wrapper.vm.toggleCategory(wrapper.vm.create, 'users', true, true) // Ignored for a full backup
    await buttonByLabel('Create the backup').trigger('click')
    await flushPromises()
    expect(BackupService.createBackup).toHaveBeenCalledWith('Before migration', null, '')
    expect(wrapper.vm.create.show).toBe(false)
    expect(lastNotification(notify)).toMatchObject({ message: 'Backup created', color: 'positive' })
    expect(BackupService.getBackups).toHaveBeenCalledTimes(2)
  })

  it('creates an encrypted partial backup and forgets the password', async () => {
    mockNotify()
    vi.spyOn(BackupService, 'createBackup').mockResolvedValue({ data: { datas: {} } })
    await openCreate()
    wrapper.vm.toggleCategory(wrapper.vm.create, 'clients', true, true)
    Object.assign(wrapper.vm.create, { name: 'Clients', password: 'S3cret!', confirm: 'S3cret!' })
    await wrapper.vm.createBackup()
    expect(BackupService.createBackup).toHaveBeenCalledWith('Clients', ['companies', 'clients'], 'S3cret!')
    expect(wrapper.vm.create).toMatchObject({ running: false, password: '', confirm: '' })
  })

  it('keeps the dialog open and notifies the error when the creation fails', async () => {
    const notify = mockNotify()
    vi.spyOn(BackupService, 'createBackup').mockRejectedValue({ message: 'Request failed', response: { data: { datas: 'Not enough disk space' } } })
    await openCreate('full')
    wrapper.vm.create.password = wrapper.vm.create.confirm = 'S3cret!'
    await wrapper.vm.createBackup()
    await flushPromises()
    expect(wrapper.vm.create).toMatchObject({ show: true, running: false, password: '', confirm: '' })
    expect(lastNotification(notify)).toMatchObject({ message: 'Not enough disk space', color: 'negative', timeout: 10000 })
    expect(BackupService.getBackups).toHaveBeenCalledTimes(1)
  })
})

describe('upload and download', () => {
  it('uploads the selected file with a progress bar, then refreshes the list', async () => {
    const notify = mockNotify()
    let progress
    vi.spyOn(BackupService, 'uploadBackup').mockImplementation((file, onProgress) => {
      progress = onProgress
      return new Promise((resolve) => setTimeout(() => resolve({ data: {} })))
    })
    await mountManager()
    const input = wrapper.find('input[type="file"]')
    expect(input.attributes('accept')).toBe('.zip,.enc')
    const file = new File(['PK'], 'backup.zip')
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
    await input.trigger('change')
    expect(BackupService.uploadBackup).toHaveBeenCalledWith(file, expect.any(Function))
    expect(wrapper.vm.upload.running).toBe(true)
    progress({ loaded: 25, total: 100 })
    expect(wrapper.vm.upload.progress).toBe(0.25)
    progress({ loaded: 50 }) // total unknown: unchanged
    expect(wrapper.vm.upload.progress).toBe(0.25)
    await new Promise((resolve) => setTimeout(resolve))
    await flushPromises()
    expect(wrapper.vm.upload.running).toBe(false)
    expect(lastNotification(notify)).toMatchObject({ message: 'backup.zip added to the backups', color: 'positive' })
    expect(BackupService.getBackups).toHaveBeenCalledTimes(2)
  })

  it('does nothing when no file is selected, and notifies the upload errors', async () => {
    const notify = mockNotify()
    vi.spyOn(BackupService, 'uploadBackup').mockRejectedValue({ message: 'Request failed', response: { data: { datas: 'Invalid backup file' } } })
    await mountManager()
    await wrapper.vm.uploadBackup({ target: { files: [] } })
    expect(BackupService.uploadBackup).not.toHaveBeenCalled()
    const target = { files: [new File(['x'], 'bad.zip')], value: 'C:\\fakepath\\bad.zip' }
    await wrapper.vm.uploadBackup({ target })
    await flushPromises()
    expect(target.value).toBe('') // The same file can be selected again
    expect(lastNotification(notify)).toMatchObject({ message: 'Invalid backup file', color: 'negative' })
    expect(wrapper.vm.upload.running).toBe(false)
  })

  it('downloads a backup with the file name of the server', async () => {
    const blob = new Blob(['PK'])
    vi.spyOn(BackupService, 'downloadBackup').mockResolvedValue({ data: blob, headers: { 'content-disposition': `attachment; filename="${encodeURIComponent('sauvegarde été.zip')}"` } })
    URL.createObjectURL = vi.fn(() => 'blob:backup')
    URL.revokeObjectURL = vi.fn()
    let link
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { link = { href: this.getAttribute('href'), download: this.download, inDocument: document.body.contains(this) } })
    await mountManager()
    await wrapper.vm.downloadBackup(BACKUPS[0])
    expect(BackupService.downloadBackup).toHaveBeenCalledWith(BACKUPS[0].id)
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob)
    expect(link).toEqual({ href: 'blob:backup', download: 'sauvegarde été.zip', inDocument: true })
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:backup')
    expect(document.querySelector('a[download]')).toBeNull()
    expect(wrapper.vm.downloading).toBeNull()
  })

  it('uses a default file name and notifies the download errors (Blob body)', async () => {
    const notify = mockNotify()
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    let downloadName
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { downloadName = this.download })
    vi.spyOn(BackupService, 'downloadBackup').mockResolvedValueOnce({ data: new Blob(['x']), headers: {} })
    await mountManager()
    await wrapper.vm.downloadBackup(BACKUPS[1])
    expect(downloadName).toBe('pwndoc-ng-backup.zip')
    const data = new Blob([JSON.stringify({ datas: 'Backup not found' })])
    BackupService.downloadBackup.mockRejectedValueOnce({ message: 'Request failed', response: { data } })
    await wrapper.vm.downloadBackup(BACKUPS[1])
    await flushPromises()
    expect(lastNotification(notify)).toMatchObject({ message: 'Backup not found', color: 'negative' })
    expect(wrapper.vm.downloading).toBeNull()
  })
})

describe('deletion', () => {
  it('asks for a confirmation, deletes the backup and refreshes the list', async () => {
    const dialogs = mockDialog()
    const notify = mockNotify()
    vi.spyOn(BackupService, 'deleteBackup').mockResolvedValue({})
    await mountManager()
    const deleteButtons = wrapper.findAllComponents(QBtn).filter((button) => button.props('icon') === 'delete')
    await deleteButtons[1].trigger('click')
    expect(dialogs).toHaveLength(1)
    expect(dialogs[0].options).toMatchObject({ title: 'Delete the backup?', message: 'The backup Customers only will be deleted from the server.' })
    expect(BackupService.deleteBackup).not.toHaveBeenCalled()
    dialogs[0].ok()
    await flushPromises()
    expect(BackupService.deleteBackup).toHaveBeenCalledWith(BACKUPS[1].id)
    expect(lastNotification(notify)).toMatchObject({ message: 'Backup deleted', color: 'positive' })
    expect(BackupService.getBackups).toHaveBeenCalledTimes(2)
  })

  it('does nothing when the deletion is cancelled', async () => {
    const dialogs = mockDialog()
    vi.spyOn(BackupService, 'deleteBackup')
    await mountManager()
    wrapper.vm.deleteBackup(BACKUPS[0])
    dialogs[0].cancel()
    expect(BackupService.deleteBackup).not.toHaveBeenCalled()
  })
})

describe('restore', () => {
  const RESULT = { categories: ['companies', 'clients'], collections: { Company: 2, Client: 5 }, templates: 0 }

  async function openRestore(backup) {
    await mountManager()
    wrapper.vm.openRestore(backup)
    await flushPromises()
  }

  it('opens the restore dialog with the categories of the backup, in merge mode', async () => {
    await openRestore(BACKUPS[1])
    expect(wrapper.vm.restore).toMatchObject({ show: true, mode: 'merge', categories: ['companies', 'clients'], password: '' })
    expect(wrapper.vm.restore.categories).not.toBe(BACKUPS[1].categories) // Copy: the backup is not modified
    expect(Object.keys(checkboxes())).toEqual(['Customers', 'Companies (2)', 'Clients (5)'])
    expect(document.body.textContent).toContain('Restore Customers only')
  })

  it('lets restore a category without its dependencies (they are already in the database)', async () => {
    await openRestore(BACKUPS[0])
    wrapper.vm.toggleCategory(wrapper.vm.restore, 'images', false, false)
    expect(wrapper.vm.restore.categories).toContain('audits')
    expect(wrapper.vm.restore.categories).not.toContain('images')
  })

  it('restores in merge mode without confirmation', async () => {
    const dialogs = mockDialog()
    const notify = mockNotify()
    vi.spyOn(BackupService, 'restoreBackup').mockResolvedValue({ data: { datas: RESULT } })
    await openRestore(BACKUPS[1])
    wrapper.vm.toggleCategory(wrapper.vm.restore, 'companies', false, false)
    await buttonByLabel('Restore').trigger('click')
    await flushPromises()
    expect(dialogs).toHaveLength(0)
    expect(BackupService.restoreBackup).toHaveBeenCalledWith(BACKUPS[1].id, 'merge', ['clients'], '')
    expect(wrapper.vm.restore.show).toBe(false)
    expect(lastNotification(notify)).toMatchObject({ message: '7 documents and 0 report templates restored', color: 'positive' })
    expect(BackupService.getBackups).toHaveBeenCalledTimes(2)
  })

  it('asks for a confirmation listing the replaced data in replace mode', async () => {
    const dialogs = mockDialog()
    mockNotify()
    vi.spyOn(BackupService, 'restoreBackup').mockResolvedValue({ data: { datas: RESULT } })
    await openRestore(BACKUPS[1])
    wrapper.vm.restore.mode = 'replace'
    await flushPromises()
    expect(document.body.textContent).toContain('The current data of the selected categories is lost')
    wrapper.vm.confirmRestore()
    expect(dialogs[0].options).toMatchObject({ title: 'Replace the current data?', persistent: true })
    expect(dialogs[0].options.message).toBe('The current data will be replaced by the content of the backup: Companies, Clients. This action is definitive.')
    expect(BackupService.restoreBackup).not.toHaveBeenCalled()
    dialogs[0].ok()
    await flushPromises()
    expect(BackupService.restoreBackup).toHaveBeenCalledWith(BACKUPS[1].id, 'replace', ['companies', 'clients'], '')
  })

  it('restores all the data of an encrypted backup of unknown content, with its password', async () => {
    const dialogs = mockDialog()
    mockNotify()
    vi.spyOn(BackupService, 'restoreBackup').mockResolvedValue({ data: { datas: RESULT } })
    await openRestore(BACKUPS[2])
    expect(Object.keys(checkboxes())).toEqual([])
    expect(document.body.textContent).toContain('The content of this backup is known once decrypted')
    expect(buttonByLabel('Restore').props('disable')).toBe(true) // Password required
    wrapper.vm.restore.password = 'S3cret!'
    wrapper.vm.restore.mode = 'replace'
    await flushPromises()
    expect(buttonByLabel('Restore').props('disable')).toBe(false)
    wrapper.vm.confirmRestore()
    expect(dialogs[0].options.message).toContain('Audits (findings, sections, comments), Vulnerabilities and proposals, Images, Users')
    dialogs[0].ok()
    await flushPromises()
    expect(BackupService.restoreBackup).toHaveBeenCalledWith(BACKUPS[2].id, 'replace', undefined, 'S3cret!')
    expect(wrapper.vm.restore.password).toBe('')
  })

  it('disables the restore when no category is selected', async () => {
    await openRestore(BACKUPS[1])
    wrapper.vm.restore.categories = []
    await flushPromises()
    expect(buttonByLabel('Restore').props('disable')).toBe(true)
  })

  it('asks to log in again when the users have been restored', async () => {
    const dialogs = mockDialog()
    const notify = mockNotify()
    vi.spyOn(UserService, 'destroyToken').mockImplementation(() => {})
    vi.spyOn(BackupService, 'restoreBackup').mockResolvedValue({ data: { datas: { categories: ['users', 'settings'], collections: { User: 3, Settings: 1 }, templates: 2 } } })
    await openRestore(BACKUPS[0])
    await wrapper.vm.restoreBackup()
    expect(notify).not.toHaveBeenCalled()
    expect(dialogs[0].options).toMatchObject({ title: 'Restore completed', message: '4 documents and 2 report templates restored. Users have been restored: log in again.', persistent: true })
    expect(UserService.destroyToken).not.toHaveBeenCalled()
    dialogs[0].ok()
    expect(UserService.destroyToken).toHaveBeenCalled()
  })

  it('keeps the dialog open and notifies the restore errors', async () => {
    const notify = mockNotify()
    vi.spyOn(BackupService, 'restoreBackup').mockRejectedValue({ message: 'Request failed', response: { data: { datas: 'Wrong password' } } })
    await openRestore(BACKUPS[2])
    wrapper.vm.restore.password = 'bad'
    await wrapper.vm.restoreBackup()
    await flushPromises()
    expect(wrapper.vm.restore).toMatchObject({ show: true, running: false, password: '' })
    expect(lastNotification(notify)).toMatchObject({ message: 'Wrong password', color: 'negative' })
  })
})
