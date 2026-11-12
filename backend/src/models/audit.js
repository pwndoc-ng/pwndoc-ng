var mongoose = require('mongoose');//.set('debug', true);
const CVSS31 = require('../lib/cvsscalc31');
var _ = require('lodash');
var Schema = mongoose.Schema;

var Paragraph = {
    text:   String,
    images: [{image: String, caption: String}]
}

var customField = {
    _id:        false,
    customField: {type: Schema.Types.Mixed, ref: 'CustomField'},
    text:       Schema.Types.Mixed
}

var Finding = {
    id:                     Schema.Types.ObjectId,
    identifier:             Number, //incremental ID to be shown in the report
    title:                  String,
    vulnType:               String,
    description:            String,
    observation:            String,
    remediation:            String,
    remediationComplexity:  {type: Number, enum: [1,2,3]},
    priority:               {type: Number, enum: [1,2,3,4]},
    references:             [String],
    cvssv3:                 String,
    paragraphs:             [Paragraph],
    poc:                    String,
    scope:                  String,
    status:                 {type: Number, enum: [0,1], default: 1}, // 0: done, 1: redacting
    category:               String,
    customFields:           [customField]
}

var Service = {
    port:       Number,
    protocol:   {type: String, enum: ['tcp', 'udp']},
    name:       String,
    product:    String,
    version:    String
}

var Host = {
    hostname:   String,
    ip:         String,
    os:         String,
    services:   [Service]
}

// Review comments: on any element of the audit (field of a page, finding or section),
// optionally on a passage of a text field. Stored apart from the content: commenting never modifies it.
var CommentReplySchema = new Schema({
    author:     {type: Schema.Types.ObjectId, ref: 'User'},
    text:       String
}, {timestamps: true})

var CommentSchema = new Schema({
    target: {
        kind:       {type: String, enum: ['general', 'network', 'finding', 'section']},
        findingId:  Schema.Types.ObjectId,
        sectionId:  Schema.Types.ObjectId,
        field:      String // e.g. 'title', 'description', 'customFields.<customFieldId>'
    },
    // Commented passage of a text field (text quote: exact text and its context), absent for the whole field.
    // Not trimmed (strings are trimmed globally): whitespaces are needed to locate the passage.
    quote: {
        exact:      {type: String, trim: false},
        prefix:     {type: String, trim: false},
        suffix:     {type: String, trim: false}
    },
    // Commented image of a text field: image source (id, URL or hash of a data URI) and its caption
    image: {
        src:        String,
        alt:        String,
        occurrence: Number // Index among identical images (same source and caption) of the field
    },
    text:       String,
    author:     {type: Schema.Types.ObjectId, ref: 'User'},
    replies:    [CommentReplySchema],
    resolved:   {type: Boolean, default: false},
    resolvedBy: {type: Schema.Types.ObjectId, ref: 'User'},
    resolvedAt: Date
}, {timestamps: true})

var SortOption = {
    _id:        false,
    category:   String,
    sortValue:  String,
    sortOrder:  {type: String, enum: ['desc', 'asc']},
    sortAuto:   Boolean
}

var AuditSchema = new Schema({
    name:               {type: String, required: true},
    auditType:          String,
    date:               String,
    date_start:         String,
    date_end:           String,
    summary:            String,
    company:            {type: Schema.Types.ObjectId, ref: 'Company'},
    client:             {type: Schema.Types.ObjectId, ref: 'Client'},
    collaborators:      [{type: Schema.Types.ObjectId, ref: 'User'}],
    reviewers:          [{type: Schema.Types.ObjectId, ref: 'User'}],
    language:           {type: String, required: true},
    scope:              [{_id: false, name: String, hosts: [Host]}],
    findings:           [Finding],
    template:           {type: Schema.Types.ObjectId, ref: 'Template'},
    creator:            {type: Schema.Types.ObjectId, ref: 'User'},
    sections:           [{field: String, name: String, text: String, customFields: [customField]}], // keep text for retrocompatibility
    customFields:       [customField],
    sortFindings:       [SortOption],
    state:              { type: String, enum: ['EDIT', 'REVIEW', 'APPROVED'], default: 'EDIT'},
    approvals:          [{type: Schema.Types.ObjectId, ref: 'User'}],
    comments:           [CommentSchema],
    // Issues of the quality checks ignored by the users (lib/qa.js): fingerprint of the issue and of its content
    qaIgnored:          [{_id: false, fingerprint: String, by: {type: Schema.Types.ObjectId, ref: 'User'}, at: Date}],
}, {timestamps: true});

