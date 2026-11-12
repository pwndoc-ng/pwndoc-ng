// AI assistance (lib/ai.js), when enabled in the settings: assisted writing of the editors, quality check of the audits
// by the AI, test of the connection to the inference server. The answers are proposals, never applied automatically.
module.exports = function(app) {

    var Response = require('../lib/httpResponse.js');
    var acl = require('../lib/auth').acl;
    var mongoose = require('mongoose');
    var Settings = mongoose.model('Settings');
    var Audit = mongoose.model('Audit');
    var ai = require('../lib/ai');

    // Errors of the AI (status: 403 disabled, 413, 422, 502 server not available...) or of the database
    var failed = (res, err) => (err && err.status) ? Response.Custom(res, 'error', err.status, err.message) : Response.Internal(res, err);

    // Settings of the AI server when the AI is enabled
    async function aiConfig() {
        var settings = await Settings.getAll();
        if (!settings || !settings.ai || !settings.ai.enabled)
            throw {status: 403, message: 'AI assistance is disabled'};
        return settings.ai.private.toObject ? settings.ai.private.toObject() : settings.ai.private;
    }

    // Audit readable by the user (company, client and scope: pseudonymization)
    var readableAudit = (req, auditId) => Audit.getAudit(acl.isAllowed(req.decodedToken.role, 'audits:read-all'), auditId, req.decodedToken.id);

    // Assisted writing: {action, html, instruction (custom action), auditId (audit of the text: pseudonymization)} → {html}
    app.post("/api/ai/assist", acl.hasPermission('ai:assist'), async function(req, res) {
        // #swagger.tags = ['AI']

        var {action, html, instruction, auditId} = req.body;
        var validInstruction = action !== 'custom' || (typeof instruction === 'string' && instruction.trim() && instruction.length <= 2000);
        if (!Object.keys(ai.ACTIONS).includes(action) || typeof html !== 'string' || !validInstruction || (auditId !== undefined && typeof auditId !== 'string')) {
            Response.BadParameters(res, 'Required parameters: action, html, instruction (custom action)');
            return;
        }
        try {
            var config = await aiConfig();
            var terms = auditId ? ai.auditTerms(await readableAudit(req, auditId)) : [];
            Response.Ok(res, await ai.assist(config, {action, html, instruction}, {terms}));
        }
        catch (err) {
            failed(res, err);
        }
    });

    // Quality check of the findings of an audit by the AI: stored (last check shown to the users of the audit)
    app.post("/api/audits/:auditId/qa/ai", acl.hasPermission('ai:qa'), async function(req, res) {
        // #swagger.tags = ['AI']

        try {
            var config = await aiConfig();
            var audit = await readableAudit(req, req.params.auditId);
            var issues = await ai.qaIssues(config, audit.toObject(), {terms: ai.auditTerms(audit)});
            await Audit.setQaAi(req.params.auditId, req.decodedToken.id, issues);
            Response.Ok(res, {at: new Date(), issues: issues});
        }
        catch (err) {
            failed(res, err);
        }
    });

    // Test of the connection to the AI server with the saved settings (also when the AI is disabled)
    app.post("/api/ai/test", acl.hasPermission('settings:update'), async function(req, res) {
        // #swagger.tags = ['AI']

        try {
            var settings = await Settings.getAll();
            Response.Ok(res, await ai.testConnection(settings.ai.private.toObject ? settings.ai.private.toObject() : settings.ai.private));
        }
        catch (err) {
            failed(res, err);
        }
    });
}
