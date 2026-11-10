import { Notify } from 'quasar';

import Breadcrumb from 'components/breadcrumb';

import VulnService from '@/services/vulnerability';
import AuditService, { errorMessage } from '@/services/audit';
import DataService from '@/services/data';
import Utils from '@/services/utils';

import { $t } from '@/boot/i18n'

export default {
    props: {
        frontEndAuditState: Number,
        parentState: String,
        parentApprovals: Array
    },
    data: () => {
        return {
            finding: {
                title: '',
                vulnType: '',
                description: '',
                observation: '',
                references: [],
                status: 1, // 1 = In progress, 0 = Completed (adapt according to your values)
                customFields: [],
                poc: '',
                scope: '',
                cvssv3: '',
                remediationComplexity: null,
                priority: null,
                remediation: ''
              },
            findingTitle: '',
            pagesNumber:10,
            // List of vulnerabilities from knowledge base
            vulnerabilities: [],
            
            filteredRowsCount: 0,

            // Loading state
            loading: false,
            // Number of the last request of the vulnerabilities
            lastVulnerabilitiesRequest: 0,
            // Creations pending (a double click creates the finding once): manual creation, vulnerabilities added
            creatingFinding: false,
            addingVulns: [],
            // Headers for vulnerabilities datatable
            dtVulnHeaders: [
                {name: 'title', label: $t('title'), field: row => row.detail.title, align: 'left', sortable: true},
                {name: 'category', label: $t('category'), field: 'category', align: 'left', sortable: true},
                {name: 'vulnType', label: $t('vulnType'), field: row => row.detail.vulnType, align: 'left', sortable: true},
                {name: 'action', label: '', field: 'action', align: 'left', sortable: false},
            ],
            // Pagination for vulnerabilities datatable
            vulnPagination: {
                page: 1,
                rowsPerPage: 25,
                sortBy: 'title',
                pagesNumber: 1
            },
            pagination: {
                page: 1,
                rowsPerPage: 25,
                pagesNumber: 1  // Add this line
            },
            rowsPerPageOptions: [
                {label:'25', value:25},
                {label:'50', value:50},
                {label:'100', value:100},
                {label:'All', value:0}
            ],
     
            // Search filter
            search: {title: '', vulnType: '', category: ''},
            
            // Vulnerabilities languages
            languages: [],
            dtLanguage: "",
            currentExpand: -1,

            // Vulnerability categories
            vulnCategories: [],
            audit: {
                creator: {},
                name: "",
                auditType: "",
                client: {},
                company: {},
                collaborators: [],
                reviewers: [],
                date: "",
                date_start: "",
                date_end: "",
                scope: [],
                language: "",
                template: "",
                customFields: [],
                approvals: []
            },
            htmlEncode: Utils.htmlEncode,
            AUDIT_VIEW_STATE: Utils.AUDIT_VIEW_STATE
        }
    },

    components: {
        Breadcrumb
    },

    mounted: function() {
        this.auditId = this.$route.params.auditId;
        this.getLanguages();
        this.dtLanguage = this.audit.language;
        this.getAudit();
        this.getVulnerabilityCategories()

        this.$socket.emit('menu', {menu: 'addFindings', room: this.auditId});
    },

    computed: {
        searchObject() {
            return {
              title: this.search.title,
              category: this.search.category,
              vulnType: this.search.vulnType
            };
          },
        // Options of the filters: values shown in the table ("No Category", "Undefined" type when empty)
        vulnCategoriesOptions: function() {
            return this.$_.uniq(this.vulnerabilities.map(vuln => this.categoryLabel(vuln)))
        },

        vulnTypeOptions: function() {
            return this.$_.uniq(this.vulnerabilities.map(vuln => this.vulnTypeLabel(vuln)))
        }
    },

    methods: {
        // Get available languages
        getLanguages: function() {
            DataService.getLanguages()
            .then((data) => {
                this.languages = data.data.datas;
            })
            .catch((err) => {
                console.log(err)
            })
        },

        // Get vulnerabilities by language. Only the answer of the last language chosen is shown (languages changed
        // quickly, answers in any order)
        getVulnerabilities: function() {
            var request = ++this.lastVulnerabilitiesRequest
            this.loading = true
            VulnService.getVulnByLanguage(this.dtLanguage)
            .then((data) => {
                if (request !== this.lastVulnerabilitiesRequest) return
                this.vulnerabilities = data.data.datas;
                this.loading = false
            })
            .catch((err) => {
                if (request !== this.lastVulnerabilitiesRequest) return
                this.loading = false
                Notify.create({
                    message: errorMessage(err),
                    color: 'negative',
                    textColor:'white',
                    position: 'top-right'
                })
            })
        },
        getAudit: function() {
            AuditService.getAudit(this.auditId)
                .then((data) => {
                    this.audit = data.data.datas;
                    this.dtLanguage=this.audit.language;
                    this.getVulnerabilities();
                })
                .catch((err) => {
                    console.log(err);
                });
        },
        // Get available vulnerability categories
        getVulnerabilityCategories: function() {
            DataService.getVulnerabilityCategories()
            .then((data) => {
                this.vulnCategories = data.data.datas;
            })
            .catch((err) => {
                console.log(err)
            })
        },

        getDtTitle: function(row) {
            var index = row.details.findIndex(obj => obj.locale === this.dtLanguage.locale);
            if (index < 0)
                return $t('err.notDefinedLanguage');
            else
                return row.details[index].title;         
        },

        categoryLabel: function(vuln) {
            return vuln.category || $t('noCategory')
        },

        vulnTypeLabel: function(vuln) {
            return (vuln.detail && vuln.detail.vulnType) || $t('undefined')
        },

        customFilter(rows, terms, cols, getCellValue) {
            var result = rows && rows.filter(row => {
              if (!row.detail || !row.detail.title) return false;

              // Values shown in the table: the "No Category" and "Undefined" options of the filters match the empty ones
              const title = row.detail.title.toLowerCase();
              const category = this.categoryLabel(row).toLowerCase();
              const vulnType = this.vulnTypeLabel(row).toLowerCase();
          
              const searchTitle = terms.title ? terms.title.toLowerCase() : '';
              const searchCategory = terms.category ? terms.category.toLowerCase() : '';
              const searchVulnType = terms.vulnType ? terms.vulnType.toLowerCase() : '';
          
              return title.includes(searchTitle)
                && category.includes(searchCategory)
                && vulnType.includes(searchVulnType);
            });
            this.filteredRowsCount = result.length;
            return result;
          },

          
          


        // Custom fields loaded by the audit edit page (index.vue): the parent of this page is its RouterView
        auditCustomFields: function() {
            for (var parent = this.$parent; parent; parent = parent.$parent) {
                if (parent.$data && Array.isArray(parent.$data.customFields))
                    return parent.$data.customFields
            }
            return []
        },

        addFindingFromVuln: function(vuln, event) {
            var finding = null;
            // Vulnerability being added, or second click of a double click (MouseEvent.detail 2, the first creation may
            // already be answered): a double click adds it once
            if ((vuln && this.addingVulns.includes(vuln._id)) || (event && event.detail > 1))
                return
            if (vuln) {
                finding = {
                    title: vuln.detail.title,
                    vulnType: vuln.detail.vulnType,
                    description: vuln.detail.description,
                    observation: vuln.detail.observation,
                    remediation: vuln.detail.remediation,
                    remediationComplexity: vuln.remediationComplexity,
                    priority: vuln.priority,
                    references: vuln.detail.references,
                    cvssv3: vuln.cvssv3,
                    category: vuln.category,
                    customFields: vuln.detail.customFields
                };
            }

            if (finding) {
                this.addingVulns.push(vuln._id)
                AuditService.createFinding(this.auditId, finding)
                .then(() => {
                    this.findingTitle = "";
                    Notify.create({
                        message: $t('msg.findingCreateOk'),
                        color: 'positive',
                        textColor:'white',
                        position: 'top-right'
                    })
                })
                .catch((err) => {
                    Notify.create({
                        message: errorMessage(err),
                        color: 'negative',
                        textColor:'white',
                        position: 'top-right'
                    })
                })
                .finally(() => {
                    this.addingVulns = this.addingVulns.filter(id => id !== vuln._id)
                })
            }
        },

        addFinding: function(category) {
            if (this.creatingFinding)
                return
            // Custom fields of the findings of the category (the fields of the vulnerabilities included)
            var customFields = this.auditCustomFields()
            var finding = null;
            if (category && this.findingTitle) {
                finding = {
                    title: this.findingTitle,
                    vulnType: "",
                    description: "",
                    observation: "",
                    remediation: "",
                    remediationComplexity: "",
                    priority: "",
                    references: [],
                    cvssv3: "",
                    category: category.name,
                    customFields: Utils.filterCustomFields('finding', category.name, customFields, [], this.audit.language)
                };
            }
            else if (this.findingTitle){
                finding = {
                    title: this.findingTitle,
                    vulnType: "",
                    description: "",
                    observation: "",
                    remediation: "",
                    remediationComplexity: "",
                    priority: "",
                    references: [],
                    cvssv3: "",
                    customFields: Utils.filterCustomFields('finding', '', customFields, [], this.audit.language)
                };
            }

            if (finding) {
                this.creatingFinding = true
                AuditService.createFinding(this.auditId, finding)
                .then(() => {
                    this.findingTitle = "";
                    Notify.create({
                        message: $t('msg.findingCreateOk'),
                        color: 'positive',
                        textColor:'white',
                        position: 'top-right'
                    })

                })
                .catch((err) => {
                    Notify.create({
                        message: errorMessage(err),
                        color: 'negative',
                        textColor:'white',
                        position: 'top-right'
                    })
                })
                .finally(() => {
                    this.creatingFinding = false
                })
            }
        }
    }
}