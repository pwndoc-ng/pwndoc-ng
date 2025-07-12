# Backend Development Guide

This document provides comprehensive guidance for understanding, setting up, and contributing to the PwnDoc-NG backend API.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Technology Stack](#technology-stack)
3. [Project Structure](#project-structure)
4. [Development Setup](#development-setup)
5. [Core Concepts](#core-concepts)
6. [Authentication & Authorization](#authentication--authorization)
7. [Database Models](#database-models)
8. [API Endpoints](#api-endpoints)
9. [Real-time Features](#real-time-features)
10. [Report Generation](#report-generation)
11. [Contributing Guidelines](#contributing-guidelines)
12. [Testing](#testing)
13. [Troubleshooting](#troubleshooting)

## Architecture Overview

PwnDoc-NG backend is a **RESTful API** built with Node.js and Express.js. It follows a **layered architecture** with clear separation of concerns:

- **Express.js**: HTTP server and routing
- **MongoDB**: Document database with Mongoose ODM
- **JWT Authentication**: Token-based authentication with role-based access control
- **Socket.io**: Real-time collaboration and live updates
- **Document Generation**: Complex DOCX report generation with templates
- **Microservices Pattern**: Modular structure with separate concerns

### Request Flow

```
Client Request → Express Router → Authentication Middleware → Authorization (ACL) → 
Controller Logic → Database Model → Response
                    ↓
               Real-time Updates (Socket.io)
```

## Technology Stack

### Core Technologies

| Technology | Version | Purpose |
|------------|---------|---------|
| **Node.js** | 20.0.0 | JavaScript runtime |
| **Express.js** | ^4.18.2 | Web application framework |
| **MongoDB** | 4.2.15 | NoSQL database |
| **Mongoose** | ^8.10.2 | MongoDB object modeling |
| **Socket.io** | ^4.8.1 | Real-time communication |

### Authentication & Security

| Technology | Version | Purpose |
|------------|---------|---------|
| **JWT** | ^9.0.0 | Token-based authentication |
| **bcrypt** | ^5.1.0 | Password hashing |
| **OTPAuth** | ^7.0.6 | Two-factor authentication |
| **QRCode** | ^1.5.1 | TOTP QR code generation |

### Document Generation

| Technology | Version | Purpose |
|------------|---------|---------|
| **docxtemplater** | ^3.60.0 | DOCX template processing |
| **docx-templates** | ^4.11.1 | Advanced DOCX generation |
| **html2ooxml** | Custom | HTML to Office XML conversion |
| **chart-generator** | Custom | Chart generation for reports |

### Development Tools

| Technology | Version | Purpose |
|------------|---------|---------|
| **Jest** | ^29.5.0 | Testing framework |
| **nodemon** | ^2.0.22 | Development server |
| **swagger-autogen** | ^2.23.1 | API documentation |
| **Docker** | - | Containerization |

## Project Structure

```
backend/
├── src/
│   ├── app.js                 # Main application entry point
│   ├── config/
│   │   ├── config.json        # Environment configuration
│   │   └── swagger-output.json # API documentation
│   ├── lib/                   # Core business logic
│   │   ├── auth.js            # Authentication & ACL system
│   │   ├── report-generator.js # DOCX report generation
│   │   ├── chart-generator.js  # Chart generation
│   │   ├── html2ooxml.js      # HTML to Office XML conversion
│   │   ├── cvsscalc31.js      # CVSS calculator
│   │   ├── utils.js           # Utility functions
│   │   └── cron.js            # Scheduled tasks
│   ├── models/                # Mongoose data models
│   │   ├── audit.js           # Audit/assessment model
│   │   ├── user.js            # User model
│   │   ├── vulnerability.js   # Vulnerability model
│   │   ├── company.js         # Company model
│   │   ├── client.js          # Client model
│   │   └── ...                # Other models
│   ├── routes/                # API route definitions
│   │   ├── audit.js           # Audit endpoints
│   │   ├── user.js            # User endpoints
│   │   ├── vulnerability.js   # Vulnerability endpoints
│   │   └── ...                # Other route files
│   └── translate/             # Internationalization
│       ├── es.json
│       ├── fr.json
│       └── ...
├── ssl/                       # SSL certificates
├── tests/                     # Test suites
├── report-templates/          # DOCX report templates
├── docker-compose.dev.yml     # Development environment
├── Dockerfile.dev            # Development Docker image
├── package.json              # Dependencies and scripts
└── swagger.js                # API documentation generator
```

## Development Setup

### Prerequisites

- **Node.js** >= 20.0.0
- **MongoDB** >= 4.2.15
- **Docker** (recommended)
- **Git**

### Local Development

#### Option 1: Docker Development (Recommended)

```bash
# Start backend with MongoDB
cd backend
docker-compose -f docker-compose.dev.yml up

# Backend API available at https://localhost:5252
# MongoDB available at localhost:27017
```

#### Option 2: Local Node.js Development

```bash
# Install dependencies
cd backend
npm install

# Start MongoDB (ensure MongoDB is running)
# Update config.json database.server to "127.0.0.1"

# Start development server
npm run dev
```

### Environment Configuration

Configuration is handled through `src/config/config.json`:

```json
{
  "dev": {
    "port": 5252,
    "host": "",
    "database": {
      "name": "pwndoc",
      "server": "mongo-pwndoc-ng",
      "port": "27017"
    },
    "apidoc": true
  }
}
```

### API Documentation

Swagger API documentation is available at:
- **Development**: `https://localhost:5252/api-docs`
- Generated automatically using `swagger-autogen`

## Core Concepts

### 1. Application Bootstrap

The main application (`src/app.js`) initializes:

```javascript
// SSL/HTTPS Server
var https = require('https').Server({
  key: fs.readFileSync(__dirname+'/../ssl/server.key'),
  cert: fs.readFileSync(__dirname+'/../ssl/server.cert')
}, app);

// Database Connection
mongoose.connect(`mongodb://${config.database.server}:${config.database.port}/${config.database.name}`);

// Socket.io for Real-time
var io = require('socket.io')(https);

// Models Registration
require('./models/user');
require('./models/audit');
// ... other models
```

### 2. Route Structure

Routes are organized by resource and follow RESTful conventions:

```javascript
// routes/audit.js
module.exports = function(app, io) {
  // GET /api/audits - List audits
  app.get("/api/audits", acl.hasPermission('audits:read'), function(req, res) {
    // Implementation
  });

  // POST /api/audits - Create audit
  app.post("/api/audits", acl.hasPermission('audits:create'), function(req, res) {
    // Implementation
  });
}
```

### 3. Middleware Pattern

Common middleware for all routes:

```javascript
// CORS Configuration
app.use(function(req, res, next) {
  res.header("Access-Control-Allow-Methods", "GET,POST,DELETE,PUT,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

// Body Parser
app.use(bodyParser.json({limit: '100mb'}));
app.use(cookieParser());
```

### 4. Error Handling

Standardized error responses using `lib/httpResponse.js`:

```javascript
var Response = require('../lib/httpResponse');

// Usage in routes
Response.Ok(res, data);           // 200 OK
Response.Created(res, data);      // 201 Created
Response.BadParameters(res, msg); // 400 Bad Request
Response.Unauthorized(res, msg);  // 401 Unauthorized
Response.Forbidden(res, msg);     // 403 Forbidden
Response.NotFound(res, msg);      // 404 Not Found
Response.Internal(res, err);      // 500 Internal Server Error
```

## Authentication & Authorization

### JWT Authentication

Token-based authentication with refresh tokens:

```javascript
// Token generation
var token = jwt.sign(payload, auth.jwtSecret, {expiresIn: '15 minutes'});
var refreshToken = jwt.sign(payload, auth.jwtRefreshSecret, {expiresIn: '7 days'});

// Token validation middleware
acl.hasPermission('permission:name')
```

### Role-Based Access Control (RBAC)

Comprehensive permission system with role inheritance:

```javascript
// Built-in roles
var roles = {
  user: {
    allows: [
      'audits:create',
      'audits:read',
      'audits:update',
      'audits:delete',
      // ... other permissions
    ]
  },
  admin: {
    allows: "*"  // All permissions
  }
}

// Permission checking
acl.isAllowed(userRole, 'audits:create')
```

### Two-Factor Authentication (2FA)

TOTP-based 2FA with QR code generation:

```javascript
// TOTP Configuration
var totpConfig = {
  issuer: 'PwnDoc',
  algorithm: 'SHA1',
  digits: 6,
  period: 30
};

// QR code generation for setup
QRCode.toDataURL(totp.toString())
```

## Database Models

### 1. Audit Model

Core entity representing security assessments:

```javascript
var AuditSchema = new Schema({
  name: {type: String, required: true},
  auditType: String,
  date: String,
  summary: String,
  company: {type: Schema.Types.ObjectId, ref: 'Company'},
  client: {type: Schema.Types.ObjectId, ref: 'Client'},
  collaborators: [{type: Schema.Types.ObjectId, ref: 'User'}],
  reviewers: [{type: Schema.Types.ObjectId, ref: 'User'}],
  language: {type: String, required: true},
  findings: [Finding],              // Embedded findings
  template: {type: Schema.Types.ObjectId, ref: 'Template'},
  state: {type: String, enum: ['EDIT', 'REVIEW', 'APPROVED'], default: 'EDIT'},
  customFields: [customField]
});
```

### 2. User Model

Authentication and user management:

```javascript
var UserSchema = new Schema({
  username: {type: String, unique: true, required: true},
  password: {type: String, required: true},
  firstname: {type: String, required: true},
  lastname: {type: String, required: true},
  email: String,
  phone: String,
  role: {type: String, default: 'user'},
  totpEnabled: {type: Boolean, default: false},
  totpSecret: String,
  enabled: {type: Boolean, default: true},
  refreshTokens: [{sessionId: String, token: String}]
});
```

### 3. Vulnerability Model

Vulnerability database and findings:

```javascript
var VulnerabilitySchema = new Schema({
  vulnType: String,
  title: String,
  description: String,
  observation: String,
  remediation: String,
  remediationComplexity: {type: Number, enum: [1,2,3]},
  priority: {type: Number, enum: [1,2,3,4]},
  references: [String],
  cvssv3: String,
  category: String,
  customFields: [customField]
});
```

### 4. Model Relationships

```
User ──┬── Audit (creator)
       ├── Audit (collaborators)
       └── Audit (reviewers)

Audit ──┬── Company
        ├── Client
        ├── Template
        └── Findings[]

Vulnerability ──── VulnerabilityType
             ├── VulnerabilityCategory
             └── CustomFields[]
```

## API Endpoints

### Authentication Endpoints

```
POST   /api/users/token          # Login
GET    /api/users/refreshtoken   # Refresh token
DELETE /api/users/refreshtoken   # Logout
POST   /api/users/init           # Initialize first user
GET    /api/users/init           # Check initialization status
```

### User Management

```
GET    /api/users/me             # Get current user profile
PUT    /api/users/me             # Update profile
POST   /api/users/totp           # Setup 2FA
GET    /api/users/totp           # Get TOTP QR code
DELETE /api/users/totp           # Disable 2FA
```

### Audit Management

```
GET    /api/audits               # List audits
POST   /api/audits               # Create audit
GET    /api/audits/:id           # Get audit details
PUT    /api/audits/:id/general   # Update general info
GET    /api/audits/:id/generate  # Generate report
DELETE /api/audits/:id           # Delete audit
```

### Findings Management

```
POST   /api/audits/:id/findings           # Create finding
GET    /api/audits/:id/findings/:findingId # Get finding
PUT    /api/audits/:id/findings/:findingId # Update finding
DELETE /api/audits/:id/findings/:findingId # Delete finding
```

### Vulnerability Database

```
GET    /api/vulnerabilities      # List vulnerabilities
POST   /api/vulnerabilities      # Create vulnerability
PUT    /api/vulnerabilities/:id  # Update vulnerability
DELETE /api/vulnerabilities/:id  # Delete vulnerability
```

## Real-time Features

### Socket.io Integration

Real-time collaboration for simultaneous editing:

```javascript
// Socket.io configuration
io.on('connection', (socket) => {
  socket.on('join', (data) => {
    socket.join(data.room);
    socket.username = data.username;
    socket.color = generateColor();
    io.to(data.room).emit('updateUsers');
  });

  socket.on('menu', (data) => {
    socket.menu = data.menu;
    if (data.finding) socket.finding = data.finding;
    io.to(data.room).emit('updateUsers');
  });
});
```

### Collaborative Editing

Integration with Hocuspocus for real-time document editing:

```javascript
// Hocuspocus server for collaborative editing
const serverHocus = hocus.Server.configure({
  port: process.env.COLLAB_WEBSOCKET_PORT || 8440,
  onUpgrade(data) {
    // Authentication and authorization for collaborative editing
    return new Promise(async (resolve, reject) => {
      // JWT validation and audit access verification
    });
  }
});
```

## Report Generation

### DOCX Template System

Advanced report generation using `docxtemplater`:

```javascript
// Template processing
var doc = new Docxtemplater(zip, {
  modules: [imageModule],
  parser: parser,
  paragraphLoop: true
});

// Data preparation
var preppedAudit = await prepAuditData(audit, settings);

// Render document
doc.render(preppedAudit);
```

### Template Features

- **Dynamic Content**: Conditional sections and loops
- **Image Handling**: Automatic image resizing and embedding
- **Chart Generation**: CVSS score charts and finding statistics
- **Custom Fields**: Dynamic form fields in templates
- **Internationalization**: Multi-language template support

### Angular Expression Filters

Custom filters for template processing:

```javascript
// Custom filters
expressions.filters.uniqFindings = function(findings) {
  // Remove duplicate findings by title
};

expressions.filters.bookmarkCreate = function(input, refid) {
  // Create Word bookmarks for cross-references
};

expressions.filters.splitParagraphs = function(text) {
  // Split HTML into Word paragraphs
};
```

## Contributing Guidelines

### 1. Code Style

- **ES6+** syntax with async/await
- **RESTful** API design principles
- **Mongoose** for all database operations
- **Consistent error handling** with Response library

### 2. Adding New Features

#### New API Endpoint

```javascript
// 1. Add route in routes/feature.js
app.post("/api/feature", acl.hasPermission('feature:create'), function(req, res) {
  // Validation
  if (!req.body.name) {
    Response.BadParameters(res, 'Name is required');
    return;
  }

  // Business logic
  Feature.create(req.body)
    .then(result => Response.Created(res, result))
    .catch(err => Response.Internal(res, err));
});
```

#### New Database Model

```javascript
// 1. Create models/feature.js
var FeatureSchema = new Schema({
  name: {type: String, required: true},
  description: String,
  creator: {type: Schema.Types.ObjectId, ref: 'User'}
});

// 2. Add static methods
FeatureSchema.statics.create = function(data) {
  return new Promise((resolve, reject) => {
    // Implementation
  });
};

// 3. Register in app.js
require('./models/feature');
```

### 3. Database Operations

Use Mongoose ODM for all database interactions:

```javascript
// Query with population
var query = Audit.findById(auditId)
  .populate('creator', 'username firstname lastname')
  .populate('company')
  .populate('collaborators');

// Promise-based operations
query.exec()
  .then(result => {
    // Success handling
  })
  .catch(err => {
    // Error handling
  });
```

### 4. Authentication Integration

Add permission checks to new endpoints:

```javascript
// 1. Define permission in auth.js
var builtInRoles = {
  user: {
    allows: [
      'feature:create',
      'feature:read',
      'feature:update',
      'feature:delete'
    ]
  }
};

// 2. Use permission in route
app.post("/api/feature", acl.hasPermission('feature:create'), handler);
```

## Testing

### Test Structure

```bash
# Run all tests
npm test

# Run specific test file
npm test -- tests/audit.test.js
```

### Test Examples

```javascript
// tests/audit.test.js
const request = require('supertest');
const app = require('../src/app');

describe('Audit API', () => {
  test('should create audit', async () => {
    const auditData = {
      name: 'Test Audit',
      language: 'en',
      auditType: 'Network'
    };

    const response = await request(app)
      .post('/api/audits')
      .send(auditData)
      .expect(201);

    expect(response.body.datas.audit.name).toBe('Test Audit');
  });
});
```

### Test Data Management

```javascript
// Setup test database
beforeEach(async () => {
  await User.deleteMany({});
  await Audit.deleteMany({});
  // Create test data
});

// Cleanup after tests
afterEach(async () => {
  await mongoose.connection.db.dropDatabase();
});
```

## Troubleshooting

### Common Issues

#### 1. Database Connection

```bash
# Check MongoDB status
docker-compose logs mongodb

# Verify connection string in config.json
{
  "database": {
    "server": "mongo-pwndoc-ng",  // Docker service name
    "port": "27017"
  }
}
```

#### 2. SSL Certificate Issues

```bash
# Generate new certificates
openssl req -x509 -newkey rsa:4096 -keyout ssl/server.key -out ssl/server.cert -days 365 -nodes
```

#### 3. Permission Errors

```bash
# Check user role and permissions
console.log(req.decodedToken.role);
console.log(acl.getRoles(req.decodedToken.role));
```

#### 4. Report Generation Issues

```bash
# Check template path
var templatePath = `${__basedir}/../report-templates/${audit.template.name}.docx`;
console.log('Template path:', templatePath);
console.log('Template exists:', fs.existsSync(templatePath));
```

### Development Tools

#### 1. API Testing

```bash
# Test with curl
curl -X POST https://localhost:5252/api/audits \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","language":"en","auditType":"Network"}' \
  -k

# Or use Postman/Insomnia with the Swagger documentation
```

#### 2. Database Inspection

```bash
# Connect to MongoDB
docker exec -it mongo-pwndoc-ng-dev mongo

# Show databases
show dbs

# Use pwndoc database
use pwndoc

# Show collections
show collections

# Query data
db.audits.find().pretty()
```

#### 3. Debugging

```javascript
// Add debugging to routes
console.log('Request body:', req.body);
console.log('User token:', req.decodedToken);

// Debug database queries
mongoose.set('debug', true);
```

### Performance Optimization

#### 1. Database Indexing

```javascript
// Add indexes to frequently queried fields
AuditSchema.index({creator: 1, createdAt: -1});
AuditSchema.index({'findings.title': 'text'});
```

#### 2. Query Optimization

```javascript
// Use lean() for read-only queries
var query = Audit.find().lean();

// Limit fields in responses
query.select('name language creator createdAt');

// Use population selectively
query.populate('creator', 'username firstname lastname');
```

#### 3. Caching

```javascript
// Implement caching for frequently accessed data
var cache = {};

// Cache settings
if (!cache.settings) {
  cache.settings = await Settings.getAll();
}
```

## Additional Resources

- **Express.js Documentation**: https://expressjs.com/
- **Mongoose Documentation**: https://mongoosejs.com/
- **Socket.io Documentation**: https://socket.io/docs/
- **JWT Documentation**: https://jwt.io/
- **Jest Testing**: https://jestjs.io/docs/
- **Docker Documentation**: https://docs.docker.com/
- **MongoDB Documentation**: https://docs.mongodb.com/

---

This documentation should be updated as the backend evolves. For questions or clarifications, please refer to the existing codebase or create an issue in the project repository. 