/*
*** Helpers ***
*/

// Custom fields of the audit and of its findings replaced by their definition (label, fieldType, text), null for a deleted
// field (those of the sections keep the copy stored with them). Done here and not with populate(): a stored value that is
// not an identifier (accepted by older versions) made populate() throw, and the audit could not be opened nor exported
async function populateCustomFields(audit) {
    var entries = [audit.customFields, ...audit.findings.map(f => f.customFields)]
        .flatMap(list => list || [])
        .filter(entry => entry.customField !== undefined && entry.customField !== null)
    var idOf = (value) => {
        var id = (typeof value === 'object') ? value._id : value
        return mongoose.isObjectIdOrHexString(id) ? String(id) : null
    }
    var ids = [...new Set(entries.map(entry => idOf(entry.customField)).filter(id => id))]
    var fields = await mongoose.model('CustomField').find({_id: {$in: ids}}).select('label fieldType text').lean()
    var byId = new Map(fields.map(field => [String(field._id), field]))
    entries.forEach(entry => entry.customField = byId.get(idOf(entry.customField)) || null)
}

// Values of a write checked against the schema (types, enums) before the update: the updates below do not run the
// validators, and an invalid value stored in an audit made every later save of the audit fail
function validateValues(values) {
    var error = new Audit({name: 'validation', language: 'validation', ...values}).validateSync()
    if (error)
        throw error
}

// Filter of the audits the user can modify: creator, collaborators (or all the audits)
function writeFilter(isAdmin, auditId, userId) {
    var filter = {_id: auditId}
    if (!isAdmin)
        filter.$or = [{creator: userId}, {collaborators: userId}]
    return filter
}

// Update of an element of an audit (finding, section) matching nothing: unknown element, or unknown audit / no write access
async function elementNotFound(filter, message) {
    if (await Audit.exists(filter))
        return {fn: 'NotFound', message: message}
    return {fn: 'NotFound', message: 'Audit not found or Insufficient Privileges'}
}

// Update pipeline putting the findings in the order of ids. Permutation of the current findings: a finding updated meanwhile
// keeps its new values, a finding deleted meanwhile is not recreated, a finding added meanwhile is kept at the end
function reorderFindings(ids) {
    return [{$set: {findings: {$concatArrays: [
        {$map: {
            input: {$filter: {input: ids, as: 'id', cond: {$in: ['$$id', '$findings._id']}}},
            as: 'id',
            in: {$arrayElemAt: ['$findings', {$indexOfArray: ['$findings._id', '$$id']}]}
        }},
        {$filter: {input: '$findings', as: 'finding', cond: {$not: {$in: ['$$finding._id', ids]}}}}
    ]}}}]
}

/*
*** Statics ***
*/

// Get all audits (admin)
AuditSchema.statics.getAudits = (isAdmin, userId, filters) => {
    return new Promise((resolve, reject) => { 
        var query = Audit.find(filters)
        if (!isAdmin)
            query.or([{creator: userId}, {collaborators: userId}, {reviewers: userId}])
        query.populate('creator', 'username')
        query.populate('collaborators', 'username')
        query.populate('reviewers', 'username firstname lastname')
        query.populate('approvals', 'username firstname lastname')
        query.populate('company', 'name')
        query.select('id name language creator collaborators company createdAt state')
        query.exec()
        .then((rows) => {
            resolve(rows)
        })
        .catch((err) => {
            reject(err)
        })
    })
}

// Get all audits for download
/*
AuditSchema.statics.export = () => {
    return new Promise((resolve, reject) => {
        var query = Audit.find()
        query.populate('creator', 'username')
        query.populate('collaborators', 'username')
        query.populate('reviewers', 'username firstname lastname')
        query.populate('approvals', 'username firstname lastname')
        query.populate('company', 'name')
        query.select('id name language creator collaborators company createdAt state')
        query.exec()
        .then((rows) => {
            resolve(rows)
        })
        .catch((err) => {
            reject(err)
        })
    });
}
*/

