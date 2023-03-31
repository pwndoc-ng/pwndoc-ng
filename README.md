# PwnDoc-ng

<img src='/docs/_images/logo_text.png' width="200px" />

PwnDoc-ng is a pentest reporting application making it simple and easy to write your findings and generate a customizable Docx report. It is based on original fork of [PwnDoc](https://github.com/pwndoc/pwndoc) work by [yeln4ts](https://github.com/yeln4ts).
The main goal is to have more time to **Pwn** and less time to **Doc** by mutualizing data like vulnerabilities between users.

## What's New ?

PwnDoc was originaly manage by its creator. After months of absence, an increase of issues and pending pull requests, we decided to open this maintained fork.

This fork includes pending PR and new feature such as:
- Fix build error due to Node version
- Fix LFI/RCE vulnerability
- Tiptap 2.0 WYSIWYG
- Collaborative editing
- Table support
- New filters
- Reviewer variable
- Remediation complexity color by @Syzik
- Mongo-data volume from @noraj
- Minor bumps
...


## Quick Setup
### Installation

PwnDoc-ng uses 3 containers:
  - backend (pwndoc-ng-backend)
  - frontend (pwndoc-ng-frontend)
  - database (mongo-pwndoc-ng)
Those containers can be orchestrated within the `docker-compose.yml` by using [docker-compose](https://docs.docker.com/compose/).

#### Production
***For production usage: Make sure to change the certificates in `backend/ssl` folder and optionnaly to set the JWT secret in `backend/src/lib/auth.js` (`jwtSecret` and `jwtRefreshSecret` in `backend/src/config/config.json`) if you don't want to use random ones.***

Build and run Docker containers
```docker-compose up -d --build```

Stop/Start containers
```docker-compose stop```
```docker-compose start```

Update PwnDoc-ng
```docker-compose down && git pull && docker-compose up -d --build```

Remove containers
```docker-compose down```

#### Development
For development purposes, specific docker-compose files can be used in each folder (`backend` and `frontend`).
The source code can then be modified live and the application will automatically reload on changes.

Build and run Docker containers
```docker-compose -f backend/docker-compose.dev.yml up -d --build```

Stop/Start containers
```docker-compose -f backend/docker-compose.dev.yml stop```
```docker-compose -f backend/docker-compose.dev.yml start```

Remove containers
```docker-compose -f backend/docker-compose.dev.yml down```

#### Tests
***Don't use it in production as it will delete the production database!***
By now only backend tests have been written (it's a continuous work in progress).

Test files are located in `backend/tests` using [Jest]() testing framework.

Script `backend/tests/run_tests.sh` cat be used to launch tests:

```
Usage:        ./run_tests.sh -q|-f [-h, --help]

Options:
  -h, --help  Display help
  -q          Run quick tests (No build)
  -f          Run full tests (Build with no cache)
```

### API
#### Production
- the application: [https://localhost:8443](https://localhost:8443)
- the API: [https://localhost:8443/api](https://localhost:8443/api)

#### Development
- the application: [https://localhost:8081](https://localhost:8081)
- the API: [https://localhost:8081/api](https://localhost:8081/api)

### Debugging
Display backend container logs - the default loaded `docker-compose.yml` is the one in the actual working directory
```docker-compose logs -f pwndoc-ng-backend```
If you want to debug a container from the development configuration, you have to provide the development file
```docker-compose -f backend/docker-compose.dev.yml logs -f pwndoc-ng-backend```

## Documentation

- [Installation](https://pwndoc-ng.github.io/pwndoc-ng/#/installation)
- [Data](https://pwndoc-ng.github.io/pwndoc-ng/#/data)
- [Vulnerabilities](https://pwndoc-ng.github.io/pwndoc-ng/#/vulnerabilities)
- [Audits](https://pwndoc-ng.github.io/pwndoc-ng/#/audits)
- [Templating](https://pwndoc-ng.github.io/pwndoc-ng/#/docxtemplate)


## Features

- Multiple Language support
- Multiple Data support
- Great Customization
  - Manage reusable Audit and Vulnerability Data
  - Create Custom Sections
  - Add custom fields to Vulnerabilities
- Vulnerabilities Management
- Multi-User reporting
- Docx Report Generation
- Docx Template customization

## Demos

### Multi-User reporting
![Shared Audit demo gif](https://raw.githubusercontent.com/pwndoc-ng/pwndoc-ng/master/demos/shared_audit_demo.gif)

### Finding edition
![Finding edit demo gif](https://raw.githubusercontent.com/pwndoc-ng/pwndoc-ng/master/demos/audit_finding_demo.gif)

### Vulnerability management workflow
![Create and update demo gif](https://raw.githubusercontent.com/pwndoc-ng/pwndoc-ng/master/demos/create_and_update_finding.gif)

## Contribute

Feel free to contribute :).
