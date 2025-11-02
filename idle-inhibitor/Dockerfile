FROM python:3.11-slim

# Install build dependencies, compile PyGObject, then clean up to reduce image size
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        gcc \
        pkg-config \
        libgirepository1.0-dev \
        libcairo2-dev \
    && pip install --no-cache-dir 'PyGObject<3.46' \
    && apt-get purge -y --auto-remove gcc pkg-config libgirepository1.0-dev libcairo2-dev \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Install runtime dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        dbus \
        libgirepository-1.0-1 \
        libcairo2 \
        gir1.2-glib-2.0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application
COPY inhibitor.py .
RUN chmod +x inhibitor.py

ENTRYPOINT ["python3", "-u", "inhibitor.py"]

