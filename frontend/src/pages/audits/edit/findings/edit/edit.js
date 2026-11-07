import { nextTick } from 'vue';
import { Notify, Dialog } from 'quasar';

import BasicEditor from 'components/editor';
import Breadcrumb from 'components/breadcrumb';
import CvssCalculator from 'components/cvsscalculator';
import TextareaArray from 'components/textarea-array';
import CustomFields from 'components/custom-fields';
import CommentButton from 'components/comment-button';
import ProposalReview from 'components/proposal-review';

import AuditService from '@/services/audit';
import DataService from '@/services/data';
import VulnService from '@/services/vulnerability';
import Utils from '@/services/utils';
import { FINDING_FIELD_TABS } from '@/services/comments';
import { statusInfo } from '@/services/proposals';

import { $t } from '@/boot/i18n';

export default {
  props: {
    audit: Object,
    frontEndAuditState: Number,
    parentState: String,
    parentApprovals: Array,
  },
  data: () => {
    return {
      finding: {
        title: '',
        vulnType: '',
        description: '',
        observation: '',
        references: [],
        status: 1,
        customFields: [],
        poc: '',
        scope: '',
        cvssv3: '',
        remediationComplexity: null,
        priority: null,
        remediation: '',
      },
      localAudit: { language: '' },
      findingOrig: {},
      selectedTab: 'definition',
      findingProposal: null, // Last proposal made from this finding
      proofsTabVisited: false,
      detailsTabVisited: false,
      vulnTypes: [],
      filteredVulnTypes: [],
      readyToSave: false,
      needSave: false,
      AUDIT_VIEW_STATE: Utils.AUDIT_VIEW_STATE,
    };
  },

  components: {
    BasicEditor,
    Breadcrumb,
    CvssCalculator,
    TextareaArray,
    CustomFields,
    CommentButton,
    ProposalReview,
  },

  // Review comments store of the audit edit page
  inject: {
    commentsStore: { from: 'auditComments', default: null },
  },

  mounted() {
    this.auditId = this.$route.params.auditId;
    this.findingId = this.$route.params.findingId;
    this.getFindingProposal();
    this.getCustomFields().then( x => {
      this.getFinding();
    })
    this.getAudit();
    this.getVulnTypes();
    

    this.$socket.emit('menu', {
      menu: 'editFinding',
      finding: this.findingId,
      room: this.auditId,
    });

    document.addEventListener('keydown', this._listener, false);
  },

  beforeUnmount() {
    document.removeEventListener('keydown', this._listener, false);
  },

  beforeRouteLeave(to, from, next) {
    Utils.syncEditors(this.$refs);
    if (this.unsavedChanges()) {
      Dialog.create({
        title: $t('msg.thereAreUnsavedChanges'),
        message: $t('msg.doYouWantToLeave'),
        ok: { label: $t('btn.confirm'), color: 'negative' },
        cancel: { label: $t('btn.cancel'), color: 'white' },
      }).onOk(() => next());
    } else next();
  },

  beforeRouteUpdate(to, from, next) {
    Utils.syncEditors(this.$refs);

    if (this.unsavedChanges()) {
      Dialog.create({
        title: $t('msg.thereAreUnsavedChanges'),
        message: $t('msg.doYouWantToLeave'),
        ok: { label: $t('btn.confirm'), color: 'negative' },
        cancel: { label: $t('btn.cancel'), color: 'white' },
      }).onOk(() => next());
    } else next();
  },


  watch: {
    'commentsStore.focus': {
      handler(focus) {
        if (!focus || focus.kind !== 'finding' || focus.findingId !== this.$route.params.findingId) return;
        const tab = Object.keys(FINDING_FIELD_TABS).find((name) => FINDING_FIELD_TABS[name].includes(focus.field));
        this.selectedTab = tab || 'definition';
      },
      immediate: true,
    },
  },
  computed: {
    proposalStatus() {
      return statusInfo(this.findingProposal && this.findingProposal.status);
    },
    // Review comments targets of the finding fields (stable objects: used as props of editors)
    commentTargets() {
      const findingId = this.$route.params.findingId;
      const target = (field) => ({ kind: 'finding', findingId: findingId, field: field });
      const targets = { base: { kind: 'finding', findingId: findingId } };
      ['title', 'vulnType', 'description', 'observation', 'references', 'poc', 'scope', 'cvssv3', 'remediationComplexity', 'priority', 'remediation']
        .forEach((field) => { targets[field] = target(field) });
      return targets;
    },

    vulnTypesLang() {
      return this.vulnTypes.filter(
        (type) => type.locale === this.localAudit.language
      );
    },
  },

  methods: {
    _listener(e) {
      if (
        (window.navigator.platform.match('Mac') ? e.metaKey : e.ctrlKey) &&
        e.keyCode == 83
      ) {
        e.preventDefault();
        // Only trigger save if we're in the finding edit context
        if (this.frontEndAuditState === this.AUDIT_VIEW_STATE.EDIT && 
            this.$route.name === 'editFinding')
            this.updateFinding();
      }
    },
    getCustomFields: function() {
      return new Promise((resolve, reject) => {
          DataService.getCustomFields()
          .then((data) => {
              this.customFields = this.$_.cloneDeep(data.data.datas)
              resolve();
          })
          .catch((err) => {
              console.log(err)
              reject();
          })
        })
    },
    getAudit() {
      AuditService.getAudit(this.auditId)
        .then((data) => {
          this.localAudit = data.data.datas;
        })
        .catch((err) => {
          console.log(err);
        });
    },

    getVulnTypes() {
      DataService.getVulnerabilityTypes()
        .then((data) => {
          this.vulnTypes = data.data.datas;
          this.filteredVulnTypes = this.vulnTypesLang;
        })
        .catch((err) => {
          console.log(err);
        });
    },

    filterType(val, update) {
      if (val === '') {
        update(() => {
          this.filteredVulnTypes = this.vulnTypesLang || [];
        });
        return;
      }

      update(() => {
        const needle = val.toLowerCase();
        this.filteredVulnTypes = (this.vulnTypesLang || []).filter((v) =>
          v.name.toLowerCase().includes(needle)
        );
      });
    },
    initCustomFieldsForFinding() {
        // Define the category and language to use
        const categoryForFilter = this.finding.category || 'default';
        const languageForFilter = (this.audit && this.audit.language) || 'en';
        
        // If no custom field is defined, we create the default structure
        if (!this.finding.customFields || this.finding.customFields.length === 0) {

         const  findingCustomField = this.$_.cloneDeep(
            Utils.filterCustomFields(
              'finding',              
              categoryForFilter,     
              this.customFields,     
              [],                  
              languageForFilter  
            )
          )
          const existingKeys = new Set(findingCustomField.map(field => field.key));
         const vulnerabilityCustomField = this.$_.cloneDeep(
            Utils.filterCustomFields(
              'vulnerability',              
              categoryForFilter,     
              this.customFields,     
              [],                  
              languageForFilter  
            ).filter(field => !existingKeys.has(field.key))
          )
          this.finding.customFields = [ ...findingCustomField,...vulnerabilityCustomField ];
        }
        else {
          // Retrieve existing fields to avoid duplicates
          const existingKeys = new Set(this.finding.customFields.map(field => field.key));
        
          const newFindingFields = this.$_.cloneDeep(
            Utils.filterCustomFields('finding', categoryForFilter, this.customFields, this.finding.customFields, languageForFilter)
          );
        
          const newVulnerabilityFields = this.$_.cloneDeep(
            Utils.filterCustomFields('vulnerability', categoryForFilter, this.customFields, this.finding.customFields, languageForFilter)
          ).filter(field => !existingKeys.has(field.key)); // Remove duplicates
        
          this.finding.customFields = [...newFindingFields, ...newVulnerabilityFields];
        } 
 
      },
      
      getFinding() {
        AuditService.getFinding(this.auditId, this.findingId)
          .then((data) => {
            this.finding = data.data.datas || {};
      
            // Force initialization of customFields if it's undefined
            if (typeof this.finding.customFields === 'undefined') {
              this.finding.customFields = [];
            }
      
            // Ensure that certain text fields are initialized
            ['description', 'observation', 'poc', 'scope', 'remediation'].forEach(field => {
              this.finding[field] = this.finding[field] || '';
            });
            this.finding.references = this.finding.references || [];
      
            // Initialize custom fields (even if they were empty)
            this.initCustomFieldsForFinding();
      
            this.$nextTick(() => {
              Utils.syncEditors(this.$refs);
              this.findingOrig = this.$_.cloneDeep(this.finding);
            });
          })
          .catch((err) => {
            console.error(err);
          });
      },
      
    updateFinding() {
      Utils.syncEditors(this.$refs);
      nextTick(() => {
        if (
          this.$refs.customfields &&
          this.$refs.customfields.requiredFieldsEmpty()
        ) {
          Notify.create({
            message: $t('msg.fieldRequired'),
            color: 'negative',
            textColor: 'white',
            position: 'top-right',
          });
          return;
        }

        AuditService.updateFinding(this.auditId, this.findingId, this.finding)
          .then(() => {
            this.findingOrig = this.$_.cloneDeep(this.finding);
            Notify.create({
              message: $t('msg.findingUpdateOk'),
              color: 'positive',
              textColor: 'white',
              position: 'top-right',
            });
            this.needSave = false;
          })
          .catch((err) => {
            Notify.create({
              message: err.response.data.datas,
              color: 'negative',
              textColor: 'white',
              position: 'top-right',
            });
          });
      }).catch((err) => {
        console.error('Error in updateFinding nextTick:', err);
      });
    },

    syncEditors() {
      Utils.syncEditors(this.$refs);
    },
    // Last proposal made from this finding to the vulnerabilities database
    getFindingProposal: function() {
        VulnService.getFindingProposal(this.$route.params.findingId)
        .then((data) => {
            this.findingProposal = data.data.datas;
        })
        .catch((err) => console.log(err));
    },
    backupFinding: function() {
        Utils.syncEditors(this.$refs)
        // Source of the proposal: its review status is shown on this finding
        VulnService.backupFinding(this.localAudit.language, {...this.finding, auditId: this.auditId, findingId: this.findingId})
        .then((data) => {
            this.getFindingProposal();
            Notify.create({
                message: data.data.datas,
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
    },
    deleteFinding: function() {
        Dialog.create({
            title: $t('msg.deleteFindingConfirm'),
            message: $t('msg.deleteFindingNotice'),
            ok: {label: $t('btn.confirm'), color: 'negative'},
            cancel: {label: $t('btn.cancel'), color: 'white'}
        })
        .onOk(() => {
            AuditService.deleteFinding(this.auditId, this.findingId)
            .then(() => {
                Notify.create({
                    message: $t('msg.findingDeleteOk'),
                    color: 'positive',
                    textColor:'white',
                    position: 'top-right'
                })
                this.findingOrig = this.finding
                var currentIndex = this.$parent.audit.findings.findIndex(e => e._id === this.findingId)
                if (this.$parent.audit.findings.length === 1)
                    this.$router.push(`/audits/${this.$parent.auditId}/findings/add`)
                else if (currentIndex === this.$parent.audit.findings.length - 1)
                    this.$router.push(`/audits/${this.$parent.auditId}/findings/${this.$parent.audit.findings[currentIndex - 1]._id}`)
                else
                    this.$router.push(`/audits/${this.$parent.auditId}/findings/${this.$parent.audit.findings[currentIndex + 1]._id}`)
            })
            .catch((err) => {
                Notify.create({
                    message: err.response.data.datas,
                    color: 'negative',
                    textColor:'white',
                    position: 'top-right'
                })
            })
        })
    },
    updateOrig() {
      if (this.selectedTab === 'proofs' && !this.proofsTabVisited) {
        this.finding.poc = this.finding.poc || '';
        Utils.syncEditors(this.$refs);
        this.findingOrig.poc = this.finding.poc;
        this.proofsTabVisited = true;
      } else if (this.selectedTab === 'details' && !this.detailsTabVisited) {
        this.finding.remediation = this.finding.remediation || '';
        Utils.syncEditors(this.$refs);
        this.findingOrig.remediation = this.finding.remediation;
        this.detailsTabVisited = true;
      }
    },

    unsavedChanges() {
      return this.needSave;
    },
  },
};
