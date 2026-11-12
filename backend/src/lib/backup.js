// Backups of the instance data (migration to another server, copy of some data, restore point)
//
// Archive: zip file with
//   manifest.json          format, version, name, date, type (full / partial), categories, number of documents
//                          per collection, template files
//   data/<Model>.json      raw documents of the collections of the categories (MongoDB Extended JSON: ObjectId,
//                          dates... are kept): a JSON list, one document per line (the first versions wrote the list on
//                          a single line: still read)
//   templates/<file>       report template files (templates category)
// Encrypted with a password:
//   MAGIC2 | header length (uint32 BE) | header (manifest, JSON) | salt | iv | auth tag | AES-256-GCM(zip)
//   The header is the additional authenticated data of GCM: the name, date and content of an encrypted backup are
//   known without the password, and cannot be modified. Key derived from the password with scrypt.
//   Backups of the first version (MAGIC1: no header, every collection) are still read.
//
// The data is never held in memory as a whole: the images of an instance can be several GB, more than the maximum length
// of a string. Documents are read from the database and written to the archive one by one, archives are written to and
// read from files (streams), uploads and downloads are streamed.
//
// Backups are stored on the server (backup directory): <id>.backup (archive) and <id>.json (information). Files being
// written are named *.tmp (removed if the server stops meanwhile).
//
// Restore of the selected categories of a backup: the documents of the backup are first written into temporary
// collections, with the indexes of the collections, so that an invalid backup or a conflict changes nothing. Then the
// temporary collections replace the collections (renamed), the previous collections being kept until the end.
//   replace: the temporary collections contain the documents of the backup
//   merge: the temporary collections are copies of the collections, where the documents of the backup are added, or
//          replace the documents with the same identifier; nothing is deleted (settings, a single document, are replaced)
// If the restore fails, the previous collections and the previous template files are put back.

var fs = require('fs');
var fsp = require('fs/promises');
var path = require('path');
var crypto = require('crypto');
var { Readable, Transform } = require('stream');
var { pipeline } = require('stream/promises');
var mongoose = require('mongoose');
var yazl = require('yazl');
var yauzl = require('yauzl');
var migrations = require('./migrations');
var { EJSON } = mongoose.mongo.BSON;

var FORMAT = 'pwndoc-ng-backup';
var FORMAT_VERSION = 2;
var MAGIC1 = Buffer.from('PWNDOCNG-BACKUP-ENC1');
var MAGIC2 = Buffer.from('PWNDOCNG-BACKUP-ENC2');
var CRYPTO_PARAMETERS_SIZE = 44; // salt (16) | iv (12) | auth tag (16)
var SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
var DISK_MARGIN = 50 * 1024 * 1024; // Free space kept on the disk after writing a backup
var ID_FORMAT = /^\d{8}-\d{6}-[a-f0-9]{8}$/;
var MANIFEST_MAX_SIZE = 10 * 1024 * 1024;
var HEADER_MAX_READ = MAGIC2.length + 4 + MANIFEST_MAX_SIZE + CRYPTO_PARAMETERS_SIZE;
var BATCH_DOCUMENTS = 500; // Documents written to the database at once during a restore...
var BATCH_SIZE = 16 * 1024 * 1024; // ... or less: total size of their text

// Collections of the backups, in restore order
var MODELS = [
    'Settings', 'Language', 'AuditType', 'VulnerabilityType', 'VulnerabilityCategory', 'CustomField', 'CustomSection', 'SpellcheckWord',
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
    spellcheckWords: ['SpellcheckWord'],
    settings: ['Settings']
};
var CATEGORY_NAMES = Object.keys(CATEGORIES);

// Categories always saved with another one: images of the audits and vulnerabilities, companies of the clients
var DEPENDENCIES = { audits: ['images'], vulnerabilities: ['images'], clients: ['companies'] };

