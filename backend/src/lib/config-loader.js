const fs = require("fs");
const env = process.env.NODE_ENV || 'dev'

const jsonFile = `${__dirname}/../config/config.json`
const configJSON = require(jsonFile)

let currentConfig = configJSON[env];
if (process.env.JWT_SECRET && process.env.JWT_REFRESH_SECRET) {
    currentConfig.jwtSecret = process.env.JWT_SECRET;
    currentConfig.jwtRefreshSecret = process.env.JWT_REFRESH_SECRET;
} else if (env === "prod") {

    if (process.env.PROD_JWT_SECRET && process.env.PROD_JWT_REFRESH_SECRET) {
        currentConfig.jwtSecret = process.env.PROD_JWT_SECRET;
        currentConfig.jwtRefreshSecret = process.env.PROD_JWT_REFRESH_SECRET;
    }
} else if (env === "dev") {

    if (process.env.DEV_JWT_SECRET && process.env.DEV_JWT_REFRESH_SECRET) {
        currentConfig.jwtSecret = process.env.DEV_JWT_SECRET;
        currentConfig.jwtRefreshSecret = process.env.DEV_JWT_REFRESH_SECRET;
    }
} else if (env === "test") {

    if (process.env.TEST_JWT_SECRET && process.env.TEST_JWT_REFRESH_SECRET) {
        currentConfig.jwtSecret = process.env.TEST_JWT_SECRET;
        currentConfig.jwtRefreshSecret = process.env.TEST_JWT_REFRESH_SECRET;
    }
}

if (!currentConfig.jwtSecret || !currentConfig.jwtRefreshSecret) {
    if (!currentConfig.jwtSecret) {
        configJSON[env].jwtSecret = require('crypto').randomBytes(32).toString('hex')
        currentConfig.jwtSecret = configJSON[env].jwtSecret
    }

    if (!currentConfig.jwtRefreshSecret) {
        configJSON[env].jwtRefreshSecret = require('crypto').randomBytes(32).toString('hex')
        currentConfig.jwtRefreshSecret = configJSON[env].jwtRefreshSecret
    }

    var configString = JSON.stringify(configJSON, null, 4)
    fs.writeFileSync(jsonFile, configString)
}

exports.config = currentConfig