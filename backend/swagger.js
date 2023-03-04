const swaggerAutogen = require('swagger-autogen')();

const doc = {
    info: {
        title: 'PwndocNG API Documentation',
        description: '',
    },
    host: '/',
    schemes: ['http'],
};

const outputFile = './src/config/swagger-output.json';
const endpointsFiles = [
    './src/routes/audit.js',
    './src/routes/client.js',
    './src/routes/company.js',
    './src/routes/data.js',
    './src/routes/image.js',
    './src/routes/settings.js',
    './src/routes/template.js',
    './src/routes/user.js',
    './src/routes/vulnerability.js'
];

/* NOTE: if you use the express Router, you must pass in the
   'endpointsFiles' only the root file where the route starts,
   such as index.js, app.js, routes.js, ... */

swaggerAutogen(outputFile, endpointsFiles, doc);