# Idle Inhibitor Implementation

## Overview

This service monitors an SSE (Server-Sent Events) stream and maintains a systemd idle inhibitor lock on the **host system** while events are flowing. The lock is released after a configurable idle timeout.

## How It Works

### Method: `systemd-inhibit` Command

The implementation uses the `systemd-inhibit` command, which is the **simplest and most reliable** method for acquiring inhibitor locks from within a Docker container.

**Key mechanism:**
- Spawns `systemd-inhibit --what=idle:sleep --mode=block sleep infinity`
- The inhibitor lock is held as long as the process runs
- Releasing the lock is as simple as terminating the process

### Docker Configuration

The container requires:

1. **Privileged mode** (`privileged: true`)
   - Required for D-Bus communication with host systemd

2. **Volume mount** (`/run:/run:ro`)
   - Provides access to host's systemd D-Bus socket
   - Read-only is sufficient

3. **Environment variable** (`SYSTEMCTL_FORCE_BUS=1`)
   - Forces systemctl to use D-Bus instead of trying to use systemd directly

## Architecture

```
┌─────────────────────────────────────────┐
│          Docker Container               │
│                                         │
│  ┌──────────────────────────────────┐  │
│  │     inhibitor.py                 │  │
│  │                                  │  │
│  │  1. Monitors SSE stream          │  │
│  │  2. Detects activity             │  │
│  │  3. Spawns systemd-inhibit       │  │
│  │  4. Manages idle timeout         │  │
│  └──────────────────────────────────┘  │
│              │                          │
│              ↓                          │
│  ┌──────────────────────────────────┐  │
│  │   systemd-inhibit process        │  │
│  │   (sleep infinity)               │  │
│  └──────────────────────────────────┘  │
│              │                          │
└──────────────┼──────────────────────────┘
               │ D-Bus over /run
               ↓
┌──────────────────────────────────────────┐
│          Host System                     │
│                                          │
│  ┌────────────────────────────────────┐ │
│  │   systemd-logind                   │ │
│  │   (manages inhibitor locks)        │ │
│  └────────────────────────────────────┘ │
└──────────────────────────────────────────┘
```

## Configuration

Environment variables:

- `SSE_URL`: SSE endpoint to monitor (default: `http://localhost/api/v1/events`)
- `UNIX_SOCKET`: Unix socket for SSE connection (default: `/var/run/wolf/wolf.sock`)
- `IDLE_TIMEOUT`: Seconds of inactivity before releasing lock (default: `300`)
- `WHAT`: What to inhibit, colon-separated (default: `idle:sleep`)
  - Options: `idle`, `sleep`, `shutdown`, `handle-power-key`, `handle-suspend-key`, `handle-hibernate-key`, `handle-lid-switch`
- `WHY`: Human-readable reason (default: `Wolf streaming session active`)
- `RECONNECT_DELAY`: Seconds to wait before reconnecting (default: `5`)

## Testing

### 1. Build and start the container

```bash
cd host-runner
docker compose build idle-inhibitor
docker compose up idle-inhibitor
```

### 2. Check if the lock is acquired

On the host system, run:

```bash
systemd-inhibit --list
```

You should see an entry like:

```
WHO                 UID  USER  PID   COMM             WHAT        WHY                              MODE
idle-inhibitor      0    root  12345 systemd-inhibit  idle:sleep  Wolf streaming session active    block
```

### 3. Monitor logs

```bash
docker compose logs -f idle-inhibitor
```

Expected output:
```
[2025-11-02T12:00:00] INFO: Idle Inhibitor Service starting...
[2025-11-02T12:00:00] INFO: SSE URL: http://localhost/api/v1/events
[2025-11-02T12:00:00] INFO: Connecting to http://localhost/api/v1/events...
[2025-11-02T12:00:01] INFO: Connected to SSE stream
[2025-11-02T12:00:01] INFO: Acquiring inhibitor lock: systemd-inhibit --what=idle:sleep ...
[2025-11-02T12:00:01] INFO: Acquired inhibitor lock (pid=7)
```

### 4. Test idle timeout

Stop the SSE stream (or simulate no events for 5 minutes). You should see:

```
[2025-11-02T12:05:01] INFO: Idle timeout (300s) reached, releasing lock
[2025-11-02T12:05:01] INFO: Releasing inhibitor lock (pid=7)
[2025-11-02T12:05:01] INFO: Released inhibitor lock
```

## Troubleshooting

### Lock not appearing in `systemd-inhibit --list`

1. Check container logs for errors
2. Verify `/run` is mounted: `docker exec idle-inhibitor ls -la /run/dbus`
3. Verify privileged mode: `docker inspect idle-inhibitor | grep Privileged`
4. Test systemd-inhibit manually:
   ```bash
   docker exec idle-inhibitor systemd-inhibit --list
   ```

### "systemd-inhibit command not available"

The Dockerfile should install systemd. Rebuild the image:
```bash
docker compose build --no-cache idle-inhibitor
```

### Permission denied errors

Ensure the container is running in privileged mode. Check docker-compose.yml:
```yaml
privileged: true
```

## Security Considerations

**Privileged containers** have elevated permissions and can pose security risks:

- The container can access host systemd services
- Consider network isolation if possible
- Run only trusted code in privileged containers
- Monitor container logs for suspicious activity

**Alternative (more secure but complex):**
- Create a host-side service that manages inhibitor locks
- Container communicates with this service via HTTP/gRPC
- Requires more infrastructure but maintains better isolation

## Why This Method?

After researching multiple approaches, `systemd-inhibit` command is chosen because:

1. **Simplicity**: No complex D-Bus bindings needed
2. **Reliability**: Well-tested, standard systemd tool
3. **Process-based**: Lock lifecycle tied to process (automatic cleanup)
4. **Language-agnostic**: Works from any language via subprocess
5. **Debugging**: Easy to test manually with `docker exec`

Alternative methods (D-Bus direct, pydbus, etc.) were more complex and error-prone, especially regarding file descriptor management across container boundaries.