// Get Audit with ID to generate report
AuditSchema.statics.getAudit = (isAdmin, auditId, userId) => {
    return new Promise((resolve, reject) => {
        var query = Audit.findById(auditId)
        if (!isAdmin)
            query.or([{creator: userId}, {collaborators: userId}, {reviewers: userId}])
        query.populate('template')
        query.populate('creator', 'username firstname lastname email phone role')
        query.populate('company')
        query.populate('client')
        query.populate('collaborators', 'username firstname lastname email phone role')
        query.populate('reviewers', 'username firstname lastname role')
        query.populate('approvals', 'username firstname lastname role')
        query.select('-comments') // Loaded with getComments
        query.exec()
        .then(async (row) => {
            if (!row)
                throw({fn: 'NotFound', message: 'Audit not found or Insufficient Privileges'})
            await populateCustomFields(row)
            resolve(row)
        })
        .catch((err) => {
            if (err.name === "CastError")
                reject({fn: 'BadParameters', message: 'Bad Audit Id'})
            else
                reject(err)
        })
    })
}

// Create audit
AuditSchema.statics.create = (audit, userId) => {
    return new Promise((resolve, reject) => {
        audit.creator = userId
        audit.sections = []
        audit.customFields = []

        var auditTypeSections = []
        var customSections = []
        var customFields = []
        var AuditType = mongoose.model('AuditType')
        AuditType.getByName(audit.auditType)
        .then((row) => {
            if (row) {
                auditTypeSections = row.sections
                var auditTypeTemplate = row.templates.find(e => e.locale === audit.language)
                if (auditTypeTemplate)
                    audit.template = auditTypeTemplate.template
                var Section = mongoose.model('CustomSection')
                var CustomField = mongoose.model('CustomField')
                var promises = []
                promises.push(Section.getAll())
                promises.push(CustomField.getAll())
                return Promise.all(promises)
            }
            else
                throw({fn: 'NotFound', message: 'AuditType not found'})
        })
        .then(resolved => {
            customSections = resolved[0]
            customFields = resolved[1]

            customSections.forEach(section => { // Add sections with customFields (and default text) to audit
                var tmpSection = {}
                if (auditTypeSections.includes(section.field)) {
                    tmpSection.field = section.field
                    tmpSection.name = section.name
                    tmpSection.customFields = []

                    customFields.forEach(field => {
                        field = field.toObject()
                        if (field.display === 'section' && field.displaySub === tmpSection.name) {
                            var fieldText = field.text.find(e => e.locale === audit.language)
                            if (fieldText)
                                fieldText = fieldText.value
                            else
                                fieldText = ""
                            
                            delete field.text
                            tmpSection.customFields.push({customField: field, text: fieldText})
                        }
                    })
                    audit.sections.push(tmpSection)
                }
            })

            customFields.forEach(field => { // Add customFields (and default text) to audit
                field = field.toObject()
                if (field.display === 'general') {
                    var fieldText = field.text.find(e => e.locale === audit.language)
                    if (fieldText)
                        fieldText = fieldText.value
                    else
                        fieldText = ""

                    delete field.text
                    audit.customFields.push({customField: field, text: fieldText})
                }
            })

            var VulnerabilityCategory = mongoose.model('VulnerabilityCategory')
            return VulnerabilityCategory.getAll()
        })
        .then((rows) => {
            // Add default sort options for each vulnerability category
            audit.sortFindings = []
            rows.forEach(e => {
                audit.sortFindings.push({
                    category: e.name,
                    sortValue: e.sortValue,
                    sortOrder: e.sortOrder,
                    sortAuto: e.sortAuto
                })
            })

            return new Audit(audit).save()
        })
        .then((rows) => {
            resolve(rows)
        })
        .catch((err) => {
            console.log(err)
            if (err.name === "ValidationError")
                reject({fn: 'BadParameters', message: 'Audit validation failed'})
            else
                reject(err)
        })
    })
}

// Delete Outdated audit (Automation setting feature)
AuditSchema.statics.deleteOutdatedReportAutomation = (days) => {
    return new Promise((resolve, reject) => {
        var deleteBefore = new Date(Date.now() -  86400000 * days); // 86400000 = 1 day | test 64000 = 1 min 
        var query = Audit.deleteMany({createdAt:{"$lte": deleteBefore}})
        query.exec()               
        .then((data) => {
            resolve(data)
        })
        .catch((err) => {
            reject(err)
        })
    })
}

 // Delete audit
AuditSchema.statics.delete = (isAdmin, auditId, userId) => {
    return new Promise((resolve, reject) => {
        var query = Audit.findOneAndDelete({_id: auditId})
        if (!isAdmin)
            query.or([{creator: userId}])
        return query.exec()               
        .then((row) => {
            if (!row)
                throw({fn: 'NotFound', message: 'Audit not found or Insufficient Privileges'})
            
            resolve(row)
        })
        .catch((err) => {
            reject(err)
        })
    })
}

