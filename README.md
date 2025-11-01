# Cloud Gaming Monorepo

This monorepo contains multiple applications for cloud gaming management.

## Control Panel

A simple web application to send Wake-on-LAN packets to devices.

### Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set environment variables:
   ```bash
   export MAC_ADDRESS=00:11:22:33:44:55
   export DEVICE_IP=192.168.1.100  # Optional, for status checking
   export PORT=3000  # Optional, defaults to 3000
   ```

   Or create a `.env` file in the `control-panel` directory:
   ```
   MAC_ADDRESS=00:11:22:33:44:55
   DEVICE_IP=192.168.1.100
   PORT=3000
   ```

### Running Locally

From the `control-panel` directory:
```bash
npm start
```

Or from the root directory:
```bash
cd control-panel && npm start
```

The server will start on `http://localhost:3000` (or the port specified in `PORT`).

### Building and Running with Docker

1. Build the Docker image:
   ```bash
   cd control-panel
   docker build -t control-panel .
   ```

2. Run the container:
   ```bash
   docker run -d \
     -p 3000:3000 \
     -e MAC_ADDRESS=00:11:22:33:44:55 \
     -e DEVICE_IP=192.168.1.100 \
     --name control-panel \
     control-panel
   ```

### Environment Variables

- `MAC_ADDRESS` (required): The MAC address of the target device in format `XX:XX:XX:XX:XX:XX` or `XX-XX-XX-XX-XX-XX`
- `DEVICE_IP` (optional): The IP address of the target device for status checking via ping. If not set, status checking will be disabled but wake functionality will still work.
- `PORT` (optional): Server port, defaults to 3000

### Usage

1. Open the web interface at `http://localhost:3000`
2. The device status will be displayed at the top (Online/Offline)
3. If the device is offline, click the "Wake Device" button
4. The app will wait for the device to come online and provide confirmation
5. If the device is already online, the wake button will be disabled

## Host Info

A monitoring service that runs on the host PC to track system metrics and determine if the PC is busy.

### Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set environment variables (optional):
   ```bash
   export PORT=3001  # Optional, defaults to 3001
   export GPU_UTIL_THRESHOLD=80  # Optional, defaults to 80%
   export GPU_MEM_THRESHOLD=80  # Optional, defaults to 80%
   export CPU_UTIL_THRESHOLD=80  # Optional, defaults to 80%
   ```

   Or create a `.env` file in the `host-info` directory:
   ```
   PORT=3001
   GPU_UTIL_THRESHOLD=80
   GPU_MEM_THRESHOLD=80
   CPU_UTIL_THRESHOLD=80
   ```

### Running Locally

From the `host-info` directory:
```bash
npm start
```

Or from the root directory:
```bash
cd host-info && npm start
```

The server will start on `http://localhost:3001` (or the port specified in `PORT`).

**Note:** This app requires `nvidia-smi` to be available for GPU monitoring. Make sure you have NVIDIA drivers installed.

### Building and Running with Docker

**Important:** This container requires NVIDIA GPU support. Use `nvidia-docker` or Docker with GPU support.

1. Build the Docker image:
   ```bash
   cd host-info
   docker build -t host-info .
   ```

2. Run the container with GPU support:
   ```bash
   docker run -d \
     --gpus all \
     -p 3001:3001 \
     -e GPU_UTIL_THRESHOLD=80 \
     -e GPU_MEM_THRESHOLD=80 \
     -e CPU_UTIL_THRESHOLD=80 \
     --name host-info \
     host-info
   ```

### Environment Variables

- `PORT` (optional): Server port, defaults to 3001
- `GPU_UTIL_THRESHOLD` (optional): GPU utilization threshold percentage, defaults to 80
- `GPU_MEM_THRESHOLD` (optional): GPU memory usage threshold percentage, defaults to 80
- `CPU_UTIL_THRESHOLD` (optional): CPU utilization threshold percentage, defaults to 80

### API Endpoints

#### GET `/api/busy`

Returns whether the PC is currently "busy" based on whether any metric has exceeded thresholds in the past 5 minutes.

**Response:**
```json
{
  "success": true,
  "busy": false,
  "thresholds": {
    "cpu": 80,
    "gpuUtil": 80,
    "gpuMem": 80
  },
  "latest": {
    "cpuUtilization": 15.5,
    "gpuUtilization": 0,
    "gpuMemoryPercent": 2.3
  }
}
```

#### GET `/api/metrics`

Returns current metrics and busy status.

**Response:**
```json
{
  "success": true,
  "timestamp": 1234567890,
  "cpuUtilization": 15.5,
  "gpuUtilization": 0,
  "gpuMemoryPercent": 2.3,
  "busy": false
}
```

#### GET `/health`

Health check endpoint.

### Usage

The app continuously monitors:
- **GPU Utilization**: Via `nvidia-smi` utility
- **GPU Memory Usage**: Percentage of GPU memory used
- **CPU Utilization**: System-wide CPU usage

Metrics are collected every 10 seconds and stored in memory for the past 5 minutes. The system is considered "busy" if any of the metrics exceeded their thresholds at any point during the past 5 minutes.

