var fs = require('fs');
var app = require('express')();
var https = require('https').Server({
  key: fs.readFileSync(__dirname+'/../ssl/server.key'),
  cert: fs.readFileSync(__dirname+'/../ssl/server.cert')
}, app);
var io = require('socket.io')(https, {
  cors: {
    origin: "*"
  }
})
var bodyParser = require('body-parser');
var cookieParser = require('cookie-parser')
var utils = require('./lib/utils');


const swaggerUi = require('swagger-ui-express');
const swaggerDocument = require('./config/swagger-output.json');



// Get configuration
var env = process.env.NODE_ENV || 'dev';
var config = require('./config/config.json')[env];
global.__basedir = __dirname;

// Database connection
var mongoose = require('mongoose');
// Use native promises
mongoose.Promise = global.Promise;
// Trim all Strings
mongoose.Schema.Types.String.set('trim', true);

// Retried while the database is not available (container starting, migration of the data to a new MongoDB version)
function connectDatabase() {
  mongoose.connect(`mongodb://${config.database.server}:${config.database.port}/${config.database.name}`, {})
  .catch(err => {
    console.log(`Database not available (${err.message}): new attempt in 5 seconds`);
    setTimeout(connectDatabase, 5000);
  });
}
connectDatabase();

// Models import
require('./models/user');
require('./models/audit');
require('./models/client');
require('./models/company');
require('./models/template');
require('./models/vulnerability');
require('./models/vulnerability-update');
require('./models/language');
require('./models/audit-type');
require('./models/vulnerability-type');
require('./models/vulnerability-category');
require('./models/custom-section');
require('./models/custom-field');
require('./models/image');
require('./models/settings');

var auth = require('./lib/auth');
var acl = auth.acl;
var Audit = mongoose.model('Audit');

// Socket IO configuration
// Only authenticated users can open a socket (token cookie is sent with the handshake)
io.use((socket, next) => {
  var decodedToken = auth.decodeTokenFromCookieHeader(socket.handshake.headers.cookie)
  if (!decodedToken)
    return next(new Error('Unauthorized'))
  socket.decodedToken = decodedToken
  next()
})

io.on('connection', (socket) => {
  // Joins waiting for the access check: a 'leave' received meanwhile cancels the join
  var pendingJoins = new Set()

  // Rooms are audit IDs: user must have read access to the audit to join it
  socket.on('join', async (data) => {
    if (!data || typeof data.room !== 'string')
      return
    pendingJoins.add(data.room)
    try {
      var access = await Audit.getUserAccess(data.room, socket.decodedToken.id, acl.isAllowed(socket.decodedToken.role, 'audits:read-all'), false)
    }
    catch (err) {
      console.log(err)
      pendingJoins.delete(data.room)
      return
    }
    if (!pendingJoins.delete(data.room) || !access.read)
      return
    console.log(`user ${socket.decodedToken.username} joined room ${data.room}`)
    socket.username = socket.decodedToken.username;
    do { socket.color = '#'+(0x1000000+(Math.random())*0xffffff).toString(16).substr(1,6); } while (socket.color === "#77c84e")
    socket.join(data.room);
    io.to(data.room).emit('updateUsers');
  });
  socket.on('leave', (data) => {
    if (!data)
      return
    pendingJoins.delete(data.room)
    if (!socket.rooms.has(data.room))
      return
    console.log(`user ${socket.username} left room ${data.room}`)
    socket.leave(data.room)
    io.to(data.room).emit('updateUsers');
  })
  socket.on('updateUsers', (data) => {
    if (!data || !socket.rooms.has(data.room))
      return
    var userList = [...new Set(utils.getSockets(io, data.room).map(s => {
      var user = {};
      user.username = s.username;
      user.color = s.color;
      user.menu = s.menu;
      if (s.finding) user.finding = s.finding;
      if (s.section) user.section = s.section;
      return user;
    }))];
    io.to(data.room).emit('roomUsers', userList);
  })
  socket.on('menu', (data) => {
    if (!data)
      return
    // Store position even if 'join' is not completed yet: it will be broadcasted once in the room
    socket.menu = data.menu;
    (data.finding)? socket.finding = data.finding: delete socket.finding;
    (data.section)? socket.section = data.section: delete socket.section;
    if (socket.rooms.has(data.room))
      io.to(data.room).emit('updateUsers');
  })
  socket.on('disconnect', () => {
    socket.broadcast.emit('updateUsers')
  })
});

