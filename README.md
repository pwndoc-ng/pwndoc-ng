# PwnDoc-ng

<img src='/docs/_images/logo_text.png' width="200px" />

PwnDoc-ng is a pentest reporting application making it simple and easy to write your findings and generate a customizable Docx report. It is based on original fork of [PwnDoc](https://github.com/pwndoc/pwndoc) work by [yeln4ts](https://github.com/yeln4ts).
The main goal is to have more time to **Pwn** and less time to **Doc** by mutualizing data like vulnerabilities between users.


| Example Template  | Generated document |
| ------------- | ------------- |
| ![t1](demos/t1.png)  | ![t2](demos/t2.png)


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

### Developing with docker-compose

```bash
docker-compose -f docker-compose-dev.yml up
```

Feel free to contribute :).
