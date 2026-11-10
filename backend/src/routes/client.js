module.exports = function(app) {

    var Response = require('../lib/httpResponse.js');
    var Client = require('mongoose').model('Client');
    var acl = require('../lib/auth').acl;
    var utils = require('../lib/utils');

    // Name of the company of a client: a string only, it is used as query (an operator {$ne: null} linked the client to an
    // existing company chosen by MongoDB)
    var validCompany = (company) => !utils.isObject(company) || utils.isOptionalString(company.name);

    // Get clients list
    app.get("/api/clients", acl.hasPermission('clients:read'), function(req, res) {
        // #swagger.tags = ['Client']

        Client.getAll()
        .then(msg => Response.Ok(res, msg))
        .catch(err => Response.Internal(res, err))
    });
    
    // Get clients for export
    app.get("/api/clients/export", acl.hasPermission('clients:read'), function(req, res) {
        // #swagger.tags = ['Client']

        Client.export()
        .then(msg => Response.Ok(res, msg))
        .catch(err => Response.Internal(res, err))
    });

    // Create clients (array of clients)
    app.post("/api/clients", acl.hasPermission('clients:create'), function(req, res) {
        // #swagger.tags = ['Client']

        if (!utils.isListOfObjects(req.body)) {
            Response.BadParameters(res, 'A list of clients is required');
            return;
        }
        var clients = [];
        for (var i=0; i< req.body.length;i++) {
            var bcli = req.body[i]

            if (!bcli.email) {
                Response.BadParameters(res, 'Required parameters: email');
                return;
            }
            if (!validCompany(bcli.company)) {
                Response.BadParameters(res, 'Invalid parameter: company');
                return;
            }

            var client = {};
            // Required parameters
            client.email = bcli.email;

            // Optional parameters
            if (bcli.lastname) client.lastname = bcli.lastname;
            if (bcli.firstname) client.firstname = bcli.firstname;
            if (bcli.phone) client.phone = bcli.phone;
            if (bcli.cell) client.cell = bcli.cell;
            if (bcli.title) client.title = bcli.title;
            var company = null;
            if (bcli.company && bcli.company.name) company = bcli.company.name;

            clients.push([client, company]);
        }
        Client.create(clients)
        .then(msg => {
            // Check if there were duplicates
            if (msg.duplicates && msg.duplicates.length > 0) {
                Response.BadParameters(res, 'Client email already exists');
            } else {
                Response.Created(res, msg);
            }
        })
        .catch(err => {
            if (err.fn === 'BadParameters') {
                Response.BadParameters(res, err.message);
            } else {
                Response.Internal(res, err);
            }
        })
    });

    // Update client
    app.put("/api/clients/:id", acl.hasPermission('clients:update'), function(req, res) {
        // #swagger.tags = ['Client']

        if (!validCompany(req.body.company)) {
            Response.BadParameters(res, 'Invalid parameter: company');
            return;
        }

        var client = {};
        // Optional parameters
        if (req.body.email) client.email = req.body.email;
        client.lastname = req.body.lastname || null;
        client.firstname = req.body.firstname || null;
        client.phone = req.body.phone || null;
        client.cell = req.body.cell || null;
        client.title = req.body.title || null;
        var company = null;
        if (req.body.company && req.body.company.name) company = req.body.company.name;

        Client.update(req.params.id, client, company)
        .then(msg => Response.Ok(res, 'Client updated successfully'))
        .catch(err => Response.Internal(res, err))
    });

    // Delete client
    app.delete("/api/clients/:id", acl.hasPermission('clients:delete'), function(req, res) {
        // #swagger.tags = ['Client']

        Client.delete(req.params.id)
        .then(msg => Response.Ok(res, 'Client deleted successfully'))
        .catch(err => Response.Internal(res, err))
    });

    // Delete all clients
    app.delete("/api/clients", acl.hasPermission('clients:delete'), function(req, res) {
        // #swagger.tags = ['Client']

        Client.deleteAll()
        .then(msg => Response.Ok(res, msg))
        .catch(err => Response.Internal(res, err))
    });
}