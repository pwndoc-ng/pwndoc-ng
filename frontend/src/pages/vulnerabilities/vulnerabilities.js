import { Dialog, Notify } from 'quasar';

import BasicEditor from 'components/editor';
import Breadcrumb from 'components/breadcrumb'
import CvssCalculator from 'components/cvsscalculator'
import TextareaArray from 'components/textarea-array'
import CustomFields from 'components/custom-fields'

import VulnerabilityService from '@/services/vulnerability'
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
            // Loading state
            loading: true,
            // Datatable headers
            dtHeaders: [
                {name: 'title', label: $t('title'), field: 'title', align: 'left', sortable: true},
                {name: 'category', label: $t('category'), field: 'category', align: 'left', sortable: true},
                {name: 'type', label: $t('type'), field: 'type', align: 'left', sortable: true},
                {name: 'action', label: '', field: 'action', align: 'left', sortable: false},
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
            search: {title: '', type: '', category: '', valid: 0, new: 1, updates: 2},
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
            vulnUpdates: [],
            currentUpdate: '',
            currentUpdateLocale: '',
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
            customFields: []
        }
    },

    components: {
        BasicEditor,
        Breadcrumb,
        CvssCalculator,
        TextareaArray,
        CustomFields
    },

    mounted: function() {
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
        vulnTypesLang: function() {
            return this.vulnTypes.filter(type => type.locale === this.currentLanguage);
        },

        computedVulnerabilities: function() {
            var result = [];
            this.vulnerabilities.forEach(vuln => {
                for (var i=0; i<vuln.details.length; i++) {
                    if (vuln.details[i].locale === this.dtLanguage && vuln.details[i].title) {
                        result.push(vuln);
                    }
                }
            })
            return result;
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
                this.customFields = data.data.datas
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
            VulnerabilityService.getVulnerabilities()
            .then((data) => {
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
            this.cleanErrors();
            var index = this.currentVulnerability.details.findIndex(obj => obj.title !== '');
            if (index < 0)
                this.errors.title = $t('err.titleRequired');
            
            if (this.errors.title)
                return;

            VulnerabilityService.createVulnerabilities([this.currentVulnerability])
            .then(() => {
                this.getVulnerabilities();
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

        updateVulnerabilityFromAlternativeVersionPanel: function(update_version) {
            // update_version contains all template info, including the parts that are not locale specific
            // I'm copying all of it, the pwndoc doesn't seem to care.
            // Also - this kind of copy doesn't overwrite it inside the window, but as I'm closing the window right away it doesn't matter.
            this.currentVulnerability.details[this.currentDetailsIndex] = update_version; 
            this.updateVulnerability();
        },
        
        updateVulnerability: function() {
            this.cleanErrors();
            var index = this.currentVulnerability.details.findIndex(obj => obj.title !== '');
            if (index < 0)
                this.errors.title = $t('err.titleRequired');
            
            if (this.errors.title)
                return;

            VulnerabilityService.updateVulnerability(this.vulnerabilityId, this.currentVulnerability)
            .then(() => {
                this.getVulnerabilities();
                this.$refs.editModal.hide();
                this.$refs.updatesModal.hide();
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

        confirmDeleteVulnerability: function(row) {
            Dialog.create({
                title: $t('msg.confirmSuppression'),
                message: $t('msg.vulnerabilityWillBeDeleted'),
                ok: {label: $t('btn.confirm'), color: 'negative'},
                cancel: {label: $t('btn.cancel'), color: 'white'}
            })
            .onOk(() => this.deleteVulnerability(row._id))
        },

        getVulnUpdates: function(vulnId) {
            VulnerabilityService.getVulnUpdates(vulnId)
            .then((data) => {
                this.vulnUpdates = data.data.datas;
                this.vulnUpdates.forEach(vuln => {
                    vuln.customFields = Utils.filterCustomFields('vulnerability', this.currentVulnerability.category, this.customFields, vuln.customFields, vuln.locale)
                })
                if (this.vulnUpdates.length > 0) {
                    this.currentUpdate = this.vulnUpdates[0]._id || null;
                    this.currentLanguage = this.vulnUpdates[0].locale || null;
                }
            })
            .catch((err) => {
                console.log(err)
            })
        },

        clone: function(row) {
            this.cleanCurrentVulnerability();
            
            this.currentVulnerability = this.$_.cloneDeep(row)
            this.setCurrentDetails();
            
            this.vulnerabilityId = row._id;
            if (this.UserService.isAllowed('vulnerabilities:update'))
                this.getVulnUpdates(this.vulnerabilityId);
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

        cleanCurrentVulnerability: function() {
            this.cleanErrors();
            this.currentVulnerability.cvssv3 = '';
            this.currentVulnerability.priority = '';
            this.currentVulnerability.remediationComplexity = '';
            this.currentVulnerability.details = [];
            this.currentLanguage = this.dtLanguage;
            if (this.currentCategory && this.currentCategory.name) 
                this.currentVulnerability.category = this.currentCategory.name
            else
                this.currentVulnerability.category = null

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
                    description: '',
                    observation: '',
                    remediation: '',
                    references: [],
                    customFields: []
                }
                details.customFields = Utils.filterCustomFields('vulnerability', this.currentVulnerability.category, this.customFields, [], this.currentLanguage)
                
                this.currentVulnerability.details.push(details)
                index = this.currentVulnerability.details.length - 1;
            }
            else {
                this.currentVulnerability.details[index].customFields = Utils.filterCustomFields('vulnerability', this.currentVulnerability.category, this.customFields, this.currentVulnerability.details[index].customFields, this.currentLanguage)
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

        customSort: function(rows, sortBy, descending) {
            if (rows) {
                var data = [...rows];

                if (sortBy === 'type') {
                    (descending)
                        ? data.sort((a, b) => this.getDtType(b).localeCompare(this.getDtType(a)))
                        : data.sort((a, b) => this.getDtType(a).localeCompare(this.getDtType(b)))
                }
                else if (sortBy === 'title') {
                    (descending)
                        ? data.sort((a, b) => this.getDtTitle(b).localeCompare(this.getDtTitle(a)))
                        : data.sort((a, b) => this.getDtTitle(a).localeCompare(this.getDtTitle(b)))
                }
                else if (sortBy === 'category') {
                    (descending)
                        ? data.sort((a, b) => (b.category || $t('noCategory')).localeCompare(a.category || $t('noCategory')))
                        : data.sort((a, b) => (a.category || $t('noCategory')).localeCompare(b.category || $t('noCategory')))
                }
                return data;
            }
        },

        customFilter: function(rows, terms, cols, getCellValue) {
            var result = rows && rows.filter(row => {
                var title = this.getDtTitle(row).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
                var type = this.getDtType(row).toLowerCase()
                var category = (row.category || $t('noCategory')).toLowerCase()
                var termTitle = (terms.title || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
                var termCategory = (terms.category || "").toLowerCase()
                var termVulnType = (terms.type || "").toLowerCase()
                return title.indexOf(termTitle) > -1 && 
                type.indexOf(termVulnType||"") > -1 &&
                category.indexOf(termCategory||"") > -1 &&
                (row.status === terms.valid || row.status === terms.new || row.status === terms.updates)
            })
            this.filteredRowsCount = result.length;
            return result;
        },

        goToAudits: function(row) {
            var title = this.getDtTitle(row);
            this.$router.push({name: 'audits', params: {finding: title}});
        },

        getVulnTitleLocale: function(vuln, locale) {
            for (var i=0; i<vuln.details.length; i++) {
                if (vuln.details[i].locale === locale && vuln.details[i].title) return vuln.details[i].title;
            }
            return "undefined";
        },

        mergeVulnerabilities: function() {
            VulnerabilityService.mergeVulnerability(this.mergeVulnLeft, this.mergeVulnRight, this.mergeLanguageRight)
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
            this.clone(row)
            if (this.UserService.isAllowed('vulnerabilities:update') && row.status === 2)
                this.$refs.updatesModal.show()
            else
                this.$refs.editModal.show()
        }
        
        ,_get_custom_fields_select: function() {
            let answer = {};
            
            let customFields = this.customFields;
            for (const singleField of customFields){
                if (singleField.fieldType != 'select') { continue; }
                let fieldID = singleField._id;
                answer[fieldID] = {};

                for (const singleOption of singleField.options){
                    if (!(singleOption.locale in answer[fieldID])){
                        answer[fieldID][singleOption.locale] = [];
                    }
                    answer[fieldID][singleOption.locale].push(singleOption.value);
                }
            }
            return answer;
        }

        ,_translate_custom_field: function(field_id, og_locale, og_val, new_locale) {
            let all_fields = this._get_custom_fields_select();
            if (!(field_id in all_fields)) { return undefined; }

            let og_index = all_fields[field_id][og_locale].indexOf(og_val);
            let new_val = all_fields[field_id][new_locale][og_index];
            return new_val;
        }

        ,_translate_several_custom_fields: function(custom_fields, og_locale_str, new_locale_str) {
            for (let i = 0; i < custom_fields.length; i++){
                let new_val = this._translate_custom_field(
                    custom_fields[i].customField._id,
                    og_locale_str,
                    custom_fields[i].text,
                    new_locale_str                  
                )
                console.debug(custom_fields[i].customField.label, og_locale_str, custom_fields[i].text, new_locale_str, new_val);
                if (new_val === undefined) { continue; }
                custom_fields[i].customField.text = new_val;
            }
        }

        ,copySharedFields: function() {
            this.cleanErrors();
            let currentLanguageId = this.currentDetailsIndex;
            let currentLanguageName = this.currentLanguage;

            let currentVulnerability = this.currentVulnerability;
            let ogLocale = currentVulnerability.details[currentLanguageId];

            let copied_to_locales = [];
            for (let i = 0; i < currentVulnerability.details.length; i++){
                let newLocale = currentVulnerability.details[i];
                if (i == currentLanguageId || newLocale.locale == 'og' ){ continue; }

                newLocale.references = ogLocale.references;
                newLocale.customFields = this.$_.cloneDeep(ogLocale.customFields);
                this._translate_several_custom_fields(newLocale.customFields, ogLocale.locale, newLocale.locale);

                copied_to_locales.push(newLocale.locale);
            }
            
            Notify.create({
                message:
                copied_to_locales.length 
                    ? `Custom fields copied from "${currentLanguageName}" to "${copied_to_locales}."`
                    : `Custom fields are only copied to non-og locales that exist (i.e. have been at least opened).`,
                color: copied_to_locales.length ? 'positive' : 'negative',
                textColor:'white',
                position: 'top-right'
            })
        }

        ,copyLocaleToAllLanguagesWithoutTitle: function() {
            this.cleanErrors();
            let currentLanguageName = this.currentLanguage;

            let currentVulnerability = this.currentVulnerability;
            let ogLocale = currentVulnerability.details[this.currentDetailsIndex];

            let copied_to_locales = [];

            for (const language_dict of this.languages){
                if (new_locale_str == 'og' || new_locale_str == currentLanguageName ){ continue; } // don't overwrite current locale or OG

                // try to find details for each locale and if the details don't exist, create empty entry in the list
                let new_locale_str = language_dict.locale;
                let new_locale_index = -1;
                for (let i = 0; i < currentVulnerability.details.length; i++){
                    if (currentVulnerability.details[i].locale == new_locale_str){
                        new_locale_index = i;
                        break;
                    }
                }
                if (new_locale_index < 0){ new_locale_index = currentVulnerability.details.push(undefined) - 1; }

                // skip a locale if it has a title
                if (currentVulnerability.details[new_locale_index]?.title?.length > 0){ continue; }

                // copy the template and translate the custom fields
                currentVulnerability.details[new_locale_index] = this.$_.cloneDeep(ogLocale);
                
                let newLocale = currentVulnerability.details[new_locale_index];
                newLocale.locale = new_locale_str;
                this._translate_several_custom_fields(newLocale.customFields, ogLocale.locale, newLocale.locale);

                copied_to_locales.push(newLocale.locale);
            }
            
            Notify.create({
                message:
                copied_to_locales.length 
                    ? `Copied template "${currentLanguageName}" to "${copied_to_locales}."`
                    : `No copy happened - templates for all proper languages exist and have a non-empty title.`,
                color: copied_to_locales.length ? 'positive' : 'negative',
                textColor:'white',
                position: 'top-right'
            })
        }

    }
}