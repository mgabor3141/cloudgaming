# Idle Inhibitor Service

A containerized service that monitors Server-Sent Events (SSE) streams and prevents system sleep/idle while activity is detected.

## Overview

This service connects to an SSE endpoint (typically from Wolf or similar streaming services) and maintains a systemd idle inhibitor lock while events are flowing. When no activity is detected for a configurable period, the lock is released and the system can sleep.

## Design Decisions

### Why Python?
- Excellent D-Bus support via `dasbus`
- Simple SSE handling with `requests`
- Easy to maintain and debug
- Good standard library for threading/timers

### Why D-Bus instead of `systemd-inhibit`?
The original bash script used `systemd-inhibit` command-line tool, but from a container, using D-Bus directly is more reliable:
- **Direct API access**: Communicates with systemd-logind via D-Bus without shell wrappers
- **Better error handling**: Can catch and handle D-Bus errors programmatically
- **Cleaner resource management**: Inhibitor lock is tied to a file descriptor
- **Container-friendly**: Just mount the D-Bus socket, no privileged access needed

### Reliability Through Docker Compose
Instead of complex retry logic and backoff strategies in the application, we rely on:
- Docker Compose `restart: unless-stopped` policy
- Simple reconnection logic in the app
- Let the orchestrator handle failure recovery

## How It Works

1. **Connects to SSE stream** via Unix socket or HTTP
2. **Monitors for activity** (any `data:` line in the stream)
3. **Acquires D-Bus inhibitor lock** when activity starts
4. **Resets idle timer** on each event
5. **Releases lock** after configured idle timeout
6. **Reconnects automatically** if stream drops

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `SSE_URL` | `http://localhost/api/v1/events` | SSE endpoint URL |
| `UNIX_SOCKET` | `/var/run/wolf/wolf.sock` | Unix socket path (optional) |
| `IDLE_TIMEOUT` | `300` | Seconds of inactivity before releasing lock |
| `WHAT` | `sleep:idle` | What to inhibit (systemd-logind format) |
| `WHY` | `Wolf streaming session active` | Reason for inhibitor |
| `RECONNECT_DELAY` | `5` | Seconds to wait before reconnecting |

## Docker Compose Example

```yaml
services:
  idle-inhibitor:
    build: ./idle-inhibitor
    restart: unless-stopped
    environment:
      - SSE_URL=http://localhost/api/v1/events
      - UNIX_SOCKET=/var/run/wolf/wolf.sock
      - IDLE_TIMEOUT=300
    volumes:
      # Mount D-Bus system socket for systemd-logind access
      - /run/dbus/system_bus_socket:/run/dbus/system_bus_socket:ro
      # Mount Wolf socket (if using Unix socket)
      - /var/run/wolf:/var/run/wolf:ro
```

## Testing

### Test D-Bus connectivity:
```bash
docker run --rm \
  -v /run/dbus/system_bus_socket:/run/dbus/system_bus_socket \
  idle-inhibitor \
  python3 -c "from dasbus.connection import SystemMessageBus; bus = SystemMessageBus(); print('D-Bus OK')"
```

### Test with mock SSE server:
```bash
# Terminal 1: Mock SSE server
while true; do echo "data: test"; sleep 2; done | nc -l 8080

# Terminal 2: Run inhibitor
docker run --rm \
  -v /run/dbus/system_bus_socket:/run/dbus/system_bus_socket \
  -e SSE_URL=http://host.docker.internal:8080 \
  -e UNIX_SOCKET= \
  idle-inhibitor
```

### Check active inhibitors:
```bash
systemd-inhibit --list
```

## Development

### Using devenv (Recommended)

This project uses [devenv.sh](https://devenv.sh) for development environments:

```bash
# From project root - devenv automatically:
# - Creates .venv at project root
# - Installs Python dependencies
# - Activates the venv in the shell

# Run the service locally
idle-inhibitor-dev

# Or manually
cd idle-inhibitor
python3 inhibitor.py  # venv is auto-activated by devenv
```

### Manual Setup (Alternative)

If not using devenv:

```bash
cd idle-inhibitor
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python3 inhibitor.py
```

### Docker Build

```bash
docker build -t idle-inhibitor ./idle-inhibitor
```

## Permissions

The container needs:
- Read access to `/run/dbus/system_bus_socket`
- The user running the container must be allowed to create inhibitors (most users can)
- No privileged mode or special capabilities required

## Comparison with Bash Version

| Aspect | Bash (sse.sh) | Python (inhibitor.py) |
|--------|---------------|----------------------|
| D-Bus | Via `systemd-inhibit` CLI | Direct via dasbus API |
| SSE | curl coprocess | requests library |
| State management | Global variables + backgrounded sleep | Threading + Timer objects |
| Error handling | Exit codes + trap | Exceptions + try/catch |
| Reconnection | Exponential backoff loop | Simple delay (Docker restarts) |
| Dependencies | bash, curl, systemd, inotifywait | Python + 3 packages |
| Container-friendly | Needs privileged or host PID | Just needs D-Bus socket |

## Troubleshooting

**"Failed to acquire inhibitor"**
- Check D-Bus socket is mounted: `-v /run/dbus/system_bus_socket:/run/dbus/system_bus_socket`
- Verify D-Bus permissions: some systems require user to be in specific group
- Check systemd-logind is running on host: `systemctl status systemd-logind`

**Connection timeout**
- Verify SSE endpoint is accessible from container
- Check Unix socket path is correct and mounted
- Test with curl: `curl --unix-socket /var/run/wolf/wolf.sock http://localhost/api/v1/events`

**Container keeps restarting**
- Check logs: `docker logs <container>`
- Verify environment variables are set correctly
- Test D-Bus access (see Testing section above)

