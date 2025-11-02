FROM node:20-alpine

# Label to link package to GitHub repository
ARG GITHUB_REPO_URL
LABEL org.opencontainers.image.source="${GITHUB_REPO_URL}"

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --omit=dev

# Copy application files
COPY server.js ./
COPY public ./public

# Expose port
EXPOSE 3000

# Set default environment variables
ENV PORT=3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:${PORT}', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the application
CMD ["node", "server.js"]

