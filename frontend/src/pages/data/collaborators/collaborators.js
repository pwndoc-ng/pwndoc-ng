import { Dialog, Notify } from 'quasar';

import CollabService from '@/services/collaborator'
import UserService from '@/services/user'
import DataService from '@/services/data'
import Utils from '@/services/utils'

import { $t } from '@/boot/i18n'

export default {
    data: () => {
        return {
            UserService: UserService,
            // Collaborators list
            collabs: [],
            // Loading state
            loading: true,
            // Datatable headers

            dtHeaders: [
                {name: 'username', label: $t('username'), field: 'username', align: 'left', sortable: true},
                {name: 'firstname', label: $t('firstname'), field: 'firstname', align: 'left', sortable: true},
                {name: 'lastname', label: $t('lastname'), field: 'lastname', align: 'left', sortable: true},
                {name: 'email', label: $t('email'), field: 'email', align: 'left', sortable: true},
                {name: 'role', label: $t('role'), field: 'role', align: 'left', sortable: true},
                {name: 'action', label: '', field: 'action', align: 'left', sortable: false},
            ],
            // Datatable pagination
            pagination: {
                page: 1,
                rowsPerPage: 25,
                sortBy: 'username'
            },
            rowsPerPageOptions: [
                {label:'25', value:25},
                {label:'50', value:50},
                {label:'100', value:100},
                {label:'All', value:0}
            ],
            // Search filter
            search: {username: '', firstname: '', lastname: '', role: '', email: '', enabled: true},
            customFilter: Utils.customFilter,
            // Errors messages
            errors: {lastname: '', firstname: '', username: '', password: ''},
            // Collab to create or update
            currentCollab: {
                lastname: '', 
                firstname: '', 
                username: '',
                role: '',
                email: '',
                phone: '',
                password: '',
                totpEnabled: false
            },
            // Username to identify collab to update
            idUpdate: '',
            // List of roles
            roles: [],
            // Creation in progress (double click protection)
            creating: false,
            // Number of the last loading of the list
            listRequest: 0
        }
    },

    mounted: function() {
        this.getCollabs()
        this.getRoles()
    },

    unmounted: function() {
        // The answers of the loadings still pending are ignored once the page is left
        this.listRequest++
    },

    methods: {
        getCollabs: function() {
            this.loading = true
            // Several loadings may be pending (page opened, refresh after a change): only the last one is applied
            var request = ++this.listRequest
            CollabService.getCollabs()
            .then((data) => {
                if (request !== this.listRequest)
                    return
                this.collabs = data.data.datas
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

        createCollab: function() {
            // Double click or Enter pressed twice: the second request would be refused (username already exists)
            if (this.creating)
                return;
            this.cleanErrors();
            if (!this.currentCollab.lastname)
                this.errors.lastname = $t('msg.lastnameRequired');
            if (!this.currentCollab.firstname)
                this.errors.firstname = $t('msg.firstnameRequired');
            if (!this.currentCollab.username)
                this.errors.username = $t('msg.usernameRequired');
            if (!Utils.strongPassword(this.currentCollab.password))
                this.errors.password = $t('msg.passwordComplexity')

            if (this.errors.lastname || this.errors.firstname || this.errors.username || this.errors.password)
                return;

            this.creating = true;
            var created = this.currentCollab;
            CollabService.createCollab([this.currentCollab])
            .finally(() => {
                this.creating = false;
            })
            .then(() => {
                this.getCollabs();
                // Not when the page was left, nor when the dialog was opened again meanwhile (new object)
                if (this.$refs.createModal && this.currentCollab === created)
                    this.$refs.createModal.hide();
                Notify.create({
                    message: $t('msg.collaboratorCreatedOk'),
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

        updateCollab: function() {
            this.cleanErrors();
            if (!this.currentCollab.lastname)
                this.errors.lastname = $t('msg.lastnameRequired');
            if (!this.currentCollab.firstname)
                this.errors.firstname = $t('msg.firstnameRequired');
            if (!this.currentCollab.username)
                this.errors.username = $t('msg.usernameRequired');
            // The password is optional in the update: checked and sent only when given
            if (this.currentCollab.password && !Utils.strongPassword(this.currentCollab.password))
                this.errors.password = $t('msg.passwordComplexity')

            if (this.errors.lastname || this.errors.firstname || this.errors.username || this.errors.password)
                return;

            // A password typed then erased is empty (or null when cleared): sent, it would replace the password of the user
            var collab = this.$_.clone(this.currentCollab);
            if (!collab.password)
                delete collab.password;
            var updated = this.currentCollab;
            CollabService.updateCollab(this.idUpdate, collab)
            .then(() => {
                this.getCollabs();
                // Not when the page was left, nor when another user was opened meanwhile (new object)
                if (this.$refs.editModal && this.currentCollab === updated)
                    this.$refs.editModal.hide();
                Notify.create({
                    message: $t('msg.collaboratorUpdatedOk'),
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

        getRoles: function() {
            DataService.getRoles()
            .then((data) => {
                this.roles = data.data.datas
           
            })
            .catch((err) => {
                console.log(err)
            })
        },

        clone: function(row) {
            this.currentCollab = this.$_.clone(row);
            this.idUpdate = row._id;
        },

        cleanErrors: function() {
            this.errors.lastname = '';
            this.errors.firstname = '';
            this.errors.username = '';
            this.errors.password = '';
        },

        // New object for each opening: the answer of a request closes only the dialog of the user it was sent for
        cleanCurrentCollab: function() {
            this.currentCollab = {
                lastname: '',
                firstname: '',
                username: '',
                role: 'user',
                email: '',
                phone: '',
                password: '',
                totpEnabled: false
            };
        },

        dblClick: function(evt, row) {
            if (this.UserService.isAllowed('users:update')) {
                this.clone(row)
                this.$refs.editModal.show()  
            }     
        }
    }
}