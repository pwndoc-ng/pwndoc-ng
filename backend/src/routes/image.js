module.exports = function(app) {

    var Response = require('../lib/httpResponse.js')
    var Image = require('mongoose').model('Image')
    var acl = require('../lib/auth').acl

    // Size of the data URI of an image: MongoDB document limit (16 MB) minus a margin for the other fields
    var MAX_IMAGE_LENGTH = 16 * 1024 * 1024 - 64 * 1024

    // Image of an audit: readable by the users who can read the audit only (same answer as an unknown image)
    var getReadable = async (req) => {
        var image = await Image.getOne(req.params.imageId)
        if (!await Image.isReadable(req.params.imageId, req.decodedToken.id, acl.isAllowed(req.decodedToken.role, 'audits:read-all')))
            throw({fn: 'NotFound', message: 'Image not found'})
        return image
    }

    // Get image
    app.get("/api/images/:imageId", acl.hasPermission('images:read'), async function(req, res) {
        // #swagger.tags = ['Image']

        Response.Ok(res, await getReadable(req))
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
        // An image is stored in one MongoDB document, limited to 16 MB (the driver failed with a raw error, 500)
        if (req.body.value.length > MAX_IMAGE_LENGTH) {
            Response.Custom(res, 'error', 413, 'Image too large: 16 MB maximum')
            return
        }

        var image = {}
        // Required parameters
        image.value = req.body.value

        // Optional parameters
        if (req.body.name) image.name = req.body.name
        if (req.body.auditId) image.auditId = req.body.auditId

        Image.create(image, req.decodedToken.id, acl.isAllowed(req.decodedToken.role, 'audits:read-all'))
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
    app.get("/api/images/download/:imageId", acl.hasPermission('images:read'), async function(req, res) {
        // #swagger.tags = ['Image']

        var data = await getReadable(req)
        var imgBase64 = data.value.split(",")[1]
        var img = Buffer.from(imgBase64, 'base64')
        Response.SendImage(res, img)
    })
}