import { Dialog, Notify, QSpinnerGears } from 'quasar';

import AuditStateIcon from 'components/audit-state-icon'
import Breadcrumb from 'components/breadcrumb'

import AuditService from '@/services/audit'
import DataService from '@/services/data'
import CompanyService from '@/services/company'
import UserService from '@/services/user'

import { $t } from '@/boot/i18n'

export default {
    data: () => {
        return {
            UserService: UserService,
            // Audits list
            audits: [],
            // Loading state
            loading: true,
            // AuditTypes list
            auditTypes: [],
            // Companies list
            companies: [],
            // Languages availbable
            languages: [],
            showCreateModal: false,
            // Datatable headers
            dtHeaders: [
                { name: 'name', label: $t('name'), field: 'name', align: 'left', sortable: true },
                { name: 'company', label: $t('company'), field: row => row.company.name, align: 'left', sortable: true },
                { name: 'language', label: $t('language'), field: 'language', align: 'left', sortable: true },
                { name: 'users', label: $t('participants'), field: 'users', align: 'left', sortable: false },
                { name: 'date', label: $t('date'), field: 'date', align: 'left', sortable: true },
                { name: 'connected', label: $t('usersConnected'), field: 'connected', align: 'left', sortable: false },
                { name: 'reviews', label: $t('reviews'), field: 'reviews', align: 'left', sortable: false },
                { name: 'action', label: '', field: 'action', align: 'left', sortable: false }
              ],              
            visibleColumns: ['name', 'language', 'company', 'users', 'date', 'action'],
            // Datatable pagination
            pagination: {
                page: 1,
                rowsPerPage: 25,
                sortBy: 'date',
                descending: true,
                pagesNumber: 1
            },

            
            rowsPerPageOptions: [
                {label:'25', value:25},
                {label:'50', value:50},
                {label:'100', value:100},
                {label:'All', value:0}
            ],
            // Search filter
            search: {finding: '', name: '', language: '', company: '', users: '', date: ''},
            myAudits: false,
            displayConnected: false,
            displayReadyForReview: false,
            // Errors messages
            errors: {name: '', language: '', auditType: '', selectedAudit: ''},
            // Selected or New Audit
            currentAudit: {name: '', language: '', auditType: ''},
            // Clone existing report toggle
            cloneExistingReport: false,
            // Selected audit to clone
            selectedAuditToClone: null,
            // Available audits for cloning
            availableAuditsForCloning: []
        }
    },

    components: {
        AuditStateIcon,
        Breadcrumb
    },

    mounted: function() {
        this.search.finding = this.$route.params.finding;

        if (this.UserService.isAllowed('audits:users-connected'))
            this.visibleColumns.push('connected')
        if (this.$settings.reviews.enabled)
            this.visibleColumns.push('reviews')

        this.getAudits();
        this.getLanguages();
        this.getAuditTypes();
        this.getCompanies();
        this.getAvailableAuditsForCloning();
    },

    methods: {
        getLanguages: function() {
            DataService.getLanguages()
            .then((data) => {
                this.languages = data.data.datas;
            })
            .catch((err) => {
                console.log(err)
            })
        },

        getAuditTypes: function() {
            DataService.getAuditTypes()
            .then((data) => {
                this.auditTypes = data.data.datas
            })
            .catch((err) => {
                console.log(err)
            })
        },

         // Get Companies list
         getCompanies: function() {
            CompanyService.getCompanies()
            .then((data) => {
                this.companies = data.data.datas;
            })
            .catch((err) => {
                console.log(err)
            })
        },

        // Get available audits for cloning
        getAvailableAuditsForCloning: function() {
            AuditService.getAudits()
            .then((data) => {
                this.availableAuditsForCloning = data.data.datas;
            })
            .catch((err) => {
                console.log(err)
            })
        },

        // Filter audits for cloning
        filterAuditsForCloning: function(val, update) {
            if (val === '') {
                update(() => this.availableAuditsForCloning = this.audits)
                return
            }
            update(() => {
                const needle = val.toLowerCase()
                this.availableAuditsForCloning = this.audits.filter(v => 
                    v.name.toLowerCase().indexOf(needle) > -1 ||
                    (v.company && v.company.name && v.company.name.toLowerCase().indexOf(needle) > -1) ||
                    v.language.toLowerCase().indexOf(needle) > -1
                )
            })
        },

        getAudits: function() {
            this.loading = true
            AuditService.getAudits({findingTitle: this.search.finding})
            .then((data) => {
                this.audits = data.data.datas
      
                this.loading = false
            })
            .catch((err) => {
                console.log(err)
            })
        },
        formatDate(dateString) {
            if (!dateString) return '-';
            const date = new Date(dateString);
            return date.toLocaleDateString('fr-FR');
          },
        createAudit: function() {
            this.cleanErrors();
            
            if (this.cloneExistingReport) {
                // Mode clonage
                if (!this.currentAudit.name)
                    this.errors.name = "Name required";
                if (!this.selectedAuditToClone)
                    this.errors.selectedAudit = "Please select an audit to clone";
                
                if (this.errors.name || this.errors.selectedAudit)
                    return;

                // Create a cloned audit
                this.createClonedAudit();
            } else {
                // Normal creation mode
                this.currentAudit.auditType = this.currentAudit.auditType.name;
                if (!this.currentAudit.name)
                    this.errors.name = "Name required";
                if (!this.currentAudit.language)
                    this.errors.language = "Language required";
                if (!this.currentAudit.auditType)
                    this.errors.auditType = "Assessment required";
                    
                if (this.errors.name || this.errors.language || this.errors.auditType)
                    return;

                this.createNormalAudit();
            }
        },

        // Create a normal audit
        createNormalAudit: function() {
            AuditService.createAudit(this.currentAudit)
            .then((response) => {
                this.showCreateModal = false;
                this.getAudits();
                this.$router.push("/audits/" + response.data.datas.audit._id)
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

        // Create a cloned audit
        createClonedAudit: function() {
            AuditService.createClonedAudit(this.selectedAuditToClone, this.currentAudit.name)
            .then((response) => {
                this.showCreateModal = false;
                this.getAudits();
                this.$router.push("/audits/" + response.data.datas.audit._id)
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

        deleteAudit: function(uuid) {
            AuditService.deleteAudit(uuid)
            .then(() => {
                this.getAudits();
                Notify.create({
                    message: 'Audit deleted successfully',
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

        confirmDeleteAudit: function(audit) {
            Dialog.create({
                title: 'Confirm Suppression',
                message: `Audit «${audit.name}» will be permanently deleted`,
                ok: {label: 'Confirm', color: 'negative'},
                cancel: {label: 'Cancel', color: 'white'}
            })
            .onOk(() => this.deleteAudit(audit._id))
        },

        // Convert blob to text
        BlobReader: function(data) {
            const fileReader = new FileReader();

            return new Promise((resolve, reject) => {
                fileReader.onerror = () => {
                    fileReader.abort()
                    reject(new Error('Problem parsing blob'));
                }

                fileReader.onload = () => {
                    resolve(fileReader.result)
                }

                fileReader.readAsText(data)
            })
        },

        generateReport: function(auditId) {
            var downloadNotif = Notify.create({
                spinner: QSpinnerGears,
                message: 'Generating the Report',
                color: "blue",
                timeout: 0,
                group: false
            })
            AuditService.generateAuditReport(auditId)
            .then(response => {
                var blob = new Blob([response.data], {type: "application/octet-stream"});
                var link = document.createElement('a');
                link.href = window.URL.createObjectURL(blob);
                link.download = decodeURIComponent(response.headers['content-disposition'].split('"')[1]);
                document.body.appendChild(link);
                link.click();
                link.remove();

                downloadNotif({
                    icon: 'done',
                    spinner: false,
                    message: 'Report successfully generated',
                    color: 'green',
                    timeout: 2500
                })
              })
            .catch( async err => {
                var message = "Error generating template"
                if (err.response && err.response.data) {
                    var blob = new Blob([err.response.data], {type: "application/json"})
                    var blobData = await this.BlobReader(blob)
                    message = JSON.parse(blobData).datas
                }
                downloadNotif()
                Notify.create({
                    message: message,
                    type: 'negative',
                    textColor:'white',
                    position: 'top',
                    closeBtn: true,
                    timeout: 0,
                    classes: "text-pre-wrap"
                })
            })
        },

        cleanErrors: function() {
            this.errors.name = '';
            this.errors.language = '';
            this.errors.auditType = '';
            this.errors.selectedAudit = '';
        },

        cleanCurrentAudit: function() {
            this.cleanErrors();
            this.currentAudit.name = '';
            this.currentAudit.language = '';
            this.currentAudit.auditType = '';
            this.cloneExistingReport = false;
            this.selectedAuditToClone = null;
        },

        // Convert language locale of audit for table display
        convertLocale: function(locale) {
            for (var i=0; i<this.languages.length; i++)
                if (this.languages[i].locale === locale)
                    return this.languages[i].language;
            return ""
        },

        convertParticipants: function(row) {
            var collabs = (row.collaborators)? row.collaborators: [];
            var result = (row.creator)? [row.creator.username]: [];
            collabs.forEach(collab => result.push(collab.username));
            return result.join(', '); 
        },

        customFilter: function(rows, terms, cols, getCellValue) {
            var username = this.UserService.user.username.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")

            var nameTerm = (terms.name || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
            var languageTerm = (terms.language)? terms.language.toLowerCase(): ""
            var companyTerm = (terms.company)? terms.company.toLowerCase(): ""
            var usersTerm = (terms.users || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
            var dateTerm = (terms.date)? terms.date.toLowerCase(): ""

            return rows && rows.filter(row => {
                var name = (row.name || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
                var language = (row.language)? row.language.toLowerCase(): ""
                var companyName = (row.company)? row.company.name.toLowerCase(): ""
                var users = this.convertParticipants(row).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
                var date = (row.createdAt)? row.createdAt.split('T')[0]: "";

                return name.indexOf(nameTerm) > -1 &&
                    language.indexOf(languageTerm) > -1 &&
                    (!companyTerm || companyTerm === companyName) &&
                    users.indexOf(usersTerm) > -1 &&
                    date.indexOf(dateTerm) > -1 &&
                    ((this.myAudits && users.indexOf(username) > -1) || !this.myAudits) &&
                    ((this.displayConnected && row.connected && row.connected.length > 0) || !this.displayConnected) &&
                    ((this.displayReadyForReview && users.indexOf(username) < 0 && row.state === 'REVIEW') || !this.displayReadyForReview)
            })
        },

        dblClick: function(evt, row) {
            if(typeof row !== 'undefined' && typeof row._id !== 'undefined') this.$router.push('/audits/'+row._id+'/general')
            else if(typeof evt !== 'undefined' && typeof evt._id !== 'undefined') this.$router.push('/audits/'+evt._id+'/general')
        }
    }
}