// Documents whose references to images are granted after the restore of a backup made before the image access control
var IMAGE_REFERENCES = {
    Audit: 'summary customFields findings sections',
    Vulnerability: 'details',
    VulnerabilityUpdate: 'description observation remediation customFields status'
};

function backupError(message) {
    return { fn: 'BadParameters', message: message };
}

function notFound(message) {
    return { fn: 'NotFound', message: message };
}

function diskSpaceError(needed, available) {
    return backupError(needed === undefined ? 'Not enough disk space' :
        `Not enough disk space: ${Math.ceil((needed + DISK_MARGIN) / 1048576)} MB needed, ${Math.floor(available / 1048576)} MB available`);
}

/*
*** Operation in progress ***
*/

// One operation at a time (a backup made during a restore would be inconsistent): creation or restore of a backup, and its
// progress. step: 'start', 'data' (documents written or read: done / total), 'encrypt' and 'decrypt' (bytes), 'replace'
// (collections replaced by the restored ones), 'templates' (template files)
var operation = null;

async function exclusive(type, fn) {
    if (operation)
        throw backupError(`A backup ${operation.type} is already in progress`);
    operation = { type: type, step: 'start', done: 0, total: 0, startedAt: new Date().toISOString() };
    try {
        return await fn();
    }
    finally {
        operation = null;
    }
}

function setProgress(step, total) {
    if (operation) Object.assign(operation, { step: step, done: 0, total: total || 0 });
}

function addProgress(count) {
    if (operation) operation.done += count;
}

// Bytes going through a stream added to the progress
function progressCounter() {
    return new Transform({ transform(chunk, encoding, callback) { addProgress(chunk.length); callback(null, chunk) } });
}

// Operation in progress (null if none): { type, step, done, total, startedAt }
function getProgress() {
    return operation ? Object.assign({}, operation) : null;
}

function templatesDir() {
    return path.join(__basedir, '..', 'report-templates');
}

