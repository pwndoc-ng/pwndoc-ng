# MongoDB 8 for pwndoc-ng, with a transparent migration of the data of the previous installations (MongoDB 4.x)
# See mongodb/README.md
ARG MONGO_VERSION=8.0
ARG LEGACY_MONGO_VERSION=4.4

# MongoDB 4.4: last version without AVX requirement, reads the data files of the previous installations
# (data of MongoDB 4.2 or 4.4). Its binary and libraries (not provided by the MongoDB 8 image) are kept apart.
FROM mongo:${LEGACY_MONGO_VERSION} AS legacy
RUN mkdir -p /opt/mongodb-legacy/bin /opt/mongodb-legacy/lib \
 && cp /usr/bin/mongod /opt/mongodb-legacy/bin/ \
 && ldd /usr/bin/mongod | awk '/=> \// { print $3 }' \
    | grep -vE '/(libc|libm|libdl|libpthread|librt|libresolv|ld-linux[^/]*)\.so' \
    | xargs -I{} cp -L {} /opt/mongodb-legacy/lib/

FROM mongo:${MONGO_VERSION}
COPY --from=legacy /opt/mongodb-legacy /opt/mongodb-legacy
COPY pwndoc-mongodb.sh /usr/local/bin/pwndoc-mongodb.sh
RUN chmod 755 /usr/local/bin/pwndoc-mongodb.sh \
 && LD_LIBRARY_PATH=/opt/mongodb-legacy/lib /opt/mongodb-legacy/bin/mongod --version | head -1

ENTRYPOINT ["pwndoc-mongodb.sh"]
CMD ["mongod"]
