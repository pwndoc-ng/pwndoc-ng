// Automatic backups (settings: backups): a full backup on the selected days, once the time of the settings is reached (time of
// the server: TZ environment variable, UTC by default), then the rotation of the automatic backups:
//   kept: the keepDaily most recent automatic backups, and the most recent one of each of the keepWeekly previous weeks
//   having automatic backups (weeks ending on weeklyDay). The other automatic backups are deleted; backups created by the
//   users and uploaded backups are never deleted.
//   e.g. Monday to Friday, keepDaily 5, keepWeekly 2, weeklyDay Friday: the backups of the last five days, plus the backups of
//   the Fridays of the two previous weeks (7 backups).
// Checked every minute (lib/cron.js): a backup missed while the server was stopped is made when it starts again, the same
// day. Encrypted with the password of the BACKUP_PASSWORD environment variable, if set (never stored).
var mongoose = require('mongoose');
var backup = require('./backup');

var NAME = 'Automatic backup';
var RETRY_DELAY = 60 * 60 * 1000; // After a failure (disk space...), next attempt one hour later
var lastFailure = 0;

function pad(number) {
    return String(number).padStart(2, '0');
}

// Day of a date in the time of the server: 'YYYY-MM-DD'
function localDay(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Week of a date: its last day (weeks ending on weeklyDay)
function weekOf(date, weeklyDay) {
    return localDay(new Date(date.getFullYear(), date.getMonth(), date.getDate() + (weeklyDay - date.getDay() + 7) % 7));
}

function minutesOf(time) {
    var [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
}

function scheduledBackups(backups) {
    return backups.filter(item => item.origin === 'scheduled').sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

// Automatic backup due at this date: enabled, day selected, time reached, no automatic backup made this day yet
function isDue(schedule, now, backups) {
    if (!schedule || !schedule.enabled || !schedule.private.days.includes(now.getDay()))
        return false;
    if (now.getHours() * 60 + now.getMinutes() < minutesOf(schedule.private.time))
        return false;
    return !scheduledBackups(backups).some(item => localDay(new Date(item.createdAt)) === localDay(now));
}

// Automatic backups to delete (rotation, see above). The most recent automatic backup is always kept
function backupsToDelete(backups, policy, now) {
    var scheduled = scheduledBackups(backups);
    var kept = new Set(scheduled.slice(0, Math.max(1, policy.keepDaily)).map(item => item.id));
    var currentWeek = weekOf(now, policy.weeklyDay);
    var weeks = new Map(); // Previous weeks: their most recent backup
    scheduled.forEach(item => {
        var week = weekOf(new Date(item.createdAt), policy.weeklyDay);
        if (week !== currentWeek && !weeks.has(week)) weeks.set(week, item.id);
    });
    [...weeks.values()].slice(0, policy.keepWeekly).forEach(id => kept.add(id));
    return scheduled.filter(item => !kept.has(item.id));
}

// Date of the next automatic backup (null if disabled): now when it is due
function nextRun(schedule, now, backups) {
    if (!schedule || !schedule.enabled || schedule.private.days.length === 0)
        return null;
    if (isDue(schedule, now, backups))
        return now;
    var minutes = minutesOf(schedule.private.time);
    var doneToday = scheduledBackups(backups).some(item => localDay(new Date(item.createdAt)) === localDay(now));
    for (var day = 0; day <= 7; day++) {
        var date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + day, Math.floor(minutes / 60), minutes % 60);
        if (schedule.private.days.includes(date.getDay()) && date > now && !(day === 0 && doneToday))
            return date;
    }
    return null;
}

async function getSchedule(now = new Date()) {
    var settings = await mongoose.model('Settings').getAll();
    var schedule = settings && settings.backups;
    var next = nextRun(schedule, now, backup.listBackups());
    return { enabled: !!(schedule && schedule.enabled), encrypted: !!process.env.BACKUP_PASSWORD, nextRun: next ? next.toISOString() : null };
}

// Automatic backup if it is due, then rotation. Returns {created, deleted} or null (not due, operation in progress or failure)
async function runScheduledBackup(now = new Date()) {
    if (Date.now() - lastFailure < RETRY_DELAY || mongoose.connection.readyState !== 1)
        return null; // After a failure, or database not available yet (migration): checked again later
    var settings = await mongoose.model('Settings').getAll();
    if (!settings || !isDue(settings.backups, now, backup.listBackups()) || backup.getProgress())
        return null; // Operation of a user in progress: next minute
    try {
        var created = await backup.createStoredBackup({ name: NAME, password: process.env.BACKUP_PASSWORD || null, origin: 'scheduled' });
        var deleted = backupsToDelete(backup.listBackups(), settings.backups.private, now);
        deleted.forEach(item => backup.deleteStoredBackup(item.id));
        console.log(`Automatic backup ${created.id} created${created.encrypted ? ' (encrypted)' : ''}, ${deleted.length} previous automatic backups deleted`);
        return { created: created, deleted: deleted.map(item => item.id) };
    }
    catch (err) {
        lastFailure = Date.now();
        console.error('Automatic backup failed, next attempt in one hour:', err.message || err);
        return null;
    }
}

// Tests: retry without waiting after a failure
function resetFailure() {
    lastFailure = 0;
}

module.exports = { runScheduledBackup, getSchedule, backupsToDelete, isDue, nextRun, weekOf, resetFailure };
