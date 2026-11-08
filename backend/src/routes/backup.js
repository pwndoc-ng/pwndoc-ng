module.exports = function(app) {

    var bodyParser = require('body-parser');
    var Response = require('../lib/httpResponse.js');
    var acl = require('../lib/auth').acl;
    var backup = require('../lib/backup');

    var restoreInProgress = false;

    // Global backup of the instance data (zip, encrypted when a password is given)
    app.post("/api/backup/export", acl.hasPermission('backup:export'), async function(req, res) {
        // #swagger.tags = ['Backup']

        var password = req.body && req.body.password;
        if (password !== undefined && password !== '' && typeof password !== 'string') {
            Response.BadParameters(res, 'Invalid password');
            return;
        }
        try {
            var buffer = await backup.createBackup(password || null);
            var date = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13);
            res.set({'Content-Type': 'application/octet-stream', 'Content-Length': buffer.length});
            Response.SendFile(res, `pwndoc-ng-backup-${date}.zip${password ? '.enc' : ''}`, buffer);
        }
        catch (err) {
            Response.Internal(res, err);
        }
    });

    // Restore of a global backup: replaces all the data of the instance
    // Body: the backup file. Password (encrypted backup): X-Backup-Password header, base64 encoded
    app.post("/api/backup/import", acl.hasPermission('backup:import'), bodyParser.raw({type: 'application/octet-stream', limit: '2gb'}), async function(req, res) {
        // #swagger.tags = ['Backup']

        if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
            Response.BadParameters(res, 'Backup file required (Content-Type: application/octet-stream)');
            return;
        }
        if (restoreInProgress) {
            Response.BadParameters(res, 'A restore is already in progress');
            return;
        }
        var password = null;
        if (req.headers['x-backup-password'])
            password = Buffer.from(req.headers['x-backup-password'], 'base64').toString('utf8');

        restoreInProgress = true;
        try {
            var result = await backup.restoreBackup(req.body, password);
            // Collaborative editing sessions contain the previous data: clients reconnect on the restored data
            var hocuspocus = app.get('hocuspocus');
            if (hocuspocus) hocuspocus.closeConnections();
            Response.Ok(res, result);
        }
        catch (err) {
            Response.Internal(res, err);
        }
        finally {
            restoreInProgress = false;
        }
    });
}