var temporaryFilesRemoved = false;
function backupDir() {
    var dir = path.join(__basedir, '..', 'backup');
    fs.mkdirSync(dir, { recursive: true });
    // Files of an operation interrupted by a stop of the server (operations run in this process only)
    if (!temporaryFilesRemoved) {
        temporaryFilesRemoved = true;
        fs.readdirSync(dir).filter(file => file.endsWith('.tmp')).forEach(file => fs.rmSync(path.join(dir, file), { force: true }));
    }
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

function collectionName(model) {
    return mongoose.model(model).collection.collectionName;
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

function checkDiskSpace(size) {
    var stats = fs.statfsSync(backupDir());
    var available = Number(stats.bavail) * Number(stats.bsize);
    if (available < size + DISK_MARGIN)
        throw diskSpaceError(size, available);
}

// Size of the archive of the collections, estimated from their size in the database (compressed as well)
async function estimatedSize(models, templateFiles) {
    var size = Object.values(templateFiles).reduce((total, content) => total + content.length, 0);
    for (var model of models) {
        try {
            var [stats] = await mongoose.connection.db.collection(collectionName(model)).aggregate([{ $collStats: { storageStats: {} } }]).toArray();
            size += stats ? stats.storageStats.storageSize : 0;
        }
        catch (err) {} // Collection not created yet
    }
    return size;
}

async function removeFiles(...files) {
    await Promise.all(files.filter(file => file).map(file => fsp.rm(file, { force: true })));
}

async function readFileStart(filePath, length) {
    var file = await fsp.open(filePath, 'r');
    try {
        var buffer = Buffer.alloc(Math.min(length, (await file.stat()).size));
        var { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
        return buffer.subarray(0, bytesRead);
    }
    finally {
        await file.close();
    }
}

/*
*** Archive writing ***
*/

// Text of a collection: JSON list with one document per line, the documents being read one by one. counts: number of
// documents of the collection, set at the end
async function* collectionText(model, counts) {
    var count = 0;
    yield Buffer.from('[\n');
    for await (var document of mongoose.model(model).collection.find({})) {
        if (model === 'User') delete document.refreshTokens; // Sessions are only valid on the source instance
        yield Buffer.from((count++ > 0 ? ',\n' : '') + EJSON.stringify(document, { relaxed: false }));
        addProgress(1);
    }
    yield Buffer.from('\n]\n');
    counts[model] = count;
}

// Writes the zip archive of a backup into a file: data of the collections, template files, then the manifest (numbers of
// documents known once the data is written). The entries are written one after the other, each one read when written.
function writeArchive(filePath, models, manifest, templateFiles) {
    var zip = new yazl.ZipFile();
    var written = pipeline(zip.outputStream, fs.createWriteStream(filePath));
    var fail = (err) => zip.outputStream.destroy(err); // Errors of the entries are not handled by yazl
    zip.on('error', fail);
    zip.outputStream.on('error', () => {}); // Given to the pipeline; later writes of yazl to the destroyed stream ignored
    var addStream = (fileName, generator) => zip.addReadStreamLazy(fileName, (callback) => {
        var stream = Readable.from(generator(), { objectMode: false });
        stream.on('error', fail);
        callback(null, stream);
    });

    models.forEach(model => addStream(`data/${model}.json`, () => collectionText(model, manifest.collections)));
    Object.entries(templateFiles).forEach(([fileName, content]) => {
        zip.addBuffer(content, `templates/${fileName}`);
        manifest.templates.push(fileName);
    });
    addStream('manifest.json', async function* () {
        if (models.some(model => manifest.collections[model] === undefined))
            throw new Error('Backup data not written');
        yield Buffer.from(JSON.stringify(manifest, null, 2));
    });
    zip.end();
    return written;
}

function deriveKey(password, salt) {
    return crypto.scryptSync(password, salt, 32, SCRYPT);
}

// Encrypted backup file from an archive file (the manifest is the authenticated header)
async function encryptFile(source, target, password, manifest) {
    var header = Buffer.from(JSON.stringify(manifest));
    var headerLength = Buffer.alloc(4);
    headerLength.writeUInt32BE(header.length);
    var salt = crypto.randomBytes(16);
    var iv = crypto.randomBytes(12);
    var cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(password, salt), iv);
    cipher.setAAD(header);
    var prefix = Buffer.concat([MAGIC2, headerLength, header, salt, iv]);
    var output = fs.createWriteStream(target);
    output.write(Buffer.concat([prefix, Buffer.alloc(16)])); // Authentication tag: known at the end, written below
    setProgress('encrypt', (await fsp.stat(source)).size);
    await pipeline(fs.createReadStream(source), progressCounter(), cipher, output);
    var file = await fsp.open(target, 'r+');
    try {
        await file.write(cipher.getAuthTag(), 0, 16, prefix.length);
    }
    finally {
        await file.close();
    }
}

function startsWith(buffer, magic) {
    return buffer.length > magic.length && buffer.subarray(0, magic.length).equals(magic);
}

function isEncrypted(buffer) {
    return startsWith(buffer, MAGIC1) || startsWith(buffer, MAGIC2);
}

// Header of an encrypted backup (version 2), from the start of the file: { header, manifest, offset of the crypto parameters }
function readHeader(buffer) {
    var offset = MAGIC2.length;
    if (buffer.length < offset + 4)
        throw backupError('Invalid backup file');
    var length = buffer.readUInt32BE(offset);
    offset += 4;
    if (length > MANIFEST_MAX_SIZE || buffer.length < offset + length + CRYPTO_PARAMETERS_SIZE)
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

// Archive file from an encrypted backup file: authenticated once the whole file is decrypted (removed if not)
async function decryptFile(source, target, password) {
    var start = await readFileStart(source, HEADER_MAX_READ);
    var aad = null;
    var offset = MAGIC1.length;
    if (startsWith(start, MAGIC2)) {
        var header = readHeader(start);
        aad = header.header;
        offset = header.offset;
    }
    if (start.length < offset + CRYPTO_PARAMETERS_SIZE)
        throw backupError('Invalid backup file');
    var salt = start.subarray(offset, offset + 16);
    var iv = start.subarray(offset + 16, offset + 28);
    var tag = start.subarray(offset + 28, offset + 44);
    var size = (await fsp.stat(source)).size;
    checkDiskSpace(size);
    setProgress('decrypt', size - offset - CRYPTO_PARAMETERS_SIZE);
    var decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(password, salt), iv);
    decipher.setAuthTag(tag);
    if (aad) decipher.setAAD(aad);
    try {
        await pipeline(fs.createReadStream(source, { start: offset + CRYPTO_PARAMETERS_SIZE }), progressCounter(), decipher, fs.createWriteStream(target));
    }
    catch (err) {
        await removeFiles(target);
        if (err.code === 'ENOSPC') throw diskSpaceError();
        throw backupError('Wrong password or corrupted backup');
    }
}

/*
*** Archive reading ***
*/

function openZip(filePath) {
    return new Promise((resolve, reject) => yauzl.open(filePath, { lazyEntries: true, autoClose: false }, (err, zip) => {
        if (err) return reject(backupError('Invalid backup file'));
        zip.on('error', () => {}); // Errors of the reads are given to their callers
        resolve(zip);
    }));
}

function readEntries(zip) {
    return new Promise((resolve, reject) => {
        var entries = new Map();
        zip.on('entry', entry => {
            entries.set(entry.fileName, entry);
            zip.readEntry();
        });
        zip.once('end', () => resolve(entries));
        zip.once('error', () => reject(backupError('Invalid backup file')));
        zip.readEntry();
    });
}

function openEntry(zip, entry) {
    return new Promise((resolve, reject) => zip.openReadStream(entry, (err, stream) => {
        if (err) return reject(backupError(`Invalid backup file: unreadable ${entry.fileName}`));
        resolve(stream);
    }));
}

async function readEntryBuffer(zip, entry) {
    var chunks = [];
    try {
        for await (var chunk of await openEntry(zip, entry))
            chunks.push(chunk);
    }
    catch (err) {
        throw err.fn ? err : backupError(`Invalid backup file: unreadable ${entry.fileName}`);
    }
    return Buffer.concat(chunks);
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

// Opened archive file of a backup and its checked manifest: the data files of its categories are in the archive.
// The zip file must be closed by the caller.
async function openArchive(filePath) {
    var zip = await openZip(filePath);
    try {
        var entries = await readEntries(zip);
        var manifestEntry = entries.get('manifest.json');
        if (!manifestEntry)
            throw backupError('Invalid backup file: manifest.json not found');
        var manifest;
        try {
            if (manifestEntry.uncompressedSize > MANIFEST_MAX_SIZE) throw new Error('Manifest too large');
            manifest = JSON.parse((await readEntryBuffer(zip, manifestEntry)).toString('utf8'));
        }
        catch (err) {
            throw backupError('Invalid backup file: unreadable manifest');
        }
        checkManifest(manifest);
        modelsOf(manifest.categories).forEach(name => {
            if (!entries.has(`data/${name}.json`))
                throw backupError(`Invalid backup file: data/${name}.json not found`);
        });
        return { zip, entries, manifest };
    }
    catch (err) {
        zip.close();
        throw err;
    }
}

// Lines of a stream (UTF-8), read when the next line is asked for: the stream is not read further while a line is processed
// (a line is a document, up to 16 MB: lines read in advance would add up). Errors of the stream are thrown.
async function* linesOf(stream) {
    var pending = []; // Parts of the line being read
    for await (var chunk of stream) {
        var start = 0;
        var end;
        while ((end = chunk.indexOf(10, start)) !== -1) { // '\n' (never part of a multibyte UTF-8 character)
            pending.push(chunk.subarray(start, end));
            yield Buffer.concat(pending).toString('utf8');
            pending = [];
            start = end + 1;
        }
        if (start < chunk.length) pending.push(chunk.subarray(start));
    }
    if (pending.length > 0)
        yield Buffer.concat(pending).toString('utf8');
}

// Documents of a data file of a backup, read one by one: [document, size of its text]
async function* documentsOf(stream, fileName) {
    var unreadable = () => backupError(`Invalid backup file: unreadable ${fileName}`);
    var parse = (text) => {
        try {
            return EJSON.parse(text, { relaxed: false });
        }
        catch (err) {
            throw unreadable();
        }
    };
    var checked = (document) => {
        if (!document || typeof document !== 'object' || Array.isArray(document)) throw unreadable();
        return document;
    };
    var state = 'start'; // 'list': after the line '[', 'end': after the end of the list
    try {
        for await (var line of linesOf(stream)) {
            line = line.trim();
            if (!line) continue;
            if (state === 'end') throw unreadable();
            if (state === 'start') {
                if (!line.startsWith('['))
                    throw backupError(`Invalid backup file: ${fileName} is not a list`);
                if (line === '[') {
                    state = 'list';
                    continue;
                }
                // List on a single line (first versions of the backups)
                var list = parse(line);
                if (!Array.isArray(list))
                    throw backupError(`Invalid backup file: ${fileName} is not a list`);
                var size = list.length ? line.length / list.length : 0;
                for (var document of list)
                    yield [checked(document), size];
                state = 'end';
                continue;
            }
            if (line === ']') {
                state = 'end';
                continue;
            }
            yield [checked(parse(line.endsWith(',') ? line.slice(0, -1) : line)), line.length];
        }
    }
    catch (err) {
        throw err.fn ? err : unreadable(); // Corrupted archive
    }
    finally {
        stream.destroy(); // Reading stopped before the end: the archive file can be closed
    }
    if (state !== 'end')
        throw state === 'start' ? backupError(`Invalid backup file: ${fileName} is not a list`) : unreadable();
}

// Information of a backup file without its data. Content of the backups encrypted with the first version: unknown
// (categories: null) until the restore.
async function readInfo(filePath) {
    var start = await readFileStart(filePath, HEADER_MAX_READ);
    if (start.length === 0)
        throw backupError('Empty backup file');
    if (startsWith(start, MAGIC2)) {
        var manifest = checkManifest(readHeader(start).manifest);
        return { name: manifest.name, createdAt: manifest.createdAt, type: manifest.type, categories: manifest.categories, collections: manifest.collections || {}, encrypted: true };
    }
    if (startsWith(start, MAGIC1))
        return { name: '', createdAt: null, type: null, categories: null, collections: {}, encrypted: true };
    var archive = await openArchive(filePath);
    archive.zip.close();
    manifest = archive.manifest;
    return { name: manifest.name || '', createdAt: manifest.createdAt, type: manifest.type, categories: manifest.categories, collections: manifest.collections || {}, encrypted: false };
}

/*
*** Restore ***
*/

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

async function collectionExists(name) {
    return (await mongoose.connection.db.listCollections({ name: name }, { nameOnly: true }).toArray()).length > 0;
}

// Temporary collection of a restore, with the indexes of the collection (unique values checked when it is filled)
async function createRestoreCollection(model, name) {
    await mongoose.model(model).createIndexes(); // Collection and indexes of the schema, if not created yet
    var db = mongoose.connection.db;
    var indexes = await db.collection(collectionName(model)).listIndexes().toArray();
    await db.createCollection(name);
    var specs = indexes.filter(index => index.name !== '_id_').map(({ v, ns, ...spec }) => spec);
    if (specs.length > 0)
        await db.collection(name).createIndexes(specs);
}

async function writeDocuments(model, collection, documents, merge) {
    if (!merge)
        return collection.insertMany(documents, { ordered: true });
    try {
        await collection.bulkWrite(
            documents.map(document => ({ replaceOne: { filter: { _id: document._id }, replacement: document, upsert: true } })),
            { ordered: false }
        );
    }
    catch (err) {
        var conflicts = conflictsMessage(model, err);
        throw conflicts ? new Error(`documents in conflict with the current data (same unique value, other identifier): ${conflicts}`) : err;
    }
}

// Restore of the archive file of a backup: the selected categories (all the categories of the backup by default), replaced
// or merged. If the restore fails, the previous data is put back.
async function restoreArchive(filePath, { mode, categories }) {
    var { zip, entries, manifest } = await openArchive(filePath);
    var db = mongoose.connection.db;
    var token = crypto.randomBytes(4).toString('hex');
    var collections = []; // { model, name, restore: temporary collection, previous: name while replaced, state }
    try {
        var selected = categories === undefined || categories === null ? manifest.categories : normalizeCategories(categories, false);
        var missing = selected.filter(category => !manifest.categories.includes(category));
        if (missing.length > 0)
            throw backupError(`Data not in the backup: ${missing.join(', ')}`);
        var models = modelsOf(selected);
        setProgress('data', models.reduce((total, model) => total + ((manifest.collections || {})[model] || 0), 0));

        // Documents of the backup in temporary collections: the current data is not modified
        var restored = {};
        var restoredIds = {}; // Documents referencing images
        var templates = [];
        try {
            for (var model of models) {
                var name = collectionName(model);
                var target = { model, name, restore: `pwndoc_restore_${token}_new_${name}`, previous: `pwndoc_restore_${token}_old_${name}`, state: 'restore' };
                collections.push(target);
                await createRestoreCollection(model, target.restore);
                var merge = mode === 'merge' && model !== 'Settings'; // Settings: a single document, replaced
                if (merge)
                    await db.collection(name).aggregate([{ $match: {} }, { $out: target.restore }]).toArray(); // Indexes of the target kept
                var fileName = `data/${model}.json`;
                var stream = await openEntry(zip, entries.get(fileName));
                var count = 0;
                var batch = [];
                var batchSize = 0;
                for await (var [document, size] of documentsOf(stream, fileName)) {
                    count++;
                    addProgress(1);
                    if (IMAGE_REFERENCES[model]) (restoredIds[model] = restoredIds[model] || []).push(document._id);
                    if (model === 'Template') templates.push(document);
                    batch.push(document);
                    batchSize += size;
                    if (batch.length >= BATCH_DOCUMENTS || batchSize >= BATCH_SIZE) {
                        await writeDocuments(model, db.collection(target.restore), batch, merge);
                        batch = [];
                        batchSize = 0;
                    }
                }
                if (batch.length > 0)
                    await writeDocuments(model, db.collection(target.restore), batch, merge);
                if (manifest.collections && manifest.collections[model] !== undefined && manifest.collections[model] !== count)
                    throw backupError(`Invalid backup file: data/${model}.json is incomplete`);
                restored[model] = count;
            }
        }
        catch (err) {
            if (err.fn) throw err; // Invalid backup
            throw backupError(`Restore failed, the previous data has been kept: ${err.message}`);
        }

        // Template files of the backup (read before any change: a template with an invalid file name is refused)
        var restoreTemplates = models.includes('Template');
        var templateFiles = {};
        if (restoreTemplates) {
            for (var template of templates) {
                var templateFile = templateFileName(template);
                var entry = entries.get(`templates/${templateFile}`);
                if (entry) templateFiles[templateFile] = await readEntryBuffer(zip, entry);
            }
        }
        zip.close();

        // Previous template files modified by the restore
        var previousFiles = {}; // file name: previous content (null: no file)
        var keepFile = (fileName) => {
            if (!(fileName in previousFiles)) {
                var filePath = path.join(templatesDir(), fileName);
                previousFiles[fileName] = fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
            }
        };
        if (restoreTemplates) {
            if (mode === 'replace')
                Object.keys(readTemplateFiles(await db.collection(collectionName('Template')).find({}).toArray())).forEach(keepFile);
            Object.keys(templateFiles).forEach(keepFile);
        }

        try {
            // The temporary collections replace the collections
            setProgress('replace', collections.length);
            for (var target of collections) {
                if (await collectionExists(target.name)) {
                    await db.collection(target.name).rename(target.previous);
                    target.state = 'previous kept';
                }
                else
                    target.state = 'no previous';
                await db.collection(target.restore).rename(target.name, { dropTarget: true });
                target.state = target.state === 'previous kept' ? 'replaced' : 'created';
                addProgress(1);
            }
            // Backup made before the access control of the images (date unknown included): the accesses of its references are
            // granted, as done for the database by the migration of the upgrade. Never for a later backup: a reference written
            // after the upgrade only grants the images its writer could read
            var imageAccessAt = await migrations.doneAt(migrations.IMAGE_ACCESS);
            var createdAt = Date.parse(manifest.createdAt);
            if (imageAccessAt && !(createdAt >= imageAccessAt.getTime())) {
                var restoredDocuments = (model) => restoredIds[model] ?
                    db.collection(collectionName(model)).find({ _id: { $in: restoredIds[model] } }, { projection: Object.fromEntries(IMAGE_REFERENCES[model].split(' ').map(field => [field, 1])) }) : [];
                await mongoose.model('Image').grantExistingReferences({
                    audits: restoredDocuments('Audit'), vulnerabilities: restoredDocuments('Vulnerability'), proposals: restoredDocuments('VulnerabilityUpdate')
                });
            }
            if (restoreTemplates) {
                setProgress('templates', Object.keys(templateFiles).length);
                // Replace: files of the previous templates are replaced by the files of the backup
                if (mode === 'replace')
                    Object.entries(previousFiles).forEach(([fileName, content]) => { if (content) fs.unlinkSync(path.join(templatesDir(), fileName)) });
                Object.entries(templateFiles).forEach(([fileName, content]) => fs.writeFileSync(path.join(templatesDir(), fileName), content));
            }
        }
        catch (err) {
            console.log('Backup restore failed, previous data restored:', err.message);
            for (var target of collections.slice().reverse()) {
                if (['replaced', 'previous kept'].includes(target.state))
                    await db.collection(target.previous).rename(target.name, { dropTarget: true });
                else if (target.state === 'created')
                    await db.collection(target.name).drop();
                target.state = 'restore';
            }
            Object.entries(previousFiles).forEach(([fileName, content]) => {
                var filePath = path.join(templatesDir(), fileName);
                if (content) fs.writeFileSync(filePath, content);
                else { try { fs.unlinkSync(filePath) } catch (e) {} }
            });
            throw backupError(`Restore failed, the previous data has been kept: ${err.message}`);
        }

        return { name: manifest.name || '', createdAt: manifest.createdAt, mode: mode, categories: selected, collections: restored, templates: restoreTemplates ? Object.keys(templateFiles).length : 0 };
    }
    finally {
        zip.close();
        // Temporary collections left: previous collections replaced, or collections of the backup not used
        for (var target of collections) {
            var leftover = target.state === 'replaced' ? target.previous : target.state === 'restore' ? target.restore : null;
            if (leftover && await collectionExists(leftover))
                await db.collection(leftover).drop();
        }
    }
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

// Information file of a backup whose archive is written
function writeInfo(id, info) {
    var paths = storedPaths(id);
    info = Object.assign({ id: id }, info, { addedAt: new Date().toISOString() });
    fs.writeFileSync(paths.info, JSON.stringify(info, null, 2));
    return Object.assign({ size: fs.statSync(paths.archive).size }, info);
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

// Creates a backup of the instance data and stores it on the server: all the data, or the selected categories. Encrypted
// when a password is given. origin: 'created' (by a user) or 'scheduled' (automatic backups, rotated)
async function createStoredBackup({ name, categories, password, origin = 'created' } = {}) {
    categories = normalizeCategories(categories);
    return exclusive('creation', () => writeStoredBackup(name, categories, password, origin));
}

async function writeStoredBackup(name, categories, password, origin) {
    var models = modelsOf(categories);
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
    var templateFiles = models.includes('Template') ? readTemplateFiles(await mongoose.model('Template').collection.find({}).toArray()) : {};
    // Encrypted: the archive is written, then encrypted into another file
    checkDiskSpace(await estimatedSize(models, templateFiles) * (password ? 2 : 1));

    var id = newId();
    var paths = storedPaths(id);
    var archive = `${paths.archive}.tmp`;
    var plainArchive = password ? `${paths.archive}.zip.tmp` : archive;
    var documents = 0;
    for (var model of models)
        documents += await mongoose.model(model).collection.estimatedDocumentCount();
    setProgress('data', documents);
    try {
        await writeArchive(plainArchive, models, manifest, templateFiles);
        if (password) {
            await encryptFile(plainArchive, archive, password, manifest);
            await removeFiles(plainArchive);
        }
        await fsp.rename(archive, paths.archive);
    }
    catch (err) {
        await removeFiles(plainArchive, archive);
        throw err.code === 'ENOSPC' ? diskSpaceError() : err;
    }
    return writeInfo(id, {
        name: manifest.name, createdAt: manifest.createdAt, type: manifest.type, categories: manifest.categories,
        collections: manifest.collections, encrypted: !!password, origin: origin
    });
}

// Stores a backup file uploaded from another instance (or downloaded before), read from a stream: the file is checked
// first. size: size given by the client, if known
async function addUploadedBackup(input, fileName, size) {
    if (size) checkDiskSpace(size);
    var id = newId();
    var paths = storedPaths(id);
    var archive = `${paths.archive}.tmp`;
    try {
        await pipeline(input, fs.createWriteStream(archive));
        if ((await fsp.stat(archive)).size === 0)
            throw backupError('Empty backup file');
        var info = await readInfo(archive);
        if (!info.name) info.name = path.basename(String(fileName || '')).replace(/\.(zip|enc|backup)$/gi, '') || 'Backup';
        info.origin = 'uploaded';
        await fsp.rename(archive, paths.archive);
    }
    catch (err) {
        await removeFiles(archive);
        throw err.code === 'ENOSPC' ? diskSpaceError() : err;
    }
    return writeInfo(id, info);
}

// Archive file of a stored backup, for its download
function getStoredBackup(id) {
    return { info: getStoredInfo(id), path: storedPaths(id).archive };
}

function deleteStoredBackup(id) {
    var paths = storedPaths(id);
    getStoredInfo(id);
    fs.unlinkSync(paths.archive);
    fs.unlinkSync(paths.info);
}

// Restore of a backup stored on the server (encrypted: decrypted into a temporary file first)
async function restoreStoredBackup(id, { password, mode = 'replace', categories } = {}) {
    if (!['replace', 'merge'].includes(mode))
        throw backupError('Invalid restore mode');
    var archive = getStoredBackup(id).path;
    return exclusive('restore', () => restoreStoredArchive(id, archive, password, mode, categories));
}

async function restoreStoredArchive(id, archive, password, mode, categories) {
    var decrypted = null;
    try {
        if (isEncrypted(await readFileStart(archive, MAGIC2.length + 1))) {
            if (!password)
                throw backupError('This backup is encrypted: password required');
            decrypted = path.join(backupDir(), `${id}.restore.tmp`);
            await decryptFile(archive, decrypted, password);
            archive = decrypted;
        }
        return await restoreArchive(archive, { mode, categories });
    }
    finally {
        await removeFiles(decrypted);
    }
}

module.exports = {
    listBackups, createStoredBackup, addUploadedBackup, getStoredBackup, deleteStoredBackup, restoreStoredBackup, readInfo,
    getProgress, MODELS, CATEGORIES, DEPENDENCIES
};
