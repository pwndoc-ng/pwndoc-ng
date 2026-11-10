// JWT secrets: environment variables JWT_SECRET and JWT_REFRESH_SECRET first (deployments: nothing generated nor written
// in the sources), otherwise jwtSecret and jwtRefreshSecret of the environment in config.json, generated and written in
// config.json when missing (different for each environment)
var fs = require('fs')
var path = require('path')
var env = process.env.NODE_ENV || 'dev'
var config = require('../config/config.json')

var MIN_SECRET_LENGTH = 32

// Secret of an environment variable, null if not set. Invalid values stop the start (the value is never shown)
function secretFromEnvironment(name) {
    var value = process.env[name]
    if (value === undefined)
        return null
    if (value.trim().length < MIN_SECRET_LENGTH)
        throw new Error(`Environment variable ${name}: ${MIN_SECRET_LENGTH} characters at least required (empty or too short)`)
    return value
}

var secrets = {jwtSecret: secretFromEnvironment('JWT_SECRET'), jwtRefreshSecret: secretFromEnvironment('JWT_REFRESH_SECRET')}
var generated = false
Object.keys(secrets).forEach(key => {
    if (secrets[key])
        return
    if (!config[env][key]) {
        config[env][key] = require('crypto').randomBytes(32).toString('hex')
        generated = true
    }
    secrets[key] = config[env][key]
})
if (generated)
    fs.writeFileSync(path.join(__dirname, '..', 'config', 'config.json'), JSON.stringify(config, null, 4))
// A refresh token must not be accepted as access token
if (secrets.jwtSecret === secrets.jwtRefreshSecret)
    throw new Error('The JWT secret and the JWT refresh secret must be different (JWT_SECRET, JWT_REFRESH_SECRET)')

var jwtSecret = secrets.jwtSecret
exports.jwtSecret = jwtSecret

var jwtRefreshSecret = secrets.jwtRefreshSecret
exports.jwtRefreshSecret = jwtRefreshSecret

/*  ROLES LOGIC

    role_name: {
        allows: [],
        inherits: []
    }
    allows: allowed permissions to access | use * for all
    inherits: inherits other users "allows"
*/

var builtInRoles = {
    user: {
        allows: [
            // Audits
            'audits:create',
            'audits:read',
            'audits:update',
            'audits:delete',
            // Images
            'images:create',
            'images:read',
            // Clients
            'clients:create',
            'clients:read',
            'clients:update',
            'clients:delete',
            // Companies
            'companies:create',
            'companies:read',
            'companies:update',
            'companies:delete',
            // Languages
            'languages:read',
            // Audit Types
            'audit-types:read',
            // Vulnerability Types
            'vulnerability-types:read',
            // Vulnerability Categories
            'vulnerability-categories:read',
            // Sections Data
            'sections:read',
            // Templates
            'templates:read',
            // Users
            'users:read',
            // Roles
            'roles:read',
            // Vulnerabilities
            'vulnerabilities:read',
            'vulnerability-updates:create',
            // Custom Fields
            'custom-fields:read',
            // Settings
            'settings:read-public'
        ]
    },
    admin: {
        allows: "*"
    }
}

try {
    var customRoles = require('../config/roles.json')}
catch(error) {
    var customRoles = []
}
var roles = {...customRoles, ...builtInRoles}

class ACL {
    constructor(roles) {
        if(typeof roles !== 'object') {
            throw new TypeError('Expected an object as input')
        }
        this.roles = roles
    }

    isAllowed(role, permission) {
        // Check if role exists
        if(!this.roles[role] && !this.roles['user']) {
            return false
        }

        let $role = this.roles[role] || this.roles['user'] // Default to user role in case of inexistant role
        // Check if role is allowed with permission
        if ($role.allows && ($role.allows === "*" || $role.allows.indexOf(permission) !== -1)) {
            return true
        }

        // Check if there is inheritance
        if(!$role.inherits || $role.inherits.length < 1) {
            return false
        }

        // Recursive check childs until true or false
        return $role.inherits.some(role => this.isAllowed(role, permission))
    }

    hasPermission (permission) {
        var Response = require('./httpResponse')
        var jwt = require('jsonwebtoken')

        return (req, res, next) => {
            if (!req.cookies['token']) {
                Response.Unauthorized(res, 'No token provided')
                return;
            }
    
            var cookie = req.cookies['token'].split(' ')
            if (cookie.length !== 2 || cookie[0] !== 'JWT') {
                Response.Unauthorized(res, 'Bad token type')
                return
            }
    
            var token = cookie[1]
            jwt.verify(token, jwtSecret, (err, decoded) => {
                if (err) {
                    if (err.name === 'TokenExpiredError')
                        Response.Unauthorized(res, 'Expired token')
                    else
                        Response.Unauthorized(res, 'Invalid token')
                    return
                }
                
                if ( permission === "validtoken" || this.isAllowed(decoded.role, permission)) {
                    req.decodedToken = decoded
                    return next()
                }
                else {
                    Response.Forbidden(res, 'Insufficient privileges')
                    return
                }
            })
        }
    }

    buildRoles(role) {
        var currentRole = this.roles[role] || this.roles['user'] // Default to user role in case of inexistant role

        var result = currentRole.allows || []

        if (currentRole.inherits) {
            currentRole.inherits.forEach(element => {
                result = [...new Set([...result, ...this.buildRoles(element)])]
            })
        }

        return result
    }

    getRoles(role) {
        var result = this.buildRoles(role)

        if (result.includes('*'))
            return '*'
        
        return result
    }
}

exports.acl = new ACL(roles)

// Verify the JWT stored in the 'token' cookie of a raw Cookie header ("JWT <token>", URI encoded).
// Used by the websocket servers (socket.io and collaborative editing) which don't go through Express.
// Returns the decoded token or null if it is missing or invalid.
function decodeTokenFromCookieHeader(cookieHeader) {
    if (typeof cookieHeader !== 'string')
        return null

    var tokenCookie = cookieHeader.split(';').map(c => c.trim()).find(c => c.startsWith('token='))
    if (!tokenCookie)
        return null

    try {
        var cookie = decodeURIComponent(tokenCookie.substring('token='.length)).split(' ')
        if (cookie.length !== 2 || cookie[0] !== 'JWT')
            return null
        return require('jsonwebtoken').verify(cookie[1], jwtSecret)
    }
    catch (err) {
        return null
    }
}
exports.decodeTokenFromCookieHeader = decodeTokenFromCookieHeader