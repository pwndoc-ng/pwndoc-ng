// Access to the source files of the frontend (static checks of the templates and scripts)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// (string given to fileURLToPath: the URL global is the one of jsdom in the tests)
export const FRONTEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const SRC_DIR = path.join(FRONTEND_DIR, 'src')

// Files of src/ with one of the extensions (paths relative to src/)
export function sourceFiles(extensions = ['.js', '.vue', '.html']) {
  const files = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (extensions.includes(path.extname(entry.name))) files.push(path.relative(SRC_DIR, full))
    }
  }
  walk(SRC_DIR)
  return files.sort()
}

export function readSource(relativePath) {
  return fs.readFileSync(path.join(SRC_DIR, relativePath), 'utf8')
}

// Flat view of nested i18n messages: {'btn.cancel': 'Cancel', ...}
export function flattenMessages(messages, prefix = '', result = {}) {
  for (const [key, value] of Object.entries(messages)) {
    const fullKey = prefix ? `${prefix}.${key}` : key
    if (value !== null && typeof value === 'object') flattenMessages(value, fullKey, result)
    else result[fullKey] = value
  }
  return result
}
