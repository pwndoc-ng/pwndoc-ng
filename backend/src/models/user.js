var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var bcrypt = require('bcrypt');
var jwt = require('jsonwebtoken');

var auth = require('../lib/auth.js');
const { generateUUID } = require('../lib/utils.js');
var utils = require('../lib/utils.js');
var _ = require('lodash')

var QRCode = require('qrcode');
var OTPAuth = require('otpauth');

var UserSchema = new Schema({
    username:       {type: String, unique: true, required: true},
    password:       {type: String, required: true},
    firstname:      {type: String, required: true},
    lastname:       {type: String, required: true},
    email:          {type: String, required: false},
    phone:          {type: String, required: false},
    role:           {type: String, default: 'user'},
    totpEnabled:    {type: Boolean, default: false},
    totpSecret:     {type: String, default: ''},
    // Secret proposed for the setup of the two-factor authentication: the same QR code on each request until the setup
    totpPendingSecret: {type: String, default: ''},
    enabled:        {type: Boolean, default: true},
    refreshTokens:  [{_id: false, sessionId: String, userAgent: String, token: String}]
}, {timestamps: true});

var totpConfig = {
    issuer: 'PwnDoc',
    label: '',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: ''
};

//check TOTP token 
var checkTotpToken = function(token, secret) {
    if (!token)
        throw({fn: 'BadParameters', message: 'TOTP token required'});
    if (token.length !== 6)
        throw({fn: 'BadParameters', message: 'Invalid TOTP token length'});
    if(!secret)
        throw({fn: 'BadParameters', message: 'TOTP secret required'});

    let newConfig = totpConfig;
    newConfig.secret = secret;
    let totp = new OTPAuth.TOTP(newConfig);
    let delta = totp.validate({
        token: token,
        window: 5,
    });
    //The token is valid in 2 windows in the past and the future, current window is 0.
    if ( delta === null) {
        throw({fn: 'Unauthorized', message: 'Wrong TOTP token.'});
    }else if (delta < -2 || delta > 2) {
        throw({fn: 'Unauthorized', message: 'TOTP token out of window.'});
    }
    return true;
};

/*
*** Statics ***
*/

// Create user
// (async function: an error of the hash rejects the request, it was lost in an async Promise executor and the request
// was never answered)
UserSchema.statics.create = async function (users) {
    utils.validateAll(User, users);
    for (var i=0; i< users.length; i++) {
        // Only hash password when it's not already hashed.
        // Usefull to import users with hashed password (yml file).
        if (!(users[i].password.length == 60 && users[i].password.startsWith("$2b$10$")))
            users[i].password = bcrypt.hashSync(users[i].password, 10);
    }

    try {
        var rows = await User.insertMany(users, {ordered: false})
        return {created: rows.length, duplicates: 0};
    }
    catch (err) {
        if (err.code !== 11000)
            throw err;
        // MongoDB driver 6: inserted documents in insertedDocs, message in writeError.err
        var inserted = err.insertedDocs ? err.insertedDocs.length : ((err.result && err.result.insertedCount) || 0)
        if (inserted === 0)
            throw({fn: 'BadParameters', message: 'Username already exists'});
        var errorMessages = (err.writeErrors || []).map(e => e.errmsg || (e.err && e.err.errmsg) || 'Duplicate')
        return {created: inserted, duplicates: errorMessages};
    }
}

// Get all users
UserSchema.statics.getAll = function () {
    return new Promise((resolve, reject) => {
        var query = this.find();
        query.select('username firstname lastname email phone role totpEnabled enabled');
        query.exec()
        .then(function(rows) {
            resolve(rows);
        })
        .catch(function(err) {
            reject(err);
        })
    });
}

// Get all users for download
UserSchema.statics.export = () => {
    return new Promise((resolve, reject) => {
        var query = User.find();
        query.select('username password firstname lastname email phone role totpEnabled enabled -_id')
        query.exec()
        .then((rows) => {
            resolve(rows);
        })
        .catch((err) => {
            reject(err);
        })
    });
}

// Get one user by its username
UserSchema.statics.getByUsername = function (username) {
    return new Promise((resolve, reject) => {
        var query = this.findOne({username: username})
        query.select('username firstname lastname email phone role totpEnabled enabled');
        query.exec()
        .then(function(row) {
            if (row)
                resolve(row);
            else
                throw({fn: 'NotFound', message: 'User not found'});
        })
        .catch(function(err) {
            reject(err);
        })
    });
}

