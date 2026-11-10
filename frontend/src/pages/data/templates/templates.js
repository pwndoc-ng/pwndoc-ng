import { Dialog, Notify, exportFile } from 'quasar';

import Breadcrumb from 'components/breadcrumb'

import TemplateService from '@/services/template'
import UserService from '@/services/user'
import Utils from '@/services/utils'

import { $t } from '@/boot/i18n'

export default {
    data: () => {
        return {
            UserService: UserService,
            // Templates list
            templates: [],
            // Loading state
            loading: true,
            // Datatable headers
            dtHeaders: [
                {name: 'name', label: $t('name'), field: 'name', align: 'left', sortable: true},
                {name: 'ext', label: $t('extension'), field: 'ext', align: 'left', sortable: true},
                {name: 'action', label: '', field: 'action', align: 'left', sortable: false},
            ],
            // Datatable pagination
            pagination: {
                page: 1,
                rowsPerPage: 25,
                sortBy: 'name',
            },
            rowsPerPageOptions: [
                {label:'25', value:25},
                {label:'50', value:50},
                {label:'100', value:100},
                {label:'All', value:0}
            ],
            // Search filter
            search: {name: '', ext: ''},
            //customFilter: Utils.customFilter,
            // Errors messages
            errors: {name: '', file: ''},
            // Selected or New Vulnerability
            currentTemplate: {
                name: '',
                file: '',
                ext: ''
            },
            templateId: '',
            // Creation in progress (double click protection)
            creating: false,
            // Templates whose deletion was sent (double confirmation protection), removed when the deletion fails
            deletedIds: [],
            // Number of the last loading of the list
            listRequest: 0
        }
    },

    components: {
        Breadcrumb
    },

    mounted: function() {
        this.getTemplates()
    },

    unmounted: function() {
        // The answers of the loadings still pending are ignored once the page is left
        this.listRequest++
    },

    methods: {
        getTemplates: function() {
            this.loading = true
            // Several loadings may be pending (page opened, refresh after a change): only the last one is applied
            var request = ++this.listRequest
            TemplateService.getTemplates()
            .then((data) => {
                if (request !== this.listRequest)
                    return
                this.templates = data.data.datas
                this.loading = false
            })
            .catch((err) => {
                console.log(err)
                if (request !== this.listRequest)
                    return
                this.loading = false
                Notify.create({
                    message: (err.response && err.response.data && err.response.data.datas) || err.message,
                    color: 'negative',
                    textColor: 'white',
                    position: 'top-right'
                })
            })
        },
        customFilter(rows, terms, cols, getCellValue) {
            // Check if terms is empty
            if (!terms || (terms.name === '' && terms.ext === '')) {
              return rows;
            }
            
            return rows.filter(row => {
              // Check name
              if (terms.name && row.name) {
                const nameMatch = String(row.name).toLowerCase().includes(String(terms.name).toLowerCase());
                if (!nameMatch) return false;
              }
              
              // Check ext (the templates created before the extensions are docx templates, downloaded as .docx)
              if (terms.ext) {
                const extMatch = String(row.ext || 'docx').toLowerCase().includes(String(terms.ext).toLowerCase());
                if (!extMatch) return false;
              }
              
              return true;
            });
          },
          
        downloadTemplate: function(row) {
            TemplateService.downloadTemplate(row._id)
            .then((data) => {
                // true, or the error of the browser (download blocked...)
                var status = exportFile(`${row.name}.${row.ext || 'docx'}`, data.data, {type: "application/octet-stream"})
                if (status !== true)
                    throw status
            })
            .catch(async (err) => {
                console.log(err.response || err)
                Notify.create({
                    message: (err.response && err.response.status === 404) ? $t('msg.templateNotFound') : await Utils.requestErrorMessage(err),
                    color: 'negative',
                    textColor: 'white',
                    position: 'top-right'
                })
            })
        },

        createTemplate: function() {
            // Double click or Enter pressed twice: the second request would be refused (template already exists)
            if (this.creating)
                return;
            this.cleanErrors();
            if (!this.currentTemplate.name)
                this.errors.name = $t('msg.nameRequired');
            if (!this.currentTemplate.file)
                this.errors.file = $t('msg.fileRequired');

            if (this.errors.name || this.errors.file)
                return;

            this.creating = true;
            var created = this.currentTemplate;
            TemplateService.createTemplate(this.currentTemplate)
            .finally(() => {
                this.creating = false;
            })
            .then(() => {
                this.getTemplates();
                // Not when the page was left, nor when the dialog was opened again meanwhile (new object)
                if (this.$refs.createModal && this.currentTemplate === created)
                    this.$refs.createModal.hide();
                Notify.create({
                    message: $t('msg.templateCreatedOk'),
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

        updateTemplate: function() {
            this.cleanErrors();
            if (!this.currentTemplate.name)
                this.errors.name = $t('msg.nameRequired');
            
            if (this.errors.name)
                return;

            var updated = this.currentTemplate;
            TemplateService.updateTemplate(this.templateId, this.currentTemplate)
            .then(() => {
                this.getTemplates();
                // Not when the page was left, nor when another template was opened meanwhile (new object)
                if (this.$refs.editModal && this.currentTemplate === updated)
                    this.$refs.editModal.hide();
                Notify.create({
                    message: $t('msg.templateUpdatedOk'),
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

        deleteTemplate: function(templateId) {
            // A double click on the trash opens two confirmations: the template is deleted once
            if (this.deletedIds.includes(templateId))
                return;
            this.deletedIds.push(templateId);
            TemplateService.deleteTemplate(templateId)
            .then((data) => {
                this.getTemplates();
                Notify.create({
                    message: data.data.datas,
                    color: 'positive',
                    textColor:'white',
                    position: 'top-right'
                })
            })
            .catch((err) => {
                this.deletedIds.splice(this.deletedIds.indexOf(templateId), 1);
                Notify.create({
                    message: err.response.data.datas,
                    color: 'negative',
                    textColor: 'white',
                    position: 'top-right'
                })
            })
        },

        confirmDeleteTemplate: function(row) {
            Dialog.create({
                title: $t('msg.confirmSuppression'),
                message: `${$t('template')} «${row.name}» ${$t('msg.deleteNotice')}`,
                ok: {label: $t('btn.confirm'), color: 'negative'},
                cancel: {label: $t('btn.cancel'), color: 'white'}
            })
            .onOk(() => this.deleteTemplate(row._id))
        },

        clone: function(row) {
            this.cleanCurrentTemplate();
            
            this.currentTemplate.name = row.name;
            this.templateId = row._id;
        },

        cleanErrors: function() {
            this.errors.name = '';
            this.errors.file = '';
        },

        cleanCurrentTemplate: function() {
            this.cleanErrors();
            this.currentTemplate = {
                name: '',
                file: '',
                ext: ''
            };
            this.templateId = ''
        },

        handleFile: function(files) {
            var file = files[0];
            var fileReader = new FileReader();
            // Read asynchronously: the dialog may have been closed and another template opened meanwhile (new object,
            // see cleanCurrentTemplate)
            var template = this.currentTemplate;

            fileReader.onloadend = (e) => {
                template.file = fileReader.result.split(",")[1];
            }

            template.ext = file.name.split('.').pop()
            fileReader.readAsDataURL(file);
        },

        dblClick: function(evt, row) {
            if (this.UserService.isAllowed('templates:update')) {
                this.clone(row)
                this.$refs.editModal.show()
            }     
        }
    }
}