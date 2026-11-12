import { Dialog, Notify } from 'quasar';

import BasicEditor from 'components/editor';
import Breadcrumb from 'components/breadcrumb'
import CvssCalculator from 'components/cvsscalculator'
import TextareaArray from 'components/textarea-array'
import CustomFields from 'components/custom-fields'
import ProposalsList from 'components/proposals-list'

import VulnerabilityService from '@/services/vulnerability'
import { SEVERITY_ICONS, issueMessage, issuePlace, issueCounts } from '@/services/qa'
import { errorMessage } from '@/services/audit'
import DataService from '@/services/data'
import UserService from '@/services/user'
import Utils from '@/services/utils'

import { $t } from 'boot/i18n'

export default {
    data: () => {
        return {
            UserService: UserService,
            // Vulnerabilities list
            vulnerabilities: [],
            // Quality checks of the vulnerability database (dialog)
            qa: {show: false, loading: false, loaded: false, error: '', issues: []},
            currentDetailsIndex:0,
            // Loading state
            loading: true,
            // Number of the last loading of the list: the answers of the older ones are ignored
            vulnerabilitiesRequest: 0,
            // Requests in progress (double click protection)
            creating: false,
            merging: false,
            rows:[],
            // Datatable headers
            dtHeaders: [
                { name: 'title', label: $t('title'), field: 'title', align: 'left', sortable: true },
                { name: 'category', label: $t('category'), field: 'category', align: 'left', sortable: true },
                { name: 'type', label: $t('type'), field: 'type', align: 'left', sortable: true },
                { name: 'updatedAt', label: $t('lastUpdated'), field: 'updatedAt', align: 'left', sortable: true },
                { name: 'action', label: '', field: 'action', align: 'left', sortable: false },
            ],
            // Datatable pagination
            pagination: {
                page: 1,
                rowsPerPage: 25,
                sortBy: 'title'
            },
            rowsPerPageOptions: [
                {label:'25', value:25},
                {label:'50', value:50},
                {label:'100', value:100},
                {label:'All', value:0}
            ],
            filteredRowsCount: 0,
            // Vulnerabilities languages
            languages: [],
            locale: '',
            // Search filter
            search: {title: '', type: '', category: '', updatedAt: '', valid: 0, new: 1, updates: 2},
            // Errors messages
            errors: {title: ''},
            // Selected or New Vulnerability
            currentVulnerability: {
                cvssv3: '',
                priority: '',
                remediationComplexity: '',
                details: [] 
            },
            currentLanguage: "",
            displayFilters: {valid: true, new: true, updates: true},
            dtLanguage: "",
            currentDetailsIndex: 0,
            vulnerabilityId: '',
            // Proposals tab
            mainTab: 'vulnerabilities',
            proposalsFilter: null, // {id, title}: proposals of one vulnerability
            pendingProposals: 0,
            vulnTypes: [],
            // Merge languages
            mergeLanguageLeft: '',
            mergeLanguageRight: '',
            mergeVulnLeft: '',
            mergeVulnRight: '',
            // Vulnerability categories
            vulnCategories: [],
            currentCategory: null,
            // Custom Fields
            customFields: [],
            // Until then, the custom fields of the vulnerability opened are kept as they are (not filtered, not shown)
            customFieldsLoaded: false,
            // Number of the last request of the count of the proposals (answers in any order)
            proposalsRequest: 0
        }
    },

    components: {
        BasicEditor,
        Breadcrumb,
        CvssCalculator,
        TextareaArray,
        CustomFields,
        ProposalsList
    },

    mounted: function() {
        this.refreshPendingProposals();
        this.getLanguages()
        this.getVulnTypes()
        this.getVulnerabilities()
        this.getVulnerabilityCategories()
        this.getCustomFields()
    },

    watch: {
        currentLanguage: function(val, oldVal) {
            this.setCurrentDetails();
        }
    },

    computed: {
        // Errors, warnings and information of the quality checks of the vulnerability database
        qaSummary: function() {
            return $t('qa.summaryInfo', issueCounts(this.qa.issues))
        },
        lenCurrentTitle: function() {
            return this.currentVulnerability.details[this.currentDetailsIndex].title.length
        },
        vulnTypesLang: function() {
            return this.vulnTypes.filter(type => type.locale === this.currentLanguage);
        },

        // Vulnerabilities of the current tab: archived ones only in the archives tab
        tabVulnerabilities() {
            const archives = this.mainTab === 'archives';
            return this.vulnerabilities.filter(vuln => !!vuln.archived === archives);
        },

        archivedCount() {
            return this.vulnerabilities.filter(vuln => vuln.archived).length;
        },

        computedVulnerabilities() {
            if (!this.dtLanguage) return [];
            let filtered = this.tabVulnerabilities.filter(vuln =>
                vuln.details.some(detail => detail.locale === this.dtLanguage && detail.title)
            );
            return filtered;
        },
        filteredVulnerabilitiesLeft() {
            if (!this.mergeLanguageLeft) return [];
            return this.vulnerabilities.filter(
              (vuln) => vuln && vuln.details && this.getVulnTitleLocale(vuln, this.mergeLanguageLeft) !== 'undefined'
            );
          },
          filteredVulnerabilitiesRight() {
            if (!this.mergeLanguageRight) return [];
            return this.vulnerabilities.filter(
              (vuln) => vuln && vuln.details && this.getVulnTitleLocale(vuln, this.mergeLanguageRight) !== 'undefined'
            );
          },
        vulnCategoriesOptions: function() {
            var result = this.vulnCategories.map(cat => {return cat.name})
            result.unshift('No Category')
            return result
        },

        vulnTypeOptions: function() {
            var result = this.vulnTypes.filter(type => type.locale === this.dtLanguage).map(type => {return type.name})
            result.unshift('Undefined')
            return result
        }
    },

    methods: {
        // Get available languages
        getLanguages: function() {
            DataService.getLanguages()
            .then((data) => {
                this.languages = data.data.datas;
                if (this.languages.length > 0) {
                    this.dtLanguage = this.languages[0].locale;
                    this.cleanCurrentVulnerability();
                }
            })
            .catch((err) => {
                console.log(err)
            })
        },

         // Get available custom fields
         getCustomFields: function() {
            DataService.getCustomFields()
            .then((data) => {
                this.customFields = this.$_.cloneDeep(data.data.datas)
                this.customFieldsLoaded = true
                // Vulnerability being created or edited before this answer: add its custom fields
                if (this.currentVulnerability.details.length > 0)
                    this.setCurrentDetails()
            })
            .catch((err) => {
                console.log(err)
            })
        },

        // Get Vulnerabilities types
        getVulnTypes: function() {
            DataService.getVulnerabilityTypes()
            .then((data) => {
                this.vulnTypes = data.data.datas;
            })
            .catch((err) => {
                console.log(err)
            })
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

        getVulnerabilities: function() {
            this.loading = true
            // Refreshed after each action: a slow older answer would bring back a deleted or archived vulnerability
            var request = ++this.vulnerabilitiesRequest
            VulnerabilityService.getVulnerabilities()
            .then((data) => {
                if (request !== this.vulnerabilitiesRequest)
                    return
                this.vulnerabilities = data.data.datas
                this.loading = false
            })
            .catch((err) => {
                console.log(err)
                Notify.create({
                    message: err.response.data.datas,
                    color: 'negative',
                    textColor: 'white',
                    position: 'top-right'
                })
            })
        },

        createVulnerability: function() {
            // Double click or Enter pressed twice: created once
            if (this.creating)
                return;
            this.cleanErrors();
            var index = this.currentVulnerability.details.findIndex(obj => obj.title !== '');
            if (index < 0)
                this.errors.title = $t('err.titleRequired');

            if (this.errors.title)
                return;

            this.creating = true;
            var created = this.currentVulnerability;
            VulnerabilityService.createVulnerabilities([this.currentVulnerability])
            .finally(() => {
                this.creating = false;
            })
            .then(() => {
                this.getVulnerabilities();
                // Not when the page was left, nor when the dialog was opened again meanwhile (new object)
                if (this.$refs.createModal && this.currentVulnerability === created)
                    this.$refs.createModal.hide();
                Notify.create({
                    message: $t('msg.vulnerabilityCreatedOk'),
                    color: 'positive',
                    textColor:'white',
                    position: 'top-right'
                })
            })
            .catch((err) => {
                Notify.create({
                    message: err.response.data.datas,
                    color: 'negative',
                    textColor: 'white',
                    position: 'top-right'
                })
            })
        },

        updateVulnerability: function() {
            this.cleanErrors();

            var index = this.currentVulnerability.details.findIndex(obj => obj.title !== '');
            if (index < 0)
                this.errors.title = $t('err.titleRequired');
            
            if (this.errors.title)
                return;

            // Each opening edits a new copy: the answer closes the dialog only if it still shows the vulnerability sent
            // (and if the page was not left during the request)
            var updated = this.currentVulnerability;
            VulnerabilityService.updateVulnerability(this.vulnerabilityId, this.currentVulnerability)
            .then(() => {
                this.getVulnerabilities();
                if (this.currentVulnerability === updated && this.$refs.editModal)
                    this.$refs.editModal.hide();
                this.refreshPendingProposals();
                Notify.create({
                    message: $t('msg.vulnerabilityUpdatedOk'),
                    color: 'positive',
                    textColor:'white',
                    position: 'top-right'
                })
            })
            .catch((err) => {
                Notify.create({
                    message: err.response.data.datas,
                    color: 'negative',
                    textColor: 'white',
                    position: 'top-right'
                })
            })
        },

        deleteVulnerability: function(vulnerabilityId) {
            VulnerabilityService.deleteVulnerability(vulnerabilityId)
            .then(() => {
                this.getVulnerabilities();
                Notify.create({
                    message: $t('msg.vulnerabilityDeletedOk'),
                    color: 'positive',
                    textColor:'white',
                    position: 'top-right'
                })
            })
            .catch((err) => {
                Notify.create({
                    message: err.response.data.datas,
                    color: 'negative',
                    textColor: 'white',
                    position: 'top-right'
                })
            })
        },

        // Archive (hidden when adding findings) or restore a vulnerability
        setArchived: function(row, archived) {
            VulnerabilityService.archiveVulnerability(row._id, archived)
            .then(() => {
                this.getVulnerabilities();
                Notify.create({
                    message: archived ? $t('archives.archivedOk', [this.getDtTitle(row)]) : $t('archives.restoredOk', [this.getDtTitle(row)]),
                    color: 'positive',
                    textColor: 'white',
                    position: 'top-right'
                })
            })
            .catch((err) => {
                Notify.create({
                    message: err.response.data.datas,
                    color: 'negative',
                    textColor: 'white',
                    position: 'top-right'
                })
            })
        },

        confirmDeleteVulnerability: function(row) {
            Dialog.create({
                title: $t('msg.confirmSuppression'),
                message: $t('msg.vulnerabilityWillBeDeleted'),
                ok: {label: $t('btn.confirm'), color: 'negative'},
                cancel: {label: $t('btn.cancel'), color: 'white'}
            })
            .onOk(() => this.deleteVulnerability(row._id))
        },

        /* Quality checks of the vulnerability database */

        openQa: function() {
            this.qa.show = true
            this.loadQa()
        },

        loadQa: function() {
            this.qa.loading = true
            return VulnerabilityService.getVulnerabilitiesQa()
            .then((data) => {
                this.qa.issues = data.data.datas.issues
                this.qa.error = ''
                this.qa.loaded = true
            })
            .catch((err) => {
                this.qa.error = errorMessage(err)
            })
            .finally(() => {
                this.qa.loading = false
            })
        },

        // Vulnerability of an issue opened (edition, or proposals of a vulnerability updated)
        openQaIssue: function(issue) {
            var row = this.vulnerabilities.find((vulnerability) => vulnerability._id === issue.location.id)
            if (!row)
                return
            this.qa.show = false
            if (row.status === 2)
                this.openVulnerabilityProposals(row)
            else {
                this.clone(row)
                this.$refs.editModal.show()
            }
        },

        qaIcon: (issue) => SEVERITY_ICONS[issue.severity] || SEVERITY_ICONS.info,
        qaMessage: (issue) => issueMessage(issue),
        qaPlace: (issue) => issuePlace(issue),

        clone: function(row) {
            this.cleanCurrentVulnerability();
            this.currentVulnerability = this.$_.cloneDeep(row)
            this.setCurrentDetails();
            
            this.vulnerabilityId = row._id;
        },

        editChangeCategory: function(category) {
            Dialog.create({
                title: $t('msg.confirmCategoryChange'),
                message: $t('msg.categoryChangingNotice'),
                ok: {label: $t('btn.confirm'), color: 'negative'},
                cancel: {label: $t('btn.cancel'), color: 'white'}
            })
            .onOk(() => {
                if (category){
                    this.currentVulnerability.category = category.name
                }
                else {
                    this.currentVulnerability.category = null
                }
                this.setCurrentDetails()
            })
        },

        cleanErrors: function() {
            this.errors.title = '';
        },  

        // New object for each opening: the answer of a request closes only the dialog of the vulnerability it was sent
        // for (and nothing of a vulnerability opened before, such as its _id, is kept)
        cleanCurrentVulnerability: function() {
            this.cleanErrors();
            this.currentVulnerability = {
                cvssv3: '',
                priority: '',
                remediationComplexity: '',
                details: [],
                category: (this.currentCategory && this.currentCategory.name) ? this.currentCategory.name : null
            };
            this.currentLanguage = this.dtLanguage;
            this.setCurrentDetails();
        },

        // Create detail if locale doesn't exist else set the currentDetailIndex
        setCurrentDetails: function(value) {
            var index = this.currentVulnerability.details.findIndex(obj => obj.locale === this.currentLanguage);
            if (index < 0) {
                var details = {
                    locale: this.currentLanguage,
                    title: '',
                    vulnType: '',
                    updatedAt: '',
                    description: '',
                    observation: '',
                    remediation: '',
                    references: [],
                    customFields: []
                }
         
                details.customFields = this.$_.cloneDeep(Utils.filterCustomFields('vulnerability', this.currentVulnerability.category, this.customFields, [], this.currentLanguage))
                console.log( details.customFields,'vulnerability', this.currentVulnerability.category, this.customFields, [], this.currentLanguage)
                this.currentVulnerability.details.push(details,)
                index = this.currentVulnerability.details.length - 1;
            }
            // Filtered with the custom fields not loaded yet, the values of the vulnerability would be dropped
            else if (this.customFieldsLoaded) {
                this.currentVulnerability.details[index].customFields = this.$_.cloneDeep(Utils.filterCustomFields('vulnerability', this.currentVulnerability.category, this.customFields, this.currentVulnerability.details[index].customFields, this.currentLanguage))
            }
            this.currentDetailsIndex = index;
     
     
        },

        isTextInCustomFields: function(field) {

            if (this.currentVulnerability.details[this.currentDetailsIndex].customFields) {
                return typeof this.currentVulnerability.details[this.currentDetailsIndex].customFields.find(f => {
                    return f.customField === field.customField._id && f.text === field.text
                }) === 'undefined'
            }
            return false
        },

        getTextDiffInCustomFields: function(field) {
            var result = ''
            if (this.currentVulnerability.details[this.currentDetailsIndex].customFields) {
                this.currentVulnerability.details[this.currentDetailsIndex].customFields.find(f => {
                    if (f.customField === field.customField._id)
                        result = f.text
                })
            }
            return result
        },

        getDtTitle: function(row) {
            var index = row.details.findIndex(obj => obj.locale === this.dtLanguage);
            if (index < 0 || !row.details[index].title)
                return $t('err.notDefinedLanguage');
            else
                return row.details[index].title;         
        },

        getDtType: function(row) {
            var index = row.details.findIndex(obj => obj.locale === this.dtLanguage);
            if (index < 0 || !row.details[index].vulnType)
                return "Undefined";
            else
                return row.details[index].vulnType;         
        },

        getDtUpdatedAt: function(row) {
            if (!row.updatedAt) {
                return "Undefined";
            }

            const formattedDate = new Date(row.updatedAt).toLocaleDateString('es-CL');
            return formattedDate;
        },
        
        customSort: function(rows, sortBy, descending) {
            if (rows) {
                var data = [...rows];
        
                if (sortBy === 'type') {
                    (descending)
                        ? data.sort((a, b) => (this.getDtType(b) || '').localeCompare(this.getDtType(a) || ''))
                        : data.sort((a, b) => (this.getDtType(a) || '').localeCompare(this.getDtType(b) || ''));
                } else if (sortBy === 'title') {
                    (descending)
                        ? data.sort((a, b) => (this.getDtTitle(b) || '').localeCompare(this.getDtTitle(a) || ''))
                        : data.sort((a, b) => (this.getDtTitle(a) || '').localeCompare(this.getDtTitle(b) || ''));
                } else if (sortBy === 'updatedAt') {
                    // Chronological order (dates, not the displayed dd-mm-yyyy strings), vulnerabilities without date first
                    const time = (row) => (row.updatedAt ? new Date(row.updatedAt).getTime() : 0) || 0;
                    (descending)
                        ? data.sort((a, b) => time(b) - time(a))
                        : data.sort((a, b) => time(a) - time(b));
                } else if (sortBy === 'category') {
                    (descending)
                        ? data.sort((a, b) => (b.category || $t('noCategory')).localeCompare(a.category || $t('noCategory')))
                        : data.sort((a, b) => (a.category || $t('noCategory')).localeCompare(b.category || $t('noCategory')));
                }
        
                return data;
            }
        },

        customFilter: function(rows, terms, cols, getCellValue) {
            var result = rows && rows.filter(row => {
                var title = this.getDtTitle(row).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
                var category = (row.category || $t('noCategory')).toLowerCase()
                var type = this.getDtType(row).toLowerCase()
                var updatedAt = this.getDtUpdatedAt(row)
                
                var termTitle = (terms.title || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
                var termCategory = (terms.category || "").toLowerCase()
                var termVulnType = (terms.type || "").toLowerCase()
                var termUpdatedAt = (terms.updatedAt || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")

                return title.indexOf(termTitle) > -1 && 
                    type.indexOf(termVulnType || "") > -1 &&
                    category.indexOf(termCategory || "") > -1 &&
                    updatedAt.indexOf(termUpdatedAt) > -1 &&
                    (row.status === terms.valid || row.status === terms.new || row.status === terms.updates);
            })
            this.filteredRowsCount = result.length;
            return result;
        },

        goToAudits: function(row) {
            var title = this.getDtTitle(row);
            this.$router.push({name: 'audits_by_find', params: {finding: title}});
        },

        getVulnTitleLocale: function(vuln, locale) {
            if (!vuln || !Array.isArray(vuln.details)) {
                return "undefined";
            }
            for (var i = 0; i < vuln.details.length; i++) {
                if (vuln.details[i].locale === locale && vuln.details[i].title) {
                    return vuln.details[i].title;
                }
            }
            return "undefined";
        },
        

        mergeVulnerabilities: function() {
            // Double click: the second merge would fail (merged vulnerability deleted by the first one)
            if (this.merging)
                return;
            this.merging = true;
            VulnerabilityService.mergeVulnerability(this.mergeVulnLeft, this.mergeVulnRight, this.mergeLanguageRight)
            .finally(() => {
                this.merging = false;
            })
            .then(() => {
                this.getVulnerabilities();
                Notify.create({
                    message: $t('msg.vulnerabilityMergeOk'),
                    color: 'positive',
                    textColor:'white',
                    position: 'top-right'
                })
            })
            .catch((err) => {
                Notify.create({
                    message: err.response.data.datas,
                    color: 'negative',
                    textColor: 'white',
                    position: 'top-right'
                })
            })
        },

        dblClick: function(row) {
            if (this.UserService.isAllowed('vulnerabilities:update') && row.status === 2)
                return this.openVulnerabilityProposals(row)
            this.clone(row)
            this.$refs.editModal.show()
        },

        // Pending update proposals of a vulnerability (reviewed in the proposals tab)
        openVulnerabilityProposals: function(row) {
            this.proposalsFilter = {id: row._id, title: this.getDtTitle(row)}
            this.mainTab = 'proposals'
        },

        refreshPendingProposals: function() {
            var request = ++this.proposalsRequest
            VulnerabilityService.getProposalsCount()
            .then((data) => {
                // An older answer must not replace the count of the last request
                if (request === this.proposalsRequest)
                    this.pendingProposals = data.data.datas.pending
            })
            .catch((err) => console.log(err))
        }
    }
}
