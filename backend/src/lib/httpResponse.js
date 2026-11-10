function Custom(res, status, code, message){
    res.status(code).json({"status": status, "datas": message});
};
exports.Custom = Custom;

/*
*** Codes 2xx ***
*/

function Ok(res, data){
    res.status(200).json({"status": "success", "datas": data});
};
exports.Ok = Ok;

function Created(res, data){
    res.status(201).json({"status": "success", "datas": data});
};
exports.Created = Created;

function NoContent(res, data){
    res.status(204).json({"status": "success", "datas": data});
};
exports.NoContent = NoContent;

function SendFile(res, filename, file){
    res.set({"Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`});
    res.status(200).send(file);
}
exports.SendFile = SendFile;

function SendImage(res, image){
    res.set({"Content-Type": "image/png", "Content-Length": image.length});
    res.status(200).send(image);
}
exports.SendImage = SendImage;

/*
*** Codes 4xx ***
*/

function BadRequest(res, error){
    res.status(400).json({"status": "error", "datas": error});
};
exports.BadRequest = BadRequest;

function NotFound(res, error){
    res.status(404).json({"status": "error", "datas": error});
};
exports.NotFound = NotFound;

function BadParameters(res, error){
    res.status(422).json({"status": "error", "datas": error});
};
exports.BadParameters = BadParameters;

function Unauthorized(res, error){
    res.status(401).json({"status": "error", "datas": error});
};
exports.Unauthorized = Unauthorized;

function Forbidden(res, error){
    res.status(403).json({"status": "error", "datas": error});
};
exports.Forbidden = Forbidden;

/*
*** Codes 5xx ***
*/

// Errors not converted by the routes (mongoose, MongoDB driver, body parser) answered with a 4xx status:
// [status, message] or null for an internal error
function clientError(res, error) {
    if (error.name === 'CastError') {
        // Identifier of the URL that is not an ObjectId: the document cannot exist. Value of the request: invalid
        var params = Object.values((res.req && res.req.params) || {});
        if (params.includes(String(error.value)))
            return [404, `${(error.model && error.model.modelName) || 'Document'} not found`];
        return [422, error.message];
    }
    if (['ValidationError', 'ObjectParameterError', 'StrictModeError', 'MongooseBulkWriteError'].includes(error.name))
        return [422, error.message];
    // Duplicate value of a unique index not converted by the model ('already exists' answers)
    if (error.code === 11000)
        return [422, 'Already exists'];
    // MongoDB documents (an audit with its findings) are limited to 16 MB: refused by the server (10334, 17419: document
    // after update too large) or by the driver serializing the request (Buffer offset out of range)
    if ([10334, 17419].includes(error.code) || (error.code === 'ERR_OUT_OF_RANGE' && /"offset"/.test(error.message)))
        return [413, 'Data too large: a document (audit, vulnerability...) is limited to 16 MB'];
    // Body refused by body-parser (http-errors): 400 invalid JSON or content, 413 too large, 415 charset or encoding not supported
    if ((typeof error.type === 'string' || error.expose === true) && error.status >= 400 && error.status < 500)
        return [error.status, error.message];
    return null;
}

function Internal(res, error){
    if (error.fn) var fn = exports[error.fn];
    var mapped = typeof(fn) === 'function' ? null : clientError(res, error);
    if (typeof(fn) === 'function')
        fn(res, error.message);
    else if (mapped)
        Custom(res, 'error', mapped[0], mapped[1]);
    else if (error.errmsg) {
        res.status(500).json({"status": "error", "datas": error.errmsg});
    }
    else if (error.message)
        res.status(500).json({"status": "error", "datas": error.message});
    else {
        console.log(error)
        res.status(500).json({"status": "error", "datas": "Internal Error"});
    }
};
exports.Internal = Internal;