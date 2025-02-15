import { nextTick } from 'vue';
import { Notify, Dialog } from 'quasar';

import BasicEditor from 'components/editor';
import Breadcrumb from 'components/breadcrumb';
import CvssCalculator from 'components/cvsscalculator';
import TextareaArray from 'components/textarea-array';
import CustomFields from 'components/custom-fields';

import AuditService from '@/services/audit';
import DataService from '@/services/data';
import VulnService from '@/services/vulnerability';
import Utils from '@/services/utils';

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
  },

  mounted() {
    this.auditId = this.$route.params.auditId;
    this.findingId = this.$route.params.findingId;
    this.getFinding();
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

  computed: {
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
        if (this.frontEndAuditState === this.AUDIT_VIEW_STATE.EDIT)
          this.updateFinding();
      }
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

    getFinding() {
      AuditService.getFinding(this.auditId, this.findingId)
        .then((data) => {
          this.finding = data.data.datas;

          // Initialiser les valeurs null ou undefined à des chaînes vides pour éviter les erreurs Proxy
          ['description', 'observation', 'poc', 'scope', 'remediation'].forEach(
            (field) => {
              this.finding[field] = this.finding[field] || '';
            }
          );

          this.finding.references = this.finding.references || [];

          if (
            this.finding.customFields &&
            this.finding.customFields.length > 0 &&
            typeof this.finding.customFields[0].customField === 'string'
          ) {
            this.finding.customFields = Utils.filterCustomFields(
              'finding',
              this.finding.category,
              this.$parent.customFields,
              this.finding.customFields,
              this.localAudit.language
            );
          }

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
      });
    },

    syncEditors() {
      Utils.syncEditors(this.$refs);
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
