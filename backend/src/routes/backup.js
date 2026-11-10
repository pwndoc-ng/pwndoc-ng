module.exports = function(app) {

    var bodyParser = require('body-parser');
    var Response = require('../lib/httpResponse.js');
    var acl = require('../lib/auth').acl;
    var backup = require('../lib/backup');

    // Backup creation or restore in progress: one operation at a time (a backup made during a restore would be inconsistent)
    var operation = null;

    async function exclusive(res, name, fn) {
        if (operation) {
            Response.BadParameters(res, `A backup ${operation} is already in progress`);
            return;
        }
        operation = name;
        try {
            await fn();
        }
        catch (err) {
            Response.Internal(res, err);
        }
        finally {
            operation = null;
        }
    }

    function validPassword(password) {
        return password === undefined || password === null || typeof password === 'string';
    }

    // Backups stored on the server
    app.get("/api/backups", acl.hasPermission('backups:read'), function(req, res) {
        // #swagger.tags = ['Backup']

        try {
            Response.Ok(res, backup.listBackups());
        }
        catch (err) {
            Response.Internal(res, err);
        }
    });

    // Creates a backup of the instance data and stores it on the server
    // Body: name, categories (data of a partial backup, all the data when not given), password (encryption, optional)
    app.post("/api/backups", acl.hasPermission('backups:create'), function(req, res) {
        // #swagger.tags = ['Backup']

        var body = req.body || {};
        if (body.name !== undefined && (typeof body.name !== 'string' || body.name.length > 100)) {
            Response.BadParameters(res, 'Invalid name');
            return;
        }
        if (!validPassword(body.password)) {
            Response.BadParameters(res, 'Invalid password');
            return;
        }
        exclusive(res, 'creation', async () => {
            var info = await backup.createStoredBackup({ name: (body.name || '').trim(), categories: body.categories, password: body.password || null });
            Response.Created(res, info);
        });
    });

    // Adds a backup file to the backups of the server (backup downloaded from this instance or another one)
    // Body: the backup file. File name: X-Backup-Filename header (URI encoded)
    app.post("/api/backups/upload", acl.hasPermission('backups:create'), bodyParser.raw({type: 'application/octet-stream', limit: '2gb'}), function(req, res) {
        // #swagger.tags = ['Backup']

        if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
            Response.BadParameters(res, 'Backup file required (Content-Type: application/octet-stream)');
            return;
        }
        var fileName = '';
        try {
            fileName = decodeURIComponent(req.headers['x-backup-filename'] || '');
        }
        catch (err) {}
        try {
            Response.Created(res, backup.addUploadedBackup(req.body, fileName));
        }
        catch (err) {
            Response.Internal(res, err);
        }
    });

    app.get("/api/backups/:backupId/download", acl.hasPermission('backups:read'), function(req, res) {
        // #swagger.tags = ['Backup']

        try {
            var stored = backup.readStoredBackup(req.params.backupId);
            var date = (stored.info.createdAt || stored.info.addedAt).replace(/[-:]/g, '').replace('T', '-').slice(0, 13);
            var name = (stored.info.name || 'backup').replace(/[^\p{Letter}\p{Mark}0-9_-]+/gu, '_').slice(0, 60);
            res.set({'Content-Type': 'application/octet-stream', 'Content-Length': stored.buffer.length});
            Response.SendFile(res, `pwndoc-ng-${name}-${date}.zip${stored.info.encrypted ? '.enc' : ''}`, stored.buffer);
        }
        catch (err) {
            Response.Internal(res, err);
        }
    });

    app.delete("/api/backups/:backupId", acl.hasPermission('backups:delete'), function(req, res) {
        // #swagger.tags = ['Backup']

        try {
            backup.deleteStoredBackup(req.params.backupId);
            Response.Ok(res, 'Backup deleted');
        }
        catch (err) {
            Response.Internal(res, err);
        }
    });

    // Restore of a backup stored on the server
    // Body: mode ('replace': the data of the categories is replaced, 'merge': documents added or updated, nothing deleted),
    // categories (all the categories of the backup when not given), password (encrypted backup)
    app.post("/api/backups/:backupId/restore", acl.hasPermission('backups:restore'), function(req, res) {
        // #swagger.tags = ['Backup']

        var body = req.body || {};
        if (!validPassword(body.password)) {
            Response.BadParameters(res, 'Invalid password');
            return;
        }
        exclusive(res, 'restore', async () => {
            var result = await backup.restoreStoredBackup(req.params.backupId, { mode: body.mode || 'replace', categories: body.categories, password: body.password || null });
            // Collaborative editing sessions contain the previous data: clients reconnect on the restored data
            var hocuspocus = app.get('hocuspocus');
            if (hocuspocus) hocuspocus.closeConnections();
            Response.Ok(res, result);
        });
    });
}