// Get audit general information
AuditSchema.statics.getGeneral = (isAdmin, auditId, userId) => {
    return new Promise((resolve, reject) => { 
        var query = Audit.findById(auditId);
        if (!isAdmin)
            query.or([{creator: userId}, {collaborators: userId}, {reviewers: userId}])
        query.populate({
            path: 'client', 
            select: 'email firstname lastname', 
            populate: {
                path: 'company', 
                select: 'name'}
            });
        query.populate('creator', 'username firstname lastname')
        query.populate('collaborators', 'username firstname lastname')
        query.populate('reviewers', 'username firstname lastname')
        query.populate('company')
        query.select('name auditType date date_start date_end client collaborators language scope.name template customFields')
        query.lean().exec()
        .then((row) => {
            if (!row)
                throw({fn: 'NotFound', message: 'Audit not found or Insufficient Privileges'});

            var formatScope = row.scope.map(item => {return item.name})
            for (var i=0;i<formatScope.length;i++) {
                row.scope[i] = formatScope[i]
            }
            resolve(row)
        })
        .catch((err) => {
            reject(err)
        })
    })
}

// Update audit general information. scopeNames: names of the scope (page General information), the hosts and services of
// the scopes kept are computed by MongoDB in the same update (a network import saved meanwhile is not overwritten)
AuditSchema.statics.updateGeneral = async (isAdmin, auditId, userId, update, scopeNames) => {
    // Company given by its name: the company of this name, created if needed (Company.create is the static of the model
    // creating a list of companies: it answers a count, not the company)
    if (update.company && update.company.name)
        update.company = (await mongoose.model('Company').findOneAndUpdate({name: update.company.name}, {}, {upsert: true, new: true}))._id
    validateValues(update)
    var row = await Audit.findOneAndUpdate(writeFilter(isAdmin, auditId, userId), update)
    if (!row)
        throw({fn: 'NotFound', message: 'Audit not found or Insufficient Privileges'})
    if (scopeNames) {
        var hostsOf = {$filter: {input: {$ifNull: ['$scope', []]}, cond: {$eq: ['$$this.name', '$$name']}}}
        await Audit.updateOne({_id: auditId}, [{$set: {scope: {$map: {input: {$literal: scopeNames}, as: 'name', in: {
            name: '$$name',
            hosts: {$ifNull: [{$first: {$map: {input: hostsOf, in: '$$this.hosts'}}}, []]}
        }}}}}])
    }
    return "Audit General updated successfully"
}

// Get audit Network information
AuditSchema.statics.getNetwork = (isAdmin, auditId, userId) => {
    return new Promise((resolve, reject) => { 
        var query = Audit.findById(auditId)
        if (!isAdmin)
            query.or([{creator: userId}, {collaborators: userId}, {reviewers: userId}])
        query.select('scope')
        query.exec()
        .then((row) => {
            if (!row)
                throw({fn: 'NotFound', message: 'Audit not found or Insufficient Privileges'})
            
            resolve(row)
        })
        .catch((err) => {
            reject(err)
        })
    })
}

// Update audit Network information
AuditSchema.statics.updateNetwork = async (isAdmin, auditId, userId, update) => {
    validateValues(update)
    var row = await Audit.findOneAndUpdate(writeFilter(isAdmin, auditId, userId), update)
    if (!row)
        throw({fn: 'NotFound', message: 'Audit not found or Insufficient Privileges'})
    return "Audit Network updated successfully"
}

// Create finding
AuditSchema.statics.createFinding = async (isAdmin, auditId, userId, finding) => {
    validateValues({findings: [finding]})
    var values = new Audit({findings: [finding]}).findings[0].toObject()
    delete values.identifier
    // Identifier computed by MongoDB in the same update (highest identifier + 1): findings created at the same time get
    // distinct identifiers. $literal: values of the request are not interpreted as expressions
    var identifier = {$add: [{$ifNull: [{$max: '$findings.identifier'}, 0]}, 1]}
    var row = await Audit.findOneAndUpdate(writeFilter(isAdmin, auditId, userId), [{$set: {findings: {$concatArrays: [
        {$ifNull: ['$findings', []]},
        [{$mergeObjects: [{$literal: values}, {identifier: identifier}]}]
    ]}}}])
    if (!row)
        throw({fn: 'NotFound', message: 'Audit not found or Insufficient Privileges'})
    await Audit.sortFindings(auditId)
    return "Audit Finding created successfully"
}

