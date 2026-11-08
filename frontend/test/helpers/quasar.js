// Mocks of the Quasar plugins used by the components (Dialog, Notify)
import { vi } from 'vitest'
import { Dialog, Notify } from 'quasar'

// Dialog.create replaced by a fake dialog: the test answers it with dialog.ok(value) / dialog.cancel()
export function mockDialog() {
  const dialogs = []
  vi.spyOn(Dialog, 'create').mockImplementation((options) => {
    const handlers = {}
    const dialog = {
      options,
      onOk(fn) { handlers.ok = fn; return dialog },
      onCancel(fn) { handlers.cancel = fn; return dialog },
      onDismiss(fn) { handlers.dismiss = fn; return dialog },
      hide() { return dialog },
      update() { return dialog },
      ok: (value) => handlers.ok && handlers.ok(value),
      cancel: () => handlers.cancel && handlers.cancel()
    }
    dialogs.push(dialog)
    return dialog
  })
  return dialogs
}

// Notify.create replaced by a spy (returns the update function of the notification)
export function mockNotify() {
  return vi.spyOn(Notify, 'create').mockImplementation(() => vi.fn())
}

// Options of the last notification
export function lastNotification(spy) {
  return spy.mock.calls[spy.mock.calls.length - 1][0]
}
