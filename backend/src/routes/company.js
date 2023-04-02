module.exports = function(app) {

    var Response = require('../lib/httpResponse.js');
    var Company = require('mongoose').model('Company');
    var acl = require('../lib/auth').acl;

    // Get companies list
    app.get("/api/companies", acl.hasPermission('companies:read'), function(req, res) {
        // #swagger.tags = ['Company']

        Company.getAll()
        .then(msg => Response.Ok(res, msg))
        .catch(err => Response.Internal(res, err))
    });

    // Get companies for export
    app.get("/api/companies/export", acl.hasPermission('companies:read'), function(req, res) {
        // #swagger.tags = ['Company']

        Company.export()
        .then(msg => Response.Ok(res, msg))
        .catch(err => Response.Internal(res, err))
    });

    // Create company
    app.post("/api/companies", acl.hasPermission('companies:create'), function(req, res) {
        // #swagger.tags = ['Company']

        var companies = [];
        for (var i=0; i< req.body.length;i++) {
            var cpny = req.body[i]

            if (!cpny.name) {
                Response.BadParameters(res, 'Required paramters: name');
                return;
            }

            var company = {};
            // Required parameters
            company.name = cpny.name;

            // Optional parameters
            if (cpny.shortName) company.shortName = cpny.shortName;
            if (cpny.logo) company.logo = cpny.logo;
            companies.push(company)
        }
        Company.create(companies)
        .then(msg => Response.Created(res, msg))
        .catch(err => Response.Internal(res, err))
    });

    // Update company
    app.put("/api/companies/:id", acl.hasPermission('companies:update'), function(req, res) {
        // #swagger.tags = ['Company']

        var company = {};
        // Optional parameters
        if (req.body.name) company.name = req.body.name;
        if (req.body.shortName) company.shortName = req.body.shortName;
        if (req.body.logo) company.logo = req.body.logo;

        Company.update(req.params.id, company)
        .then(msg => Response.Ok(res, 'Company updated successfully'))
        .catch(err => Response.Internal(res, err))
    });

    // Delete company
    app.delete("/api/companies/:id", acl.hasPermission('companies:delete'), function(req, res) {
        // #swagger.tags = ['Company']

        Company.delete(req.params.id)
        .then(msg => Response.Ok(res, 'Company deleted successfully'))
        .catch(err => Response.Internal(res, err))
    });

    // Delete companies
    app.delete("/api/companies", acl.hasPermission('companies:delete'), function(req, res) {
        // #swagger.tags = ['Company']

        Company.deleteAll()
        .then(msg => Response.Ok(res, msg))
        .catch(err => Response.Internal(res, err))
    });
}