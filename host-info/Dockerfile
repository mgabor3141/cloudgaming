FROM nvidia/cuda:12.0.0-base-ubuntu22.04

# Install Node.js and nvidia-smi dependencies
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application files
COPY server.js ./

# Expose port
EXPOSE 3001

# Set default environment variables
ENV PORT=3001
ENV GPU_UTIL_THRESHOLD=80
ENV GPU_MEM_THRESHOLD=50
ENV CPU_UTIL_THRESHOLD=80
ENV BUSY_THRESHOLD_PERCENT=60

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:${PORT}/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the application
CMD ["node", "server.js"]

