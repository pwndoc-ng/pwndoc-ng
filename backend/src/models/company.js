var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var CompanySchema = new Schema({
    name: {type: String, required: true, unique: true},
    shortName: String,
    logo: String

}, {timestamps: true});

/*
*** Statics ***
*/

// Get all companies
CompanySchema.statics.getAll = () => {
    return new Promise((resolve, reject) => {
        var query = Company.find();
        query.select('name shortName logo');
        query.exec()
        .then((rows) => {
            resolve(rows);
        })
        .catch((err) => {
            reject(err);
        })
    });
}

// Get all companies for download
CompanySchema.statics.export = () => {
    return new Promise((resolve, reject) => {
        var query = Company.find();
        query.select('name shortName logo -_id')
        query.exec()
        .then((rows) => {
            resolve(rows);
        })
        .catch((err) => {
            reject(err);
        })
    });
}

// Create company
CompanySchema.statics.create = (companies) => {
    return new Promise((resolve, reject) => {
        Company.insertMany(companies, {ordered: false})
        .then((rows) => {
            resolve({created: rows.length, duplicates: 0});
        })
        .catch((err) => {
            if (err.code === 11000) {
                if (err.result.nInserted === 0)
                    reject({fn: 'BadParameters', message: 'Company name already exists'});
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

// Update company
CompanySchema.statics.update = (companyId, company) => {
    return new Promise((resolve, reject) => {
        var query = Company.findOneAndUpdate({_id: companyId}, company);
        query.exec()
        .then((rows) => {
            if (rows)
                resolve(rows);
            else
                reject({fn: 'NotFound', message: 'Company Id not found'});
        })
        .catch((err) => {
            if (err.code === 11000)
                reject({fn: 'BadParameters', message: 'Company name already exists'});
            else
                reject(err);
        })
    });
}

// Delete all clients
CompanySchema.statics.deleteAll = () => {
    return new Promise((resolve, reject) => {
        var query = Company.deleteMany();
        query.exec()
        .then(() => {
            resolve('All companies deleted successfully');
        })
        .catch((err) => {
            reject(err);
        })
    });
}

// Delete company
CompanySchema.statics.delete = (companyId) => {
    return new Promise((resolve, reject) => {
        var query = Company.findOneAndRemove({_id: companyId});
        query.exec()
        .then((rows) => {
            if (rows)
                resolve(rows);
            else
                reject({fn: 'NotFound', message: 'Company Id not found'});
        })
        .catch((err) => {
            reject(err);
        })
    });
}

/*
*** Methods ***
*/

var Company = mongoose.model('Company', CompanySchema);
module.exports = Company;