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
   export DEVICE_IP=192.168.1.100  # Required for status checking
   export HOST_INFO_URL=http://localhost:3001  # Optional, defaults to http://localhost:3001
   export PORT=3000  # Optional, defaults to 3000
   ```

   Or create a `.env` file in the `control-panel` directory:
   ```
   MAC_ADDRESS=00:11:22:33:44:55
   DEVICE_IP=192.168.1.100
   HOST_INFO_URL=http://localhost:3001
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
- `DEVICE_IP` (required): The IP address of the target device for status checking via ping
- `HOST_INFO_URL` (optional): URL of the host-info service for metrics. Defaults to `http://localhost:3001`
- `PORT` (optional): Server port, defaults to 3000

### Usage

1. Open the web interface at `http://localhost:3000`
2. The **availability status** is prominently displayed at the top, showing:
   - **Available** (green): Host is offline (can be woken) OR online and not busy
   - **Unavailable** (red): Host is online but busy OR game server unavailable
3. A small utilization chart shows recent metrics when available
4. If the host is offline, click the "Wake Device" button
5. The app will wait for the device to come online and provide confirmation
6. Detailed status information is shown below the availability status

### Availability States

The control panel displays four distinct states:

- **Host offline**: Available for gaming (can be woken)
- **Host online + not busy**: Available for gaming
- **Host online + busy**: Unavailable (system resources in use)
- **Host online + no metrics**: Game server unavailable (host-info not responding)

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
   export GPU_MEM_THRESHOLD=50  # Optional, defaults to 50%
   export CPU_UTIL_THRESHOLD=80  # Optional, defaults to 80%
   export BUSY_THRESHOLD_PERCENT=60  # Optional, defaults to 60%
   ```

   Or create a `.env` file in the `host-info` directory:
   ```
   PORT=3001
   GPU_UTIL_THRESHOLD=80
   GPU_MEM_THRESHOLD=50
   CPU_UTIL_THRESHOLD=80
   BUSY_THRESHOLD_PERCENT=60
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
     -e GPU_MEM_THRESHOLD=50 \
     -e CPU_UTIL_THRESHOLD=80 \
     -e BUSY_THRESHOLD_PERCENT=60 \
     --name host-info \
     host-info
   ```

### Environment Variables

- `PORT` (optional): Server port, defaults to 3001
- `GPU_UTIL_THRESHOLD` (optional): GPU utilization threshold percentage, defaults to 80
- `GPU_MEM_THRESHOLD` (optional): GPU memory usage threshold percentage, defaults to 50
- `CPU_UTIL_THRESHOLD` (optional): CPU utilization threshold percentage, defaults to 80
- `BUSY_THRESHOLD_PERCENT` (optional): Percentage of samples in the past 5 minutes that must exceed thresholds to be considered busy. Defaults to 60. This prevents brief spikes from marking the system as busy - requires sustained load.

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
    "gpuMem": 50,
    "busyThresholdPercent": 60
  },
  "busyPercentage": 15.5,
  "sampleCount": 30,
  "busySampleCount": 5,
  "latest": {
    "cpuUtilization": 15.5,
    "gpuUtilization": 0,
    "gpuMemoryPercent": 2.3
  }
}
```

#### GET `/api/metrics`

Returns current metrics, busy status, and graph data for visualization.

**Response:**
```json
{
  "success": true,
  "timestamp": 1234567890,
  "cpuUtilization": 15.5,
  "gpuUtilization": 0,
  "gpuMemoryPercent": 2.3,
  "overallUtilization": 15.5,
  "busy": false,
  "busyPercentage": 12.5,
  "sampleCount": 30,
  "busySampleCount": 4,
  "graph": {
    "dataPoints": [
      {
        "timestamp": 1234567800,
        "utilization": 10.2
      },
      {
        "timestamp": 1234567810,
        "utilization": 12.5
      }
    ],
    "timeRange": {
      "start": 1234567500,
      "end": 1234567890,
      "durationMs": 300000
    }
  }
}
```

The `graph.dataPoints` array contains historical utilization data points suitable for drawing a line graph. Each point includes a timestamp and overall utilization (maximum of CPU and GPU utilization).

#### GET `/health`

Health check endpoint.

### Usage

The app continuously monitors:
- **GPU Utilization**: Via `nvidia-smi` utility
- **GPU Memory Usage**: Percentage of GPU memory used
- **CPU Utilization**: System-wide CPU usage

Metrics are collected every 10 seconds and stored in memory for the past 5 minutes. The system is considered "busy" only if a significant percentage (default 60%) of samples exceeded their thresholds, weighted by recency. More recent samples count exponentially more than older samples, so if the system is busy right now (even if it was idle earlier), it will be marked as busy. This prevents brief spikes from marking the system as busy while also ensuring current load is properly reflected.

