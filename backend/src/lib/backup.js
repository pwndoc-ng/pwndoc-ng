// Global backup of the instance data (migration to another server or another MongoDB version)
//
// Archive: zip file with
//   manifest.json          format, version, date, number of documents per collection, template files
//   data/<Model>.json      raw documents of each collection (MongoDB Extended JSON: ObjectId, dates... are kept)
//   templates/<file>       report template files (report-templates directory)
// Optionally encrypted with a password: MAGIC | salt | iv | auth tag | AES-256-GCM(zip), key derived with scrypt.
//
// Restore replaces all the data of the instance: every collection is emptied then filled with the
// documents of the backup (same identifiers, references between documents stay consistent).

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var mongoose = require('mongoose');
var PizZip = require('pizzip');
var { EJSON } = mongoose.mongo.BSON;

var FORMAT = 'pwndoc-ng-backup';
var FORMAT_VERSION = 1;
var MAGIC = Buffer.from('PWNDOCNG-BACKUP-ENC1');
var SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

// Collections of the backup, in restore order
var MODELS = [
    'Settings', 'Language', 'AuditType', 'VulnerabilityType', 'VulnerabilityCategory', 'CustomField', 'CustomSection',
    'User', 'Company', 'Client', 'Template', 'Image', 'Vulnerability', 'VulnerabilityUpdate', 'Audit'
];

function templatesDir() {
    return path.join(__basedir, '..', 'report-templates');
}

// Template file name, refused if it could leave the templates directory
function templateFileName(template) {
    var name = `${template.name}.${template.ext || 'docx'}`;
    if (!template.name || name !== path.basename(name) || name.startsWith('.'))
        throw ({ fn: 'BadParameters', message: `Invalid template file name: ${name}` });
    return name;
}

function backupError(message) {
    return { fn: 'BadParameters', message: message };
}

async function readCollections() {
    var data = {};
    for (var name of MODELS)
        data[name] = await mongoose.model(name).collection.find({}).toArray();
    return data;
}

// Backup of the instance: zip buffer, encrypted when a password is given
async function createBackup(password) {
    var data = await readCollections();
    // Sessions are not exported: refresh tokens are only valid on the source instance
    data.User.forEach(user => delete user.refreshTokens);

    var zip = new PizZip();
    var manifest = { format: FORMAT, version: FORMAT_VERSION, createdAt: new Date().toISOString(), collections: {}, templates: [] };
    MODELS.forEach(name => {
        manifest.collections[name] = data[name].length;
        zip.file(`data/${name}.json`, EJSON.stringify(data[name], { relaxed: false }));
    });
    data.Template.forEach(template => {
        var fileName = templateFileName(template);
        var filePath = path.join(templatesDir(), fileName);
        if (fs.existsSync(filePath)) {
            zip.file(`templates/${fileName}`, fs.readFileSync(filePath));
            manifest.templates.push(fileName);
        }
    });
    zip.file('manifest.json', JSON.stringify(manifest, null, 2));

    var buffer = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
    return password ? encrypt(buffer, password) : buffer;
}

function encrypt(buffer, password) {
    var salt = crypto.randomBytes(16);
    var iv = crypto.randomBytes(12);
    var key = crypto.scryptSync(password, salt, 32, SCRYPT);
    var cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    var encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
    return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), encrypted]);
}

function isEncrypted(buffer) {
    return buffer.length > MAGIC.length && buffer.subarray(0, MAGIC.length).equals(MAGIC);
}

function decrypt(buffer, password) {
    var offset = MAGIC.length;
    var salt = buffer.subarray(offset, offset += 16);
    var iv = buffer.subarray(offset, offset += 12);
    var tag = buffer.subarray(offset, offset += 16);
    var key = crypto.scryptSync(password, salt, 32, SCRYPT);
    var decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    try {
        return Buffer.concat([decipher.update(buffer.subarray(offset)), decipher.final()]);
    }
    catch (err) {
        throw backupError('Wrong password or corrupted backup');
    }
}

