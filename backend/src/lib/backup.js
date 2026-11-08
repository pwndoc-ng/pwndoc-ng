// Backups of the instance data (migration to another server, copy of some data, restore point)
//
// Archive: zip file with
//   manifest.json          format, version, name, date, type (full / partial), categories, number of documents
//                          per collection, template files
//   data/<Model>.json      raw documents of the collections of the categories (MongoDB Extended JSON: ObjectId,
//                          dates... are kept)
//   templates/<file>       report template files (templates category)
// Encrypted with a password:
//   MAGIC2 | header length (uint32 BE) | header (manifest, JSON) | salt | iv | auth tag | AES-256-GCM(zip)
//   The header is the additional authenticated data of GCM: the name, date and content of an encrypted backup are
//   known without the password, and cannot be modified. Key derived from the password with scrypt.
//   Backups of the first version (MAGIC1: no header, every collection) are still read.
//
// Backups are stored on the server (backup directory): <id>.backup (archive) and <id>.json (information).
//
// Restore of the selected categories of a backup:
//   replace: the collections of the categories are emptied, then filled with the documents of the backup
//   merge: the documents of the backup are added, or replace the documents with the same identifier; nothing is
//          deleted (settings, a single document, are replaced)
// If the restore fails, the previous data of the collections and the previous template files are put back.

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var mongoose = require('mongoose');
var PizZip = require('pizzip');
var { EJSON } = mongoose.mongo.BSON;

var FORMAT = 'pwndoc-ng-backup';
var FORMAT_VERSION = 2;
var MAGIC1 = Buffer.from('PWNDOCNG-BACKUP-ENC1');
var MAGIC2 = Buffer.from('PWNDOCNG-BACKUP-ENC2');
var SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
var DISK_MARGIN = 50 * 1024 * 1024; // Free space kept on the disk after writing a backup
var ID_FORMAT = /^\d{8}-\d{6}-[a-f0-9]{8}$/;

// Collections of the backups, in restore order
var MODELS = [
    'Settings', 'Language', 'AuditType', 'VulnerabilityType', 'VulnerabilityCategory', 'CustomField', 'CustomSection',
    'User', 'Company', 'Client', 'Template', 'Image', 'Vulnerability', 'VulnerabilityUpdate', 'Audit'
];

// Data that can be selected in a backup, and their collections
var CATEGORIES = {
    audits: ['Audit'],
    images: ['Image'],
    vulnerabilities: ['Vulnerability', 'VulnerabilityUpdate'],
    users: ['User'],
    companies: ['Company'],
    clients: ['Client'],
    templates: ['Template'],
    languages: ['Language'],
    auditTypes: ['AuditType'],
    vulnerabilityTypes: ['VulnerabilityType'],
    vulnerabilityCategories: ['VulnerabilityCategory'],
    customFields: ['CustomField'],
    customSections: ['CustomSection'],
    settings: ['Settings']
};
var CATEGORY_NAMES = Object.keys(CATEGORIES);

// Categories always saved with another one: images of the audits and vulnerabilities, companies of the clients
var DEPENDENCIES = { audits: ['images'], vulnerabilities: ['images'], clients: ['companies'] };

function backupError(message) {
    return { fn: 'BadParameters', message: message };
}

function notFound(message) {
    return { fn: 'NotFound', message: message };
}

function templatesDir() {
    return path.join(__basedir, '..', 'report-templates');
}

