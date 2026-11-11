// Filename whitelist validation for template creation
function validFilename(filename) {
  const regex = /^[\p{Letter}\p{Mark}0-9 \[\]'()_-]+$/iu;
    
    return (regex.test(filename));
}
exports.validFilename = validFilename;

function validExtension(ext) {
  const regex = /^[a-zA-Z]+$/;
    
    return (regex.test(ext));
}
exports.validExtension = validExtension;

// Escape XML special entities when using {@RawXML} in template generation
function escapeXMLEntities(input) {
    var XML_CHAR_MAP = { '<': '&lt;', '>': '&gt;', '&': '&amp;'};
    var standardEncode = input.replace(/[<>&]/g, function (ch) { return XML_CHAR_MAP[ch]; });
    return standardEncode;
}
exports.escapeXMLEntities = escapeXMLEntities;

// Convert number to 3 digits format if under 100
function lPad(number) {
    if (number <= 99) { number = ("00" + number).slice(-3); }
    return `${number}`;
}
exports.lPad = lPad;

function escapeRegex(regex) {
    return regex.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')
}
exports.escapeRegex = escapeRegex

function generateUUID() {
    return require('crypto').randomBytes(32).toString('hex')
}
exports.generateUUID = generateUUID

var getObjectPaths = (obj, prefix = '') =>
  Object.keys(obj).reduce((res, el) => {
    if( Array.isArray(obj[el]) ) {
      return [...res, prefix + el];
    } else if( typeof obj[el] === 'object' && obj[el] !== null ) {
      return [...res, ...getObjectPaths(obj[el], prefix + el + '.')];
    }
    return [...res, prefix + el];
  }, [])
exports.getObjectPaths = getObjectPaths

function getSockets(io, room) {
  var result = []
  io.sockets.sockets.forEach((data) => {
    if (data.rooms.has(room)) {
      result.push(data)
    }
  })
  return result
}
exports.getSockets = getSockets

// Replaces all the documents of a collection by a new list (pages of the custom data: languages, audit types...).
// If the new list cannot be inserted (duplicate values, invalid values), the previous documents are put back.
async function replaceAll(Model, documents) {
  var previous = await Model.find({}).lean()
  await Model.deleteMany({})
  try {
    await Model.insertMany(documents)
  }
  catch (err) {
    await Model.deleteMany({})
    if (previous.length > 0)
      await Model.collection.insertMany(previous)
    if (err.code === 11000 || err.name === 'ValidationError')
      throw {fn: 'BadParameters', message: err.code === 11000 ? 'Duplicate values in the list' : err.message}
    throw err
  }
}
exports.replaceAll = replaceAll

// Type checks of the request bodies (values of the wrong type must be refused, not stored nor thrown as 500)
function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
exports.isObject = isObject

function isListOfObjects(value) {
  return Array.isArray(value) && value.every(isObject)
}
exports.isListOfObjects = isListOfObjects

// Strings that are optional: undefined or null allowed
function isOptionalString(value) {
  return value === undefined || value === null || typeof value === 'string'
}
exports.isOptionalString = isOptionalString

// Custom fields of an audit, finding or section: [{customField: <id> or {_id: <id>, label...}, text}].
// The customField reference is Mixed in the schema: a value that is not an identifier made the audit unreadable
function validCustomFields(list) {
  var mongoose = require('mongoose')
  var isId = (value) => mongoose.isObjectIdOrHexString(isObject(value) ? value._id : value)
  return Array.isArray(list) && list.every(entry => isObject(entry) && isId(entry.customField))
}
exports.validCustomFields = validCustomFields

// Documents of a list checked before inserting any of them: an invalid document refuses the whole list (insertMany with
// ordered: false inserted the valid ones and dropped or refused the others). A single document is accepted, as by insertMany
function validateAll(Model, documents) {
  [].concat(documents).forEach(document => {
    var error = new Model(document).validateSync()
    if (error)
      throw error
  })
}
exports.validateAll = validateAll

// Task of the start of the server run once the database is connected (connection: mongoose.connection). The connection is
// retried while the database is not available (container starting, migration of the data to a new MongoDB version: see
// app.js): the operations sent meanwhile would fail after 10 seconds and the task would be lost until the next start. Errors
// of the task are logged. Returns a promise of the end of the task.
function whenConnected(name, task, connection) {
    connection = connection || require('mongoose').connection
    var run = () => Promise.resolve().then(task).catch(err => console.error(`${name} failed:`, (err && err.message) || err))
    if (connection.readyState === 1)
        return run()
    return new Promise(resolve => connection.once('connected', resolve)).then(run)
}
exports.whenConnected = whenConnected
