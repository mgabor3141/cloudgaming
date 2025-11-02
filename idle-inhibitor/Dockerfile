FROM python:3.11-slim

# Install system dependencies for D-Bus
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        dbus \
        libdbus-1-3 \
        libdbus-glib-1-2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application
COPY inhibitor.py .
RUN chmod +x inhibitor.py

# Run as non-root user (but needs access to D-Bus socket)
USER nobody

ENTRYPOINT ["python3", "-u", "inhibitor.py"]

