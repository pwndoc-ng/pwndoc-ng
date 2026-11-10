# Playwright runner of the end-to-end tests: same version as @playwright/test (package.json)
FROM mcr.microsoft.com/playwright:v1.64.1-noble
WORKDIR /e2e
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
# Tests, fixtures and configuration are mounted at runtime (docker-compose.e2e.yml)
CMD ["npx", "playwright", "test"]
