// Data created by the end-to-end tests (fresh instance started by run.sh).
// Accounts are dedicated to these tests: never use real accounts here.

const USERS = {
  admin: { username: 'e2e-admin', password: 'E2e-Admin-2026', firstname: 'Ada', lastname: 'Admin', role: 'admin' },
  reviewer: { username: 'e2e-reviewer', password: 'E2e-Review-2026', firstname: 'Rita', lastname: 'Reviewer', role: 'admin', email: 'rita@e2e.test' },
  pentester: { username: 'e2e-pentester', password: 'E2e-Pentest-2026', firstname: 'Paul', lastname: 'Pentester', role: 'user', email: 'paul@e2e.test' },
  pentester2: { username: 'e2e-pentester2', password: 'E2e-Pentest2-2026', firstname: 'Lea', lastname: 'Second', role: 'user' },
  disabled: { username: 'e2e-disabled', password: 'E2e-Disabled-2026', firstname: 'Dan', lastname: 'Disabled', role: 'user' }
}

const LANGUAGES = [
  { language: 'English', locale: 'en' },
  { language: 'Francais', locale: 'fr' }
]

const TEMPLATE = { name: 'E2E Default', file: 'Default Template.docx' }

const SECTION = { name: 'E2E Synthesis', field: 'e2e_synthesis', icon: 'fa fa-book' }

const AUDIT_TYPE = { name: 'E2E Pentest' }

const VULN_TYPES = [
  { name: 'Web Application', locale: 'en' },
  { name: 'Application Web', locale: 'fr' }
]

const CATEGORY = { name: 'E2E Category' }

const CUSTOM_FIELDS = {
  // Audit general tab
  general: { label: 'E2E Contract Ref', fieldType: 'input', display: 'general' },
  // Findings and vulnerabilities (no category)
  finding: { label: 'E2E Impact Zone', fieldType: 'input', display: 'vulnerability' }
}

const COMPANY = { name: 'E2E Corp', shortName: 'E2EC' }
const CLIENT = { firstname: 'Carl', lastname: 'Client', email: 'carl@e2e-corp.test' }

const VULNS = {
  // Vulnerability in 2 languages created from the UI
  sqli: {
    en: { title: 'E2E SQL Injection', description: 'User input reaches SQL queries.', remediation: 'Use prepared statements.' },
    fr: { title: 'E2E Injection SQL', description: 'Les entrees utilisateur atteignent les requetes SQL.', remediation: 'Utiliser des requetes preparees.' }
  },
  xss: { en: { title: 'E2E Cross-Site Scripting', description: 'Reflected XSS.', remediation: 'Encode the output.' } },
  csrf: { en: { title: 'E2E Missing CSRF Token', description: 'Forms without CSRF token.', remediation: 'Add anti-CSRF tokens.' } }
}

const AUDIT = { name: 'E2E Main Audit' }

module.exports = { USERS, LANGUAGES, TEMPLATE, SECTION, AUDIT_TYPE, VULN_TYPES, CATEGORY, CUSTOM_FIELDS, COMPANY, CLIENT, VULNS, AUDIT }
