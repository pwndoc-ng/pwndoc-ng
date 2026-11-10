module.exports = function(app) {
    var Response = require('../lib/httpResponse.js');
    var acl = require('../lib/auth').acl;
    var Settings = require('mongoose').model('Settings');
    var utils = require('../lib/utils');

    // Reviews enabled or disabled: the editing sessions are read-only or not depending on the state of the audits only when
    // the reviews are enabled, the open sessions are authenticated again (all the documents) to get their new scope
    var reviewsEnabled = async () => {
        var settings = await Settings.getAll();
        return Boolean(settings && settings.reviews.enabled);
    };
    var resetSessionsIfReviewsChanged = (before, after) => {
        var reset = app.get('resetCollaborationSessions');
        if (before !== after && reset)
            reset();
    };
    
    app.get("/api/settings", acl.hasPermission('settings:read'), function(req, res) {
        // #swagger.tags = ['Settings']

        Settings.getAll()
        .then(settings => Response.Ok(res, settings))
        .catch(err => Response.Internal(res, err));
    });

    app.get("/api/settings/public", acl.hasPermission('settings:read-public'), function(req, res) {
        // #swagger.tags = ['Settings']

        Settings.getPublic()
        .then(settings => Response.Ok(res, settings))
        .catch(err => Response.Internal(res, err));
    });

    app.put("/api/settings", acl.hasPermission('settings:update'), async function(req, res) {
        // #swagger.tags = ['Settings']

        // Sections of the wrong type were ignored with a 200 answer
        if (!utils.isObject(req.body) || ['report', 'reviews', 'danger'].some(section => req.body[section] !== undefined && !utils.isObject(req.body[section]))) {
            Response.BadParameters(res, 'Invalid settings: report, reviews and danger must be objects');
            return;
        }

        var before = await reviewsEnabled();
        Settings.update(req.body)
        .then(msg => {
            resetSessionsIfReviewsChanged(before, Boolean(msg.reviews.enabled));
            Response.Ok(res, msg);
        })
        .catch(err => Response.Internal(res, err));
    });

    app.put("/api/settings/revert", acl.hasPermission('settings:update'), async function(req, res) {
        // #swagger.tags = ['Settings']

        var before = await reviewsEnabled();
        Settings.restoreDefaults()
        .then(async msg => {
            resetSessionsIfReviewsChanged(before, await reviewsEnabled());
            Response.Ok(res, msg);
        })
        .catch(err => Response.Internal(res, err));
    });

    app.get("/api/settings/export", acl.hasPermission("settings:read"), function(req, res) {
        // #swagger.tags = ['Settings']

        Settings.getAll()
        .then(settings => Response.SendFile(res, "app-settings.json", settings))
        .catch(err => Response.Internal(res, err))
    });
}