// Update user with password verification (for updating my profile)
UserSchema.statics.updateProfile = function (username, user) {
    return new Promise((resolve, reject) => {
        var query = this.findOne({username: username});
        var payload = {};
        query.exec()
        .then(function(row) {
            if (!row)
                throw({fn: 'NotFound', message: 'User not found'});
            else if (bcrypt.compareSync(user.password, row.password)) {
                if (user.username) row.username = user.username;
                if (user.firstname) row.firstname = user.firstname;
                if (user.lastname) row.lastname = user.lastname;
                if (!_.isNil(user.email)) row.email = user.email;
                if (!_.isNil(user.phone)) row.phone = user.phone;
                if (user.newPassword) row.password = bcrypt.hashSync(user.newPassword, 10);
                if (typeof(user.totpEnabled)=='boolean') row.totpEnabled = user.totpEnabled;

                payload.id = row._id;
                payload.username = row.username;
                payload.role = row.role;
                payload.firstname = row.firstname;
                payload.lastname = row.lastname;
                payload.email = row.email;
                payload.phone = row.phone;
                payload.roles = auth.acl.getRoles(payload.role)

                return row.save();
            }
            else
                throw({fn: 'Unauthorized', message: 'Current password is invalid'});
        })
        .then(function() {
            var token = jwt.sign(payload, auth.jwtSecret, {expiresIn: '15 minutes'});
            resolve({token: `JWT ${token}`});
        })
        .catch(function(err) {
            if (err.code === 11000)
                reject({fn: 'BadParameters', message: 'Username already exists'});
            else
                reject(err);
        })
    })

}

// Update user (for admin usage)
UserSchema.statics.updateUser = function (userId, user) {
    return new Promise((resolve, reject) => {
        // Never saved without hash (an empty password was saved as is)
        if (user.password)
            user.password = bcrypt.hashSync(user.password, 10);
        else
            delete user.password;
        var query = this.findOneAndUpdate({_id: userId}, user);
        query.exec()
        .then(function(row) {
            if (row)
                resolve('User updated successfully')
            else
                reject({fn: 'NotFound', message: 'User not found'});
        })
        .catch(function(err) {
            if (err.code === 11000)
                reject({fn: 'BadParameters', message: 'Username already exists'});
            else
                reject(err);
        })
    })
}

// Update refreshtoken
UserSchema.statics.updateRefreshToken = function (refreshToken, userAgent) {
    return new Promise((resolve, reject) => {
        var token = ""
        var newRefreshToken = ""
        try {
            var decoded = jwt.verify(refreshToken, auth.jwtRefreshSecret)
            var userId = decoded.userId
            var sessionId = decoded.sessionId
            var expiration = decoded.exp
        }
        catch (err) {
            if (err.name === 'TokenExpiredError')
                throw({fn: 'Unauthorized', message: 'Expired refreshToken'})
            else
                throw({fn: 'Unauthorized', message: 'Invalid refreshToken'})
        }
        var query = this.findById(userId)
        query.exec()
        .then(row => {
            if (row && row.enabled !== false) {
                // Check session exist and sessionId not null (if null then it is a login)
                if (sessionId !== null) {
                    var sessionExist = row.refreshTokens.findIndex(e => e.sessionId === sessionId && e.token === refreshToken)
                    if (sessionExist === -1) // Not found
                        throw({fn: 'Unauthorized', message: 'Session not found'})
                }

                // Generate new token
                var payload = {}
                payload.id = row._id
                payload.username = row.username
                payload.role = row.role
                payload.firstname = row.firstname
                payload.lastname = row.lastname
                payload.email = row.email
                payload.phone = row.phone
                payload.roles = auth.acl.getRoles(payload.role)

                token = jwt.sign(payload, auth.jwtSecret, {expiresIn: '15 minutes'})

                // Remove expired sessions
                row.refreshTokens = row.refreshTokens.filter(e => {
                    try {
                        var decoded = jwt.verify(e.token, auth.jwtRefreshSecret)
                    }
                    catch (err) {
                        var decoded = null
                    }
                    return decoded !== null
                })
                // Update or add new refresh token
                var foundIndex = row.refreshTokens.findIndex(e => e.sessionId === sessionId)
                if (foundIndex === -1) { // Not found
                    sessionId = generateUUID()
                    newRefreshToken = jwt.sign({sessionId: sessionId, userId: userId}, auth.jwtRefreshSecret, {expiresIn: '7 days'})
                    row.refreshTokens.push({sessionId: sessionId, userAgent: userAgent, token:newRefreshToken})
                 }
                else {
                    newRefreshToken = jwt.sign({sessionId: sessionId, userId: userId, exp: expiration}, auth.jwtRefreshSecret)
                    row.refreshTokens[foundIndex].token = newRefreshToken
                }
                return row.save()
            }
            else if (row) {
                reject({fn: 'Unauthorized', message: 'Authentication Failed.'})
            }
            else
                reject({fn: 'NotFound', message: 'Session not found'})
        })
        .then(() => {
            resolve({token: token, refreshToken: newRefreshToken})
        })
        .catch(err => {
            if (err.code === 11000)
                reject({fn: 'BadParameters', message: 'Username already exists'})
            else
                reject(err)
        })
    })
}

