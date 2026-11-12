const request = require("supertest");

var env = process.env.NODE_ENV || 'dev';
var config = require('../src/config/config.json')[env];

var mongoose = require('mongoose');
mongoose.connect(`mongodb://${config.database.server}:${config.database.port}/${config.database.name}`, {});

/* Clean the DB */
mongoose.connection.dropDatabase();

const app = require(__dirname+"/../src/app");

// Import tests
require('./unauthenticated.test')(request, app)
require('./user.test')(request, app)
require('./template.test')(request, app)
require('./data.test')(request, app)
require('./company.test')(request, app)
require('./client.test')(request, app)
require('./vulnerability.test')(request, app)
require('./audit.test')(request, app)
require('./settings.test')(request, app)
require('./role.test')(request, app)
require('./auth.test')(request, app)
require('./customdata.test')(request, app)
require('./image.test')(request, app)
require('./audit-workflow.test')(request, app)
require('./proposals.test')(request, app)
require('./vulndb.test')(request, app)
require('./configs.test')(request, app)
require('./report.test')(request, app)
require('./report-content.test')(request, app)
require('./company-client.test')(request, app)
require('./socket.test')(request, app)
require('./collaboration.test')(request, app)
require('./scenario.test')(request, app)
require('./spellcheck.test')(request, app)
require('./highlights.test')(request, app)
require('./qa.test')(request, app)
require('./ai.test')(request, app)
require('./permissions-matrix.test')(request, app)
require('./robustness.test')(request, app)
require('./backup.test')(request, app) // Last: a restore replaces the whole database
require('./lib.test')()
require('./html2ooxml.test')()
require('./units.test')()
require('./secrets.test')()