// CORS
app.use(function(req, res, next) {
  // res.header("Access-Control-Allow-Origin", req.headers.origin);
  res.header("Access-Control-Allow-Methods", "GET,POST,DELETE,PUT,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  res.header('Access-Control-Expose-Headers', 'Content-Disposition')
  // res.header('Access-Control-Allow-Credentials', 'true')
  next();
});

app.use(bodyParser.json({limit: '100mb'}));
app.use(bodyParser.urlencoded({
  limit: '10mb',
  extended: false // do not need to take care about images, videos -> false: only strings
}));

app.use(cookieParser())

// Express 4 does not handle the rejected promises of async route handlers: the request had no answer and the
// unhandled rejection stopped the process (e.g. PUT on an audit without access). Their errors are passed to the
// error handler defined after the routes.
;['get', 'post', 'put', 'delete'].forEach(method => {
  var route = app[method].bind(app)
  app[method] = (path, ...handlers) => {
    if (handlers.length === 0) return route(path) // app.get(setting)
    return route(path, ...handlers.map(handler => (typeof handler === 'function' && handler.constructor.name === 'AsyncFunction')
      ? (req, res, next) => handler(req, res, next).catch(next)
      : handler))
  }
})

// Routes import
require('./routes/user')(app);
require('./routes/audit')(app, io);
require('./routes/client')(app);
require('./routes/company')(app);
require('./routes/vulnerability')(app);
require('./routes/template')(app);
require('./routes/data')(app);
require('./routes/image')(app);
require('./routes/settings')(app);
require('./routes/backup')(app);

const { cronJobs } = require('./lib/cron');
cronJobs();

require('./lib/migrations').runMigrations();

// Collaborative editing server (Yjs documents)
// Document names are chosen by the client inside the websocket protocol (not in the URL), so access
// control is done per document in onAuthenticate. Defining onAuthenticate makes Hocuspocus wait for it
// before attaching the document (onConnect alone runs concurrently with the first queued messages).
// The client sends a dummy token to trigger it: authentication relies on the httpOnly token cookie.
var { Server: HocuspocusServer } = require('@hocuspocus/server')
var { ResetConnection } = require('@hocuspocus/common')

// Permissions allowing to write non-audit documents (vulnerabilities and custom fields editors)
var dataWritePermissions = ['vulnerabilities:create', 'vulnerabilities:update', 'custom-fields:create', 'custom-fields:update']

// Initial contents of the copy of the document held by the client: token of the editors {"init": {<field>: <id>}}, id of
// the deterministic initial content written in each field (map 'pwndoc', keys 'init:<field>'). The legacy token
// ('cookie') and malformed tokens have no entries
function tokenInitialContents(token) {
  try {
    var init = JSON.parse(token).init
    if (!init || typeof init !== 'object' || Array.isArray(init))
      return {}
    return Object.fromEntries(Object.entries(init).filter(([field, id]) => typeof id === 'number'))
  }
  catch (err) {
    return {}
  }
}

const serverHocus = new HocuspocusServer({
  port: process.env.COLLAB_WEBSOCKET_PORT || 8440,

  // Refuse the websocket upgrade if the user is not authenticated
  async onUpgrade({ request, socket }) {
    var decodedToken = auth.decodeTokenFromCookieHeader(request.headers.cookie)
    if (!decodedToken || !acl.isAllowed(decodedToken.role, 'audits:read')) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      socket.destroy()
      throw null // Empty rejection: Hocuspocus stops processing the upgrade
    }
  },

  // Called for each document opened on the websocket, before any document data is exchanged
  async onAuthenticate({ documentName, requestHeaders, connectionConfig, token }) {
    var decodedToken = auth.decodeTokenFromCookieHeader(requestHeaders.get('cookie')) // Web standard Headers (Hocuspocus v4)
    if (!decodedToken || !acl.isAllowed(decodedToken.role, 'audits:read')) {
      console.warn(`Collaboration refused: document ${documentName}, ${decodedToken ? `role ${decodedToken.role} without audits:read` : 'no valid token'}`)
      throw new Error('Unauthorized')
    }

    // Audit documents are named with the audit ID: same read/write rules as the REST API
    if (mongoose.isObjectIdOrHexString(documentName)) {
      var access = await Audit.getUserAccess(
        documentName,
        decodedToken.id,
        acl.isAllowed(decodedToken.role, 'audits:read-all'),
        acl.isAllowed(decodedToken.role, 'audits:update-all')
      )
      if (!access.read) {
        console.warn(`Collaboration refused: document ${documentName} not readable by ${decodedToken.username}`)
        throw new Error('Forbidden')
      }
      // When reviews are enabled, an audit which is not in edition cannot be changed (same rule as the REST API)
      var readOnly = !access.write
      if (!readOnly && (await mongoose.model('Settings').getAll()).reviews.enabled) {
        var audit = await Audit.findById(documentName).select('state').lean()
        readOnly = !audit || audit.state !== 'EDIT'
      }
      connectionConfig.readOnly = readOnly
    }
    // Other documents (vulnerabilities, custom fields default text) contain data readable by any
    // authenticated user, but only users allowed to edit this data can push changes
    else {
      connectionConfig.readOnly = !dataWritePermissions.some(permission => acl.isAllowed(decodedToken.role, permission))
    }

    // The client writing the initial content of a field records its id (deterministic, from the field and the value of
    // the database) in the map 'pwndoc' (key 'init:<field>'). A client coming back with a copy whose field was initialized
    // from another value of the database than the loaded document is refused instead of merging its copy, which would
    // duplicate the content: it starts again from the shared document. Same initial content (merge without duplicate),
    // field not initialized in the loaded document or document not loaded: accepted, the copy of the client and its
    // offline changes are kept. Accepted limit: a copy initialized from an older value seeds a field not initialized yet
    // in the loaded document (no duplicate, content based on the older value). Hocuspocus sends error.reason to the client
    var document = serverHocus.hocuspocus.documents.get(documentName)
    var shared = document && document.getMap('pwndoc')
    var stale = shared && Object.entries(tokenInitialContents(token)).some(([field, id]) => {
      var current = shared.get(`init:${field}`)
      return current !== undefined && current !== id
    })
    if (stale)
      throw Object.assign(new Error('stale-document'), { reason: 'stale-document' })
  }
})
serverHocus.listen()
app.set('hocuspocus', serverHocus.hocuspocus) // Used to close the editing sessions after a backup restore

// Ends the editing sessions of a document (of all the documents without name) by closing their websockets: the providers
// of the editors reconnect and are authenticated again, with the current access and scope. Called when the access to an
// audit changes (collaborators, reviewers, state, deletion). A close message of the document only (closeConnections)
// leaves the providers detached: they would neither receive nor send changes until the page is reloaded.
app.set('resetCollaborationSessions', (documentName) => {
  serverHocus.hocuspocus.documents.forEach((document) => {
    if (!documentName || document.name === documentName)
      document.getConnections().forEach(connection => connection.webSocket.close(ResetConnection.code, ResetConnection.reason))
  })
})


if(config.apidoc) {
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
}


app.get("*", function(req, res) {
    res.status(404).json({"status": "error", "data": "Route undefined"});
})

// Errors of the routes (async handlers): same answers as the routes (NotFound, BadParameters...)
app.use(function(err, req, res, next) {
    if (res.headersSent)
        return next(err);
    require('./lib/httpResponse.js').Internal(res, err);
});

// Last resort: an unhandled rejection is logged instead of stopping the process
process.on('unhandledRejection', (reason) => {
    console.error('Unhandled promise rejection:', reason);
});

// Start server
https.listen(config.port, config.host)

module.exports = app;
