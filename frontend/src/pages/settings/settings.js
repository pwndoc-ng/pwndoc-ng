import { Notify, Dialog } from 'quasar'

import SettingsService from '@/services/settings'
import SpellcheckService from '@/services/spellcheck'
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
            // Number of the last loading of the settings (reloaded after a revert or an import)
            settingsRequest: 0,
            findingCustomFieldLabels: [], // Labels of findings custom fields usable in the sidebar template
            spellcheckWords: [], // Words ignored by the spell checker: proposed (pending) and approved
            spellcheckNewWord: ''
        }
    },

    computed: {
        // Variables of the findings sidebar template, including findings custom fields
        // Highlight colors of the editors for the warning of the highlighted texts, several can be chosen (same colors as
        // the editor menu)
        highlightColorOptions: function() {
            return [['#ffff00', 'yellow'], ['#fe0000', 'red'], ['#00ff00', 'green'], ['#00ffff', 'cyan']]
                .map(([value, name]) => ({value: value, label: $t(`highlightColor.${name}`)}))
        },

        // Days of the automatic backups, Monday first: {value: 0 (Sunday) to 6, label: name in the language of the interface}
        weekDayOptions: function() {
            return [1, 2, 3, 4, 5, 6, 0].map(day => ({value: day, label: this.weekDayName(day)}))
        },

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
            ok: {label: $t('btn.confirm'), color: 'negative'},
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
        if (UserService.isAllowed('spellcheck-words:update'))
            this.getSpellcheckWords()
    },

    unmounted: function() {
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
            // A revert then an import confirmed quickly: the answer of the older loading must not replace the last one
            var request = ++this.settingsRequest
            SettingsService.getSettings()
            .then((data) => {
                if (request !== this.settingsRequest)
                    return
                // Lists of the server replace the defaults (merged by index otherwise)
                this.settings = this.$_.mergeWith(
                    {
                      danger: { enabled: false, public:{nbdaydelete: 0}},
                      reviews: { enabled: false, public: { minReviewers: 1 } }
                    },
                    data.data.datas,
                    (current, value) => Array.isArray(value) ? value : undefined
                  );
                  
                this.settingsOrig = this.$_.cloneDeep(this.settings);
                this.loading = false
            })
            .catch((err) => {
                if (request !== this.settingsRequest)
                    return
                Notify.create({
                    message: this.errorMessage(err),
                    color: 'negative',
                    textColor:'white',
                    position: 'top-right'
                })
            })
        },

        // Name of a day of the week (0: Sunday) in the language of the interface
        weekDayName: function(day) {
            var locale = (this.$i18n && this.$i18n.locale) || 'en-US'
            return new Intl.DateTimeFormat(locale, {weekday: 'long'}).format(new Date(2026, 10, 1 + Number(day))) // 2026-11-01: Sunday
        },

        // Message of the server (the message of axios only says the status code), or of the network error
        /* Words ignored by the spell checker */

        getSpellcheckWords: function() {
            return SpellcheckService.getAllWords()
            .then((data) => {
                this.spellcheckWords = data.data.datas
            })
            .catch((err) => this.notifyError(err))
        },

        // Proposed by, approved by
        spellcheckWordInfo: function(word) {
            var name = (user) => user ? `${user.firstname || ''} ${user.lastname || ''}`.trim() || user.username : '?'
            var info = $t('spellcheck.proposedBy', [name(word.proposedBy)])
            return word.approvedBy ? `${info} · ${$t('spellcheck.approvedBy', [name(word.approvedBy)])}` : info
        },

        // Word added by the administrator: approved at once
        addSpellcheckWord: function() {
            var word = this.spellcheckNewWord.trim()
            if (!word)
                return
            SpellcheckService.proposeWord(word)
            .then(() => {
                this.spellcheckNewWord = ''
                SpellcheckService.clearCache()
                return this.getSpellcheckWords()
            })
            .catch((err) => this.notifyError(err))
        },

        approveSpellcheckWord: function(word) {
            SpellcheckService.approveWord(word._id)
            .then(() => {
                SpellcheckService.clearCache()
                return this.getSpellcheckWords()
            })
            .catch((err) => this.notifyError(err))
        },

        deleteSpellcheckWord: function(word) {
            SpellcheckService.deleteWord(word._id)
            .then(() => {
                SpellcheckService.clearCache()
                return this.getSpellcheckWords()
            })
            .catch((err) => this.notifyError(err))
        },

        notifyError: function(err) {
            Notify.create({
                message: this.errorMessage(err),
                color: 'negative',
                textColor: 'white',
                position: 'top-right'
            })
        },

        errorMessage: function(err) {
            return (err.response && err.response.data && err.response.data.datas) || err.message
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
            // Ctrl+S before the end of the loading would send the empty initial settings
            if (this.loading)
                return;
            var min = 1;
            var max = 99;
            if(this.settings.reviews.public.minReviewers < min || this.settings.reviews.public.minReviewers > max) {
                this.settings.reviews.public.minReviewers = this.settings.reviews.public.minReviewers < min ? min: max;
            }
            // Snapshot of the settings sent: the changes made while the request is pending stay unsaved
            var sent = this.$_.cloneDeep(this.settings);
            SettingsService.updateSettings(sent)
            .then((data) => {
                this.settingsOrig = sent;
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
                    message: this.errorMessage(err),
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
                try {
                    await SettingsService.revertDefaults();
                }
                catch (err) {
                    Notify.create({
                        message: this.errorMessage(err),
                        color: 'negative',
                        textColor:'white',
                        position: 'top-right'
                    })
                    return;
                }
                this.$settings.refresh();
                this.getSettings();
                Notify.create({
                    message: $t('msg.settingsUpdatedOk'),
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
                    // typeof gives 'object' for null and the arrays too
                    if (settings && typeof settings === 'object' && !Array.isArray(settings)) {
                        Dialog.create({
                            title: $t('msg.importingSettings'),
                            message: $t('msg.importingSettingsConfirm'),
                            ok: {label: $t('btn.confirm'), color: 'negative'},
                            cancel: {label: $t('btn.cancel'), color: 'white'}
                        })
                        .onOk(async () => {
                            try {
                                await SettingsService.updateSettings(settings);
                            }
                            catch (err) {
                                Notify.create({
                                    message: this.errorMessage(err),
                                    color: 'negative',
                                    textColor: 'white',
                                    position: 'top-right'
                                })
                                return;
                            }
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