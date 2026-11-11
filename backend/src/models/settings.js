var mongoose = require('mongoose');//.set('debug', true);
var Schema = mongoose.Schema;
var fs = require('fs');
var _ = require('lodash');
var Utils = require('../lib/utils.js');

// https://stackoverflow.com/questions/25822289/what-is-the-best-way-to-store-color-hex-values-in-mongodb-mongoose
const colorValidator = (v) => (/^#([0-9a-f]{3}){1,2}$/i).test(v);

const SettingSchema = new Schema({
    report: { 
        enabled: {type: Boolean, default: true},
        public: {
            cvssColors: {
                noneColor: { type: String, default: "#4a86e8", validate: [colorValidator, 'Invalid color'] },
                lowColor: { type: String, default: "#008000", validate: [colorValidator, 'Invalid color'] },
                mediumColor: { type: String, default: "#f9a009", validate: [colorValidator, 'Invalid color'] },
                highColor: { type: String, default: "#fe0000", validate: [colorValidator, 'Invalid color'] },
                criticalColor: { type: String, default: "#212121", validate: [colorValidator, 'Invalid color'] }
            },
            remediationColorsComplexity: {
                lowColor: { type: String, default: "#4472c4", validate: [colorValidator, 'Invalid color'] },
                mediumColor: { type: String, default: "#ffc000", validate: [colorValidator, 'Invalid color'] },
                highColor: { type: String, default: "#FF2F2F", validate: [colorValidator, 'Invalid color'] }
            },
            remediationColorsPriority: {
                lowColor: { type: String, default: "#4472c4", validate: [colorValidator, 'Invalid color'] },
                mediumColor: { type: String, default: "#ffc000", validate: [colorValidator, 'Invalid color'] },
                highColor: { type: String, default: "#ff2f2f", validate: [colorValidator, 'Invalid color'] },
                urgentColor: { type: String, default: "#C00000", validate: [colorValidator, 'Invalid color'] }
            },
            captions: {
                type: [{type: String, unique: true}],
                default: ['Figure']
            },
            extendCvssTemporalEnvironment: {
                type: Boolean,
                default: false
            },
            // Text template of findings in the audit sidebar, e.g. "{identifier} - {title} [{custom.Asset}]"
            findingSidebarTemplate: { type: String, default: '{title}', maxlength: 500 },
            // Width of editor images without explicit width (large: between page margins)
            imageDefaultWidth: { type: String, enum: ['small', 'medium', 'large'], default: 'large' }
        },
        private: {
            imageBorder: { type: Boolean, default: false },
            imageBorderColor: { type: String, default: "#000000", validate: [colorValidator, 'Invalid color'] }
        }
     },
    reviews: {
        enabled: { type: Boolean, default: false },
        public: {
            mandatoryReview: { type: Boolean, default: false },
            minReviewers: { type: Number, default: 1, min: 1, max: 100, validate: [Number.isInteger, 'Invalid integer'] },
            // Approving an audit requires all its review comments to be resolved
            blockApprovalWithOpenComments: { type: Boolean, default: false }
        },
        private: {
            removeApprovalsUponUpdate: { type: Boolean, default: false }
        }
    },
    danger: {
      enabled: { type: Boolean, default: false },
      public: {
        nbdaydelete: { type: Number, default: 1, min: 1, max: 365, validate: [Number.isInteger, 'Invalid integer'] }
      },
      private: {}
     },
    // Automatic backups of all the data (lib/backup-schedule.js), on the days and at the time of the server, then rotation:
    // the keepDaily most recent automatic backups are kept, and the most recent one of each of the keepWeekly previous weeks
    // (weeks ending on weeklyDay). Days: 0 (Sunday) to 6 (Saturday)
    backups: {
        enabled: { type: Boolean, default: false },
        private: {
            time: { type: String, default: '02:00', validate: [time => /^([01]\d|2[0-3]):[0-5]\d$/.test(time), 'Invalid time'] },
            days: {
                type: [{ type: Number, min: 0, max: 6, validate: [Number.isInteger, 'Invalid integer'] }],
                default: [1, 2, 3, 4, 5],
                validate: [days => new Set(days).size === days.length, 'Invalid days']
            },
            keepDaily: { type: Number, default: 5, min: 1, max: 366, validate: [Number.isInteger, 'Invalid integer'] },
            keepWeekly: { type: Number, default: 2, min: 0, max: 520, validate: [Number.isInteger, 'Invalid integer'] },
            weeklyDay: { type: Number, default: 5, min: 0, max: 6, validate: [Number.isInteger, 'Invalid integer'] }
        }
    }
}, {strict: true});

// Get all settings
SettingSchema.statics.getAll = () => {
    return new Promise((resolve, reject) => {
        const query = Settings.findOne({});
        query.select('-_id -__v');
        query.exec()
            .then(settings => {
                resolve(settings)
            })
            .catch(err => reject(err));
    });
};

// Get public settings
SettingSchema.statics.getPublic = () => {
    return new Promise((resolve, reject) => {
        const query = Settings.findOne({});
        query.select('-_id report.enabled report.public reviews.enabled reviews.public danger.enabled danger.public');
        query.exec()
            .then(settings => resolve(settings))
            .catch(err => reject(err));
    });
};

// Values of the input by path of the schema ('reviews.public.minReviewers'): the sections (nested paths) are followed, any
// other value (number, string, list, object given for a value) is a value. Keys of the prototype and keys of operators
// ($unset...) are ignored
function settingValues(input, prefix = '') {
    return Object.keys(input).filter(key => !['__proto__', 'constructor', 'prototype'].includes(key) && !key.startsWith('$')).flatMap(key => {
        var path = prefix + key;
        if (SettingSchema.pathType(path) === 'nested' && Utils.isObject(input[key]))
            return settingValues(input[key], `${path}.`);
        return [[path, input[key]]];
    });
}

// Update Settings: the given values only (a section given partially keeps its other settings: set() of a whole section put
// back the default values of the others), in one update with the validators (concurrent updates: the last one wins for
// each value). Values of the input are cast to the type of their path (paths of the schema only): MongoDB operators of the
// input ($unset, $rename...) are not executed
SettingSchema.statics.update = async (settings) => {
    var values = Object.fromEntries(settingValues(settings));
    return Settings.findOneAndUpdate({}, {$set: values}, {new: true, upsert: true, runValidators: true});
};


// Restore settings to default
SettingSchema.statics.restoreDefaults = () => {
    return new Promise((resolve, reject) => {
        const query = Settings.deleteMany({});
        query.exec()
            .then(_ => {
                const query = new Settings({});
                query.save()
                    .then(_ => resolve("Restored default settings."))
                    .catch(err => reject(err));
            })
            .catch(err => reject(err));
    });
};

const Settings = mongoose.model('Settings', SettingSchema);

// Populate/update settings when server starts, once the database is connected
Utils.whenConnected('Initialization of the settings', async () => {
  var liveSettings = await Settings.findOne();
  if (!liveSettings) {
    console.log("Initializing Settings");
    await Settings.create({});
    return;
  }
  var needUpdate = false
  var liveSettingsPaths = Utils.getObjectPaths(liveSettings.toObject())

  liveSettingsPaths.forEach(path => {
      if (!SettingSchema.path(path) && !path.startsWith('_')) {
          needUpdate = true
          _.set(liveSettings, path, undefined)
      }
  })

  if (needUpdate) {
      console.log("Removing unused fields from Settings")
      await liveSettings.save()
  }
});

module.exports = Settings;
