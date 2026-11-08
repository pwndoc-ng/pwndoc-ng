var fs = require('fs')
var gLocale = 'en'

// Locales are the names of the JSON files of this folder. The locale can come from a report template
// ({input | translate: 'fr'}): it must not be able to point to another file.
var LOCALE_FORMAT = /^[A-Za-z0-9_-]+$/

function setLocale(locale) {
    gLocale = locale
}
exports.setLocale = setLocale

function translate(message, locale = gLocale) {
    try {
        if (typeof locale !== 'string' || !LOCALE_FORMAT.test(locale))
            return message
        let dictionary = JSON.parse(fs.readFileSync(`${__dirname}/${locale}.json`))
        // Translations only: not the properties inherited from Object (constructor, __proto__...)
        if (typeof message === 'string' && Object.prototype.hasOwnProperty.call(dictionary, message))
            return dictionary[message] || message
        return message
    }
    catch (error) {
        return message
    }
}
exports.translate = translate
