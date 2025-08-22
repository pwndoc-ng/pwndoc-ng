module.exports = function(app) {

    var Response = require('../lib/httpResponse.js')
    var Image = require('mongoose').model('Image')
    var acl = require('../lib/auth').acl

    // Get image
    app.get("/api/images/:imageId", acl.hasPermission('images:read'), function(req, res) {
        // #swagger.tags = ['Image']

        Image.getOne(req.params.imageId)
        .then(msg => Response.Ok(res, msg))
        .catch(err => Response.Internal(res, err))
    })

    // Create image
    app.post("/api/images/", acl.hasPermission('images:create'), function(req, res) {
        // #swagger.tags = ['Image']

        if (!req.body.value) {
            Response.BadParameters(res, 'Missing required parameters: value')
            return
        }
        
        // Type validation
        if (typeof req.body.value !== "string") {
            Response.BadParameters(res, 'value parameter must be a String')
            return
        }

        var image = {}
        // Required parameters
        image.value = req.body.value

        // Optional parameters
        if (req.body.name) image.name = req.body.name
        if (req.body.auditId) image.auditId = req.body.auditId

        Image.create(image)
        .then(data => Response.Created(res, data))
        .catch(err => Response.Internal(res, err))
    })

    // Delete image
    app.delete("/api/images/:imageId", acl.hasPermission('images:delete'), function(req, res) {
        // #swagger.tags = ['Image']

        Image.delete(req.params.imageId)
        .then(data => {
            Response.Ok(res, 'Image deleted successfully')
        })
        .catch(err => {
            Response.Internal(res, err)
        })
    })

    // Download image file
    app.get("/api/images/download/:imageId", acl.hasPermission('images:read'), function(req, res) {
        // #swagger.tags = ['Image']

        Image.getOne(req.params.imageId)
        .then(data => {
            var imgBase64 = data.value.split(",")[1]
            var img = Buffer.from(imgBase64, 'base64')
            Response.SendImage(res, img)
        })
        .catch(err =>{
            Response.Internal(res, err)
        })
    })

    // Validate external image URL
    app.post("/api/images/validate-external", acl.hasPermission('images:create'), function(req, res) {
        // #swagger.tags = ['Image']
        
        if (!req.body.url) {
            Response.BadParameters(res, 'Missing required parameters: url')
            return
        }

        // Vérifier que l'URL est valide et pointe vers une image
        const url = req.body.url;
        if (!url.match(/^https?:\/\/.*\.(jpg|jpeg|png|gif|webp|svg)(\?.*)?$/i)) {
            Response.BadParameters(res, 'Invalid image URL format')
            return
        }

        // Retourner l'URL validée
        Response.Ok(res, { url: url, valid: true })
    })
}