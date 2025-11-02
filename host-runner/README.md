# Host Runner

Docker Compose deployment package for the cloud gaming host. Brings together all components needed for a complete cloud gaming setup:

- Games on Whales (Wolf) for game streaming
- Host monitoring service
- Idle inhibitor to prevent sleep during sessions
- Tailscale for secure remote access

## Quick Start

### Using the Helper Scripts (Recommended)

1. Run the start script:

   ```bash
   ./start.sh
   ```

   This will:

   - Create `.env` from `.env.example` if needed
   - Check for required configuration
   - Create necessary volumes
   - Start all services
   - Wait for Wolf socket and set proper permissions

2. Stop services:
   ```bash
   ./stop.sh
   ```

### Manual Setup

1. Copy the example environment file:

   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and configure:

   - `TS_AUTHKEY`: Your Tailscale authentication key (**required**)
     - Generate at: https://login.tailscale.com/admin/settings/keys
   - Other settings as needed (see `.env.example` for details)

3. Ensure NVIDIA driver volume exists:

   ```bash
   docker volume create nvidia-driver-vol
   ```

4. Start all services:

   ```bash
   docker compose up -d
   ```

5. View logs:
   ```bash
   docker compose logs -f
   ```

## Services

### wolf

Games on Whales streaming server. Provides the core game streaming functionality using Moonlight protocol.

**Exposed Resources:**

- Socket: `/var/run/wolf/wolf.sock`
- Web UI: Check Wolf documentation for port

**Key Configuration:**

- `WOLF_INTERNAL_MAC`: MAC address for internal network interface

### host-info

Monitors system metrics (CPU, GPU utilization) and provides a REST API.

**Endpoints:**

- `http://localhost:3001/api/metrics` - Current system metrics
- `http://localhost:3001/api/busy` - Whether system is busy (based on thresholds)
- `http://localhost:3001/health` - Health check

**Key Configuration:**

- `HOST_INFO_PORT`: Service port (default: 3001)
- `GPU_UTIL_THRESHOLD`: GPU utilization threshold for "busy" state
- `CPU_UTIL_THRESHOLD`: CPU utilization threshold for "busy" state

### idle-inhibitor

Monitors Wolf's SSE event stream and prevents system sleep/idle during active streaming sessions.

**Key Configuration:**

- `IDLE_TIMEOUT`: Seconds to wait after last activity before allowing sleep (default: 300)
- `INHIBIT_WHAT`: What to inhibit (default: sleep:idle)

### tailscale

Provides secure remote access to the gaming host via Tailscale VPN.

**Key Configuration:**

- `TS_AUTHKEY`: Authentication key from Tailscale (required)
- `TS_EXTRA_ARGS`: Additional Tailscale arguments (default: --advertise-exit-node)

## Requirements

- **Docker**: Version 20.10 or later
- **Docker Compose**: Version 2.0 or later
- **NVIDIA GPU**: With drivers installed and working
- **systemd-logind**: For idle inhibitor functionality
- **Tailscale Account**: Free account at https://tailscale.com

### Verifying NVIDIA Setup

Ensure NVIDIA drivers are working:

```bash
nvidia-smi
```

Check if nvidia-drm module is loaded with modeset:

```bash
cat /sys/module/nvidia_drm/parameters/modeset
```

Should output `Y`. If not, add `nvidia-drm.modeset=1` to your kernel parameters.

## Configuration

All configuration is done through environment variables in the `.env` file. See `.env.example` for all available options with detailed comments.

### Important Settings

- **TS_AUTHKEY** (required): Tailscale authentication key
- **WOLF_INTERNAL_MAC**: MAC address for Wolf's internal network
- **IDLE_TIMEOUT**: How long to wait before allowing sleep after last activity

## Troubleshooting

### Wolf socket not appearing

Check Wolf logs:

```bash
docker compose logs wolf
```

Ensure `/var/run/wolf` directory exists and is writable:

```bash
sudo mkdir -p /var/run/wolf
sudo chmod 755 /var/run/wolf
```

### Idle inhibitor not working

Check that D-Bus socket is accessible:

```bash
ls -la /run/dbus/system_bus_socket
```

View inhibitor logs:

```bash
docker compose logs idle-inhibitor
```

### Tailscale not connecting

Verify your auth key is set in `.env`:

```bash
grep TS_AUTHKEY .env
```

Check Tailscale logs:

```bash
docker compose logs tailscale
```

### GPU not accessible

Ensure NVIDIA devices are available:

```bash
ls -la /dev/nvidia*
```

Check that NVIDIA container runtime is configured:

```bash
docker run --rm --gpus all nvidia/cuda:11.0-base nvidia-smi
```

## Useful Commands

### View all logs

```bash
docker compose logs -f
```

### View specific service logs

```bash
docker compose logs -f wolf
docker compose logs -f host-info
docker compose logs -f idle-inhibitor
docker compose logs -f tailscale
```

### Restart a service

```bash
docker compose restart wolf
```

### Check service status

```bash
docker compose ps
```

### Stop all services

```bash
docker compose down
```

### Update images

```bash
docker compose pull
docker compose up -d
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Host System                          │
│                                                             │
│  ┌──────────┐  ┌────────────┐  ┌─────────────┐           │
│  │   Wolf   │  │ Host-Info  │  │   Tailscale │           │
│  │          │  │            │  │             │           │
│  │  Port:   │  │ Port: 3001 │  │   Network   │           │
│  │  (check  │  │            │  │    Mode:    │           │
│  │   docs)  │  └────────────┘  │    host     │           │
│  │          │                   └─────────────┘           │
│  │ Socket:  │                                             │
│  │ /var/run/│  ┌─────────────────────────────┐           │
│  │  wolf/   │  │    Idle Inhibitor           │           │
│  │ wolf.sock├──┤                             │           │
│  └──────────┘  │ Monitors Wolf SSE events    │           │
│                │ Prevents system sleep       │           │
│                └─────────────────────────────┘           │
│                           │                               │
│                           ▼                               │
│                  ┌─────────────────┐                      │
│                  │  systemd-logind │                      │
│                  │    (D-Bus)      │                      │
│                  └─────────────────┘                      │
└─────────────────────────────────────────────────────────────┘
```

## References

- [Games on Whales Documentation](https://games-on-whales.github.io/wolf/)
- [Tailscale Documentation](https://tailscale.com/kb/)
- Previous implementation: See `reference/` directory for the original bash-based implementation
