var mongoose = require('mongoose')
var Schema = mongoose.Schema

// Access: an image of an audit (auditId, audits) is readable by the users who can read one of its audits, an image of no
// audit (vulnerabilities, shared) by all the users
var ImageSchema = new Schema({
    auditId:    {type: Schema.Types.ObjectId, ref: 'Audit'}, // Audit of the upload
    audits:     [{type: Schema.Types.ObjectId, ref: 'Audit'}], // Other audits using it: same image uploaded, clones, copied content
    value:      {type: String, required: true, unique: true},
    name:       String

}, {timestamps: true})

/*
*** Helpers ***
*/

// Identifiers of the images of content of the editors (<img src="<id>">), in any string of the value
function imageIdsIn(value) {
    var json = JSON.stringify(value) || ''
    return [...new Set([...json.matchAll(/<img\b[^>]*?\ssrc=\\"([a-f0-9]{24})\\"/gi)].map(match => match[1].toLowerCase()))]
}

// Image readable by the user (image: auditId and audits). readAll: user allowed to read all the audits
async function readable(image, userId, readAll) {
    var audits = [image.auditId, ...(image.audits || [])].filter(id => id)
    if (audits.length === 0 || readAll)
        return true
    return Boolean(await mongoose.model('Audit').exists({_id: {$in: audits}, $or: [{creator: userId}, {collaborators: userId}, {reviewers: userId}]}))
}

/*
*** Statics ***
*/

// Get one image
ImageSchema.statics.getOne = (imageId) => {
    return new Promise((resolve, reject) => {
        var query = Image.findById(imageId)
        
        query.select('auditId value name')
        query.exec()
        .then((row) => {
            if (row)
                resolve(row)
            else 
                throw({fn: 'NotFound', message: 'Image not found'});
        })
        .catch((err) => {
            reject(err)
        })
    })
}

// Image readable by the user (identifiers of images can be guessed: knowing one is not enough)
ImageSchema.statics.isReadable = async (imageId, userId, readAll) => {
    var image = await Image.findById(imageId).select('auditId audits').lean()
    return image ? readable(image, userId, readAll) : false
}

// Create image: an identical image is stored once (unique value) and its identifier returned, also to the requests
// uploading it at the same time (duplicate key error of the unique index). The image already stored is given to the audit
// of the upload, or shared if uploaded out of an audit by a user who cannot read it (the user has its content anyway)
ImageSchema.statics.create = async (image, userId, readAll) => {
    var row = await Image.findOne({value: image.value}).select('auditId audits')
    if (!row) {
        try {
            return {_id: (await new Image(image).save())._id}
        }
        catch (err) {
            if (err.code !== 11000)
                throw err
            row = await Image.findOne({value: image.value}).select('auditId audits')
        }
    }
    if (row.auditId && image.auditId)
        await Image.updateOne({_id: row._id, auditId: {$ne: image.auditId}}, {$addToSet: {audits: image.auditId}})
    else if (row.auditId && !await readable(row, userId, readAll))
        await Image.updateOne({_id: row._id}, {$unset: {auditId: 1}, $set: {audits: []}})
    return {_id: row._id}
}

// Images referenced by content written to an audit (target: its id) or to the vulnerabilities (target null: images shared
// with all the users, the vulnerabilities are readable by all of them). Only the images the writer can read are granted
ImageSchema.statics.grantReferenced = async (content, target, userId, readAll) => {
    var ids = imageIdsIn(content)
    if (ids.length === 0)
        return
    var granted = []
    for (var image of await Image.find({_id: {$in: ids}, auditId: {$ne: null}}).select('auditId audits').lean()) {
        var alreadyGranted = target && [image.auditId, ...(image.audits || [])].some(id => String(id) === String(target))
        if (!alreadyGranted && await readable(image, userId, readAll))
            granted.push(image._id)
    }
    if (granted.length === 0)
        return
    if (target)
        await Image.updateMany({_id: {$in: granted}}, {$addToSet: {audits: target}})
    else
        await Image.updateMany({_id: {$in: granted}}, {$unset: {auditId: 1}, $set: {audits: []}})
}

// Images stored before their access control was added: they were readable by all the users. Access granted from the
// references present at the upgrade (run once, lib/migrations.js): audits referencing an image added to its audits (clones,
// copied content), images of the vulnerabilities and of the pending proposals shared. Documents of the database read with
// cursors, or the documents given (sources: {audits, vulnerabilities, proposals} of a backup made before the upgrade, lists
// or cursors). Returns the number of images granted to an audit and shared
async function* pendingProposals(proposals) {
    for await (var proposal of proposals)
        if (!proposal.status || proposal.status === 'pending') yield proposal
}

ImageSchema.statics.grantExistingReferences = async (sources) => {
    var counts = {granted: 0, shared: 0}
    var audits = sources ? sources.audits : mongoose.model('Audit').find({}).select('summary customFields findings sections').lean().cursor({batchSize: 20})
    for await (var audit of audits) {
        var ids = imageIdsIn(audit)
        if (ids.length > 0)
            counts.granted += (await Image.updateMany({_id: {$in: ids}, auditId: {$nin: [null, audit._id]}}, {$addToSet: {audits: audit._id}})).modifiedCount
    }

    var shared = new Set()
    var documents = sources ? [sources.vulnerabilities, pendingProposals(sources.proposals)] : [
        mongoose.model('Vulnerability').find({}).select('details').lean().cursor({batchSize: 100}),
        mongoose.model('VulnerabilityUpdate').find({status: {$in: ['pending', null]}}).select('description observation remediation customFields').lean().cursor({batchSize: 100})
    ]
    for (var list of documents) {
        for await (var document of list)
            imageIdsIn(document).forEach(id => shared.add(id))
    }
    var ids = [...shared]
    for (var i = 0; i < ids.length; i += 1000)
        counts.shared += (await Image.updateMany({_id: {$in: ids.slice(i, i + 1000)}, auditId: {$ne: null}}, {$unset: {auditId: 1}, $set: {audits: []}})).modifiedCount
    return counts
}

// Delete image
ImageSchema.statics.delete = (imageId) => {
    return new Promise((resolve, reject) => {
        var query = Image.findByIdAndDelete(imageId)
        query.exec()
        .then((rows) => {
            if (rows)
                resolve(rows)
            else
                reject({fn: 'NotFound', message: 'Image not found'})
        })
        .catch((err) => {
            reject(err)
        })
    })
}

/*
*** Methods ***
*/

var Image = mongoose.model('Image', ImageSchema)
require('../lib/utils').whenConnected('Indexes of the images', () => Image.syncIndexes())
module.exports = Image