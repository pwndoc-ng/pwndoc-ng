# Installation

> PwnDoc-ng uses 3 containers: the backend, the frontend and the database.

## Production

All 3 containers can be run at once using the docker-compose file in the root directory.

!> For production usage make sure to change the certificates in `backend/ssl` folder and optionnaly to set the JWT secret in `backend/src/lib/auth.js` (`jwtSecret` and `jwtRefreshSecret` in `backend/src/config/config.json`) if you don't want to use random ones.

Build and run Docker containers

```
docker-compose up -d --build
```

Display backend container logs

```
docker-compose logs -f backend
```

Stop/Start containers

```
docker-compose stop
docker-compose start
```

Remove containers

```
docker-compose down
```

Update

```
docker-compose down
git pull
docker-compose up -d --build
```

?> The database uses MongoDB 8. The data of installations using MongoDB 4.x is migrated automatically at the first start after the update (the previous data files are kept as a backup). On CPUs unable to run MongoDB 8 (no AVX, ARMv8.0), MongoDB 4.4 keeps serving the data. See `mongodb/README.md`.

Application is accessible through https://localhost:8443
API is accessible through https://localhost:8443/api

## Development

For development purposes, specific docker-compose file can be used in each folder (backend/frontend).

> *Source code can be modified live and application will automatically reload on changes.*

Build and run backend and database containers

```
docker-compose -f backend/docker-compose.dev.yml up -d --build
```

Display backend container logs

```
docker-compose -f backend/docker-compose.dev.yml logs -f pwndoc-ng-backend
```

Stop/Start container

```
docker-compose -f backend/docker-compose.dev.yml stop
docker-compose -f backend/docker-compose.dev.yml start
```

Remove containers

```
docker-compose -f backend/docker-compose.dev.yml down
```

Application is accessible through https://localhost:8081
API is accessible through https://localhost:8081/api

## Tests

> For now only backend tests have been written (it's a continuous work in progress)

Test files are located in `backend/tests` using Jest testing framework

Script `run_tests.sh` at the root folder can be used to launch tests :

```
Usage:        ./run_tests.sh -q|-f [-h, --help]

Options:
  -h, --help  Display help
  -q          Run quick tests (No build)
  -f          Run full tests (Build with no cache)
```

!> **Don't use it in production as it will delete the production Database**

## Backup

### From the application

*Data > Import / Export > Backups* (permissions in [roles](roles.md)):

- **Create a backup**: all the data, or a selection (audits, vulnerabilities, images, users, companies and clients, report templates, custom data, settings). Images are always saved with the audits and the vulnerabilities, companies with the clients. A password encrypts the backup (AES-256): its name and content stay visible, its data cannot be read or restored without the password.
- Backups are stored on the server in `backend/backup` (volume of the backend container). **Download** a backup to keep it elsewhere, **upload** a backup file to add it to the backups of the instance (migration to another server).
- **Restore** the selected data of a backup:
  - *Merge*: the data of the backup is added, or replaces the data with the same identifier. Nothing is deleted. Settings are replaced.
  - *Replace*: the current data of the selected categories is deleted and replaced by the data of the backup.

  If the restore fails (for example data of the backup in conflict with the current data during a merge: same name, another identifier), the previous data is kept. Users editing audits are disconnected and reconnect on the restored data.
- The free disk space is checked before writing a backup.

### Database volume

It's also possible to regularly backup the `mongo-data` volume. It contains all the database.

Find the location of the volume on the disk:

```
sudo docker inspect pwndoc-ng_mongo-data
[
    {
        "CreatedAt": "2022-09-18T19:11:42+02:00",
        "Driver": "local",
        "Labels": {
            "com.docker.compose.project": "pwndoc-ng",
            "com.docker.compose.version": "2.11.0",
            "com.docker.compose.volume": "mongo-data"
        },
        "Mountpoint": "/var/lib/docker/volumes/pwndoc-ng_mongo-data/_data",
        "Name": "pwndoc-ng_mongo-data",
        "Options": null,
        "Scope": "local"
    }
]
```

To restore :

- Stop containers
- Replace the current `mongo-data` volume with the backed up one
- Start containers
