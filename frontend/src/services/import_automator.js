
export default {
  updateImporterDB: function(pwndoc_template_id) {
    return fetch(`/import_automator/templates/update_db/${pwndoc_template_id}`);
  },

  triggerImporterDBUpdateForTemplate(templateID){
    this.updateImporterDB(templateID).catch((err) => {
        Notify.create({
            message: err.response.data.datas,
            color: 'negative',
            textColor: 'white',
            position: 'top-right'
        })
    });
  },

  getFindingSeverityCustom: function(finding, locale){
    try {
      let customFields = finding?.customFields ? finding?.customFields : finding.details[0].customFields;
      let severity_label_field = customFields.filter((el) => el.customField.label === 'severity_label')[0];

      let text_severity = severity_label_field.text;
      let all_options = severity_label_field.customField.options;
      
      let severity_index = all_options.filter((el) => el.locale === locale).map(x => x.value).indexOf(text_severity);
      let unified_severity_level = this.unifiedSeverityLevels()[severity_index];

      return unified_severity_level;
    } catch (e){
      return undefined;
    }
  },

  unifiedSeverityLevels: function(){
    return ['none', 'low', 'medium', 'high', 'critical'];
  },
  
  unifiedSeverityToEquivalentCVSSString: function(unified_severity_string){
    let levels = {
      critical: 	"CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H",
      high: 		"CVSS:3.1/AV:P/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H",
      medium: 	"CVSS:3.1/AV:P/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
      low: 		"CVSS:3.1/AV:P/AC:H/PR:H/UI:R/S:U/C:N/I:L/A:N",
      none: 		"CVSS:3.1/AV:P/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N",
    };
    return levels[unified_severity_string];
  },

  setFakeCVSS: function(finding, locale){
    let customSeverity = this.getFindingSeverityCustom(finding, locale);
    if (customSeverity !== undefined) {
      finding.cvssv3 = this.unifiedSeverityToEquivalentCVSSString(customSeverity); // finding.cvssv3 might get overwriten later
    }
  },

}