function backupDir() {
    var dir = path.join(__basedir, '..', 'backup');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

// Template file name, refused if it could leave the templates directory
function templateFileName(template) {
    var name = `${template.name}.${template.ext || 'docx'}`;
    if (!template.name || name !== path.basename(name) || name.startsWith('.'))
        throw backupError(`Invalid template file name: ${name}`);
    return name;
}

// Checked list of categories, with their dependencies, in the order of CATEGORIES. All the categories when none is given.
function normalizeCategories(categories, withDependencies = true) {
    if (categories === undefined || categories === null)
        return CATEGORY_NAMES.slice();
    if (!Array.isArray(categories) || categories.length === 0)
        throw backupError('Select the data of the backup');
    var unknown = categories.filter(category => !CATEGORY_NAMES.includes(category));
    if (unknown.length > 0)
        throw backupError(`Unknown data: ${unknown.join(', ')}`);
    var selected = new Set(categories);
    if (withDependencies)
        categories.forEach(category => (DEPENDENCIES[category] || []).forEach(dependency => selected.add(dependency)));
    return CATEGORY_NAMES.filter(category => selected.has(category));
}

function modelsOf(categories) {
    var models = new Set(categories.flatMap(category => CATEGORIES[category]));
    return MODELS.filter(model => models.has(model));
}

async function readCollections(models) {
    var data = {};
    for (var name of models)
        data[name] = await mongoose.model(name).collection.find({}).toArray();
    return data;
}

function readTemplateFiles(templates) {
    var files = {};
    templates.forEach(template => {
        try {
            var fileName = templateFileName(template);
            var filePath = path.join(templatesDir(), fileName);
            if (fs.existsSync(filePath)) files[fileName] = fs.readFileSync(filePath);
        }
        catch (err) {} // Template with an invalid name: no file
    });
    return files;
}

// Backup of the instance data: all the data, or the selected categories. Encrypted when a password is given.
// Returns the archive and its manifest.
async function createBackup({ name, categories, password } = {}) {
    categories = normalizeCategories(categories);
    var models = modelsOf(categories);
    var data = await readCollections(models);
    // Sessions are not saved: refresh tokens are only valid on the source instance
    if (data.User) data.User.forEach(user => delete user.refreshTokens);

    var zip = new PizZip();
    var manifest = {
        format: FORMAT,
        version: FORMAT_VERSION,
        name: name || '',
        createdAt: new Date().toISOString(),
        type: categories.length === CATEGORY_NAMES.length ? 'full' : 'partial',
        categories: categories,
        collections: {},
        templates: []
    };
    models.forEach(model => {
        manifest.collections[model] = data[model].length;
        zip.file(`data/${model}.json`, EJSON.stringify(data[model], { relaxed: false }));
    });
    if (data.Template) {
        Object.entries(readTemplateFiles(data.Template)).forEach(([fileName, content]) => {
            zip.file(`templates/${fileName}`, content);
            manifest.templates.push(fileName);
        });
    }
    zip.file('manifest.json', JSON.stringify(manifest, null, 2));

    var buffer = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
    return { buffer: password ? encrypt(buffer, password, manifest) : buffer, manifest: manifest };
}

function deriveKey(password, salt) {
    return crypto.scryptSync(password, salt, 32, SCRYPT);
}

function encrypt(buffer, password, manifest) {
    var header = Buffer.from(JSON.stringify(manifest));
    var headerLength = Buffer.alloc(4);
    headerLength.writeUInt32BE(header.length);
    var salt = crypto.randomBytes(16);
    var iv = crypto.randomBytes(12);
    var cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(password, salt), iv);
    cipher.setAAD(header);
    var encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
    return Buffer.concat([MAGIC2, headerLength, header, salt, iv, cipher.getAuthTag(), encrypted]);
}

function startsWith(buffer, magic) {
    return buffer.length > magic.length && buffer.subarray(0, magic.length).equals(magic);
}

function isEncrypted(buffer) {
    return startsWith(buffer, MAGIC1) || startsWith(buffer, MAGIC2);
}

// Header of an encrypted backup (version 2): { header, offset of the encrypted part }
function readHeader(buffer) {
    var offset = MAGIC2.length;
    if (buffer.length < offset + 4)
        throw backupError('Invalid backup file');
    var length = buffer.readUInt32BE(offset);
    offset += 4;
    if (length > 10 * 1024 * 1024 || buffer.length < offset + length + 44)
        throw backupError('Invalid backup file');
    var header = buffer.subarray(offset, offset + length);
    try {
        var manifest = JSON.parse(header.toString('utf8'));
    }
    catch (err) {
        throw backupError('Invalid backup file: unreadable header');
    }
    return { header, manifest, offset: offset + length };
}

function decrypt(buffer, password) {
    var aad = null;
    var offset = MAGIC1.length;
    if (startsWith(buffer, MAGIC2)) {
        var header = readHeader(buffer);
        aad = header.header;
        offset = header.offset;
    }
    var salt = buffer.subarray(offset, offset += 16);
    var iv = buffer.subarray(offset, offset += 12);
    var tag = buffer.subarray(offset, offset += 16);
    var decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(password, salt), iv);
    decipher.setAuthTag(tag);
    if (aad) decipher.setAAD(aad);
    try {
        return Buffer.concat([decipher.update(buffer.subarray(offset)), decipher.final()]);
    }
    catch (err) {
        throw backupError('Wrong password or corrupted backup');
    }
}

