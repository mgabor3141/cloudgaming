#!/usr/bin/env bash
#
# gow-start.sh by mgabor — launches and supervises the Games-on-Whales “wolf” container.
#
# This script:
#   • Ensures it runs as root (re-execs with sudo if needed)
#       - This is needed so that we can manipulate the wolf.socket
#   • Starts the wolf container
#   • Waits for the wolf UNIX socket (/var/run/wolf/wolf.sock) to appear and opens its ownership to non-root
#   • Starts the SSE watcher script (gow/sse.sh) to manage a system sleep inhibitor
#   • Ensures correct cleanup
#
# Usage: run from your normal user account; the script will elevate as needed.
#
# Dependencies: bash ≥4, sudo, docker, inotifywait

set -Eeuo pipefail

if [ "$EUID" -ne 0 ]; then
  echo "Elevating privileges with sudo..."
  exec sudo --preserve-env=HOME,PATH,TERM "$0" "$@"
fi

container_name="wolf"
sse_pid=""
docker_wait_pid=""
log_pid=""
_shutting_down=0

cleanup() {
  (( _shutting_down )) && return
  _shutting_down=1

  # Kill background helpers
  for p in "$sse_pid" "$docker_wait_pid" "$log_pid"; do
    [[ -n "$p" ]] && kill "$p" 2>/dev/null || true
  done

  # Stop container if still running
  docker stop "$container_name" >/dev/null 2>&1 || true

  wait 2>/dev/null || true
}
trap 'cleanup; exit 130' INT
trap cleanup EXIT TERM

# --- cd to script directory ---
scriptDir="$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")"
cd "$scriptDir"

# --- run container detached; capture ID ---
container_id="$(
    docker run -d --rm \
        --name "$container_name" \
        --network=host \
        -e NVIDIA_DRIVER_VOLUME_NAME=nvidia-driver-vol \
        -e WOLF_INTERNAL_MAC=b4:2e:99:49:49:f0 \
        -e WOLF_SOCKET_PATH=/var/run/wolf/wolf.sock \
        -v nvidia-driver-vol:/usr/nvidia:rw \
        -v /etc/wolf:/etc/wolf:rw \
        -v /var/run/docker.sock:/var/run/docker.sock:rw \
        -v /var/run/wolf:/var/run/wolf \
        --device /dev/nvidia-uvm \
        --device /dev/nvidia-uvm-tools \
        --device /dev/dri \
        --device /dev/nvidia-caps/nvidia-cap1 \
        --device /dev/nvidia-caps/nvidia-cap2 \
        --device /dev/nvidiactl \
        --device /dev/nvidia0 \
        --device /dev/nvidia-modeset \
        --device /dev/uinput \
        --device /dev/uhid \
        -v /dev/:/dev/:rw \
        -v /run/udev:/run/udev:rw \
        --device-cgroup-rule "c 13:* rmw" \
        ghcr.io/games-on-whales/wolf:stable
)"

echo "Started container $container_name ($container_id)"

# --- follow container logs in background ---
docker logs -f "$container_name" &
log_pid=$!

# --- wait for the wolf socket to appear, give user permission ---
inotifywait -e create,moved_to,attrib --include '/wolf\.sock$' -qq /var/run/wolf
chown $SUDO_USER /var/run/wolf/wolf.sock

# --- start SSE watcher ---
./gow/sse.sh &
sse_pid=$!

# --- optional: exit if container stops ---
docker wait "$container_name" >/dev/null 2>&1 &
docker_wait_pid=$!

# --- block until either job exits ---
wait
