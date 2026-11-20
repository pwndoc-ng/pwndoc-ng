// Requests to the AI run in the background: the route answers at once (202, {job}), then the browser asks for the result
// (GET /api/ai/jobs/:jobId) until it is ready. An answer of the AI can take minutes (reasoning models, quality check of
// a whole audit): no HTTP request stays open that long, which the proxies between the browser and pwndoc would cut (504).
// Jobs kept in memory for the user who started them, until some minutes after their end (lost when the backend restarts).

var crypto = require('crypto');

var KEEP = 10 * 60 * 1000; // Result kept after the end of a job
var MAX_RUNNING = 5; // Jobs running at once for a user

var jobs = new Map();

// Jobs ended for longer than KEEP removed
function cleanup(now = Date.now()) {
    for (var [id, job] of jobs) {
        if (job.end !== null && now - job.end > KEEP)
            jobs.delete(id);
    }
}

// Job of a user: work() run in the background, its result or its error ({status, message}) kept. Identifier of the job
function start(userId, work) {
    cleanup();
    var user = String(userId);
    var running = [...jobs.values()].filter(job => job.user === user && job.state === 'running').length;
    if (running >= MAX_RUNNING)
        throw {status: 429, message: 'Too many requests to the AI at once: wait for the end of the previous ones'};
    var job = {id: crypto.randomBytes(16).toString('hex'), user: user, state: 'running', end: null, result: null, error: null};
    jobs.set(job.id, job);
    Promise.resolve().then(work).then(
        result => Object.assign(job, {state: 'done', result: result, end: Date.now()}),
        err => Object.assign(job, {state: 'error', error: err, end: Date.now()})
    );
    return job.id;
}

// Job of a user, null when unknown, ended for too long or started by another user
function get(userId, jobId) {
    cleanup();
    var job = jobs.get(String(jobId));
    return job && job.user === String(userId) ? job : null;
}

module.exports = {start, get, cleanup, jobs, KEEP, MAX_RUNNING};