// Checked manifest: categories of the backup (backups of the first version contain every collection)
function checkManifest(manifest) {
    if (!manifest || typeof manifest !== 'object' || manifest.format !== FORMAT)
        throw backupError('Invalid backup file: not a pwndoc-ng backup');
    if (typeof manifest.version !== 'number' || manifest.version > FORMAT_VERSION)
        throw backupError(`Backup made by a newer version of pwndoc-ng (format ${manifest.version})`);
    if (manifest.version < 2)
        manifest.categories = CATEGORY_NAMES.slice();
    else {
        try {
            manifest.categories = normalizeCategories(manifest.categories, false);
        }
        catch (err) {
            throw backupError(`Invalid backup file: ${err.message}`);
        }
    }
    manifest.type = manifest.categories.length === CATEGORY_NAMES.length ? 'full' : 'partial';
    return manifest;
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
    checkManifest(manifest);

    var data = {};
    modelsOf(manifest.categories).forEach(name => {
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
    (data.Template || []).forEach(template => {
        var fileName = templateFileName(template);
        var file = zip.file(`templates/${fileName}`);
        if (file) templates[fileName] = file.asNodeBuffer();
    });
    return { manifest, data, templates };
}

// Information of a backup file without its data. Content of the backups encrypted with the first version: unknown
// (categories: null) until the restore.
function readInfo(buffer) {
    if (startsWith(buffer, MAGIC2)) {
        var manifest = checkManifest(readHeader(buffer).manifest);
        return { name: manifest.name, createdAt: manifest.createdAt, type: manifest.type, categories: manifest.categories, collections: manifest.collections || {}, encrypted: true };
    }
    if (startsWith(buffer, MAGIC1))
        return { name: '', createdAt: null, type: null, categories: null, collections: {}, encrypted: true };
    var backup = parseBackup(buffer);
    return { name: backup.manifest.name || '', createdAt: backup.manifest.createdAt, type: backup.manifest.type, categories: backup.manifest.categories, collections: backup.manifest.collections || {}, encrypted: false };
}

// Text of a duplicate key error (merge restore): '<Model>: { username: "admin" }'
function conflictsMessage(model, err) {
    var errors = err.writeErrors || (err.code === 11000 ? [err] : []);
    if (errors.length === 0)
        return null;
    var keys = errors.slice(0, 5).map(error => {
        var message = error.errmsg || (error.err && error.err.errmsg) || error.message || '';
        var key = message.match(/dup key: (\{.*\})/);
        return key ? key[1] : message;
    });
    return `${model}: ${keys.join(', ')}${errors.length > 5 ? ` (${errors.length} conflicts)` : ''}`;
}

async function replaceCollection(name, documents) {
    var collection = mongoose.model(name).collection;
    await collection.deleteMany({});
    if (documents.length > 0)
        await collection.insertMany(documents, { ordered: true });
}

async function mergeCollection(name, documents) {
    if (name === 'Settings') // Single document
        return replaceCollection(name, documents);
    if (documents.length === 0)
        return;
    try {
        await mongoose.model(name).collection.bulkWrite(
            documents.map(document => ({ replaceOne: { filter: { _id: document._id }, replacement: document, upsert: true } })),
            { ordered: false }
        );
    }
    catch (err) {
        var conflicts = conflictsMessage(name, err);
        throw conflicts ? new Error(`documents in conflict with the current data (same unique value, other identifier): ${conflicts}`) : err;
    }
}

// Restore of a backup: the selected categories (all the categories of the backup by default), replaced or merged.
// If the restore fails, the previous data is put back.
async function restoreBackup(buffer, { password, mode = 'replace', categories } = {}) {
    if (!['replace', 'merge'].includes(mode))
        throw backupError('Invalid restore mode');
    var backup = parseBackup(buffer, password);
    var selected = categories === undefined || categories === null ? backup.manifest.categories : normalizeCategories(categories, false);
    var missing = selected.filter(category => !backup.manifest.categories.includes(category));
    if (missing.length > 0)
        throw backupError(`Data not in the backup: ${missing.join(', ')}`);
    var models = modelsOf(selected);

    // Previous state of the collections and template files modified by the restore
    var previous = await readCollections(models);
    var previousFiles = {}; // file name: previous content (null: no file)
    var keepFile = (fileName) => {
        if (!(fileName in previousFiles)) {
            var filePath = path.join(templatesDir(), fileName);
            previousFiles[fileName] = fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
        }
    };
    var restoreTemplates = models.includes('Template');
    if (restoreTemplates) {
        if (mode === 'replace')
            Object.keys(readTemplateFiles(previous.Template)).forEach(keepFile);
        Object.keys(backup.templates).forEach(keepFile);
    }

    try {
        for (var name of models) {
            if (mode === 'replace') await replaceCollection(name, backup.data[name]);
            else await mergeCollection(name, backup.data[name]);
        }
        if (restoreTemplates) {
            // Replace: files of the previous templates are replaced by the files of the backup
            if (mode === 'replace')
                Object.entries(previousFiles).forEach(([fileName, content]) => { if (content) fs.unlinkSync(path.join(templatesDir(), fileName)) });
            Object.entries(backup.templates).forEach(([fileName, content]) => fs.writeFileSync(path.join(templatesDir(), fileName), content));
        }
    }
    catch (err) {
        console.log('Backup restore failed, previous data restored:', err.message);
        for (var model of models)
            await replaceCollection(model, previous[model]);
        Object.entries(previousFiles).forEach(([fileName, content]) => {
            var filePath = path.join(templatesDir(), fileName);
            if (content) fs.writeFileSync(filePath, content);
            else { try { fs.unlinkSync(filePath) } catch (e) {} }
        });
        throw backupError(`Restore failed, the previous data has been kept: ${err.message}`);
    }

    var restored = {};
    models.forEach(name => restored[name] = backup.data[name].length);
    return { name: backup.manifest.name || '', createdAt: backup.manifest.createdAt, mode: mode, categories: selected, collections: restored, templates: restoreTemplates ? Object.keys(backup.templates).length : 0 };
}

/*
*** Backups stored on the server ***
*/

function newId() {
    var date = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    return `${date}-${crypto.randomBytes(4).toString('hex')}`;
}

function storedPaths(id) {
    if (typeof id !== 'string' || !ID_FORMAT.test(id))
        throw notFound('Backup not found');
    var dir = backupDir();
    return { archive: path.join(dir, `${id}.backup`), info: path.join(dir, `${id}.json`) };
}

function checkDiskSpace(size) {
    var stats = fs.statfsSync(backupDir());
    var available = Number(stats.bavail) * Number(stats.bsize);
    if (available < size + DISK_MARGIN)
        throw backupError(`Not enough disk space: ${Math.ceil((size + DISK_MARGIN) / 1048576)} MB needed, ${Math.floor(available / 1048576)} MB available`);
}

function writeStored(buffer, info) {
    checkDiskSpace(buffer.length);
    var id = newId();
    var paths = storedPaths(id);
    info = Object.assign({ id: id }, info, { addedAt: new Date().toISOString() });
    fs.writeFileSync(paths.archive, buffer);
    fs.writeFileSync(paths.info, JSON.stringify(info, null, 2));
    return Object.assign({ size: buffer.length }, info);
}

function getStoredInfo(id) {
    var paths = storedPaths(id);
    if (!fs.existsSync(paths.archive) || !fs.existsSync(paths.info))
        throw notFound('Backup not found');
    var info = JSON.parse(fs.readFileSync(paths.info, 'utf8'));
    info.id = id;
    info.size = fs.statSync(paths.archive).size;
    return info;
}

// Backups stored on the server, most recent first
function listBackups() {
    return fs.readdirSync(backupDir())
        .filter(file => file.endsWith('.json') && ID_FORMAT.test(file.slice(0, -5)))
        .map(file => {
            try { return getStoredInfo(file.slice(0, -5)) }
            catch (err) { return null } // Incomplete or unreadable backup
        })
        .filter(info => info)
        .sort((a, b) => (b.createdAt || b.addedAt).localeCompare(a.createdAt || a.addedAt));
}

// Creates a backup and stores it on the server
async function createStoredBackup({ name, categories, password } = {}) {
    var backup = await createBackup({ name, categories, password });
    var manifest = backup.manifest;
    return writeStored(backup.buffer, {
        name: manifest.name, createdAt: manifest.createdAt, type: manifest.type, categories: manifest.categories,
        collections: manifest.collections, encrypted: !!password, origin: 'created'
    });
}

// Stores a backup file uploaded from another instance (or downloaded before): the file is checked first
function addUploadedBackup(buffer, fileName) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0)
        throw backupError('Empty backup file');
    var info = readInfo(buffer);
    if (!info.name) info.name = path.basename(String(fileName || '')).replace(/\.(zip|enc|backup)$/gi, '') || 'Backup';
    info.origin = 'uploaded';
    return writeStored(buffer, info);
}

function readStoredBackup(id) {
    var info = getStoredInfo(id);
    return { info: info, buffer: fs.readFileSync(storedPaths(id).archive) };
}

function deleteStoredBackup(id) {
    var paths = storedPaths(id);
    getStoredInfo(id);
    fs.unlinkSync(paths.archive);
    fs.unlinkSync(paths.info);
}

async function restoreStoredBackup(id, options) {
    return restoreBackup(readStoredBackup(id).buffer, options);
}

module.exports = {
    createBackup, restoreBackup, parseBackup, readInfo, isEncrypted,
    listBackups, createStoredBackup, addUploadedBackup, readStoredBackup, deleteStoredBackup, restoreStoredBackup,
    MODELS, CATEGORIES, DEPENDENCIES
};
