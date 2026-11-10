# pwndoc-ng MongoDB image

MongoDB 8 for pwndoc-ng. The data of the installations using MongoDB 4.x (previous `mongo:4` image) is migrated
automatically at the first start: nothing to do besides the usual update (`docker-compose up -d --build`).

## Data folder

The data is stored on the host, in `mongodb/mongo-data` (mounted at `/data/db`, ignored by git and by the image
build). Back it up like any folder, with MongoDB stopped (`docker-compose stop mongodb`), or use the backups of the
application.

Installations made before kept their data in a Docker volume (`<project>_mongo-data`, or `<project>_mongo-data-dev`
for `docker-compose-dev.yml`). The compose files mount it at `/data/previous-volume`: at startup, when
`mongodb/mongo-data` is empty, its content is copied into it once (logs: `pwndoc-mongodb`), then the usual startup
goes on (migration of MongoDB 4.x data included). The copy is done by the image: update with `--build`
(`docker-compose up -d --build`), otherwise the previous image starts an empty database in `mongodb/mongo-data` (the
data is still in the volume: stop, empty the folder and start again with `--build`). The volume is left unchanged as
a backup. Once the data is checked
in the application, the `/data/previous-volume` line of the compose file and the volume can be removed
(`docker volume rm <project>_mongo-data`). An interrupted copy is done again at the next start; a failed copy (disk
space) stops the container instead of starting on an empty database.

## Migration of MongoDB 4.x data

At startup, `pwndoc-mongodb.sh` looks at the data volume (`/data/db`):

| Volume content | Action |
|---|---|
| MongoDB 8 data (`mongodb/.pwndoc-ready`) | MongoDB 8 is started |
| MongoDB 4.x data files (previous installation) | Migration, then MongoDB 8 is started |
| Empty (new installation) | MongoDB 8 is started |

Migration:

1. MongoDB 4.4 (included in the image) is started on the previous data (data of MongoDB 4.2 or 4.4).
2. The data is exported (`mongodump`) and imported in MongoDB 8 (`mongorestore`), indexes included,
   in the `mongodb/` folder of the same volume.
3. The number of documents of every collection is compared between both versions.
4. MongoDB 8 is started on the imported data.

The previous data files are never modified and stay at the root of the volume as a backup. The dump, the
document counts and the logs of the migration are kept in `/data/db/.pwndoc-migration`. Once the migration is
checked, the previous files can be deleted (every file and folder of the volume except `mongodb/`).

No intermediate version is needed: an in-place upgrade of the data files would need MongoDB 5.0, 6.0 and 7.0,
each one requiring AVX.

If the migration fails (or is interrupted), nothing is lost: the partial MongoDB 8 data is removed, MongoDB 4.4
keeps serving the previous data and the migration is retried at the next start. Logs:

```
docker-compose logs mongodb | grep pwndoc-mongodb
```

## CPU requirements

MongoDB 5.0 and later need AVX on x86_64 CPUs and ARMv8.2-A on arm64 CPUs. Some virtual machines do not
expose AVX (e.g. Proxmox `kvm64` CPU type) and some small boards are ARMv8.0 (Raspberry Pi 4).

On such CPUs:

- if the image contains a MongoDB 8 build without AVX (`/opt/mongodb-noavx/bin/mongod`), it is used,
- otherwise MongoDB 4.4 keeps serving the data (no migration, no change for the application). The migration is
  done automatically the day the installation runs on a CPU able to run MongoDB 8.

`PWNDOC_MONGODB_CPU=legacy` forces this behaviour (tests).
