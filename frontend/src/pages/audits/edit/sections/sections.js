import { nextTick } from 'vue';
import { Notify, Dialog } from 'quasar';

import BasicEditor from 'components/editor';
import Breadcrumb from 'components/breadcrumb';
import CustomFields from 'components/custom-fields';
import CommentButton from 'components/comment-button';

import AuditService, { errorMessage } from '@/services/audit';
import DataService from '@/services/data';
import Utils from '@/services/utils';

import { $t } from '@/boot/i18n'

export default {
    props: {
        frontEndAuditState: Number,
        parentState: String,
        parentApprovals: Array,
        audit: {
            type: Object,
            required: false,
            default: () => ({})
          }
    },
    data: () => {
        return {
            // Set audit ID
            auditId: null,
            section: {
                field: "",
                name: "",
                customFields: []
            },
            sectionOrig: {},
            // Section loaded: it cannot be saved before (the empty section would replace it)
            loaded: false,
            // Saves numbered in the order of the requests: copy of the section sent by the last one, number of the last
            // one answered (an older save answered after a newer one is not the saved version)
            sectionSaving: null,
            saveCount: 0,
            savedCount: 0,
            // List of CustomFields
            customFields: [],
            AUDIT_VIEW_STATE: Utils.AUDIT_VIEW_STATE
        }
    },

    components: {
        BasicEditor,
        Breadcrumb,
        CustomFields,
        CommentButton
    },

    computed: {
        // Review comments targets of the section (stable objects: used as props of editors)
        commentTargets: function() {
            const base = {kind: 'section', sectionId: this.$route.params.sectionId}
            return {base: base, text: {...base, field: 'text'}}
        },
        // Field of the text editor in the shared document of the audit: same for all the users of the section
        // (without it the editor uses a random field and its text is not shared)
        textEditorId: function() {
            return `${this.$route.params.sectionId}-section-text`
        },
    },

    mounted: function() {
        this.auditId = this.$route.params.auditId;
        this.sectionId = this.$route.params.sectionId;
        this.getSection();

        this.$socket.emit('menu', {menu: 'editSection', section: this.sectionId, room: this.auditId});

        // save on ctrl+s
        document.addEventListener('keydown', this._listener, false)
    },

    unmounted: function() {
        document.removeEventListener('keydown', this._listener, false)
    },

    beforeRouteLeave (to, from , next) {
        Utils.syncEditors(this.$refs)
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

    beforeRouteUpdate (to, from , next) {
        Utils.syncEditors(this.$refs)
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

    methods: {
        _listener: function(e) {
            if ((window.navigator.platform.match("Mac") ? e.metaKey : e.ctrlKey) && e.keyCode == 83) {
                e.preventDefault();
                // Only trigger save if we're in the section edit context AND this is the active section
                if (this.frontEndAuditState === this.AUDIT_VIEW_STATE.EDIT && 
                    this.$route.name === 'editSection' &&
                    this.$route.params.sectionId === this.sectionId)
                    this.updateSection();
            }
        },

        // Get Section
        getSection: function() {
            DataService.getCustomFields()
            .then((data) => {
                this.customFields = data.data.datas
                return AuditService.getSection(this.auditId, this.sectionId)
            })
            .then((data) => {
                this.section = data.data.datas;
                this.sectionOrig = this.$_.cloneDeep(this.section);
                this.loaded = true
                nextTick(() => {
                    Utils.syncEditors(this.$refs)
                })
            })
            .catch((err) => {
                console.log(err)
            })
        },


        // Update Section
        updateSection: function() {
            if (!this.loaded) return
            Utils.syncEditors(this.$refs)
            nextTick(() => {
                if (this.$refs.customfields && this.$refs.customfields.requiredFieldsEmpty()) {
                    Notify.create({
                        message: $t('msg.fieldRequired'),
                        color: 'negative',
                        textColor:'white',
                        position: 'top-right'
                    })
                    return
                }
                // Saved version: the data sent, not the data typed while the request is pending
                var sent = this.$_.cloneDeep(this.section)
                var save = ++this.saveCount
                this.sectionSaving = sent
                AuditService.updateSection(this.auditId, this.sectionId, sent)
                .then(() => {
                    if (save > this.savedCount) {
                        this.savedCount = save
                        this.sectionOrig = sent;
                    }
                    Notify.create({
                        message: $t('msg.sectionUpdateOk'),
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
                    if (save === this.saveCount) // Not a later save
                        this.sectionSaving = null
                })
            }).catch((err) => {
                console.error('Error in updateSection nextTick:', err);
            })
        },

        // Text of a section of an old version shown by its editor (not editable before): the HTML normalized by the
        // editor is the saved version, otherwise leaving would warn about changes not made by the user
        textEditorReady: function() {
            Utils.syncEditors(this.$refs)
            this.sectionOrig.text = this.section.text
        },

        // Changes of the custom fields, or of the text of the sections of the old versions, not saved nor being saved
        unsavedChanges: function() {
            if (!this.loaded || this.$_.isEqual(this.section, this.sectionOrig))
                return false
            return !(this.sectionSaving && this.$_.isEqual(this.section, this.sectionSaving))
        }
    }
}
