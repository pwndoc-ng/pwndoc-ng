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
