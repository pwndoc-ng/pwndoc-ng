// AI assistance (lib/ai.js), when enabled in the settings: assisted writing of the editors, quality check of the audits
// by the AI, test of the connection to the inference server. The answers are proposals, never applied automatically.
// The requests to the AI run in the background (lib/ai-jobs.js): the routes answer at once with the job (202, {job}),
// whose result is asked with GET /api/ai/jobs/:jobId. The parameters, the rights and the settings are checked before.
module.exports = function(app) {

    var Response = require('../lib/httpResponse.js');
    var acl = require('../lib/auth').acl;
    var mongoose = require('mongoose');
    var Settings = mongoose.model('Settings');
    var Audit = mongoose.model('Audit');
    var ai = require('../lib/ai');
    var aiJobs = require('../lib/ai-jobs');

    // Errors of the AI (status: 403 disabled, 413, 422, 502 server not available...) or of the database
    var failed = (res, err) => (err && err.status) ? Response.Custom(res, 'error', err.status, err.message) : Response.Internal(res, err);

    // Settings of the AI server when the AI is enabled
    async function aiConfig() {
        var settings = await Settings.getAll();
        if (!settings || !settings.ai || !settings.ai.enabled)
            throw {status: 403, message: 'AI assistance is disabled'};
        return settings.ai.private.toObject ? settings.ai.private.toObject() : settings.ai.private;
    }

    // Request to the AI run in the background for the user: job answered at once
    var background = (req, res, work) => Response.Accepted(res, {job: aiJobs.start(req.decodedToken.id, work)});

    // Audit readable by the user (company, client and scope: pseudonymization)
    var readableAudit = (req, auditId) => Audit.getAudit(acl.isAllowed(req.decodedToken.role, 'audits:read-all'), auditId, req.decodedToken.id);

    // Assisted writing: {action, html, instruction (custom action), auditId (audit of the text: pseudonymization)} → job of
    // {html, missing}
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
            ai.checkConfig(config);
            var terms = auditId ? ai.auditTerms(await readableAudit(req, auditId)) : [];
            background(req, res, () => ai.assist(config, {action, html, instruction}, {terms}));
        }
        catch (err) {
            failed(res, err);
        }
    });

    // Quality check of the findings of an audit by the AI: stored (last check shown to the users of the audit). Job of
    // {at, issues}
    app.post("/api/audits/:auditId/qa/ai", acl.hasPermission('ai:qa'), async function(req, res) {
        // #swagger.tags = ['AI']

        try {
            var config = await aiConfig();
            ai.checkConfig(config);
            var audit = await readableAudit(req, req.params.auditId);
            background(req, res, async () => {
                var issues = await ai.qaIssues(config, audit.toObject(), {terms: ai.auditTerms(audit)});
                await Audit.setQaAi(req.params.auditId, req.decodedToken.id, issues);
                return {at: new Date(), issues: issues};
            });
        }
        catch (err) {
            failed(res, err);
        }
    });

    // Test of the connection to the AI server with the saved settings (also when the AI is disabled). Job of {models,
    // answer, reasoningTokens, seconds}
    app.post("/api/ai/test", acl.hasPermission('settings:update'), async function(req, res) {
        // #swagger.tags = ['AI']

        try {
            var settings = await Settings.getAll();
            var config = settings.ai.private.toObject ? settings.ai.private.toObject() : settings.ai.private;
            ai.checkConfig(config);
            background(req, res, () => ai.testConnection(config));
        }
        catch (err) {
            failed(res, err);
        }
    });

    // Request to the AI run in the background (started by the user): {state: 'running'}, {state: 'done', result}, or the
    // error of the request (status and message). Unknown, ended for too long or of another user: 404
    app.get("/api/ai/jobs/:jobId", acl.hasPermission('validtoken'), function(req, res) {
        // #swagger.tags = ['AI']

        var job = aiJobs.get(req.decodedToken.id, req.params.jobId);
        if (!job)
            Response.NotFound(res, 'Request to the AI not found: ended for too long, or the server was restarted');
        else if (job.state === 'error')
            failed(res, job.error);
        else
            Response.Ok(res, job.state === 'done' ? {state: 'done', result: job.result} : {state: 'running'});
    });
}
