// Mock of the axios instance of boot/axios (no network request in the tests):
//   vi.mock('boot/axios', () => import('../helpers/api-mock'))
import { vi } from 'vitest'

const ok = () => Promise.resolve({ data: { datas: [] }, headers: {} })

export const api = {
  get: vi.fn(ok),
  post: vi.fn(ok),
  put: vi.fn(ok),
  delete: vi.fn(ok),
  request: vi.fn(ok)
}

// Restores the default behaviour (resolved promise) and clears the calls
export function resetApi() {
  for (const method of Object.values(api)) {
    method.mockReset()
    method.mockImplementation(ok)
  }
}

// Last call of the API: {method, args}
export function lastCall() {
  const calls = Object.entries(api).flatMap(([method, fn]) =>
    fn.mock.calls.map((args, index) => ({ method, args, order: fn.mock.invocationCallOrder[index] })))
  calls.sort((a, b) => a.order - b.order)
  return calls[calls.length - 1]
}

export default { api }
