// API services: HTTP method, URL, body and options sent to the backend (axios instance of boot/axios mocked)
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('boot/axios', () => import('../../helpers/api-mock'))
vi.mock('@/router', () => ({ default: { push: vi.fn() } }))

import { api, resetApi, lastCall } from '../../helpers/api-mock'
import AuditService from '@/services/audit'
import ClientService from '@/services/client'
import CollabService from '@/services/collaborator'
import CompanyService from '@/services/company'
import DataService from '@/services/data'
import ImageService from '@/services/image'
import ReviewerService from '@/services/reviewer'
import SettingsService from '@/services/settings'
import TemplateService from '@/services/template'
import VulnerabilityService from '@/services/vulnerability'
import BackupService from '@/services/backup'
import UserService from '@/services/user'

const BODY = { some: 'data' }

// [service name, service, function, arguments, expected HTTP method, expected axios arguments]
const CASES = [
  // Audits
  ['audit', AuditService, 'getAudits', [], 'get', ['audits?']],
  ['audit', AuditService, 'getAudits', [{ findingTitle: 'XSS' }], 'get', ['audits?findingTitle=XSS']],
  ['audit', AuditService, 'getAudit', ['a1'], 'get', ['audits/a1']],
  ['audit', AuditService, 'createAudit', [BODY], 'post', ['audits', BODY]],
  ['audit', AuditService, 'createClonedAudit', ['a1', 'Copy'], 'post', ['audits/a1/clone', { name: 'Copy' }]],
  ['audit', AuditService, 'deleteAudit', ['a1'], 'delete', ['audits/a1']],
  ['audit', AuditService, 'getAuditGeneral', ['a1'], 'get', ['audits/a1/general']],
  ['audit', AuditService, 'updateAuditGeneral', ['a1', BODY], 'put', ['audits/a1/general', BODY]],
  ['audit', AuditService, 'getAuditNetwork', ['a1'], 'get', ['audits/a1/network']],
  ['audit', AuditService, 'updateAuditNetwork', ['a1', BODY], 'put', ['audits/a1/network', BODY]],
  ['audit', AuditService, 'createFinding', ['a1', BODY], 'post', ['audits/a1/findings', BODY]],
  ['audit', AuditService, 'getFinding', ['a1', 'f1'], 'get', ['audits/a1/findings/f1']],
  ['audit', AuditService, 'updateFinding', ['a1', 'f1', BODY], 'put', ['audits/a1/findings/f1', BODY]],
  ['audit', AuditService, 'deleteFinding', ['a1', 'f1'], 'delete', ['audits/a1/findings/f1']],
  ['audit', AuditService, 'getSection', ['a1', 's1'], 'get', ['audits/a1/sections/s1']],
  ['audit', AuditService, 'updateSection', ['a1', 's1', BODY], 'put', ['audits/a1/sections/s1', BODY]],
  ['audit', AuditService, 'getAuditTypes', [], 'get', ['audits/types']],
  ['audit', AuditService, 'generateAuditReport', ['a1'], 'get', ['audits/a1/generate', { responseType: 'blob' }]],
  ['audit', AuditService, 'updateAuditSortFindings', ['a1', BODY], 'put', ['audits/a1/sortfindings', BODY]],
  ['audit', AuditService, 'updateAuditFindingPosition', ['a1', BODY], 'put', ['audits/a1/movefinding', BODY]],
  ['audit', AuditService, 'toggleApproval', ['a1', { approved: true }], 'put', ['audits/a1/toggleApproval', { approved: true }]],
  ['audit', AuditService, 'updateReadyForReview', ['a1', BODY], 'put', ['audits/a1/updateReadyForReview', BODY]],
  ['audit', AuditService, 'getComments', ['a1'], 'get', ['audits/a1/comments']],
  ['audit', AuditService, 'createComment', ['a1', BODY], 'post', ['audits/a1/comments', BODY]],
  ['audit', AuditService, 'replyComment', ['a1', 'c1', 'Hello'], 'post', ['audits/a1/comments/c1/replies', { text: 'Hello' }]],
  ['audit', AuditService, 'updateComment', ['a1', 'c1', { resolved: true }], 'put', ['audits/a1/comments/c1', { resolved: true }]],
  ['audit', AuditService, 'deleteComment', ['a1', 'c1'], 'delete', ['audits/a1/comments/c1']],
  // Clients, companies, collaborators
  ['client', ClientService, 'getClients', [], 'get', ['clients']],
  ['client', ClientService, 'exportClients', [], 'get', ['clients/export']],
  ['client', ClientService, 'createClients', [BODY], 'post', ['clients', BODY]],
  ['client', ClientService, 'updateClient', ['c1', BODY], 'put', ['clients/c1', BODY]],
  ['client', ClientService, 'deleteClient', ['c1'], 'delete', ['clients/c1']],
  ['client', ClientService, 'deleteAllClients', [], 'delete', ['clients']],
  ['company', CompanyService, 'getCompanies', [], 'get', ['companies']],
  ['company', CompanyService, 'exportCompanies', [], 'get', ['companies/export']],
  ['company', CompanyService, 'createCompanies', [BODY], 'post', ['companies', BODY]],
  ['company', CompanyService, 'updateCompany', ['c1', BODY], 'put', ['companies/c1', BODY]],
  ['company', CompanyService, 'deleteCompany', ['c1'], 'delete', ['companies/c1']],
  ['company', CompanyService, 'deleteAllCompanies', [], 'delete', ['companies']],
  ['collaborator', CollabService, 'getCollabs', [], 'get', ['users']],
  ['collaborator', CollabService, 'createCollab', [BODY], 'post', ['users', BODY]],
  ['collaborator', CollabService, 'updateCollab', ['u1', BODY], 'put', ['users/u1', BODY]],
  ['collaborator', CollabService, 'deleteCollab', ['u1'], 'delete', ['users/u1']],
  ['collaborator', CollabService, 'deleteAllCollab', [], 'delete', ['users']],
  // Custom data
  ['data', DataService, 'getRoles', [], 'get', ['data/roles']],
  ['data', DataService, 'getLanguages', [], 'get', ['data/languages']],
  ['data', DataService, 'createLanguage', [BODY], 'post', ['data/languages', BODY]],
  ['data', DataService, 'deleteLanguage', ['fr'], 'delete', ['data/languages/fr']],
  ['data', DataService, 'updateLanguages', [BODY], 'put', ['data/languages', BODY]],
  ['data', DataService, 'getAuditTypes', [], 'get', ['data/audit-types']],
  ['data', DataService, 'createAuditType', [BODY], 'post', ['data/audit-types', BODY]],
  ['data', DataService, 'deleteAuditType', ['Pentest'], 'delete', ['data/audit-types/Pentest']],
  ['data', DataService, 'updateAuditTypes', [BODY], 'put', ['data/audit-types', BODY]],
  ['data', DataService, 'getVulnerabilityTypes', [], 'get', ['data/vulnerability-types']],
  ['data', DataService, 'createVulnerabilityType', [BODY], 'post', ['data/vulnerability-types', BODY]],
  ['data', DataService, 'deleteVulnerabilityType', ['Web/API & co', 'en'], 'delete', ['data/vulnerability-types/Web%2FAPI%20%26%20co', { params: { locale: 'en' } }]],
  ['data', DataService, 'updateVulnTypes', [BODY], 'put', ['data/vulnerability-types', BODY]],
  ['data', DataService, 'getVulnerabilityCategories', [], 'get', ['data/vulnerability-categories']],
  ['data', DataService, 'createVulnerabilityCategory', [BODY], 'post', ['data/vulnerability-categories', BODY]],
  ['data', DataService, 'updateVulnerabilityCategories', [BODY], 'put', ['data/vulnerability-categories/', BODY]],
  ['data', DataService, 'deleteVulnerabilityCategory', ['Web'], 'delete', ['data/vulnerability-categories/Web']],
  ['data', DataService, 'getCustomFields', [], 'get', ['data/custom-fields']],
  ['data', DataService, 'createCustomField', [BODY], 'post', ['data/custom-fields', BODY]],
  ['data', DataService, 'updateCustomFields', [BODY], 'put', ['data/custom-fields/', BODY]],
  ['data', DataService, 'deleteCustomField', ['cf1'], 'delete', ['data/custom-fields/cf1']],
  ['data', DataService, 'getSections', [], 'get', ['data/sections']],
  ['data', DataService, 'getSectionsByLanguage', ['fr'], 'get', ['data/sections/fr']],
  ['data', DataService, 'createSection', [BODY], 'post', ['data/sections', BODY]],
  ['data', DataService, 'deleteSection', ['intro', 'fr'], 'delete', ['data/sections/intro/fr']],
  ['data', DataService, 'updateSections', [BODY], 'put', ['data/sections', BODY]],
  // Images, reviewers, settings, templates
  ['image', ImageService, 'getImage', ['i1'], 'get', ['images/i1']],
  ['image', ImageService, 'createImage', [BODY], 'post', ['images', BODY]],
  ['image', ImageService, 'deleteImage', ['i1'], 'delete', ['images/i1']],
  ['reviewer', ReviewerService, 'getReviewers', [], 'get', ['users/reviewers']],
  ['settings', SettingsService, 'getSettings', [], 'get', ['settings']],
  ['settings', SettingsService, 'getPublicSettings', [], 'get', ['settings/public']],
  ['settings', SettingsService, 'updateSettings', [BODY], 'put', ['settings', BODY]],
  ['settings', SettingsService, 'exportSettings', [], 'get', ['settings/export']],
  ['settings', SettingsService, 'revertDefaults', [], 'put', ['settings/revert']],
  ['template', TemplateService, 'getTemplates', [], 'get', ['templates']],
  ['template', TemplateService, 'createTemplate', [BODY], 'post', ['templates', BODY]],
  ['template', TemplateService, 'updateTemplate', ['t1', BODY], 'put', ['templates/t1', BODY]],
  ['template', TemplateService, 'deleteTemplate', ['t1'], 'delete', ['templates/t1']],
  ['template', TemplateService, 'downloadTemplate', ['t1'], 'get', ['templates/download/t1', { responseType: 'blob' }]],
  // Vulnerabilities and proposals
  ['vulnerability', VulnerabilityService, 'getVulnerabilities', [], 'get', ['vulnerabilities']],
  ['vulnerability', VulnerabilityService, 'exportVulnerabilities', [], 'get', ['vulnerabilities/export']],
  ['vulnerability', VulnerabilityService, 'getVulnByLanguage', ['fr'], 'get', ['vulnerabilities/fr']],
  ['vulnerability', VulnerabilityService, 'createVulnerabilities', [[BODY]], 'post', ['vulnerabilities', [BODY]]],
  ['vulnerability', VulnerabilityService, 'deleteVulnerability', ['v1'], 'delete', ['vulnerabilities/v1']],
  ['vulnerability', VulnerabilityService, 'deleteAllVulnerabilities', [], 'delete', ['vulnerabilities']],
  ['vulnerability', VulnerabilityService, 'updateVulnerability', ['v1', BODY], 'put', ['vulnerabilities/v1', BODY]],
  ['vulnerability', VulnerabilityService, 'backupFinding', ['fr', BODY], 'post', ['vulnerabilities/finding/fr', BODY]],
  ['vulnerability', VulnerabilityService, 'getProposals', [{ status: 'pending' }], 'get', ['vulnerability-proposals', { params: { status: 'pending' } }]],
  ['vulnerability', VulnerabilityService, 'getProposalsCount', [], 'get', ['vulnerability-proposals/count']],
  ['vulnerability', VulnerabilityService, 'getFindingProposal', ['f1'], 'get', ['vulnerability-proposals/finding/f1']],
  ['vulnerability', VulnerabilityService, 'getProposal', ['p1'], 'get', ['vulnerability-proposals/p1']],
  ['vulnerability', VulnerabilityService, 'acceptProposal', ['p1', ['title']], 'put', ['vulnerability-proposals/p1/accept', { fields: ['title'] }]],
  ['vulnerability', VulnerabilityService, 'rejectProposal', ['p1', 'No'], 'put', ['vulnerability-proposals/p1/reject', { comment: 'No' }]],
  ['vulnerability', VulnerabilityService, 'withdrawProposal', ['p1'], 'delete', ['vulnerability-proposals/p1']],
  ['vulnerability', VulnerabilityService, 'archiveVulnerability', ['v1', true], 'put', ['vulnerabilities/v1/archive', { archived: true }]],
  ['vulnerability', VulnerabilityService, 'mergeVulnerability', ['v1', 'v2', 'fr'], 'put', ['vulnerabilities/merge/v1', { vulnId: 'v2', locale: 'fr' }]],
  // Backups
  ['backup', BackupService, 'getBackups', [], 'get', ['backups']],
  ['backup', BackupService, 'createBackup', ['Weekly', null, ''], 'post', ['backups', { name: 'Weekly', categories: undefined, password: undefined }, { timeout: 0 }]],
  ['backup', BackupService, 'createBackup', ['Partial', ['audits', 'images'], 'S3cret!'], 'post', ['backups', { name: 'Partial', categories: ['audits', 'images'], password: 'S3cret!' }, { timeout: 0 }]],
  ['backup', BackupService, 'restoreBackup', ['b1', 'merge', ['users'], ''], 'post', ['backups/b1/restore', { mode: 'merge', categories: ['users'], password: undefined }, { timeout: 0 }]],
  ['backup', BackupService, 'restoreBackup', ['b1', 'replace', undefined, 'pwd'], 'post', ['backups/b1/restore', { mode: 'replace', categories: undefined, password: 'pwd' }, { timeout: 0 }]],
  ['backup', BackupService, 'deleteBackup', ['b1'], 'delete', ['backups/b1']],
  // Users (requests without token handling)
  ['user', UserService, 'isInit', [], 'get', ['users/init', { timeout: 10000 }]],
  ['user', UserService, 'exportUsers', [], 'get', ['users/export']],
  ['user', UserService, 'getProfile', [], 'get', ['users/me']],
  ['user', UserService, 'updateProfile', [BODY], 'put', ['users/me', BODY]],
  ['user', UserService, 'getTotpQrCode', [], 'get', ['users/totp']],
  ['user', UserService, 'setupTotp', ['123456', 'SECRET'], 'post', ['users/totp', { totpToken: '123456', totpSecret: 'SECRET' }]],
  ['user', UserService, 'cancelTotp', ['123456'], 'delete', ['users/totp', { data: { totpToken: '123456' } }]]
]

