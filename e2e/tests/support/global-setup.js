// Waits until the whole chain answers: nginx (frontend) -> backend -> MongoDB
const { request } = require('@playwright/test')

module.exports = async (config) => {
  const baseURL = config.projects[0].use.baseURL
  const api = await request.newContext({ baseURL, ignoreHTTPSErrors: true })
  const deadline = Date.now() + 180_000
  let lastError = ''
  while (Date.now() < deadline) {
    try {
      const response = await api.get('/api/users/init', { timeout: 5000 })
      if (response.ok()) {
        await api.dispose()
        return
      }
      lastError = `HTTP ${response.status()}`
    } catch (err) {
      lastError = err.message
    }
    await new Promise(resolve => setTimeout(resolve, 2000))
  }
  await api.dispose()
  throw new Error(`pwndoc-ng is not reachable at ${baseURL}: ${lastError}`)
}
