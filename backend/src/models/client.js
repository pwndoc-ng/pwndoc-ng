var mongoose = require('mongoose');
var Schema = mongoose.Schema;

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
ClientSchema.statics.create = (clients) => {
    return new Promise(async(resolve, reject) => {
        var clients_with_company = []
        var company;
        for (var i=0; i< clients.length; i++) {
            company = clients[i][1]
            if (company) {
                var Company = mongoose.model("Company");
                var query = Company.findOneAndUpdate({name: company}, {}, {upsert: true, new: true});
                var companyRow = await query.exec()
                if (companyRow) clients[i][0].company = companyRow._id;
            }
            clients_with_company.push(clients[i][0])
        }
        
        Client.insertMany(clients_with_company, {ordered: false})
        .then((rows) => {
            resolve({created: rows.length, duplicates: 0});
        })
        .catch((err) => {
            if (err.code === 11000) {
                if (err.result.nInserted === 0)
                    reject({fn: 'BadParameters', message: 'Client email already exists'});
                else {
                    var errorMessages = [] 
                    err.writeErrors.forEach(e => errorMessages.push(e.errmsg || "no errmsg"))
                    resolve({created: err.result.nInserted, duplicates: errorMessages});
                }
            }
            else
                reject(err);
        })
    })
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
        var query = Client.findOneAndRemove({_id: clientId});
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