describe('API services', () => {
  beforeEach(() => resetApi())

  const cases = CASES.map(([name, service, fn, args, method, expected]) => ({ name, service, fn, args, method, expected, url: expected[0] }))

  it.each(cases)('$name.$fn -> $method $url', ({ service, fn, args, method, expected }) => {
    const result = service[fn](...args)
    const call = lastCall()
    expect(call.method).toBe(method)
    expect(call.args).toEqual(expected)
    expect(Object.values(api).reduce((count, f) => count + f.mock.calls.length, 0)).toBe(1)
    // The promise of axios is returned to the caller
    expect(result).toBeInstanceOf(Promise)
  })

  it('uses relative URLs (resolved against the /api base URL of the axios instance)', () => {
    for (const [, service, fn, args] of CASES) {
      resetApi()
      service[fn](...args)
      expect(lastCall().args[0]).not.toMatch(/^\/|^https?:/)
    }
  })

  it('returns the response of axios', async () => {
    api.get.mockResolvedValueOnce({ data: { datas: [{ _id: 'a1' }] } })
    await expect(AuditService.getAudit('a1')).resolves.toEqual({ data: { datas: [{ _id: 'a1' }] } })
  })

  it('encodes the finding title in the query string of getAudits', () => {
    AuditService.getAudits({ findingTitle: 'XSS & CSRF #1' })
    expect(lastCall().args[0]).toBe(`audits?findingTitle=${encodeURIComponent('XSS & CSRF #1')}`)
  })
})

