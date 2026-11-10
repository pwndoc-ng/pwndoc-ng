var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var utils = require('../lib/utils');

var ClientSchema = new Schema({
    email:      {type: String, required: true, unique: true},
    company:    {type: Schema.Types.ObjectId, ref: 'Company'},
    lastname:   String,
    firstname:  String,
    phone:      String,
    cell:       String,
    title:      String

}, {timestamps: true});

/*
*** Statics ***
*/

// Get all clients
ClientSchema.statics.getAll = () => {
    return new Promise((resolve, reject) => {
        var query = Client.find().populate('company', '-_id name');
        query.select('email lastname firstname phone cell title');
        query.exec()
        .then((rows) => {
            resolve(rows);
        })
        .catch((err) => {
            reject(err);
        })
    });
}


// Get all clients for download
ClientSchema.statics.export = () => {
    return new Promise((resolve, reject) => {
        var query = Client.find();
        query.select('email lastname firstname phone cell title -_id')
        query.exec()
        .then((rows) => {
            resolve(rows);
        })
        .catch((err) => {
            reject(err);
        })
    });
}

// Create client
// Create client (clients: list of [client, name of its company]). The clients are checked before their companies are
// created: an invalid client refuses the whole list
ClientSchema.statics.create = async (clients) => {
    utils.validateAll(Client, clients.map(([client]) => client))
    var Company = mongoose.model("Company");
    for (var [client, company] of clients) {
        if (company)
            client.company = (await Company.findOneAndUpdate({name: company}, {}, {upsert: true, new: true}))._id;
    }

    try {
        var rows = await Client.insertMany(clients.map(([client]) => client), {ordered: false});
        return {created: rows.length, duplicates: 0};
    }
    catch (err) {
        if (err.code !== 11000)
            throw err;
        // MongoDB driver 6: inserted documents in insertedDocs, message in writeError.err
        var inserted = err.insertedDocs ? err.insertedDocs.length : ((err.result && err.result.insertedCount) || 0)
        if (inserted === 0)
            throw({fn: 'BadParameters', message: 'Client email already exists'});
        var errorMessages = (err.writeErrors || []).map(e => e.errmsg || (e.err && e.err.errmsg) || 'Duplicate')
        return {created: inserted, duplicates: errorMessages};
    }
}

// Update client
ClientSchema.statics.update = (clientId, client, company) => {
    return new Promise(async(resolve, reject) => {
        if (company) {
            var Company = mongoose.model("Company");
            var query = Company.findOneAndUpdate({name: company}, {}, {upsert: true, new: true});
            var companyRow = await query.exec()
            if (companyRow) client.company = companyRow.id;
        }
        var query = Client.findOneAndUpdate({_id: clientId}, client);
        query.exec()
        .then((rows) => {
            if (rows)
                resolve(rows);
            else
                reject({fn: 'NotFound', message: 'Client Id not found'});
        })
        .catch((err) => {
            if (err.code === 11000)
                reject({fn: 'BadParameters', message: 'Client email already exists'});
            else
                reject(err);
        })
    });
}

// Delete all clients
ClientSchema.statics.deleteAll = () => {
    return new Promise((resolve, reject) => {
        var query = Client.deleteMany();
        query.exec()
        .then(() => {
            resolve('All clients deleted successfully');
        })
        .catch((err) => {
            reject(err);
        })
    });
}

// Delete client
ClientSchema.statics.delete = (clientId) => {
    return new Promise((resolve, reject) => {
        var query = Client.findOneAndDelete({_id: clientId});
        query.exec()
        .then((rows) => {
            if (rows)
                resolve(rows);
            else
                reject({fn: 'NotFound', message: 'Client Id not found'});
        })
        .catch((err) => {
            reject(err);
        })
    });
}

/*
*** Methods ***
*/

var Client = mongoose.model('Client', ClientSchema);
module.exports = Client;