// Reads and checks a backup: nothing is modified if the file is not a complete valid backup
function parseBackup(buffer, password) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0)
        throw backupError('Empty backup file');
    if (isEncrypted(buffer)) {
        if (!password)
            throw backupError('This backup is encrypted: password required');
        buffer = decrypt(buffer, password);
    }

    var zip;
    try {
        zip = new PizZip(buffer);
    }
    catch (err) {
        throw backupError('Invalid backup file');
    }
    var manifestFile = zip.file('manifest.json');
    if (!manifestFile)
        throw backupError('Invalid backup file: manifest.json not found');
    var manifest;
    try {
        manifest = JSON.parse(manifestFile.asText());
    }
    catch (err) {
        throw backupError('Invalid backup file: unreadable manifest');
    }
    if (manifest.format !== FORMAT)
        throw backupError('Invalid backup file: not a pwndoc-ng backup');
    if (manifest.version > FORMAT_VERSION)
        throw backupError(`Backup made by a newer version of pwndoc-ng (format ${manifest.version})`);

    var data = {};
    MODELS.forEach(name => {
        var file = zip.file(`data/${name}.json`);
        if (!file)
            throw backupError(`Invalid backup file: data/${name}.json not found`);
        try {
            data[name] = EJSON.parse(file.asText(), { relaxed: false });
        }
        catch (err) {
            throw backupError(`Invalid backup file: unreadable data/${name}.json`);
        }
        if (!Array.isArray(data[name]))
            throw backupError(`Invalid backup file: data/${name}.json is not a list`);
        if (manifest.collections && manifest.collections[name] !== undefined && manifest.collections[name] !== data[name].length)
            throw backupError(`Invalid backup file: data/${name}.json is incomplete`);
    });

    var templates = {};
    data.Template.forEach(template => {
        var fileName = templateFileName(template);
        var file = zip.file(`templates/${fileName}`);
        if (file) templates[fileName] = file.asNodeBuffer();
    });
    return { manifest, data, templates };
}

async function replaceCollections(data) {
    for (var name of MODELS) {
        var collection = mongoose.model(name).collection;
        await collection.deleteMany({});
        if (data[name].length > 0)
            await collection.insertMany(data[name], { ordered: true });
    }
}

// Restore of a backup: replaces all the data. If the restore fails, the previous data is put back.
async function restoreBackup(buffer, password) {
    var backup = parseBackup(buffer, password);

    var previous = await readCollections();
    var previousTemplates = {};
    previous.Template.forEach(template => {
        try {
            var fileName = templateFileName(template);
            var filePath = path.join(templatesDir(), fileName);
            if (fs.existsSync(filePath)) previousTemplates[fileName] = fs.readFileSync(filePath);
        }
        catch (err) {} // Previous template with an invalid name: no file to keep
    });

    try {
        await replaceCollections(backup.data);
        // Template files: files of the previous templates are replaced by the files of the backup
        Object.keys(previousTemplates).forEach(fileName => fs.unlinkSync(path.join(templatesDir(), fileName)));
        Object.entries(backup.templates).forEach(([fileName, content]) => fs.writeFileSync(path.join(templatesDir(), fileName), content));
    }
    catch (err) {
        console.log('Backup restore failed, previous data restored:', err.message);
        await replaceCollections(previous);
        Object.keys(backup.templates).forEach(fileName => { try { fs.unlinkSync(path.join(templatesDir(), fileName)) } catch (e) {} });
        Object.entries(previousTemplates).forEach(([fileName, content]) => fs.writeFileSync(path.join(templatesDir(), fileName), content));
        throw backupError(`Restore failed, the previous data has been kept: ${err.message}`);
    }

    var restored = {};
    MODELS.forEach(name => restored[name] = backup.data[name].length);
    return { createdAt: backup.manifest.createdAt, collections: restored, templates: Object.keys(backup.templates).length };
}

module.exports = { createBackup, restoreBackup, parseBackup, isEncrypted, MODELS };
