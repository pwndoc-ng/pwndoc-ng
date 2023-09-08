var cron = require('node-cron');
var Settings = require('mongoose').model('Settings');
var Audit = require('mongoose').model('Audit');

async function deleteOutdatedReportAutomation() {
  var settings = await Settings.getAll();
  if (settings.danger.enabled) {
    Audit.deleteOutdatedReportAutomation(settings.danger.public.nbdaydelete)
  }
}

function cronJobs() {
  // cron every day at 12:00  
  cron.schedule('0 12 * * *', () => {
    deleteOutdatedReportAutomation();
  });
}

exports.cronJobs = cronJobs;