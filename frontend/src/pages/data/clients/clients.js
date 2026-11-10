import { Dialog, Notify } from 'quasar';

import ClientService from '@/services/client'
import CompanyService from '@/services/company'
import Utils from '@/services/utils'

import { $t } from '@/boot/i18n'

export default {
    data: () => {
        return {
            // clients list
            clients: [],
            // Loading state
            loading: true,
            // Companies list
            companies: [],
            // Datatable headers
            rows:[],
            dtHeaders: [
                {name: 'firstname', label: $t('firstname'), field: 'firstname', align: 'left', sortable: true},
                {name: 'lastname', label: $t('lastname'), field: 'lastname', align: 'left', sortable: true},
                {name: 'email', label: $t('email'), field: 'email', align: 'left', sortable: true},
                {name: 'company', label: $t('company'), field: row => (row.company)?row.company.name:'', align: 'left', sortable: true},
                {name: 'action', label: '', field: 'action', align: 'left', sortable: false},
            ],
            // Datatable pagination
            pagination: {
                page: 1,
                rowsPerPage: 25,
                sortBy: 'firstname'
            },
            rowsPerPageOptions: [
                {label:'25', value:25},
                {label:'50', value:50},
                {label:'100', value:100},
                {label:'All', value:0}
            ],
            // Search filter
            search: {firstname: '', lastname: '', email: '', 'company.name': ''},
            customFilter: Utils.customFilter,
            // Errors messages
            errors: {lastname: '', firstname: '', email: ''},
            // Selected or New Client
            currentClient: {
                lastname: '',
                firstname: '',
                email: '',
                phone: '',
                cell: '',
                title: '',
                company: {}
            },
            // Email to identify client to update
            idUpdate: '',
            // Creation in progress (double click protection)
            creating: false,
            // Clients whose deletion was sent (double confirmation protection), removed when the deletion fails
            deletedIds: [],
            // Number of the last loading of the list
            listRequest: 0
        }
    },

    mounted: function() {
        this.getClients();
        this.getCompanies();
    },

    unmounted: function() {
        // The answers of the loadings still pending are ignored once the page is left
        this.listRequest++;
    },

    methods: {
        getClients: function() {
            this.loading = true
            // Several loadings may be pending (page opened, refresh after a change): only the last one is applied
            var request = ++this.listRequest
            ClientService.getClients()
            .then((data) => {
                if (request !== this.listRequest)
                    return
                this.clients = data.data.datas
                this.rows = data.data.datas
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
                    textColor:'white',
                    position: 'top-right'
                })
            })
        },

        createClient: function() {
            // Double click or Enter pressed twice: the second request would be refused (client already exists)
            if (this.creating)
                return;
            this.cleanErrors();
            if (!this.currentClient.lastname)
                this.errors.lastname = $t('msg.lastnameRequired');
            if (!this.currentClient.firstname)
                this.errors.firstname = $t('msg.firstnameRequired');
            if (!this.currentClient.email)
                this.errors.email = $t('msg.emailRequired');
            
            if (this.errors.lastname || this.errors.firstname || this.errors.email)
                return;

            this.creating = true;
            var created = this.currentClient;
            ClientService.createClients([this.currentClient])
            .finally(() => {
                this.creating = false;
            })
            .then(() => {
                this.getClients();
                // Not when the page was left, nor when the dialog was opened again meanwhile (new object)
                if (this.$refs.createModal && this.currentClient === created)
                    this.$refs.createModal.hide();
                Notify.create({
                    message: $t('msg.clientCreatedOk'),
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

        updateClient: function() {
            this.cleanErrors();
            if (!this.currentClient.lastname)
                this.errors.lastname = $t('msg.lastnameRequired');
            if (!this.currentClient.firstname)
                this.errors.firstname = $t('msg.firstnameRequired');
            if (!this.currentClient.email)
                this.errors.email = $t('msg.emailRequired');
            
            if (this.errors.lastname || this.errors.firstname || this.errors.email)
                return;

            var updated = this.currentClient;
            ClientService.updateClient(this.idUpdate, this.currentClient)
            .then(() => {
                this.getClients();
                // Not when the page was left, nor when another client was opened meanwhile (new object)
                if (this.$refs.editModal && this.currentClient === updated)
                    this.$refs.editModal.hide();
                Notify.create({
                    message: $t('msg.clientUpdatedOk'),
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

        deleteClient: function(clientId) {
            // A double click on the trash opens two confirmations: the client is deleted once
            if (this.deletedIds.includes(clientId))
                return;
            this.deletedIds.push(clientId);
            ClientService.deleteClient(clientId)
            .then(() => {
                this.getClients();
                Notify.create({
                    message: $t('msg.clientDeletedOk'),
                    color: 'positive',
                    textColor:'white',
                    position: 'top-right'
                })
            })
            .catch((err) => {
                this.deletedIds.splice(this.deletedIds.indexOf(clientId), 1);
                Notify.create({
                    message: err.response.data.datas,
                    color: 'negative',
                    textColor:'white',
                    position: 'top-right'
                })
            })
        },

        confirmDeleteClient: function(client) {
            Dialog.create({
                title: $t('msg.confirmSuppression'),
                message: `${$t('client')} «${client.firstname} ${client.lastname}» ${$t('msg.deleteNotice')}`,
                ok: {label: $t('btn.confirm'), color: 'negative'},
                cancel: {label: $t('btn.cancel'), color: 'white'}
            })
            .onOk(() => this.deleteClient(client._id))
        },

        getCompanies: function() {
            CompanyService.getCompanies()
            .then((data) => {
                // this.companies = data.data.datas.map(company => {return {label: company.name, value: company.name}});
                this.companies = data.data.datas;
            })
            .catch((err) => {
                console.log(err)
            })
        },

        clone: function(row) {
            this.currentClient = this.$_.clone(row);
            this.idUpdate = row._id;
        },

        cleanErrors: function() {
            this.errors.lastname = '';
            this.errors.firstname = '';
            this.errors.email = '';
        },

        // New object for each opening: the answer of a request closes only the dialog of the client it was sent for
        cleanCurrentClient: function() {
            this.currentClient = {
                lastname: '',
                firstname: '',
                email: '',
                phone: '',
                cell: '',
                title: '',
                company: {name: ''}
            };
        },

        dblClick: function(evt, row) {
            this.clone(row)
            this.$refs.editModal.show()       
        }
    }
}