describe('BackupService upload and download', () => {
  beforeEach(() => resetApi())

  it('uploads the raw file with its encoded name in a header and no timeout', () => {
    const file = new File(['zip content'], 'backup été #1.zip', { type: 'application/zip' })
    const onProgress = vi.fn()
    BackupService.uploadBackup(file, onProgress)
    const [url, body, options] = lastCall().args
    expect(lastCall().method).toBe('post')
    expect(url).toBe('backups/upload')
    expect(body).toBe(file)
    expect(options).toEqual({
      headers: { 'Content-Type': 'application/octet-stream', 'X-Backup-Filename': encodeURIComponent('backup été #1.zip') },
      timeout: 0,
      onUploadProgress: onProgress
    })
    // Header values must be ASCII
    expect(options.headers['X-Backup-Filename']).toMatch(/^[\x20-\x7e]+$/)
  })

  it('downloads a backup as a Blob with a progress callback and no timeout', () => {
    const onProgress = vi.fn()
    BackupService.downloadBackup('b1', onProgress)
    expect(lastCall().method).toBe('get')
    expect(lastCall().args).toEqual(['backups/b1/download', { responseType: 'blob', timeout: 0, onDownloadProgress: onProgress }])
  })

  it('reads the error message of a JSON response', async () => {
    await expect(BackupService.errorMessage({ message: 'Request failed', response: { data: { datas: 'Wrong password' } } }))
      .resolves.toBe('Wrong password')
  })

  it('reads the error message of a Blob response (downloads)', async () => {
    const data = new Blob([JSON.stringify({ status: 'error', datas: 'Backup not found' })], { type: 'application/json' })
    await expect(BackupService.errorMessage({ message: 'Request failed', response: { data } })).resolves.toBe('Backup not found')
  })

  it('falls back to the error message when the body is not usable', async () => {
    const data = new Blob(['<html>Bad gateway</html>'], { type: 'text/html' })
    await expect(BackupService.errorMessage({ message: 'Request failed with status code 502', response: { data } }))
      .resolves.toBe('Request failed with status code 502')
    await expect(BackupService.errorMessage({ message: 'Network Error' })).resolves.toBe('Network Error')
  })
})
