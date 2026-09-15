# EdgeBridge Gateway - lightweight image with zero external npm dependencies.
FROM node:20-alpine

# Create app directory
WORKDIR /app

# The gateway has no third-party dependencies, but we copy package.json so the
# image documents its metadata and scripts.
COPY package.json ./

# Copy source
COPY src ./src
COPY healthcheck.js ./

# Run as the built-in non-root "node" user for defense in depth.
USER node

# Default proxy + health ports (overridable via env / compose).
EXPOSE 1080 8080

# Container-level health probe.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD ["node", "healthcheck.js"]

CMD ["node", "src/index.js"]
