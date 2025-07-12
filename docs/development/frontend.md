# Frontend Development Guide

This document provides comprehensive guidance for understanding, setting up, and contributing to the PwnDoc-NG frontend application.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Technology Stack](#technology-stack)
3. [Project Structure](#project-structure)
4. [Development Setup](#development-setup)
5. [Key Concepts](#key-concepts)
6. [Component Patterns](#component-patterns)
7. [State Management](#state-management)
8. [Contributing Guidelines](#contributing-guidelines)
9. [Troubleshooting](#troubleshooting)

## Architecture Overview

PwnDoc-NG frontend is a **Single Page Application (SPA)** built with Vue 3 and Quasar Framework. It follows a **component-based architecture** with clear separation of concerns:

- **Vue 3**: Core framework using Composition API
- **Quasar Framework**: UI component library and build tooling
- **Service Layer**: API communication and business logic
- **Real-time Collaboration**: WebSocket-based live editing
- **Internationalization**: Multi-language support
- **Progressive Web App**: PWA capabilities

### Application Flow

```
User Request → Router → Layout → Page Component → Service Layer → Backend API
                ↓
              Components ← State Management ← WebSocket Updates
```

## Technology Stack

### Core Technologies

| Technology | Version | Purpose |
|------------|---------|---------|
| **Vue 3** | ^3.5.13 | Core framework |
| **Quasar** | ^2.17.7 | UI framework & build tools |
| **Vue Router** | Built-in | Client-side routing |
| **Vue I18n** | ^9.14.2 | Internationalization |
| **Axios** | ^1.7.9 | HTTP client |

### Rich Text Editing

| Technology | Version | Purpose |
|------------|---------|---------|
| **TipTap** | ^2.11.5 | Rich text editor |
| **Yjs** | ^13.6.23 | Collaborative editing |
| **Hocuspocus** | ^2.15.2 | Real-time provider |

### Development Tools

| Technology | Version | Purpose |
|------------|---------|---------|
| **Webpack** | Via Quasar | Module bundling |
| **Stylus** | ^0.64.0 | CSS preprocessing |
| **Docker** | - | Containerization |

## Project Structure

```
frontend/
├── public/                    # Static assets
│   ├── js/                   # Public JavaScript files
│   └── *.png                 # Images and icons
├── src/
│   ├── assets/               # Build-time assets
│   ├── boot/                 # App initialization plugins
│   │   ├── auth.js          # Authentication setup
│   │   ├── axios.js         # HTTP client configuration
│   │   ├── i18n.js          # Internationalization
│   │   ├── socketio.js      # WebSocket setup
│   │   └── ...
│   ├── components/           # Reusable Vue components
│   │   ├── editor.vue       # Rich text editor
│   │   ├── custom-fields.vue # Dynamic form fields
│   │   └── ...
│   ├── css/                  # Global styles
│   ├── i18n/                 # Translation files
│   │   ├── en-US/
│   │   ├── fr-FR/
│   │   └── ...
│   ├── layouts/              # Page layouts
│   │   └── home.vue         # Main application layout
│   ├── pages/               # Page components
│   │   ├── audits/          # Audit management pages
│   │   ├── data/            # Data management pages
│   │   ├── vulnerabilities/ # Vulnerability database
│   │   └── ...
│   ├── router/              # Routing configuration
│   │   ├── index.js         # Router setup
│   │   └── routes.js        # Route definitions
│   └── services/            # API service layer
│       ├── audit.js         # Audit-related API calls
│       ├── user.js          # Authentication & user management
│       └── ...
├── ssl/                     # SSL certificates for dev
├── docker-compose.dev.yml   # Development Docker setup
├── Dockerfile.dev          # Development Docker image
├── package.json            # Dependencies and scripts
└── quasar.conf.js         # Quasar configuration
```

## Development Setup

### Prerequisites

- **Node.js** >= 19.8.1
- **npm** >= 5.6.0
- **Docker** (recommended for full stack development)

### Local Development

#### Option 1: Docker Development (Recommended)

```bash
# Start the development environment
cd frontend
docker-compose -f docker-compose.dev.yml up

# The frontend will be available at https://localhost:8081
```

#### Option 2: Local Node.js Development

```bash
# Install dependencies
cd frontend
npm install

# Start development server
npm run dev
```

### Environment Configuration

The application supports different environments through build configuration:

- **Development**: API on port 5252
- **Production**: API on port 8443

Configuration is handled in `quasar.conf.js`:

```javascript
env: ctx.dev
  ? { API_PORT: 5252 }      // Development
  : { API_PORT: 8443 }      // Production
```

## Key Concepts

### 1. Boot Files

Boot files initialize core functionality before the app starts. Located in `src/boot/`:

- **auth.js**: Token refresh and route guards
- **axios.js**: HTTP client with interceptors
- **i18n.js**: Internationalization setup
- **socketio.js**: Real-time communication

### 2. Page Component Pattern

Pages follow a **template separation pattern**:

```
pages/audits/list/
├── index.vue          # Component entry point
├── audits-list.html   # Template file
└── audits-list.js     # Logic and data
```

**Example:**
```vue
<!-- index.vue -->
<template src='./audits-list.html'></template>
<script src='./audits-list.js'></script>
```

### 3. Service Layer

Services handle API communication and business logic:

```javascript
// services/audit.js
export default {
  getAudits: function(filters) {
    return api.get(`audits${queryParams}`)
  },
  
  createAudit: function(audit) {
    return api.post('audits', audit)
  }
}
```

### 4. Authentication Flow

```javascript
// Boot process (auth.js)
User.refreshToken() → Success → Continue to app
                   → Failure → Redirect to login

// Route guards
router.beforeEach((to, from, next) => {
  if (to.path === '/login') {
    User.isAuth() ? next('/') : next()
  } else {
    next()
  }
})
```

### 5. Real-time Collaboration

Uses **WebSocket** for live updates and **Yjs** for collaborative editing:

```javascript
// socketio.js
const socket = io(`${window.location.protocol}//${window.location.hostname}`)

socket.on('disconnect', () => {
  // Show offline indicator
})

socket.on('connect', () => {
  // Hide offline indicator
})
```

## Component Patterns

### 1. Quasar Components

Leverage Quasar's extensive component library:

```vue
<template>
  <q-table
    :columns="dtHeaders"
    :rows="audits"
    :filter="search"
    v-model:pagination="pagination"
  >
    <template v-slot:top>
      <q-input v-model="search" />
    </template>
  </q-table>
</template>
```

### 2. Custom Components

Create reusable components for complex functionality:

```vue
<!-- components/editor.vue -->
<template>
  <q-card class="editor">
    <div class="editor-toolbar">
      <!-- Rich text editing toolbar -->
    </div>
    <editor-content :editor="editor" />
  </q-card>
</template>
```

### 3. Form Validation

Consistent error handling pattern:

```javascript
data() {
  return {
    errors: { name: '', email: '' },
    form: { name: '', email: '' }
  }
},

methods: {
  cleanErrors() {
    this.errors = { name: '', email: '' }
  },
  
  validateForm() {
    this.cleanErrors()
    if (!this.form.name) this.errors.name = "Name required"
    if (!this.form.email) this.errors.email = "Email required"
    return !Object.values(this.errors).some(error => error)
  }
}
```

## State Management

### User State

Global user state is managed through the User service:

```javascript
// services/user.js
export default {
  user: {
    username: "",
    role: "",
    firstname: "",
    lastname: ""
  },
  
  isAuth() {
    return this.user && this.user.username
  },
  
  isAllowed(role) {
    return this.user.roles?.includes(role) || this.user.roles === '*'
  }
}
```

### Component State

Use Vue's reactive data for component-level state:

```javascript
export default {
  data() {
    return {
      loading: false,
      items: [],
      selectedItem: null
    }
  },
  
  computed: {
    filteredItems() {
      return this.items.filter(item => item.visible)
    }
  }
}
```

### Settings and Configuration

Global settings are injected via boot files:

```javascript
// boot/settings.js
app.config.globalProperties.$settings = {
  reviews: { enabled: true },
  // ... other settings
}
```

## Contributing Guidelines

### 1. Code Style

- **Vue 3 Composition API** for new components
- **Quasar components** over custom HTML
- **ES6+** syntax
- **Consistent naming**: kebab-case for files, camelCase for variables

### 2. File Organization

```bash
# New feature structure
pages/feature-name/
├── index.vue              # Main component
├── feature-name.html      # Template (if complex)
├── feature-name.js        # Logic (if complex)
└── components/            # Feature-specific components
    └── sub-component.vue
```

### 3. Service Layer

Create services for API interactions:

```javascript
// services/new-feature.js
import { api } from 'boot/axios'

export default {
  getItems: function() {
    return api.get('new-feature/items')
  },
  
  createItem: function(item) {
    return api.post('new-feature/items', item)
  }
}
```

### 4. Internationalization

Add translations for all user-facing text:

```javascript
// i18n/en-US/index.js
export default {
  newFeature: {
    title: 'New Feature',
    description: 'Feature description'
  }
}
```

```vue
<!-- In templates -->
<h1>{{ $t('newFeature.title') }}</h1>
```

### 5. Testing

While formal tests are not currently implemented, manual testing should cover:

- **Authentication flows**
- **CRUD operations**
- **Real-time updates**
- **Responsive design**
- **Cross-browser compatibility**

### 6. Docker Development

When adding new dependencies:

```bash
# Rebuild the development image
docker-compose -f docker-compose.dev.yml build
docker-compose -f docker-compose.dev.yml up
```

## Troubleshooting

### Common Issues

#### 1. SSL Certificate Errors

```bash
# Development server uses self-signed certificates
# Accept the certificate in your browser at https://localhost:8081
```

#### 2. API Connection Issues

```bash
# Check backend is running
docker-compose logs pwndoc-ng-backend

# Verify proxy configuration in quasar.conf.js
proxy: {
  '/api': {
    target: 'https://pwndoc-ng-backend:5252',
    changeOrigin: true,
    secure: false
  }
}
```

#### 3. Node.js Version Issues

```bash
# Use the correct Node.js version
export NODE_OPTIONS=--openssl-legacy-provider
npm run dev
```

#### 4. WebSocket Connection Problems

- Check firewall settings
- Verify backend WebSocket server is running
- Inspect browser network tab for WebSocket connections

### Development Tools

#### 1. Vue DevTools

Install Vue DevTools browser extension for debugging:
- Component inspection
- Event tracking
- State management

#### 2. Quasar DevTools

```bash
# Install Quasar CLI globally
npm install -g @quasar/cli

# Use Quasar development tools
quasar dev
```

#### 3. API Testing

Use browser Network tab or tools like Postman to test API endpoints:

```bash
# Example API calls
GET https://localhost:8081/api/audits
POST https://localhost:8081/api/audits
```

### Performance Optimization

#### 1. Code Splitting

Leverage Vue Router's lazy loading:

```javascript
// routes.js - Already implemented
{
  path: 'audits',
  component: () => import('pages/audits')  // Lazy loaded
}
```

#### 2. Component Optimization

```vue
<script>
import { defineAsyncComponent } from 'vue'

export default {
  components: {
    // Lazy load heavy components
    HeavyComponent: defineAsyncComponent(() =>
      import('./HeavyComponent.vue')
    )
  }
}
</script>
```

#### 3. Bundle Analysis

```bash
# Analyze bundle size
quasar build --analyze
```

## Additional Resources

- **Vue 3 Documentation**: https://vuejs.org/guide/
- **Quasar Framework**: https://quasar.dev/
- **TipTap Editor**: https://tiptap.dev/
- **Vue I18n**: https://vue-i18n.intlify.dev/
- **Socket.io Client**: https://socket.io/docs/v4/client-api/

---

This documentation should be updated as the frontend evolves. For questions or clarifications, please refer to the existing codebase or create an issue in the project repository. 