// Get finding of audit
AuditSchema.statics.getFinding = (isAdmin, auditId, userId, findingId) => {
    return new Promise((resolve, reject) => { 
        var query = Audit.findById(auditId)
        if (!isAdmin)
            query.or([{creator: userId}, {collaborators: userId}, {reviewers: userId}])
        query.select('findings')
        query.exec()
        .then((row) => {
            if (!row)
                throw({fn: 'NotFound', message: 'Audit not found or Insufficient Privileges'})

            var finding = row.findings.id(findingId)
            if (finding === null) 
                throw({fn: 'NotFound', message: 'Finding not found'})
            else 
                resolve(finding)
        })
        .catch((err) => {
            reject(err)
        })
    })
}

// Update finding of audit: only the given fields of this finding (concurrent updates of other findings or of the order are
// kept). arrayFilters and not the positional $: the filter also matches the collaborators array
AuditSchema.statics.updateFinding = async (isAdmin, auditId, userId, findingId, newFinding) => {
    if (!mongoose.isObjectIdOrHexString(findingId))
        throw({fn: 'NotFound', message: 'Finding not found'})
    validateValues({findings: [newFinding]})
    var set = {}
    Object.keys(newFinding).forEach(key => set[`findings.$[finding].${key}`] = newFinding[key])
    var filter = writeFilter(isAdmin, auditId, userId)
    // Nothing to update (MongoDB refuses an array filter not used by the update): access and finding checked only
    var row = (Object.keys(set).length === 0)
        ? await Audit.findOne({...filter, 'findings._id': findingId}).select('_id')
        : await Audit.findOneAndUpdate({...filter, 'findings._id': findingId}, {$set: set}, {arrayFilters: [{'finding._id': findingId}]})
    if (!row)
        throw await elementNotFound(filter, 'Finding not found')
    await Audit.sortFindings(auditId)
    return "Audit Finding updated successfully"
}

// Delete finding of audit (and the review comments of the finding)
AuditSchema.statics.deleteFinding = async (isAdmin, auditId, userId, findingId) => {
    if (!mongoose.isObjectIdOrHexString(findingId))
        throw({fn: 'NotFound', message: 'Finding not found'})
    var filter = writeFilter(isAdmin, auditId, userId)
    var row = await Audit.findOneAndUpdate({...filter, 'findings._id': findingId}, {$pull: {findings: {_id: findingId}, comments: {'target.findingId': findingId}}})
    if (!row)
        throw await elementNotFound(filter, 'Finding not found')
    return "Audit Finding deleted successfully"
}

// Create section
AuditSchema.statics.createSection = (isAdmin, auditId, userId, section) => {
    return new Promise((resolve, reject) => { 
        var query = Audit.findOneAndUpdate({_id: auditId, 'sections.field': {$ne: section.field}}, {$push: {sections: section}})
        if (!isAdmin)
            query.or([{creator: userId}, {collaborators: userId}])
        query.exec()
        .then((row) => {
            if (!row)
                throw({fn: 'NotFound', message: 'Audit not found or Section already exists or Insufficient Privileges'})
            
            resolve('Audit Section created successfully')
        })
        .catch((err) => {
            reject(err)
        })
    })
}

// Get section of audit
AuditSchema.statics.getSection = (isAdmin, auditId, userId, sectionId) => {
    return new Promise((resolve, reject) => { 
        var query = Audit.findById(auditId)
        if (!isAdmin)
            query.or([{creator: userId}, {collaborators: userId}, {reviewers: userId}])

        query.select('sections')
        query.exec()
        .then((row) => {
            if (!row)
            throw({fn: 'NotFound', message: 'Audit not found or Insufficient Privileges'})

            var section = row.sections.id(sectionId);
            if (section === null) 
                throw({fn: 'NotFound', message: 'Section id not found'});
            else 
                resolve(section);
        })
        .catch((err) => {
            reject(err)
        })
    })
}

// Update section of audit: only the given fields of this section (arrayFilters: see updateFinding)
AuditSchema.statics.updateSection = async (isAdmin, auditId, userId, sectionId, newSection) => {
    if (!mongoose.isObjectIdOrHexString(sectionId))
        throw({fn: 'NotFound', message: 'Section not found'})
    validateValues({sections: [newSection]})
    var set = {}
    Object.keys(newSection).forEach(key => set[`sections.$[section].${key}`] = newSection[key])
    var filter = writeFilter(isAdmin, auditId, userId)
    var row = await Audit.findOneAndUpdate({...filter, 'sections._id': sectionId}, {$set: set}, {arrayFilters: [{'section._id': sectionId}]})
    if (!row)
        throw await elementNotFound(filter, 'Section not found')
    return 'Audit Section updated successfully'
}

