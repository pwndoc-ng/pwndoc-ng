module.exports = function(app, io) {

    var Response = require('../lib/httpResponse');
    var Audit = require('mongoose').model('Audit');
    var acl = require('../lib/auth').acl;
    var reportGenerator = require('../lib/report-generator');
    var _ = require('lodash');
    var utils = require('../lib/utils');
    var Settings = require('mongoose').model('Settings');
    var Image = require('mongoose').model('Image');
    var highlights = require('../lib/highlights');

    // Images of the content written to the audit (copied from another audit the user can read) readable by its users
    var grantImages = (req) => Image.grantReferenced(req.body, req.params.auditId, req.decodedToken.id, acl.isAllowed(req.decodedToken.role, 'audits:read-all'));

    // Open editing sessions of the audit authenticated again (app.js): access or scope changed
    var resetCollaborationSessions = (auditId) => {
        var reset = app.get('resetCollaborationSessions');
        if (reset) reset(auditId);
    };

    /* ### AUDITS LIST ### */

    // Get audits list of user (all for admin) with regex filter on findings
    app.get("/api/audits", acl.hasPermission('audits:read'), function(req, res) {
        // #swagger.tags = ['Audit']

        var getUsersRoom = function(room) {
            return utils.getSockets(io, room).map(s => s.username)
        }
        var filters = {};
        // String only: findingTitle[$ne]=x or findingTitle[]=x (objects and arrays of the query parser) are ignored
        if (typeof req.query.findingTitle === 'string' && req.query.findingTitle)
            filters['findings.title'] = new RegExp(utils.escapeRegex(req.query.findingTitle), 'i')
            
        Audit.getAudits(acl.isAllowed(req.decodedToken.role, 'audits:read-all'), req.decodedToken.id, filters)
        .then(msg => {
                var result = []
                msg.forEach(audit => {
                    var a = {}
                    a._id = audit._id
                    a.name = audit.name
                    a.language = audit.language
                    a.creator = audit.creator
                    a.collaborators = audit.collaborators
                    a.company = audit.company
                    a.createdAt = audit.createdAt
                    a.reviewers = audit.reviewers
                    a.approvals = audit.approvals
                    a.state = audit.state
                    if (acl.isAllowed(req.decodedToken.role, 'audits:users-connected')){
                        a.connected = getUsersRoom(audit._id.toString())
                    }
                    result.push(a)
                })
            Response.Ok(res, result)
        })
        .catch(err => Response.Internal(res, err))
    });


    
    // Get clients for export
    /*
    app.get("/api/audits/export", acl.hasPermission('audits:read-all'), function(req, res) {
        // #swagger.tags = ['Audit']

        Audit.export()
        .then(msg => Response.Ok(res, msg))
        .catch(err => Response.Internal(res, err))
    });
    */

    // Create audit with name, auditType, language provided
    app.post("/api/audits", acl.hasPermission('audits:create'), function(req, res) {
        // #swagger.tags = ['Audit']

        if (!req.body.name || !req.body.language || !req.body.auditType) {
            Response.BadParameters(res, 'Missing some required parameters: name, language, auditType');
            return;
        }
        if ([req.body.name, req.body.language, req.body.auditType].some(value => typeof value !== 'string')) {
            Response.BadParameters(res, 'Parameters name, language and auditType must be strings');
            return;
        }

        if (!utils.validFilename(req.body.language)) {
            Response.BadParameters(res, 'Invalid characters for language');
            return;
        }

        var audit = {};
        // Required params
        audit.name = req.body.name;
        audit.language = req.body.language;
        audit.auditType = req.body.auditType;

        Audit.create(audit, req.decodedToken.id)
        .then(inserted => Response.Created(res, {message: 'Audit created successfully', audit: inserted}))
        .catch(err => Response.Internal(res, err))
    });

    // Clone existing audit
    app.post("/api/audits/:auditId/clone", acl.hasPermission('audits:create'), function(req, res) {
        // #swagger.tags = ['Audit']

        if (!req.body.name || typeof req.body.name !== 'string') {
            Response.BadParameters(res, 'Missing required parameter: name');
            return;
        }

        Audit.clone(acl.isAllowed(req.decodedToken.role, 'audits:read-all'), req.params.auditId, req.body.name, req.decodedToken.id)
        .then(inserted => Response.Created(res, {message: 'Audit cloned successfully', audit: inserted}))
        .catch(err => Response.Internal(res, err))
    });

    // Delete audit if creator or admin
    app.delete("/api/audits/:auditId", acl.hasPermission('audits:delete'), function(req, res) {
        // #swagger.tags = ['Audit']

        Audit.delete(acl.isAllowed(req.decodedToken.role, 'audits:delete-all'), req.params.auditId, req.decodedToken.id)
        .then(msg => {
            resetCollaborationSessions(req.params.auditId);
            Response.Ok(res, msg)
        })
        .catch(err => Response.Internal(res, err))
    })

    /* ### AUDITS EDIT ### */

    // Get Audit with ID
    app.get("/api/audits/:auditId", acl.hasPermission('audits:read'), function(req, res) {
        // #swagger.tags = ['Audit']

        Audit.getAudit(acl.isAllowed(req.decodedToken.role, 'audits:read-all'), req.params.auditId, req.decodedToken.id)
        .then(msg => Response.Ok(res, msg))
        .catch(err => Response.Internal(res, err))
    });

    // Texts highlighted with the warning colors of the settings (generic texts to replace, setting of the reports): places
    // of the audit, none when the warning is disabled. {enabled, colors, items}
    app.get("/api/audits/:auditId/highlights", acl.hasPermission('audits:read'), async function(req, res) {
        // #swagger.tags = ['Audit']

        try {
            var audit = await Audit.getAudit(acl.isAllowed(req.decodedToken.role, 'audits:read-all'), req.params.auditId, req.decodedToken.id);
            var settings = await Settings.getAll();
            var report = settings && settings.report;
            var enabled = Boolean(report && report.enabled !== false && report.public.highlightWarning);
            var colors = (report && report.public.highlightWarningColors) || [];
            Response.Ok(res, {enabled: enabled, colors: colors, items: enabled ? highlights.auditHighlights(audit, colors) : []});
        }
        catch (err) {
            Response.Internal(res, err);
        }
    });

    // Get audit general information
    app.get("/api/audits/:auditId/general", acl.hasPermission('audits:read'), function(req, res) {
        // #swagger.tags = ['Audit']

        Audit.getGeneral(acl.isAllowed(req.decodedToken.role, 'audits:read-all'), req.params.auditId, req.decodedToken.id)
        .then(msg => Response.Ok(res, msg))
        .catch(err => Response.Internal(res, err))
    });

    // Update audit general information
    app.put("/api/audits/:auditId/general", acl.hasPermission('audits:update'), async function(req, res) {
        // #swagger.tags = ['Audit']

        var update = {};
        
        var settings = await Settings.getAll();
        var audit = await Audit.getAudit(acl.isAllowed(req.decodedToken.role, 'audits:read-all'), req.params.auditId, req.decodedToken.id);
        if (settings.reviews.enabled && audit.state !== "EDIT") {
            Response.Forbidden(res, "The audit is not in the EDIT state and therefore cannot be edited.");
            return;
        }

        // Identifiers compared as strings (request: strings, audit: populated documents with ObjectIds)
        var idOf = (user) => String(user && user._id !== undefined ? user._id : user);
        var sameUser = (a, b) => idOf(a) === idOf(b);
        var conflict = "A user cannot simultaneously be a reviewer and a collaborator/creator";

        if (req.body.reviewers) {
            if (!Array.isArray(req.body.reviewers) || req.body.reviewers.some(element => !element || !element._id)) {
                Response.BadParameters(res, "One or more reviewer is missing an _id");
                return;
            }
            // Reviewer: neither the creator nor a collaborator (new collaborators of the request, current ones otherwise)
            var collaborators = req.body.collaborators || audit.collaborators || [];
            if (req.body.reviewers.some(reviewer => sameUser(reviewer, audit.creator) || collaborators.some(collaborator => sameUser(collaborator, reviewer)))) {
                Response.BadParameters(res, conflict);
                return;
            }
        }

        if (req.body.collaborators) {
            if (!Array.isArray(req.body.collaborators) || req.body.collaborators.some(element => !element || !element._id)) {
                Response.BadParameters(res, "One or more collaborator is missing an _id");
                return;
            }
            // Collaborator: not a reviewer (new reviewers of the request, current ones otherwise)
            var reviewers = req.body.reviewers || audit.reviewers || [];
            if (req.body.collaborators.some(collaborator => reviewers.some(reviewer => sameUser(reviewer, collaborator)))) {
                Response.BadParameters(res, conflict);
                return;
            }

            // If the new collaborator already gave a review, remove said review, accept collaborator
            if (audit.approvals) {
                var newApprovals = audit.approvals.filter((approval) => !req.body.collaborators.some((collaborator) => sameUser(approval, collaborator)));
                update.approvals = newApprovals;
            }
        }

        if (req.body.customFields !== undefined && !utils.validCustomFields(req.body.customFields)) {
            Response.BadParameters(res, 'Invalid parameter: customFields');
            return;
        }
        // Name of a new company: used as query, a string only
        if (utils.isObject(req.body.company) && !req.body.company._id && !utils.isOptionalString(req.body.company.name)) {
            Response.BadParameters(res, 'Invalid parameter: company');
            return;
        }

        // Optional parameters
        if (req.body.name) update.name = req.body.name;
        if (req.body.date) update.date = req.body.date;
        if (req.body.date_start) update.date_start = req.body.date_start;
        if (req.body.date_end) update.date_end = req.body.date_end;
        if (req.body.client !== undefined) update.client = req.body.client
        if (req.body.company !== undefined) {
            update.company = {};
            if (req.body.company && req.body.company._id)
                update.company._id = req.body.company._id;
            else if (req.body.company && req.body.company.name)
                update.company.name = req.body.company.name
            else
                update.company = null
        }
        if (req.body.collaborators) update.collaborators = req.body.collaborators;
        if (req.body.reviewers) update.reviewers = req.body.reviewers;
        if (req.body.language && utils.validFilename(req.body.language)) update.language = req.body.language;
        // Scope: names of the page General information (hosts and services of the page Network kept by updateGeneral)
        var scopeNames;
        if (Array.isArray(req.body.scope)) {
            scopeNames = req.body.scope.map(item => utils.isObject(item) ? item.name : item);
            if (!scopeNames.every(name => typeof name === 'string')) {
                Response.BadParameters(res, 'Invalid parameter: scope');
                return;
            }
        }
        if (req.body.template) update.template = req.body.template;
        if (req.body.customFields) update.customFields = req.body.customFields;
        if (settings.reviews.enabled && settings.reviews.private.removeApprovalsUponUpdate) update.approvals = [];
        // Collaborators or reviewers changed: removed users must lose their open editing sessions
        var sameUsers = (users, current) => !users || users.map(idOf).sort().join() === (current || []).map(idOf).sort().join();
        var usersChanged = !sameUsers(req.body.collaborators, audit.collaborators) || !sameUsers(req.body.reviewers, audit.reviewers);

        Audit.updateGeneral(acl.isAllowed(req.decodedToken.role, 'audits:update-all'), req.params.auditId, req.decodedToken.id, update, scopeNames)
        .then(async msg => {
            await grantImages(req);
            if (usersChanged) resetCollaborationSessions(req.params.auditId);
            io.to(req.params.auditId).emit('updateAudit');
            Response.Ok(res, msg)
        })
        .catch(err => Response.Internal(res, err))
    });

    // Get audit network information
    app.get("/api/audits/:auditId/network", acl.hasPermission('audits:read'), function(req, res) {
        // #swagger.tags = ['Audit']

        Audit.getNetwork(acl.isAllowed(req.decodedToken.role, 'audits:read-all'), req.params.auditId, req.decodedToken.id)
        .then(msg => Response.Ok(res, msg))
        .catch(err => Response.Internal(res, err))
    });

    // Update audit network information
    app.put("/api/audits/:auditId/network", acl.hasPermission('audits:update'), async function(req, res) {
        // #swagger.tags = ['Audit']

        var settings = await Settings.getAll();

        var audit = await Audit.getAudit(acl.isAllowed(req.decodedToken.role, 'audits:read-all'), req.params.auditId, req.decodedToken.id);
        if (settings.reviews.enabled && audit.state !== "EDIT") {
            Response.Forbidden(res, "The audit is not in the EDIT state and therefore cannot be edited.");
            return;
        }

        if (req.body.scope !== undefined && !utils.isListOfObjects(req.body.scope)) {
            Response.BadParameters(res, 'Invalid parameter: scope');
            return;
        }

        var update = {};
        // Optional parameters
        if (req.body.scope) update.scope = req.body.scope;
        if (settings.reviews.enabled && settings.reviews.private.removeApprovalsUponUpdate) update.approvals = [];

        Audit.updateNetwork(acl.isAllowed(req.decodedToken.role, 'audits:update-all'), req.params.auditId, req.decodedToken.id, update)
        .then(msg => Response.Ok(res, msg))
        .catch(err => Response.Internal(res, err))
    });

    // Add finding to audit
    app.post("/api/audits/:auditId/findings", acl.hasPermission('audits:update'), async function(req, res) {
        // #swagger.tags = ['Audit']

        var settings = await Settings.getAll();
        var audit = await Audit.getAudit(acl.isAllowed(req.decodedToken.role, 'audits:read-all'), req.params.auditId, req.decodedToken.id);
        if (settings.reviews.enabled && audit.state !== "EDIT") {
            Response.Forbidden(res, "The audit is not in the EDIT state and therefore cannot be edited.");
            return;
        }
        if (!req.body.title) {
            Response.BadParameters(res, 'Missing some required parameters: title');
            return;
        }
        if (req.body.customFields && !utils.validCustomFields(req.body.customFields)) {
            Response.BadParameters(res, 'Invalid parameter: customFields');
            return;
        }

        var finding = {};
        // Required parameters
        finding.title = req.body.title;
        
        // Optional parameters
        if (req.body.vulnType) finding.vulnType = req.body.vulnType;
        if (req.body.description) finding.description = req.body.description;
        if (req.body.observation) finding.observation = req.body.observation;
        if (req.body.remediation) finding.remediation = req.body.remediation;
        if (req.body.remediationComplexity) finding.remediationComplexity = req.body.remediationComplexity;
        if (req.body.priority) finding.priority = req.body.priority;
        if (req.body.references) finding.references = req.body.references;
        if (req.body.cvssv3) finding.cvssv3 = req.body.cvssv3;
        if (req.body.poc) finding.poc = req.body.poc;
        if (req.body.scope) finding.scope = req.body.scope;
        if (req.body.status !== undefined) finding.status = req.body.status;
        if (req.body.category) finding.category = req.body.category
        if (req.body.customFields) finding.customFields = req.body.customFields

        if (settings.reviews.enabled && settings.reviews.private.removeApprovalsUponUpdate) {
            Audit.updateGeneral(acl.isAllowed(req.decodedToken.role, 'audits:update-all'), req.params.auditId, req.decodedToken.id, { approvals: [] });
        }

        Audit.createFinding(acl.isAllowed(req.decodedToken.role, 'audits:update-all'), req.params.auditId, req.decodedToken.id, finding)
        .then(async msg => {
            await grantImages(req);
            io.to(req.params.auditId).emit('updateAudit');
            Response.Ok(res, msg)
        })
        .catch(err => Response.Internal(res, err))
    });

    // Get finding of audit
    app.get("/api/audits/:auditId/findings/:findingId", acl.hasPermission('audits:read'), function(req, res) {
        // #swagger.tags = ['Audit']

        Audit.getFinding(acl.isAllowed(req.decodedToken.role, 'audits:read-all'), req.params.auditId, req.decodedToken.id, req.params.findingId)
        .then(msg => Response.Ok(res, msg))
        .catch(err => Response.Internal(res, err))
    });

    // Update finding of audit
    app.put("/api/audits/:auditId/findings/:findingId", acl.hasPermission('audits:update'), async function(req, res) {
        // #swagger.tags = ['Audit']

        var settings = await Settings.getAll();
        var audit = await Audit.getAudit(acl.isAllowed(req.decodedToken.role, 'audits:read-all'), req.params.auditId, req.decodedToken.id);
        if (settings.reviews.enabled && audit.state !== "EDIT") {
            Response.Forbidden(res, "The audit is not in the EDIT state and therefore cannot be edited.");
            return;
        }
        
        if (req.body.customFields && !utils.validCustomFields(req.body.customFields)) {
            Response.BadParameters(res, 'Invalid parameter: customFields');
            return;
        }

        var finding = {};
        // Optional parameters
        if (req.body.title) finding.title = req.body.title;
        if (req.body.vulnType) finding.vulnType = req.body.vulnType;
        if (!_.isNil(req.body.description)) finding.description = req.body.description;
        if (!_.isNil(req.body.observation)) finding.observation = req.body.observation;
        if (!_.isNil(req.body.remediation)) finding.remediation = req.body.remediation;
        if (req.body.remediationComplexity) finding.remediationComplexity = req.body.remediationComplexity;
        if (req.body.priority) finding.priority = req.body.priority;
        if (req.body.references) finding.references = req.body.references;
        if (req.body.cvssv3) finding.cvssv3 = req.body.cvssv3;
        if (!_.isNil(req.body.poc)) finding.poc = req.body.poc;
        if (!_.isNil(req.body.scope)) finding.scope = req.body.scope;
        if (req.body.status !== undefined) finding.status = req.body.status;
        if (req.body.category) finding.category = req.body.category
        if (req.body.customFields) finding.customFields = req.body.customFields

        if (settings.reviews.enabled && settings.reviews.private.removeApprovalsUponUpdate) {
            Audit.updateGeneral(acl.isAllowed(req.decodedToken.role, 'audits:update-all'), req.params.auditId, req.decodedToken.id, { approvals: [] });
        }

        Audit.updateFinding(acl.isAllowed(req.decodedToken.role, 'audits:update-all'), req.params.auditId, req.decodedToken.id, req.params.findingId, finding)
        .then(async msg => {
            await grantImages(req);
            io.to(req.params.auditId).emit('updateAudit');            
            Response.Ok(res, msg)
        })
        .catch(err => Response.Internal(res, err))
    });

    // Delete finding of audit
    app.delete("/api/audits/:auditId/findings/:findingId", acl.hasPermission('audits:update'), async function(req, res) {
        // #swagger.tags = ['Audit']

        var settings = await Settings.getAll();
        var audit = await Audit.getAudit(acl.isAllowed(req.decodedToken.role, 'audits:read-all'), req.params.auditId, req.decodedToken.id);
        if (settings.reviews.enabled && audit.state !== "EDIT") {
            Response.Forbidden(res, "The audit is not in the EDIT state and therefore cannot be edited.");
            return;
        }
        Audit.deleteFinding(acl.isAllowed(req.decodedToken.role, 'audits:update-all'), req.params.auditId, req.decodedToken.id, req.params.findingId)
        .then(msg => {
            io.to(req.params.auditId).emit('updateAudit');            
            Response.Ok(res, msg);
        })
        .catch(err => Response.Internal(res, err))
    });

    // Get section of audit
    app.get("/api/audits/:auditId/sections/:sectionId", acl.hasPermission('audits:read'), function(req, res) {
        // #swagger.tags = ['Audit']

        Audit.getSection(acl.isAllowed(req.decodedToken.role, 'audits:read-all'), req.params.auditId, req.decodedToken.id, req.params.sectionId)
        .then(msg => Response.Ok(res, msg))
        .catch(err => Response.Internal(res, err))
    });

    // Update section of audit
    app.put("/api/audits/:auditId/sections/:sectionId", acl.hasPermission('audits:update'), async function(req, res) {
        // #swagger.tags = ['Audit']

        var settings = await Settings.getAll();
        var audit = await Audit.getAudit(acl.isAllowed(req.decodedToken.role, 'audits:read-all'), req.params.auditId, req.decodedToken.id);
        if (settings.reviews.enabled && audit.state !== "EDIT") {
            Response.Forbidden(res, "The audit is not in the EDIT state and therefore cannot be edited.");
            return;
        }
        if (typeof req.body.customFields === 'undefined') {
            Response.BadParameters(res, 'Missing some required parameters: customFields');
            return;
        }
        if (!utils.validCustomFields(req.body.customFields)) {
            Response.BadParameters(res, 'Invalid parameter: customFields');
            return;
        }
        var section = {};
        // Mandatory parameters
        section.customFields = req.body.customFields;

        // For retrocompatibility with old section.text usage
        if (req.body.text) section.text = req.body.text; 

        if (settings.reviews.enabled && settings.reviews.private.removeApprovalsUponUpdate) {
            Audit.updateGeneral(acl.isAllowed(req.decodedToken.role, 'audits:update-all'), req.params.auditId, req.decodedToken.id, { approvals: [] });
        }

        Audit.updateSection(acl.isAllowed(req.decodedToken.role, 'audits:update-all'), req.params.auditId, req.decodedToken.id, req.params.sectionId, section)
        .then(async msg => {
            await grantImages(req);
            Response.Ok(res, msg)
        })
        .catch(err => Response.Internal(res, err))
    });

    // Generate Report for specific audit
    app.get("/api/audits/:auditId/generate", acl.hasPermission('audits:read'), function(req, res){
        // #swagger.tags = ['Audit']

        Audit.getAudit(acl.isAllowed(req.decodedToken.role, 'audits:read-all'), req.params.auditId, req.decodedToken.id)
        .then(async audit => {
            var settings = await Settings.getAll();

            if (settings.reviews.enabled && settings.reviews.public.mandatoryReview && audit.state !== 'APPROVED') {
                Response.Forbidden(res, "Audit was not approved therefore cannot be exported.");
                return;
            }

            if (!audit.template)
                throw ({fn: 'BadParameters', message: 'Template not defined'})

            var reportDoc = await reportGenerator.generateDoc(audit);
            Response.SendFile(res, `${audit.name.replace(/[\\\/:*?"<>|]/g, "")}.${audit.template.ext || 'docx'}`, reportDoc);
        })
        .catch(err => {
            if (err.code === "ENOENT")
                Response.BadParameters(res, 'Template File not found')
            else
                Response.Internal(res, err)
        });
    });

    // Update sort options of an audit
    app.put("/api/audits/:auditId/sortfindings", acl.hasPermission('audits:update'), async function(req, res) {
        // #swagger.tags = ['Audit']

        var settings = await Settings.getAll();
        var audit = await Audit.getAudit(acl.isAllowed(req.decodedToken.role, 'audits:read-all'), req.params.auditId, req.decodedToken.id);
        if (settings.reviews.enabled && audit.state !== "EDIT") {
            Response.Forbidden(res, "The audit is not in the EDIT state and therefore cannot be edited.");
            return;
        }
        if (req.body.sortFindings !== undefined && !utils.isListOfObjects(req.body.sortFindings)) {
            Response.BadParameters(res, 'Invalid parameter: sortFindings');
            return;
        }

        var update = {};
        // Optional parameters
        if (req.body.sortFindings) update.sortFindings = req.body.sortFindings;
        if (settings.reviews.enabled && settings.reviews.private.removeApprovalsUponUpdate) update.approvals = [];
        
        Audit.updateSortFindings(acl.isAllowed(req.decodedToken.role, 'audits:update-all'), req.params.auditId, req.decodedToken.id, update)
        .then(msg => {
            io.to(req.params.auditId).emit('updateAudit');
            Response.Ok(res, msg)
        })
        .catch(err => Response.Internal(res, err))
    });

    // Update finding position (oldIndex -> newIndex)
    app.put("/api/audits/:auditId/movefinding", acl.hasPermission('audits:update'), async function(req, res) {
        // #swagger.tags = ['Audit']

        var settings = await Settings.getAll();
        var audit = await Audit.getAudit(acl.isAllowed(req.decodedToken.role, 'audits:read-all'), req.params.auditId, req.decodedToken.id);
        if (settings.reviews.enabled && audit.state !== "EDIT") {
            Response.Forbidden(res, "The audit is not in the EDIT state and therefore cannot be edited.");
            return;
        }
        if (typeof req.body.oldIndex === 'undefined' || typeof req.body.newIndex === 'undefined') {
            Response.BadParameters(res, 'Missing some required parameters: oldIndex, newIndex');
            return;
        }
        
        var move = {};
        // Required parameters
        move.oldIndex = req.body.oldIndex;
        move.newIndex = req.body.newIndex;

        if (settings.reviews.enabled && settings.reviews.private.removeApprovalsUponUpdate) {
            Audit.updateGeneral(acl.isAllowed(req.decodedToken.role, 'audits:update-all'), req.params.auditId, req.decodedToken.id, { approvals: [] });
        }
        
        Audit.moveFindingPosition(acl.isAllowed(req.decodedToken.role, 'audits:update-all'), req.params.auditId, req.decodedToken.id, move)
        .then(msg => {
            io.to(req.params.auditId).emit('updateAudit');
            Response.Ok(res, msg)
        })
        .catch(err => Response.Internal(res, err))
    });

    // Give or remove a reviewer's approval to an audit.
    // Body {approved: true|false} (optional): approval set to this value (idempotent, a double click keeps it approved);
    // without it, the approval of the user is toggled
    app.put("/api/audits/:auditId/toggleApproval", acl.hasPermission('audits:review'), async function(req, res) {
        // #swagger.tags = ['Audit']

        const settings = await Settings.getAll();

        if (!settings.reviews.enabled) {
            Response.Forbidden(res, "Audit reviews are not enabled.");
            return;
        }
        if (req.body.approved !== undefined && typeof req.body.approved !== 'boolean') {
            Response.BadParameters(res, "Invalid parameter: approved");
            return;
        }

        var notApprovable = (audit) => audit.state !== "REVIEW" && audit.state !== "APPROVED";
        var audit = await Audit.findById(req.params.auditId).select('state approvals');
        if (!audit) {
            Response.NotFound(res, "Audit not found");
            return;
        }
        if (notApprovable(audit)) {
            Response.Forbidden(res, "The audit is not approvable in the current state.");
            return;
        }

        var approved = (typeof req.body.approved === 'boolean') ? req.body.approved : !audit.approvals.some(approval => String(approval) === req.decodedToken.id);
        if (approved && settings.reviews.public.blockApprovalWithOpenComments && await Audit.countOpenComments(req.params.auditId) > 0) {
            Response.Forbidden(res, "Open comments must be resolved before approving the audit.");
            return;
        }

        var updated = await Audit.setApproval(acl.isAllowed(req.decodedToken.role, 'audits:review-all'), req.params.auditId, req.decodedToken.id, approved, settings.reviews.public.minReviewers);
        if (!updated) {
            // Audit sent back to edition meanwhile, or user not allowed to review it
            var current = await Audit.findById(req.params.auditId).select('state');
            if (current && notApprovable(current))
                Response.Forbidden(res, "The audit is not approvable in the current state.");
            else
                Response.NotFound(res, "Audit not found or Insufficient Privileges");
            return;
        }
        resetCollaborationSessions(req.params.auditId); // State may have changed (approved): read-only sessions
        io.to(req.params.auditId).emit('updateAudit');
        Response.Ok(res, "Approval updated successfully.");
    });

    // Sets the audit state to EDIT or REVIEW
    app.put("/api/audits/:auditId/updateReadyForReview", acl.hasPermission('audits:update'), async function(req, res) {
        // #swagger.tags = ['Audit']

        const settings = await Settings.getAll();

        if (!settings.reviews.enabled) {
            Response.Forbidden(res, "Audit reviews are not enabled.");
            return;
        }

        var inReviewStates = (audit) => audit.state === "EDIT" || audit.state === "REVIEW";
        var audit = await Audit.getAudit(acl.isAllowed(req.decodedToken.role, 'audits:read-all'), req.params.auditId, req.decodedToken.id);
        if (!inReviewStates(audit)) {
            Response.Forbidden(res, "The audit is not in the proper state for this action.");
            return;
        }

        var isAdmin = acl.isAllowed(req.decodedToken.role, 'audits:update-all');
        // Other target states are ignored (access to the audit checked only)
        if (req.body.state !== "EDIT" && req.body.state !== "REVIEW") {
            Response.Ok(res, await Audit.updateGeneral(isAdmin, req.params.auditId, req.decodedToken.id, {}));
            return;
        }

        var updated = await Audit.setReviewState(isAdmin, req.params.auditId, req.decodedToken.id, req.body.state);
        if (!updated) {
            // Audit approved meanwhile, or user not allowed to modify it
            var current = await Audit.findById(req.params.auditId).select('state');
            if (current && !inReviewStates(current))
                Response.Forbidden(res, "The audit is not in the proper state for this action.");
            else
                Response.NotFound(res, "Audit not found or Insufficient Privileges");
            return;
        }
        resetCollaborationSessions(req.params.auditId); // Read-only sessions in review, read-write back in edition
        io.to(req.params.auditId).emit('updateAudit');
        Response.Ok(res, "Audit General updated successfully");
    });

    /* ### AUDIT REVIEW COMMENTS ### */
    // Any user with read access to the audit (reviewers included) can comment and reply, at any time.
    // Resolve/reopen: author of the comment or audit editors. Edit text: author. Delete: author or audits:update-all.

    var mongoose = require('mongoose');
    var COMMENT_TARGET_KINDS = ['general', 'network', 'finding', 'section'];
    var COMMENT_MAX_LENGTH = 10000;

    // Read access to the audit is required, write access (creator/collaborators) is returned
    var getCommentAccess = async function(req) {
        var access = await Audit.getUserAccess(
            req.params.auditId,
            req.decodedToken.id,
            acl.isAllowed(req.decodedToken.role, 'audits:read-all'),
            acl.isAllowed(req.decodedToken.role, 'audits:update-all')
        );
        if (!access.read)
            throw({fn: 'NotFound', message: 'Audit not found or Insufficient Privileges'});
        return access;
    }

    var validCommentText = text => typeof text === 'string' && text.trim().length > 0 && text.length <= COMMENT_MAX_LENGTH;

    // Returns the target to store or throws BadParameters
    var parseCommentTarget = async function(auditId, target) {
        if (!target || !COMMENT_TARGET_KINDS.includes(target.kind) || typeof target.field !== 'string' || !target.field || target.field.length > 200)
            throw({fn: 'BadParameters', message: 'Invalid comment target'});
        var result = {kind: target.kind, field: target.field};
        if (target.kind === 'finding' || target.kind === 'section') {
            var idField = (target.kind === 'finding') ? 'findingId' : 'sectionId';
            var arrayField = (target.kind === 'finding') ? 'findings' : 'sections';
            if (!mongoose.isObjectIdOrHexString(target[idField]) || !await Audit.exists({_id: auditId, [`${arrayField}._id`]: target[idField]}))
                throw({fn: 'BadParameters', message: `Invalid comment target: ${idField}`});
            result[idField] = target[idField];
        }
        return result;
    }

    var parseCommentQuote = function(quote) {
        if (quote === undefined || quote === null)
            return undefined;
        var validPart = (value, max, required) => (typeof value === 'string' && value.length <= max && (!required || value.length > 0)) || (!required && value === undefined);
        if (!validPart(quote.exact, 2000, true) || !validPart(quote.prefix, 200) || !validPart(quote.suffix, 200))
            throw({fn: 'BadParameters', message: 'Invalid comment quote'});
        return {exact: quote.exact, prefix: quote.prefix || '', suffix: quote.suffix || ''};
    }

    var parseCommentImage = function(image) {
        if (image === undefined || image === null)
            return undefined;
        var valid = typeof image.src === 'string' && image.src.length > 0 && image.src.length <= 300 &&
            (image.alt === undefined || (typeof image.alt === 'string' && image.alt.length <= 500)) &&
            (image.occurrence === undefined || (Number.isInteger(image.occurrence) && image.occurrence >= 0 && image.occurrence <= 10000));
        if (!valid)
            throw({fn: 'BadParameters', message: 'Invalid comment image'});
        return {src: image.src, alt: image.alt || '', occurrence: image.occurrence || 0};
    }

    var sendComments = async function(req, res) {
        io.to(req.params.auditId).emit('updateComments');
        Response.Ok(res, await Audit.getComments(req.params.auditId));
    }

    // Get comments of an audit
    app.get("/api/audits/:auditId/comments", acl.hasPermission('audits:read'), async function(req, res) {
        // #swagger.tags = ['Audit']
        try {
            await getCommentAccess(req);
            Response.Ok(res, await Audit.getComments(req.params.auditId));
        }
        catch (err) { Response.Internal(res, err) }
    });

    // Add a comment {target: {kind, findingId|sectionId, field}, quote: {exact, prefix, suffix} | image: {src, alt}, text}
    app.post("/api/audits/:auditId/comments", acl.hasPermission('audits:read'), async function(req, res) {
        // #swagger.tags = ['Audit']
        try {
            await getCommentAccess(req);
            if (!validCommentText(req.body.text))
                throw({fn: 'BadParameters', message: 'Missing or invalid parameter: text'});
            var now = new Date();
            var comment = {
                target: await parseCommentTarget(req.params.auditId, req.body.target),
                text: req.body.text,
                author: req.decodedToken.id,
                replies: [],
                resolved: false,
                createdAt: now,
                updatedAt: now
            };
            var quote = parseCommentQuote(req.body.quote);
            var image = parseCommentImage(req.body.image);
            if (quote && image)
                throw({fn: 'BadParameters', message: 'A comment targets a passage or an image, not both'});
            if (quote)
                comment.quote = quote;
            if (image)
                comment.image = image;
            await Audit.createComment(req.params.auditId, comment);
            await sendComments(req, res);
        }
        catch (err) { Response.Internal(res, err) }
    });

    // Reply to a comment {text}
    app.post("/api/audits/:auditId/comments/:commentId/replies", acl.hasPermission('audits:read'), async function(req, res) {
        // #swagger.tags = ['Audit']
        try {
            await getCommentAccess(req);
            if (!validCommentText(req.body.text))
                throw({fn: 'BadParameters', message: 'Missing or invalid parameter: text'});
            var now = new Date();
            await Audit.addCommentReply(req.params.auditId, req.params.commentId, {author: req.decodedToken.id, text: req.body.text, createdAt: now, updatedAt: now});
            await sendComments(req, res);
        }
        catch (err) { Response.Internal(res, err) }
    });

    // Update a comment {text} and/or {resolved}
    app.put("/api/audits/:auditId/comments/:commentId", acl.hasPermission('audits:read'), async function(req, res) {
        // #swagger.tags = ['Audit']
        try {
            var access = await getCommentAccess(req);
            var comment = await Audit.getComment(req.params.auditId, req.params.commentId);
            var isAuthor = String(comment.author) === req.decodedToken.id;
            var update = {};

            if (req.body.text !== undefined) {
                if (!isAuthor)
                    throw({fn: 'Forbidden', message: 'Only the author can edit a comment'});
                if (!validCommentText(req.body.text))
                    throw({fn: 'BadParameters', message: 'Invalid parameter: text'});
                update.text = req.body.text;
            }
            if (req.body.resolved !== undefined) {
                if (typeof req.body.resolved !== 'boolean')
                    throw({fn: 'BadParameters', message: 'Invalid parameter: resolved'});
                if (!isAuthor && !access.write)
                    throw({fn: 'Forbidden', message: 'Only the author or the audit editors can resolve a comment'});
                update.resolved = req.body.resolved;
                update.resolvedBy = req.body.resolved ? req.decodedToken.id : null;
                update.resolvedAt = req.body.resolved ? new Date() : null;
            }
            if (Object.keys(update).length === 0)
                throw({fn: 'BadParameters', message: 'Nothing to update: text or resolved required'});

            await Audit.updateComment(req.params.auditId, req.params.commentId, update);
            await sendComments(req, res);
        }
        catch (err) { Response.Internal(res, err) }
    });

    // Delete a comment
    app.delete("/api/audits/:auditId/comments/:commentId", acl.hasPermission('audits:read'), async function(req, res) {
        // #swagger.tags = ['Audit']
        try {
            await getCommentAccess(req);
            var comment = await Audit.getComment(req.params.auditId, req.params.commentId);
            if (String(comment.author) !== req.decodedToken.id && !acl.isAllowed(req.decodedToken.role, 'audits:update-all'))
                throw({fn: 'Forbidden', message: 'Only the author or an administrator can delete a comment'});
            await Audit.deleteComment(req.params.auditId, req.params.commentId);
            await sendComments(req, res);
        }
        catch (err) { Response.Internal(res, err) }
    });
}
