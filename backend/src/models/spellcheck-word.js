var mongoose = require('mongoose')
var Schema = mongoose.Schema

// Words ignored by the spell checker of the editors (LanguageTool), for all the users: proposed by the users
// (spellcheck-words:create), ignored once approved (spellcheck-words:update). A word is stored once whatever its case
// (key: word in lower case), as written by the user who proposed it first
var SpellcheckWordSchema = new Schema({
    word:       {type: String, required: true, maxlength: 100},
    key:        {type: String, required: true, unique: true},
    status:     {type: String, enum: ['pending', 'approved'], default: 'pending'},
    proposedBy: {type: Schema.Types.ObjectId, ref: 'User'},
    approvedBy: {type: Schema.Types.ObjectId, ref: 'User'}
}, {timestamps: true})

/*
*** Statics ***
*/

// Word given by a user: string of 1 to 100 characters without space, trimmed (null otherwise)
SpellcheckWordSchema.statics.validWord = (word) => {
    if (typeof word !== 'string')
        return null
    word = word.trim()
    return /^\S{1,100}$/.test(word) ? word : null
}

// Approved words
SpellcheckWordSchema.statics.getApproved = async () => {
    var rows = await SpellcheckWord.find({status: 'approved'}).select('word').sort('key').lean()
    return rows.map(row => row.word)
}

// All the words, pending ones first, with the users who proposed and approved them
SpellcheckWordSchema.statics.getAll = () => {
    return SpellcheckWord.find()
        .select('word status proposedBy approvedBy createdAt updatedAt')
        .populate('proposedBy', 'username firstname lastname')
        .populate('approvedBy', 'username firstname lastname')
        .sort({status: -1, key: 1})
        .lean()
}

// Proposes a word, approved at once when the user can approve the words. A word already stored (in any case) is kept,
// and approved if the user can approve it
SpellcheckWordSchema.statics.propose = async (word, userId, approve) => {
    var key = word.toLowerCase()
    var update = {$setOnInsert: {word: word, key: key, proposedBy: userId}}
    if (approve)
        update.$set = {status: 'approved', approvedBy: userId}
    var options = {upsert: true, new: true, runValidators: true}
    try {
        return await SpellcheckWord.findOneAndUpdate({key: key}, update, options).lean()
    }
    catch (err) {
        if (err.code !== 11000)
            throw err
        return SpellcheckWord.findOneAndUpdate({key: key}, update, options).lean() // Same word proposed at the same time
    }
}

// Approves a proposed word
SpellcheckWordSchema.statics.approve = async (wordId, userId) => {
    var row = await SpellcheckWord.findByIdAndUpdate(wordId, {status: 'approved', approvedBy: userId}, {new: true}).lean()
    if (!row)
        throw {fn: 'NotFound', message: 'Word not found'}
    return row
}

// Deletes a word: proposal refused, or word no longer ignored
SpellcheckWordSchema.statics.delete = async (wordId) => {
    var row = await SpellcheckWord.findByIdAndDelete(wordId).lean()
    if (!row)
        throw {fn: 'NotFound', message: 'Word not found'}
    return row
}

var SpellcheckWord = mongoose.model('SpellcheckWord', SpellcheckWordSchema)
require('../lib/utils').whenConnected('Indexes of the spellcheck words', () => SpellcheckWord.syncIndexes())
module.exports = SpellcheckWord