// Delete section of audit
AuditSchema.statics.deleteSection = (isAdmin, auditId, userId, sectionId) => {
    return new Promise((resolve, reject) => { 
        var query = Audit.findById(auditId)
        if (!isAdmin)
            query.or([{creator: userId}, {collaborators: userId}])
        query.select('sections')
        query.exec()
        .then((row) => {
            if (!row)
                throw({fn: 'NotFound', message: 'Audit not found or Insufficient Privileges'})

            var section = row.sections.id(sectionId)
            if (section === null) throw({fn: 'NotFound', message: 'Section not found'})
            else {
                row.sections.pull(sectionId)
                return row.save()
            }
        })
        .then(() => {
            resolve('Audit Section deleted successfully')
        })
        .catch((err) => {
            reject(err)
        })
    })
}

// Value of a finding used to sort it (sortValue: field of the finding, CVSS score or label of a custom field), as a string
function sortValueOf(finding, sortValue) {
    var cvss = CVSS31.calculateCVSSFromVector(finding.cvssv3)
    var value = finding[sortValue]
    if (cvss.success && sortValue === 'cvssScore')
        value = cvss.baseMetricScore
    else if (cvss.success && sortValue === 'cvssTemporalScore')
        value = cvss.temporalMetricScore
    else if (cvss.success && sortValue === 'cvssEnvironmentalScore')
        value = cvss.environmentalMetricScore
    if (!value) {
        var field = (finding.customFields || []).find(e => e.customField && e.customField.label === sortValue)
        if (field)
            value = field.text
    }
    return (value || 0).toString()
}

// Sort the findings: grouped by category (order of the vulnerability categories, uncategorized last), each group sorted with
// its sort option (audit option, else default of the category). Categories in manual order (sortAuto false) keep their
// order, except those switching from automatic to manual (previousOptions: sort options before their update), sorted
// once. Applied as a permutation of the current findings (see reorderFindings)
AuditSchema.statics.sortFindings = async (auditId, previousOptions) => {
    var audit = await Audit.findById(auditId).select('findings sortFindings').lean()
    if (!audit)
        return
    var categories = await mongoose.model('VulnerabilityCategory').getAll()
    var categoriesOrder = categories.map(e => e.name)
    categoriesOrder.push("undefined") // Put uncategorized findings at the end
    var optionOf = (options, category) => options.find(option => option.category === category) ||
        categories.find(e => e.name === category) || {sortValue: 'cvssScore', sortOrder: 'desc', sortAuto: true}

    var findings = _.chain(audit.findings)
    .groupBy("category")
    .toPairs()
    .sort((a,b) => categoriesOrder.indexOf(a[0]) - categoriesOrder.indexOf(b[0]))
    .flatMap(([key, group]) => {
        var category = (key === 'undefined') ? 'No Category' : key
        var option = optionOf(audit.sortFindings || [], category)
        var previous = previousOptions ? optionOf(previousOptions, category) : option
        if (!option.sortAuto && !previous.sortAuto)
            return group
        var order = (option.sortOrder === 'asc') ? 1 : -1
        return group.sort((a, b) => sortValueOf(a, option.sortValue).localeCompare(sortValueOf(b, option.sortValue), undefined, {numeric: true}) * order)
    })
    .value()

    var ids = findings.map(finding => finding._id)
    if (ids.some((id, index) => String(id) !== String(audit.findings[index]._id)))
        await Audit.updateOne({_id: auditId}, reorderFindings(ids))
}

// Update audit sort options for findings (update.sortFindings) and run the sorting
AuditSchema.statics.updateSortFindings = async (isAdmin, auditId, userId, update) => {
    validateValues(update)
    var previous = await Audit.findOneAndUpdate(writeFilter(isAdmin, auditId, userId), update).select('sortFindings').lean()
    if (!previous)
        throw({fn: 'NotFound', message: 'Audit not found or Insufficient Privileges'})
    await Audit.sortFindings(auditId, update.sortFindings ? (previous.sortFindings || []) : undefined)
    return "Audit findings sorted successfully"
}

// Move finding from move.oldIndex to move.newIndex (indexes of the current findings)
AuditSchema.statics.moveFindingPosition = async (isAdmin, auditId, userId, move) => {
    var row = await Audit.findOne(writeFilter(isAdmin, auditId, userId)).select('findings._id').lean()
    if (!row)
        throw({fn: 'NotFound', message: 'Audit not found or Insufficient Privileges'})
    var ids = row.findings.map(finding => finding._id)
    var validIndex = (index) => Number.isInteger(index) && index >= 0 && index < ids.length
    if (!validIndex(move.oldIndex) || !validIndex(move.newIndex))
        throw({fn: 'BadParameters', message: 'Invalid parameters: oldIndex and newIndex must be indexes of the findings'})
    ids.splice(move.newIndex, 0, ids.splice(move.oldIndex, 1)[0])
    await Audit.updateOne({_id: auditId}, reorderFindings(ids))
    return 'Audit Finding moved successfully'
}

