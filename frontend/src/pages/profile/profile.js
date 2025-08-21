import { Dialog, Notify } from 'quasar'
import Vue, { nextTick } from 'vue';

import UserService from '@/services/user'
import Utils from '@/services/utils'
import AutoCorrectionService from '@/services/autoCorrection'

import { $t } from 'boot/i18n'

export default {
    data: () => {
        return {
            user: {},
            totpEnabled: false,
            totpQrcode: "",
            totpSecret: "",
            totpToken: "",
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
                // If 2FA is already enabled, retrieve the QR code
                if(this.user.totpEnabled) {
                    this.showExistingTotpQrCode();
                }
            })
            .catch((err) => {
                console.log(err)
            })
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

            // If the toggle is enabled, we ALWAYS retrieve the QR code
            if (this.totpEnabled) {
                console.log('Toggle is ON - fetching QR code...');
                UserService.getTotpQrCode()
                .then((data) => {
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
            UserService.getTotpQrCode()
            .then((data)=>{
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
            this.totpQrcode = "";
            this.totpSecret = "";
        },

        setupTotp: function() {
            console.log('setupTotp called with:', {
                totpToken: this.totpToken,
                totpSecret: this.totpSecret,
                currentQrCode: this.totpQrcode
            });

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

            UserService.setupTotp(this.totpToken, this.totpSecret)
            .then((data)=>{
                console.log('TOTP setup response:', data);
                
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
                console.error('TOTP setup HTTP error:', err);
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
            UserService.cancelTotp(this.totpToken)
            .then((data)=>{
                console.log('TOTP cancel response:', data);
                
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
                console.error('TOTP cancel HTTP error:', err);
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

            UserService.updateProfile(this.user)
            .then((data) => {
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
                    message: err.response.data.datas,
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
