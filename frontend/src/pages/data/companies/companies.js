import { Dialog, Notify } from 'quasar';

import CompanyService from '@/services/company'
import Utils from '@/services/utils'

import { $t } from '@/boot/i18n'

export default {
    data: () => {
        return {
            // Companies list
            companies: [],
            // Loading state
            // Datatable headers
            rows:[],
            dtHeaders: [
                {name: 'name', label: $t('name'), field: 'name', align: 'left', sortable: true},
                {name: 'shortName', label: $t('shortName'), field: 'shortName', align: 'left', sortable: true},
                {name: 'address', label: $t('address'), field: 'address', align: 'left', sortable: true},
                {name: 'postalCode', label: $t('postalCode'), field: 'postalCode', align: 'left', sortable: true},
                {name: 'city', label: $t('city'), field: 'city', align: 'left', sortable: true},
                {name: 'logo', label: $t('logo'), field: 'logo', align: 'left', sortable: true},
                {name: 'action', label: '', field: 'action', align: 'left', sortable: false},
            ],
            // Datatable pagination
            pagination: {
                page: 1,
                rowsPerPage: 25,
                sortBy: 'name'
            },
            rowsPerPageOptions: [
                {label:'25', value:25},
                {label:'50', value:50},
                {label:'100', value:100},
                {label:'All', value:0}
            ],
            // Search filter
            search: {name: ''},
            customFilter: Utils.customFilter,
            // Errors messages
            errors: {name: ''},
            // Company to create or update
            currentCompany: {
                name: '', 
                shortName: '',
                address: '',
                postalCode: '',
                city: '',
                logo: ''
            },
            // Name for update
            idUpdate: '',
            loading:false,
            // Creation in progress (double click protection)
            creating: false,
            // Companies whose deletion was sent (double confirmation protection), removed when the deletion fails
            deletedIds: [],
            // Number of the last loading of the list
            listRequest: 0
        }
    },

    mounted: function() {
        this.getCompanies()
    },

    unmounted: function() {
        // The answers of the loadings still pending are ignored once the page is left
        this.listRequest++
    },

    methods: {
        getCompanies: function() {
            this.loading = true
            // Several loadings may be pending (page opened, refresh after a change): only the last one is applied
            var request = ++this.listRequest
            CompanyService.getCompanies()
            .then((data) => {
                if (request !== this.listRequest)
                    return
                this.companies = data.data.datas
                this.loading = false
            })
            .catch((err) => {
                console.log(err)
                if (request !== this.listRequest)
                    return
                this.loading = false
                Notify.create({
                    message: this.errorMessage(err),
                    color: 'negative',
                    textColor: 'white',
                    position: 'top-right'
                })
            })
        },

        // Message of the server (the message of axios only says the status code), or of the network error
        errorMessage: function(err) {
            return (err.response && err.response.data && err.response.data.datas) || err.message
        },
        isBase64Image(logo) {
            return typeof logo === 'string' && logo.startsWith('data:image');
          },
        
          // Add the prefix if it's not already there
          getImageSrc(logo) {
            if (this.isBase64Image(logo)) {
              return logo;
            }
            // Adapt according to the actual format of your image (png, jpeg, etc.)
            return `data:image/png;base64,${logo}`;
          },
        createCompany: function() {
            // Double click or Enter pressed twice: the second request would be refused (company already exists)
            if (this.creating)
                return;
            this.cleanErrors();
            if (!this.currentCompany.name)
                this.errors.name = $t('msg.nameRequired');

            if (this.errors.name)
                return;

            this.creating = true;
            var created = this.currentCompany;
            CompanyService.createCompanies([this.currentCompany])
            .finally(() => {
                this.creating = false;
            })
            .then(() => {
                this.getCompanies();
                // Not when the page was left, nor when the dialog was opened again meanwhile (new object)
                if (this.$refs.createModal && this.currentCompany === created)
                    this.$refs.createModal.hide();
                Notify.create({
                    message: $t('msg.companyCreatedOk'),
                    color: 'positive',
                    textColor:'white',
                    position: 'top-right'
                })
            })
            .catch((err) => {
                Notify.create({
                    message: this.errorMessage(err),
                    color: 'negative',
                    textColor: 'white',
                    position: 'top-right'
                })
            })
        },

        updateCompany: function() {
            this.cleanErrors();
            if (!this.currentCompany.name)
                this.errors.name = $t('msg.nameRequired');

            if (this.errors.name)
                return;

            var updated = this.currentCompany;
            CompanyService.updateCompany(this.idUpdate, this.currentCompany)
            .then(() => {
                this.getCompanies();
                // Not when the page was left, nor when another company was opened meanwhile (new object)
                if (this.$refs.editModal && this.currentCompany === updated)
                    this.$refs.editModal.hide();
                Notify.create({
                    message: $t('msg.companyUpdatedOk'),
                    color: 'positive',
                    textColor:'white',
                    position: 'top-right'
                })
            })
            .catch((err) => {
                Notify.create({
                    message: this.errorMessage(err),
                    color: 'negative',
                    textColor: 'white',
                    position: 'top-right'
                })
            })
        },

        deleteCompany: function(companyId) {
            // A double click on the trash opens two confirmations: the company is deleted once
            if (this.deletedIds.includes(companyId))
                return;
            this.deletedIds.push(companyId);
            CompanyService.deleteCompany(companyId)
            .then(() => {
                this.getCompanies();
                Notify.create({
                    message: $t('msg.companyDeletedOk'),
                    color: 'positive',
                    textColor:'white',
                    position: 'top-right'
                })
            })
            .catch((err) => {
                this.deletedIds.splice(this.deletedIds.indexOf(companyId), 1);
                Notify.create({
                    message: this.errorMessage(err),
                    color: 'negative',
                    textColor: 'white',
                    position: 'top-right'
                })
            })
        },

        confirmDeleteCompany: function(company) {
            Dialog.create({
                title: $t('msg.confirmSuppression'),
                message: `${$t('company')} «${company.name}» ${$t('msg.deleteNotice')}`,
                ok: {label: $t('btn.confirm'), color: 'negative'},
                cancel: {label: $t('btn.cancel'), color: 'white'}
            })
            .onOk(() => this.deleteCompany(company._id))
        },

        clone: function(row) {
            this.cleanCurrentCompany();
            Object.assign(this.currentCompany, row);
            this.idUpdate = row._id;
        },

        cleanErrors: function() {
            this.errors.name = '';
        },

        // New object for each company opened: a logo still being read is written in the company it was added to
        cleanCurrentCompany: function() {
            this.currentCompany = {
                name: '',
                shortName: '',
                address: '',
                postalCode: '',
                city: '',
                logo: ''
            };
        },

        handleImage: function(files) {
            var file = files[0];
            var fileReader = new FileReader();
            // Read asynchronously: the dialog may have been closed and another company opened meanwhile
            var company = this.currentCompany;

            fileReader.onloadend = (e) => {
                company.logo = fileReader.result;
            }

            fileReader.readAsDataURL(file);
        },

        dblClick: function(evt, row) {
                this.clone(row)
                this.$refs.editModal.show()       
        }
    }
}