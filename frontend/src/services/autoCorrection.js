/**
 * Service de correction automatique
 * Gère l'activation/désactivation de la correction automatique
 */

class AutoCorrectionService {
    constructor() {
        this.isEnabled = this.loadSetting();
    }

    /**
     * Charge le paramètre de correction automatique depuis le sessionStorage
     * @returns {boolean} true si activé, false sinon
     */
    loadSetting() {
        const setting = sessionStorage.getItem('autoCorrectionEnabled');
        // Par défaut, la correction automatique est activée (true)
        // Si une valeur est stockée, on l'utilise, sinon on retourne true
        return setting !== null ? setting === 'true' : true;
    }

    /**
     * Sauvegarde le paramètre de correction automatique dans le sessionStorage
     * @param {boolean} enabled - true pour activer, false pour désactiver
     */
    saveSetting(enabled) {
        this.isEnabled = enabled;
        sessionStorage.setItem('autoCorrectionEnabled', enabled.toString());
    }

    /**
     * Vérifie si la correction automatique est activée
     * @returns {boolean} true si activé, false sinon
     */
    isAutoCorrectionEnabled() {
        return this.isEnabled;
    }

    /**
     * Active la correction automatique
     */
    enable() {
        this.saveSetting(true);
    }

    /**
     * Désactive la correction automatique
     */
    disable() {
        this.saveSetting(false);
    }
}

// Export d'une instance singleton
export default new AutoCorrectionService();
