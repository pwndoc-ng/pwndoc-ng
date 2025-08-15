import { nextTick } from 'vue';
import { Notify, Dialog } from 'quasar';

import BasicEditor from 'components/editor';
import Breadcrumb from 'components/breadcrumb';
import CustomFields from 'components/custom-fields';

import AuditService from '@/services/audit';
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
            // List of CustomFields
            customFields: [],
            AUDIT_VIEW_STATE: Utils.AUDIT_VIEW_STATE
        }
    },

    components: {
        BasicEditor,
        Breadcrumb,
        CustomFields
    },

    mounted: function() {
        this.auditId = this.$route.params.auditId;
        this.sectionId = this.$route.params.sectionId;
        this.getSection();

        this.$socket.emit('menu', {menu: 'editSection', section: this.sectionId, room: this.auditId});

        // save on ctrl+s
        document.addEventListener('keydown', this._listener, false)
    },

    destroyed: function() {
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
                AuditService.updateSection(this.auditId, this.sectionId, this.section)
                .then(() => {
                    this.sectionOrig = this.$_.cloneDeep(this.section);
                    Notify.create({
                        message: $t('msg.sectionUpdateOk'),
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
            }).catch((err) => {
                console.error('Error in updateSection nextTick:', err);
            })
        },

        unsavedChanges: function() {  
            if (!this.$_.isEqual(this.section.customFields, this.sectionOrig.customFields))
                return true

            return false
        }
    }
}
