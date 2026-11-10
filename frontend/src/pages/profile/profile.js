import { Dialog, Notify } from 'quasar'
import { nextTick } from 'vue';

import UserService from '@/services/user'
import Utils from '@/services/utils'
import AutoCorrectionService from '@/services/autoCorrection'

import { $t } from 'boot/i18n'

export default {
    data: () => {
        return {
            // Form locked until the profile is loaded: the answer replaces the whole user
            loading: true,
            user: {},
            totpEnabled: false,
            // Number of the last QR code request: the answers of the older ones (or of a toggle switched off since) are ignored
            totpQrcodeRequest: 0,
            totpQrcode: "",
            totpSecret: "",
            totpToken: "",
            // Requests in progress (double click protection)
            updating: false,
            totpUpdating: false,
            autoCorrectionEnabled: false,
            errors: {username: "", firstname:"", lastname: "", currentPassword: "", newPassword: ""}
        }
    },

    mounted: function() {
        this.getProfile();
        this.loadAutoCorrectionSetting();
    },

    methods: {
        getProfile: function() {
            UserService.getProfile()
            .then((data) => {
                this.user = data.data.datas;
                this.totpEnabled = this.user.totpEnabled;
                this.loading = false;
                // If 2FA is already enabled, retrieve the QR code
                if(this.user.totpEnabled) {
                    this.showExistingTotpQrCode();
                }
            })
            .catch((err) => {
                // The form stays locked (nothing to update without the profile): the user is told why
                Notify.create({
                    message: this.errorMessage(err),
                    color: 'negative',
                    textColor: 'white',
                    position: 'top-right'
                })
            })
        },

        // Message of the server, or of the network error (no answer)
        errorMessage: function(err) {
            return (err.response && err.response.data && err.response.data.datas) || err.message
        },

        loadAutoCorrectionSetting: function() {
            // Reverse the logic: the toggle is checked when correction is disabled
            this.autoCorrectionEnabled = !AutoCorrectionService.isAutoCorrectionEnabled();
        },

        toggleAutoCorrection: function() {
            // Reverse the logic: if the toggle is checked, we disable correction
            if (this.autoCorrectionEnabled) {
                AutoCorrectionService.disable();
            } else {
                AutoCorrectionService.enable();
            }
            
            // Notify all active editors to update their LanguageTool state
            this.notifyEditorsUpdate();
        },

        notifyEditorsUpdate: function() {
            // Emit a custom event that editors can listen to
            window.dispatchEvent(new CustomEvent('autoCorrectionToggleChanged', {
                detail: {
                    enabled: !this.autoCorrectionEnabled
                }
            }));
        },

        getTotpQrcode: function() {
            console.log('=== getTotpQrcode called ===');
            console.log('Current state:', {
                totpEnabled: this.totpEnabled,
                userTotpEnabled: this.user.totpEnabled,
                currentQrCode: this.totpQrcode ? 'Present' : 'Not present'
            });

            var request = ++this.totpQrcodeRequest;
            // If the toggle is enabled, we ALWAYS retrieve the QR code
            if (this.totpEnabled) {
                console.log('Toggle is ON - fetching QR code...');
                UserService.getTotpQrCode()
                .then((data) => {
                    // Toggle switched off or QR code requested again meanwhile: the secret would not be the one shown
                    if (request !== this.totpQrcodeRequest)
                        return;
                    let res = data.data.datas;
                    console.log('QR code received successfully:', {
                        hasQrCode: !!res.totpQrCode,
                        hasSecret: !!res.totpSecret,
                        secretLength: res.totpSecret ? res.totpSecret.length : 0
                    });
                    
                    this.totpQrcode = res.totpQrCode;
                    this.totpSecret = res.totpSecret;
                    
                    console.log('State updated:', {
                        totpQrcode: this.totpQrcode ? 'Present' : 'Not present',
                        totpSecret: this.totpSecret ? 'Present' : 'Not present'
                    });

                    // Focus sur l'input si c'est une activation
                    if (!this.user.totpEnabled && this.$refs.totpEnableInput) {
                        console.log('Focusing on enable input...');
                        this.$refs.totpEnableInput.focus();
                    }
                })
                .catch((err) => {
                    if (request !== this.totpQrcodeRequest)
                        return;
                    console.error('Error getting QR code:', err);
                    Notify.create({
                        message: 'Failed to get TOTP QR code: ' + (err.response?.data?.datas || err.message || 'Unknown error'),
                        color: 'negative',
                        textColor: 'white',
                        position: 'top-right'
                    });
                });
            } else {
                // Toggle disabled - reset values
                console.log('Toggle is OFF - resetting values...');
                this.totpQrcode = "";
                this.totpSecret = "";
                this.totpToken = "";
                
                // Focus on the disable input if necessary
                if (this.user.totpEnabled && this.$refs.totpDisableInput) {
                    console.log('Focusing on disable input...');
                    nextTick(() => {
                        this.$refs.totpDisableInput.focus();
                    });
                }
            }
        },

        // Method to display existing QR code
        showExistingTotpQrCode: function() {
            var request = ++this.totpQrcodeRequest;
            UserService.getTotpQrCode()
            .then((data)=>{
                // Hidden or toggle switched off meanwhile
                if (request !== this.totpQrcodeRequest)
                    return;
                let res = data.data.datas;
                this.totpQrcode = res.totpQrCode;
                this.totpSecret = res.totpSecret;
            })
            .catch((err)=>{
                console.log(err);
            })
        },

        // Method to hide the QR code
        hideTotpQrCode: function() {
            this.totpQrcodeRequest++;
            this.totpQrcode = "";
            this.totpSecret = "";
        },

        // The secret and the token are never logged (nor the axios answers and errors, which contain the request): they
        // would give the second factor to anyone reading the console
        setupTotp: function() {
            // Double click or Enter pressed twice: the second request would be refused after the success
            if (this.totpUpdating)
                return;
            if (!this.totpSecret) {
                console.error('No TOTP secret available!');
                Notify.create({
                    message: 'TOTP secret not available. Please try toggling 2FA again.',
                    color: 'negative',
                    textColor: 'white',
                    position: 'top-right'
                });
                return;
            }

            this.totpUpdating = true;
            UserService.setupTotp(this.totpToken, this.totpSecret)
            .finally(() => {
                this.totpUpdating = false;
            })
            .then((data)=>{
                // Check if the backend returned an error
                if (data.data && data.data.status === 'error') {
                    console.error('Backend returned error:', data.data.datas);
                    Notify.create({
                        message: 'TOTP verification failed: ' + data.data.datas,
                        color: 'negative',
                        textColor: 'white',
                        position: 'top-right'
                    });
                    return;
                }
                
                // If we get here, it's a success
                console.log('TOTP setup successful');
                this.user.totpEnabled = true;
                this.totpToken = "";
                Notify.create({
                    message: 'TOTP successfully enabled',
                    color: 'positive',
                    textColor:'white',
                    position: 'top-right'
                })
            })
            .catch((err)=>{
                let errorMessage = 'TOTP verification failed';
                
                // Essayer d'extraire le message d'erreur du backend
                if (err.response && err.response.data && err.response.data.datas) {
                    errorMessage += ': ' + err.response.data.datas;
                } else if (err.message) {
                    errorMessage += ': ' + err.message;
                }
                
                Notify.create({
                    message: errorMessage,
                    color: 'negative',
                    textColor: 'white',
                    position: 'top-right'
                })
            })
        },

        cancelTotp: function() {
            // Double click or Enter pressed twice: the second request would be refused after the success
            if (this.totpUpdating)
                return;
            this.totpUpdating = true;
            UserService.cancelTotp(this.totpToken)
            .finally(() => {
                this.totpUpdating = false;
            })
            .then((data)=>{
                // Check if the backend returned an error
                if (data.data && data.data.status === 'error') {
                    console.error('Backend returned error:', data.data.datas);
                    Notify.create({
                        message: 'Failed to cancel TOTP: ' + data.data.datas,
                        color: 'negative',
                        textColor: 'white',
                        position: 'top-right'
                    });
                    return;
                }
                
                // If we get here, it's a success
                console.log('TOTP cancel successful');
                this.user.totpEnabled = false;
                this.totpToken = "";
                Notify.create({
                    message: 'TOTP successfully disabled',
                    color: 'positive',
                    textColor:'white',
                    position: 'top-right'
                })
            })
            .catch((err)=>{
                let errorMessage = 'TOTP verification failed';
                
                // Essayer d'extraire le message d'erreur du backend
                if (err.response && err.response.data && err.response.data.datas) {
                    errorMessage += ': ' + err.response.data.datas;
                } else if (err.message) {
                    errorMessage += ': ' + err.message;
                }
                
                Notify.create({
                    message: errorMessage,
                    color: 'negative',
                    textColor: 'white',
                    position: 'top-right'
                })
            })
        },

        updateProfile: function() {
            // Double click or Enter pressed twice: after a password change, the second request would be refused
            if (this.updating)
                return;
            this.cleanErrors();
            if (!this.user.username)
                this.errors.username = $t('msg.usernameRequired');
            if (!this.user.firstname)
                this.errors.firstname = $t('msg.firstnameRequired');
            if (!this.user.lastname)
                this.errors.lastname = $t('msg.lastnameRequired');
            if (!this.user.currentPassword)
                this.errors.currentPassword = $t('msg.currentPasswordRequired');
            if (this.user.newPassword || this.user.confirmPassword) {
                if (!Utils.strongPassword(this.user.newPassword))
                    this.errors.newPassword = $t('msg.passwordComplexity');
                if (this.user.newPassword !== this.user.confirmPassword)
                    this.errors.newPassword = $t('msg.confirmPasswordDifferents');
            }
        
            if (this.errors.username || this.errors.firstname || this.errors.lastname || this.errors.currentPassword || this.errors.newPassword)
                return;

            this.updating = true;
            // Copy: the passwords of the form are cleared at the answer
            UserService.updateProfile({...this.user})
            .finally(() => {
                this.updating = false;
            })
            .then((data) => {
                // Passwords not kept in the form: after a change, the old one would be sent (and refused) at the next update
                this.user.currentPassword = '';
                this.user.newPassword = '';
                this.user.confirmPassword = '';
                UserService.refreshToken()
                Notify.create({
                    message: $t('msg.profileUpdateOk'),
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

        cleanErrors: function() {
            this.errors.username = '';
            this.errors.firstname = '';
            this.errors.lastname = '';
            this.errors.currentPassword = '';
            this.errors.newPassword = '';
        }
    }
}
