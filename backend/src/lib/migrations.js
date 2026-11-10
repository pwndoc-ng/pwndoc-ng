// One-time migrations of the data, run at the start of the server (not awaited: the server answers meanwhile). A migration
// is recorded in the 'migrations' collection once it succeeded: it never runs again. After an error, it is retried at the
// next start
var mongoose = require('mongoose')

var IMAGE_ACCESS = 'image-access-from-references'
exports.IMAGE_ACCESS = IMAGE_ACCESS

var MIGRATIONS = [
  // Access control of the images (models/image.js): accesses that existed at the upgrade
  {name: IMAGE_ACCESS, run: () => mongoose.model('Image').grantExistingReferences()}
]

// Date of a migration done, null if not done yet
async function doneAt(name) {
  var migration = await mongoose.connection.collection('migrations').findOne({name: name})
  return migration ? migration.date : null
}
exports.doneAt = doneAt

async function runMigrations() {
  // The database may become available later (app.js retries the connection)
  if (mongoose.connection.readyState !== 1)
    await new Promise(resolve => mongoose.connection.once('connected', resolve))
  var done = mongoose.connection.collection('migrations')
  for (var migration of MIGRATIONS) {
    try {
      if (await done.findOne({name: migration.name}))
        continue
      console.log(`Migration ${migration.name}: started`)
      var result = await migration.run()
      await done.insertOne({name: migration.name, date: new Date()})
      console.log(`Migration ${migration.name}: done`, result)
    }
    catch (err) {
      console.log(`Migration ${migration.name} failed, retried at the next start:`, err)
    }
  }
}
exports.runMigrations = runMigrations