// Remove session
UserSchema.statics.removeSession = function (userId, sessionId) {
    return new Promise((resolve, reject) => {
        var query = this.findById(userId)
        query.exec()
        .then(row => {
            if (row) {
                row.refreshTokens = row.refreshTokens.filter(e => e.sessionId !== sessionId)
                return row.save()
            }
            else
                reject({fn: 'NotFound', message: 'User not found'})
        })
        .then(() => {
            resolve('Session removed successfully')
        })
        .catch(err => {
            if (err.code === 11000)
                reject({fn: 'BadParameters', message: 'Username already exists'})
            else
                reject(err)
        })
    })
}

// QR code of the two-factor authentication: of the configured secret when it is enabled (shown again on the profile, a new
// secret did not match the codes of the authenticator), otherwise of the secret proposed for the setup, the same on each
// request until the setup (a new secret on each request made the QR code differ from the secret sent by the page)
UserSchema.statics.getTotpQrcode = async function (username) {
    var user = await this.findOne({username: username}).select('totpEnabled totpSecret totpPendingSecret');
    if (!user)
        throw({fn: 'NotFound', message: 'User not found'});
    var secret = user.totpEnabled ? user.totpSecret : user.totpPendingSecret;
    if (!secret) {
        // Stored only if no other request stored one meanwhile: concurrent requests get the same secret
        await this.updateOne({_id: user._id, totpPendingSecret: {$in: ['', null]}}, {totpPendingSecret: new OTPAuth.Secret({size: 10}).base32});
        secret = (await this.findById(user._id).select('totpPendingSecret')).totpPendingSecret;
    }
    var totp = new OTPAuth.TOTP({...totpConfig, label: username, secret: secret});
    return {totpQrCode: await QRCode.toDataURL(totp.toString()), totpSecret: secret};
}

// verify TOTP and Setup enabled status and secret code
UserSchema.statics.setupTotp = function (token, secret, username){
    return new Promise((resolve, reject) => {
        checkTotpToken(token, secret);
        
        var query = this.findOne({username: username});
        query.exec()
        .then(function(row) {
            if (!row)
                throw({fn: 'NotFound', message: 'User not found'});
            else if (row.totpEnabled === true)
                throw({fn: 'BadParameters', message: 'TOTP already enabled by this user'});
            else {
                row.totpEnabled = true;
                row.totpSecret = secret;
                row.totpPendingSecret = '';
                return row.save();
            }
        })
        .then(function() {
            resolve({msg: true});
        })
        .catch(function(err) {
            reject(err);
        })
    })
}

// verify TOTP and Cancel enabled status and secret code
UserSchema.statics.cancelTotp = function (token, username){
    return new Promise((resolve, reject) => {
        var query = this.findOne({username: username});
        query.exec()
        .then(function(row) {
            if (!row)
                throw({fn: 'NotFound', message: 'User not found'});
            else if (row.totpEnabled !== true)
                throw({fn: 'BadParameters', message: 'TOTP is not enabled yet'});
            else {
                checkTotpToken(token, row.totpSecret);
                row.totpEnabled = false;
                row.totpSecret = '';
                return row.save();
            }
        })
        .then(function() {
            resolve({msg: 'TOTP is canceled.'});
        })
        .catch(function(err) {
            reject(err);
        })
    })
}

/*
*** Methods ***
*/

// Authenticate user with username and password, return JWT token
UserSchema.methods.getToken = function (userAgent) {
    return new Promise((resolve, reject) => {
        var user = this;
        var query = User.findOne({username: user.username});
        query.exec()
        .then(function(row) {
            if (row && row.enabled === false) 
                throw({fn: 'Unauthorized', message: 'Account disabled'});

            if (row && bcrypt.compareSync(user.password, row.password)) {
                if (row.totpEnabled && user.totpToken)
                    checkTotpToken(user.totpToken, row.totpSecret)
                else if (row.totpEnabled)
                    throw({fn: 'BadParameters', message: 'Missing TOTP token'})
                var refreshToken = jwt.sign({sessionId: null, userId: row._id}, auth.jwtRefreshSecret)
                return User.updateRefreshToken(refreshToken, userAgent)
            }
            else {
                if (!row) {
                    // We compare two random strings to generate delay
                    var randomHash = "$2b$10$" + [...Array(53)].map(() => Math.random().toString(36)[2]).join('');
                    bcrypt.compareSync(user.password, randomHash);
                }

                throw({fn: 'Unauthorized', message: 'Authentication Failed.'});
            }
        })
        .then(row => {
            resolve({token: row.token, refreshToken: row.refreshToken})
        })
        .catch(function(err) {
            reject(err);
        })
    })
}

var User = mongoose.model('User', UserSchema);
module.exports = User;