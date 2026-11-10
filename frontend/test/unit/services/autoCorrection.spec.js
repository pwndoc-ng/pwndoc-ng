// services/autoCorrection.js: auto correction setting kept in the session storage
import { describe, it, expect, vi, beforeEach } from 'vitest'

async function freshService() {
  vi.resetModules()
  return (await import('@/services/autoCorrection')).default
}

describe('AutoCorrectionService', () => {
  beforeEach(() => sessionStorage.clear())

  it('is enabled by default', async () => {
    const service = await freshService()
    expect(service.isAutoCorrectionEnabled()).toBe(true)
  })

  it('saves the choice in the session storage', async () => {
    const service = await freshService()
    service.disable()
    expect(service.isAutoCorrectionEnabled()).toBe(false)
    expect(sessionStorage.getItem('autoCorrectionEnabled')).toBe('false')
    service.enable()
    expect(service.isAutoCorrectionEnabled()).toBe(true)
    expect(sessionStorage.getItem('autoCorrectionEnabled')).toBe('true')
  })

  it('restores the saved choice when the application is loaded again', async () => {
    sessionStorage.setItem('autoCorrectionEnabled', 'false')
    expect((await freshService()).isAutoCorrectionEnabled()).toBe(false)
    sessionStorage.setItem('autoCorrectionEnabled', 'true')
    expect((await freshService()).isAutoCorrectionEnabled()).toBe(true)
  })
})