// Approval of a reviewer given (approved: true) or removed, and state computed from the number of approvals, in one atomic
// update: concurrent approvals, or an approval and a return to edition, do not overwrite each other.
// Only for an audit in review (REVIEW or APPROVED), by a reviewer of the audit (or allowed to review all the audits) who is
// neither its creator nor a collaborator. Returns the updated audit, null if no audit matches
AuditSchema.statics.setApproval = (isAdmin, auditId, userId, approved, minReviewers) => {
    var user = new mongoose.Types.ObjectId(userId)
    var filter = {_id: auditId, state: {$in: ['REVIEW', 'APPROVED']}, creator: {$ne: user}, collaborators: {$ne: user}}
    if (!isAdmin)
        filter.reviewers = user
    var current = {$ifNull: ['$approvals', []]}
    var approvals = approved
        ? {$cond: [{$in: [user, current]}, current, {$concatArrays: [current, [user]]}]}
        : {$filter: {input: current, cond: {$ne: ['$$this', user]}}}
    return Audit.findOneAndUpdate(filter, [
        {$set: {approvals: approvals}},
        {$set: {state: {$cond: [{$gte: [{$size: '$approvals'}, minReviewers]}, 'APPROVED', 'REVIEW']}}}
    ], {new: true})
}

// Audit sent to review or back to edition (state EDIT or REVIEW) in one atomic update, only from these states (an audit
// approved meanwhile stays approved). Back to edition removes the approval of the user only.
// Returns the updated audit, null if no audit matches
AuditSchema.statics.setReviewState = (isAdmin, auditId, userId, state) => {
    var filter = {...writeFilter(isAdmin, auditId, userId), state: {$in: ['EDIT', 'REVIEW']}}
    var update = {$set: {state: state}}
    if (state === 'EDIT')
        update.$pull = {approvals: userId}
    return Audit.findOneAndUpdate(filter, update, {new: true})
}

/*
*** Review comments (access rights are checked by the routes) ***
*/

var COMMENT_USERS = 'username firstname lastname'

// Issue of the quality checks ignored (ignored true) or no longer ignored, by a user allowed to update the audit
AuditSchema.statics.setQaIgnored = async (isAdmin, auditId, userId, fingerprint, ignored) => {
    var update = ignored ?
        [{$set: {qaIgnored: {$concatArrays: [
            {$filter: {input: {$ifNull: ['$qaIgnored', []]}, cond: {$ne: ['$$this.fingerprint', fingerprint]}}},
            [{fingerprint: fingerprint, by: new mongoose.Types.ObjectId(String(userId)), at: '$$NOW'}]
        ]}}}] :
        {$pull: {qaIgnored: {fingerprint: fingerprint}}}
    var row = await Audit.findOneAndUpdate(writeFilter(isAdmin, auditId, userId), update, {timestamps: false})
    if (!row)
        throw({fn: 'NotFound', message: 'Audit not found or Insufficient Privileges'})
    return 'Quality issue updated'
}

AuditSchema.statics.getComments = async (auditId) => {
    var row = await Audit.findById(auditId).select('comments')
        .populate('comments.author', COMMENT_USERS)
        .populate('comments.replies.author', COMMENT_USERS)
        .populate('comments.resolvedBy', COMMENT_USERS)
        .exec()
    if (!row)
        throw({fn: 'NotFound', message: 'Audit not found'})
    return row.comments
}

AuditSchema.statics.getComment = async (auditId, commentId) => {
    if (!mongoose.isObjectIdOrHexString(commentId))
        throw({fn: 'NotFound', message: 'Comment not found'})
    var row = await Audit.findOne({_id: auditId, 'comments._id': commentId}, {'comments.$': 1}).exec()
    if (!row)
        throw({fn: 'NotFound', message: 'Comment not found'})
    return row.comments[0]
}

AuditSchema.statics.createComment = async (auditId, comment) => {
    var result = await Audit.updateOne({_id: auditId}, {$push: {comments: comment}}).exec()
    if (result.matchedCount === 0)
        throw({fn: 'NotFound', message: 'Audit not found'})
}

