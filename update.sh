cd /opt/pwndoc-ng && docker-compose down && mv backend/src/config/config.json backend/src/config/config.json.bak && git pull && docker-compose up -d --build
