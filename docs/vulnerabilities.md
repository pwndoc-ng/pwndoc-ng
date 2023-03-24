# Vulnerabilities

> Pwndoc-ng can manage Vulnerabilities in order to simplify redaction of an Audit. They can be added when editing an Audit as a Finding.<br>
> Each vulnerability can have multiple languages. 

## Create

When creating a Vulnerability, a Category must be selected (or No Category)

A Vulnerability is defined by:

- Title
- Type
- Language
- Description
- Observation
- CVSS
- Remediation
- Remediation Complexity
- Remediation Priority
- References
- Category
- (Additional fields from Category)

!> Title must be unique since it's used for another functionality allowing users to request creation/modification of vulnerabilities when redacting an Audit.

There is also the possibility to search Audits containing the Vulnerability in its findings (search by Title) :<br> 
![Search in Audits](/_images/action_buttons.png)

## Import/Export

Vulnerabilities can be exported/imported in Data menu.

The export format is yaml.

**Example**
```
- cvssv3: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N'
  details:
    - references:
        - 'https://cwe.mitre.org/data/definitions/1275.html'
        - >-
          https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/06-Session_Management_Testing/02-Testing_for_Cookies_Attributes
        - >-
          https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html#samesite-cookie-attribute
        - >-
          https://cheatsheetseries.owasp.org/cheatsheets/Clickjacking_Defense_Cheat_Sheet.html#defending-with-samesite-cookies
      customFields: []
      locale: EN 
      title: 'Cookie without SameSite attribut [WSTG-SESS-02]'
      description: >-
        The cookie, which is set after the login, has no SameSite-attribute.
      observation: >-
		SameSite is an attribute that can be set in a cookie to instruct the web browser whether that cookie can be sent along with cross-site requests to prevent Cross-Site Request Forgery (CSRF) attacks. The attribute has three possible values:
Strict: The cookie is only sent in a first-party context, preventing cross-site requests from third-party websites to include it.
Lax: The cookie is allowed to be sent in GET cross-site requests initiated by top-level navigation of third-party websites. For example, if you follow a hypertext link from an external website, the request includes the cookie.
None: The cookie is explicitly set to be sent by the browser in any context.
The default behavior of web browsers can differ when handling cookies in a cross-site context, making the final decision to send the cookie in that context unpredictable. The SameSite attribute should be set in every cookie to enforce the expected result from developers.
      remediation: >-
		It is recommended to set the SameSite attribute to 'strict' in the cookie.
  category: Web Application 
  priority: 2
  remediationComplexity: 1
```


For import, the Serpico format is also accepted allowing easier transition or just to have a default set of vulnerabilities.

## Merge

It's possible to merge vulnerabilities for cases where 2 different vulnerabilities exist for 2 different languages. The goal is to avoid duplicates and better multilanguage management.

![Merge Vulns](/_images/merge_vulns.png)

When both languages have been selected, only Vulnerabilities that don't have the other column language will be displayed.  
In this example :
- In the left column only Vulnerabilities having English language AND no French language are displayed
- In the right column only Vulnerabilities having French language AND no English language are displayed

The language details from the Vulnerability of the right column will be moved to the Vulnerability of the left column. So this is *CVSS*, *references*, *etc* of the left column that will be kept.

## Validate

All users can request creation or modifications on a vulnerability when redacting findings in an Audit. Users with admin role can see and validate those modifications in Vulnerabilities menu.

![Validate](/_images/new_updates_vulns.png)

**New**

![New vuln](/_images/new_vuln.png)

Before approving, it's possible to make changes to the Vulnerability including adding Languages.

**Updates**

![Updates vuln](/_images/updates_vuln.png)

The left side is the current Vulnerability

The right side has multiple tabs, each representing change requests made by users. There is syntax highlighting to make it easier to spot differences.

The admin user must manually make changes in the left side with what he wants from the right side. When clicking the Update button the left side will be saved and all update requests from the right side will be deleted.
