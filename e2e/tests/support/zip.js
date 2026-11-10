// Minimal reader of ZIP archives (docx files, backups): list of the entries and content of one entry.
// Only the "stored" and "deflate" methods are supported (enough for Office documents).
const zlib = require('zlib')

function readEntries (buffer) {
  // End of central directory record: searched from the end (comment of variable length)
  let eocd = -1
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('Not a ZIP archive (end of central directory not found)')
  const count = buffer.readUInt16LE(eocd + 10)
  let offset = buffer.readUInt32LE(eocd + 16)
  const entries = []
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('Corrupted central directory')
    const method = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localOffset = buffer.readUInt32LE(offset + 42)
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength)
    entries.push({ name, method, compressedSize, localOffset })
    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

function readEntry (buffer, entry) {
  const local = entry.localOffset
  if (buffer.readUInt32LE(local) !== 0x04034b50) throw new Error(`Corrupted local header of ${entry.name}`)
  const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28)
  const data = buffer.subarray(start, start + entry.compressedSize)
  if (entry.method === 0) return data
  if (entry.method === 8) return zlib.inflateRawSync(data)
  throw new Error(`Unsupported compression method ${entry.method} (${entry.name})`)
}

function unzip (buffer) {
  const entries = readEntries(buffer)
  return {
    names: entries.map(e => e.name),
    read: name => {
      const entry = entries.find(e => e.name === name)
      if (!entry) throw new Error(`${name} not found in the archive`)
      return readEntry(buffer, entry)
    }
  }
}

module.exports = { unzip }
