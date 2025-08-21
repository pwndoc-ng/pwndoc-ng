/**
 * Auto correction service
 * Manages activation/deactivation of auto correction
 */

class AutoCorrectionService {
    constructor() {
        this.isEnabled = this.loadSetting();
    }

    /**
     * Loads the auto correction setting from sessionStorage
     * @returns {boolean} true if enabled, false otherwise
     */
    loadSetting() {
        const setting = sessionStorage.getItem('autoCorrectionEnabled');
        // By default, auto correction is enabled (true)
        // If a value is stored, we use it, otherwise we return true
        return setting !== null ? setting === 'true' : true;
    }

    /**
     * Saves the auto correction setting in sessionStorage
     * @param {boolean} enabled - true to enable, false to disable
     */
    saveSetting(enabled) {
        this.isEnabled = enabled;
        sessionStorage.setItem('autoCorrectionEnabled', enabled.toString());
    }

    /**
     * Checks if auto correction is enabled
     * @returns {boolean} true if enabled, false otherwise
     */
    isAutoCorrectionEnabled() {
        return this.isEnabled;
    }

    /**
     * Enables auto correction
     */
    enable() {
        this.saveSetting(true);
    }

    /**
     * Disables auto correction
     */
    disable() {
        this.saveSetting(false);
    }
}

// Export a singleton instance
export default new AutoCorrectionService();
