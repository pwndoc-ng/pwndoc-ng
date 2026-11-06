import { Notify, Dialog } from 'quasar'

import SettingsService from '@/services/settings'
import UserService from '@/services/user'
import DataService from '@/services/data'
import Utils from '@/services/utils'

import { $t } from 'boot/i18n'
import LanguageSelector from '@/components/language-selector';

export default {
    data: () => {
        return {
            loading: true,
            UserService: UserService,
            settings: {danger:{enabled:false,public:{nbdaydelete: 0}},reviews:{enabled:false}},
            settingsOrig : {danger:{enabled:false},reviews:{enabled:false}},
            canEdit: false,
            findingCustomFieldLabels: [] // Labels of findings custom fields usable in the sidebar template
        }
    },

    computed: {
        // Variables of the findings sidebar template, including findings custom fields
        findingTemplateVariables: function() {
            var builtIn = Object.keys(Utils.findingTemplateVariables({}, {}))
            return builtIn.concat(this.findingCustomFieldLabels.map(label => `custom.${label}`))
        },

        // Braces are passed as parameters: they are interpolation delimiters in i18n messages
        findingTemplateDescription: function() {
            return $t('findingSidebarTemplateDescription', {customExample: '{custom.Label}', defaultExample: '{title}'})
        },

        // Template rendered with a sample finding
        findingTemplatePreview: function() {
            var finding = {
                title: 'SQL Injection',
                vulnType: 'Web',
                category: 'Web',
                cvssv3: 'CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:N',
                priority: 3,
                remediationComplexity: 1,
                scope: '<p>srv-web-01</p>',
                customFields: this.findingCustomFieldLabels.map(label => ({customField: {label: label, fieldType: 'input'}, text: `<${label}>`}))
            }
            var variables = Utils.findingTemplateVariables(finding, {index: 2, cvss: () => ({severity: 'High', score: '8.1'})})
            var template = this.settings.report && this.settings.report.public.findingSidebarTemplate
            return Utils.renderTemplate(template || '{title}', variables, finding.customFields).replace(/\s+/g, ' ').trim() || finding.title
        }
    },
    components: {
        LanguageSelector
    },

    beforeRouteLeave (to, from , next) {
        if (this.unsavedChanges()) {
            Dialog.create({
            title: $t('msg.thereAreUnsavedChanges'),
            message: $t('msg.doYouWantToLeave'),
            ok: {label: $t('btn.comfirm'), color: 'negative'},
            cancel: {label: $t('btn.cancel'), color: 'white'}
            })
            .onOk(() => next())
        }
        else
            next()
    },

    mounted: function() {
        if (UserService.isAllowed('settings:read')) {
            this.getSettings()
            this.getFindingCustomFieldLabels()
            this.canEdit = this.UserService.isAllowed('settings:update');
            document.addEventListener('keydown', this._listener, false)
        }
        else {
            this.loading = false
        }
    },

    destroyed: function() {
        document.removeEventListener('keydown', this._listener, false)
    },

    methods: {
        _listener: function(e) {
            if ((window.navigator.platform.match("Mac") ? e.metaKey : e.ctrlKey) && e.keyCode == 83) {
                e.preventDefault();
                this.updateSettings();
            }
        },

        getSettings: function() {
            SettingsService.getSettings()
            .then((data) => {
                this.settings = this.$_.merge(
                    {
                      danger: { enabled: false, public:{nbdaydelete: 0}},
                      reviews: { enabled: false, public: { minReviewers: 1 } }
                    },
                    data.data.datas
                  );
                  
                this.settingsOrig = this.$_.cloneDeep(this.settings);
                this.loading = false
            })
            .catch((err) => {
                Notify.create({
                    message: err.response.data.datas,
                    color: 'negative',
                    textColor:'white',
                    position: 'top-right'
                })
            })
        },

        getFindingCustomFieldLabels: function() {
            DataService.getCustomFields()
            .then((data) => {
                var labels = data.data.datas
                .filter(field => ['finding', 'vulnerability'].includes(field.display) && field.fieldType !== 'space' && field.label && !/[{}]/.test(field.label))
                .map(field => field.label)
                this.findingCustomFieldLabels = [...new Set(labels)]
            })
            .catch(err => console.log(err))
        },

        // Append a variable to the findings sidebar template
        insertFindingTemplateVariable: function(variable) {
            if (!this.canEdit)
                return
            var template = this.settings.report.public.findingSidebarTemplate || ''
            this.settings.report.public.findingSidebarTemplate = `${template}${template ? ' ' : ''}{${variable}}`
        },

        updateSettings: function() {
            var min = 1;
            var max = 99;
            if(this.settings.reviews.public.minReviewers < min || this.settings.reviews.public.minReviewers > max) {
                this.settings.reviews.public.minReviewers = this.settings.reviews.public.minReviewers < min ? min: max;
            }
            SettingsService.updateSettings(this.settings)
            .then((data) => {
                this.settingsOrig = this.$_.cloneDeep(this.settings);
                this.$settings.refresh();
                Notify.create({
                    message: $t('msg.settingsUpdatedOk'),
                    color: 'positive',
                    textColor:'white',
                    position: 'top-right'
                })
            })
            .catch((err) => {
                Notify.create({
                    message: err.message || err.response.data.datas,
                    color: 'negative',
                    textColor:'white',
                    position: 'top-right'
                })
            })
        },

        revertToDefaults: function() {
            Dialog.create({
                title: $t('msg.revertingSettings'),
                message: $t('msg.revertingSettingsConfirm'),
                ok: {label: $t('btn.confirm'), color: 'negative'},
                cancel: {label: $t('btn.cancel'), color: 'white'}
            })
            .onOk(async () => {
                await SettingsService.revertDefaults();
                this.$settings.refresh();
                this.getSettings();
                Notify.create({
                    message: $t('settingsUpdatedOk'),
                    color: 'positive',
                    textColor:'white',
                    position: 'top-right'
                })
            })
        },

        importSettings: function(file) {
            var fileReader = new FileReader();
            fileReader.onloadend = async (e) => {
                try {
                    var settings = JSON.parse(fileReader.result);
                    if (typeof settings === 'object') {
                        Dialog.create({
                            title: $t('msg.importingSettings'),
                            message: $t('msg.importingSettingsConfirm'),
                            ok: {label: $t('btn.confirm'), color: 'negative'},
                            cancel: {label: $t('btn.cancel'), color: 'white'}
                        })
                        .onOk(async () => {
                            await SettingsService.updateSettings(settings);
                            this.getSettings();
                            Notify.create({
                                message: $t('msg.settingsImportedOk'),
                                color: 'positive',
                                textColor:'white',
                                position: 'top-right'
                            })
                        })
                    } else {
                        throw $t('err.jsonMustBeAnObject');
                    }
                }
                catch (err) {
                    console.log(err);
                    var errMsg = $t('err.importingSettingsError')
                    if (err.message) errMsg = $t('err.errorWhileParsingJsonContent',[err.message]);
                    Notify.create({
                        message: errMsg,
                        color: 'negative',
                        textColor: 'white',
                        position: 'top-right'
                    })
                }
            };
            var fileContent = new Blob(file, {type : 'application/json'});
            fileReader.readAsText(fileContent);
        },

        exportSettings: async function() {
            var response = await SettingsService.exportSettings();
            var blob = new Blob([JSON.stringify(response.data)], {type: "application/json"});
            var link = document.createElement('a');
            link.href = window.URL.createObjectURL(blob);
            link.download = decodeURIComponent(response.headers['content-disposition'].split('"')[1]);
            document.body.appendChild(link);
            link.click();
            link.remove();
        },

        unsavedChanges() {
            return JSON.stringify(this.settingsOrig) !== JSON.stringify(this.settings);
        }
    }
}