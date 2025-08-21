import { Notify } from 'quasar';

import Breadcrumb from 'components/breadcrumb';

import VulnService from '@/services/vulnerability';
import AuditService from '@/services/audit';
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
          vulnCategoriesOptions() {
            return this.$_.uniq(this.$_.map(this.vulnerabilities, vuln => {
              return vuln.category || $t('noCategory');
            }));
          },
          vulnTypeOptions() {
            return this.$_.uniq(
              this.vulnerabilities.map(vuln => vuln.detail?.vulnType || $t('undefined'))
            );
          },
          filteredVulnerabilities() {
            if (!this.dtLanguage) return this.vulnerabilities; // If no language selected, display all
            return this.vulnerabilities.filter(vuln => vuln.locale === this.dtLanguage);
          },
        vulnCategoriesOptions: function() {
            return this.$_.uniq(this.$_.map(this.vulnerabilities, vuln => {
                return vuln.category || $t('noCategory')
            }))
        },

        vulnTypeOptions: function() {
            return this.$_.uniq(
              this.vulnerabilities.map(vuln => vuln.detail?.vulnType || $t('undefined'))
            );
          },
          filteredVulnerabilities() {
            if (!this.dtLanguage) return this.vulnerabilities; // If no language selected, display all
            return this.vulnerabilities.filter(vuln => vuln.locale === this.dtLanguage);
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

        // Get vulnerabilities by language
        getVulnerabilities: function() {
            this.loading = true
            VulnService.getVulnByLanguage(this.dtLanguage)
            .then((data) => {
                this.vulnerabilities = data.data.datas;
                this.loading = false
            })
            .catch((err) => {
                console.log(err)
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

        customFilter(rows, terms, cols, getCellValue) {
            console.log('ok')
            var result = rows && rows.filter(row => {
              if (!row.detail || !row.detail.title) return false;
          
              const title = row.detail.title.toLowerCase();
              const category = row.category ? row.category.toLowerCase() : '';
              const vulnType = row.detail.vulnType ? row.detail.vulnType.toLowerCase() : '';
          
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

          
          


        addFindingFromVuln: function(vuln) {
            var finding = null;
            if (vuln) {
                console.log(vuln.detail.customFields)
                console.log(Utils.filterCustomFields('vulnerability', vuln.category, this.$parent.customFields, [], this.audit.language))
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
                        message: err.response.data.datas,
                        color: 'negative',
                        textColor:'white',
                        position: 'top-right'
                    })
                })
            }
        },

        addFinding: function(category) {
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
                    customFields: [...Utils.filterCustomFields('finding', category.name, this.$parent.customFields, [], this.audit.language),...Utils.filterCustomFields('vulnerability', category.name, this.$parent.customFields, [], this.audit.language)]
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
                    customFields: [...Utils.filterCustomFields('finding', '', this.$parent.customFields, [], this.audit.language),...Utils.filterCustomFields('vulnerability', '', this.$parent.customFields, [], this.audit.language)]
                };
            }

            if (finding) {
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
                        message: err.response.data.datas,
                        color: 'negative',
                        textColor:'white',
                        position: 'top-right'
                    })
                })
            }
        }
    }
}