// update: {text} and/or {resolved, resolvedBy, resolvedAt}
AuditSchema.statics.updateComment = async (auditId, commentId, update) => {
    if (!mongoose.isObjectIdOrHexString(commentId))
        throw({fn: 'NotFound', message: 'Comment not found'})
    var set = {'comments.$.updatedAt': new Date()}
    Object.keys(update).forEach(key => set[`comments.$.${key}`] = update[key])
    var result = await Audit.updateOne({_id: auditId, 'comments._id': commentId}, {$set: set}).exec()
    if (result.matchedCount === 0)
        throw({fn: 'NotFound', message: 'Comment not found'})
}

AuditSchema.statics.addCommentReply = async (auditId, commentId, reply) => {
    if (!mongoose.isObjectIdOrHexString(commentId))
        throw({fn: 'NotFound', message: 'Comment not found'})
    var result = await Audit.updateOne({_id: auditId, 'comments._id': commentId}, {$push: {'comments.$.replies': reply}}).exec()
    if (result.matchedCount === 0)
        throw({fn: 'NotFound', message: 'Comment not found'})
}

AuditSchema.statics.deleteComment = async (auditId, commentId) => {
    if (!mongoose.isObjectIdOrHexString(commentId))
        throw({fn: 'NotFound', message: 'Comment not found'})
    var result = await Audit.updateOne({_id: auditId}, {$pull: {comments: {_id: commentId}}}).exec()
    if (result.modifiedCount === 0)
        throw({fn: 'NotFound', message: 'Comment not found'})
}

AuditSchema.statics.countOpenComments = async (auditId) => {
    var row = await Audit.findById(auditId).select('comments.resolved').lean().exec()
    return row ? (row.comments || []).filter(comment => !comment.resolved).length : 0
}

// Get user access rights on an audit (used to authorize realtime connections), same rules as REST routes:
// - read: creator, collaborators, reviewers or readAll permission
// - write: creator, collaborators or updateAll permission (and read access)
AuditSchema.statics.getUserAccess = async (auditId, userId, readAll, updateAll) => {
    var access = {read: false, write: false}
    if (!mongoose.isObjectIdOrHexString(auditId))
        return access

    var audit = await Audit.findById(auditId).select('creator collaborators reviewers').lean().exec()
    if (!audit)
        return access

    var isUser = id => String(id) === String(userId)
    var isEditor = isUser(audit.creator) || (audit.collaborators || []).some(isUser)
    var isReviewer = (audit.reviewers || []).some(isUser)
    access.read = readAll || isEditor || isReviewer
    access.write = access.read && (updateAll || isEditor)
    return access
}

// Clone existing audit (same read access rules as getAudit on the source audit)
// References are not populated: the cloned audit (returned to the client) must only contain IDs
AuditSchema.statics.clone = (isAdmin, auditId, newName, userId) => {
    return new Promise((resolve, reject) => {
        var query = Audit.findById(auditId)
        if (!isAdmin)
            query.or([{creator: userId}, {collaborators: userId}, {reviewers: userId}])
        query.exec()
        .then((sourceAudit) => {
            if (!sourceAudit)
                throw({fn: 'NotFound', message: 'Audit not found or Insufficient Privileges'});
            
            // Create new audit object with cloned data
            var clonedAudit = new Audit({
                name: newName,
                auditType: sourceAudit.auditType,
                language: sourceAudit.language,
                company: sourceAudit.company,
                client: sourceAudit.client,
                collaborators: sourceAudit.collaborators,
                reviewers: sourceAudit.reviewers,
                template: sourceAudit.template,
                scope: sourceAudit.scope,
                findings: sourceAudit.findings,
                sections: sourceAudit.sections,
                customFields: sourceAudit.customFields,
                sortFindings: sourceAudit.sortFindings,
                creator: userId,
                state: 'EDIT' // Reset state to EDIT for new audit
            });
            
            return clonedAudit.save();
        })
        .then(async (clonedAudit) => {
            // Images of the source audit readable by the users of the copy
            await mongoose.model('Image').grantReferenced(clonedAudit.toObject(), clonedAudit._id, userId, isAdmin);
            resolve(clonedAudit);
        })
        .catch((err) => {
            if (err.name === "CastError")
                reject({fn: 'BadParameters', message: 'Bad Audit Id'})
            else
                reject(err);
        })
    });
}

/*
*** Methods ***
*/

var Audit = mongoose.model('Audit', AuditSchema);
// Audit.syncIndexes()
module.exports = Audit;