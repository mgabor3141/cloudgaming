#!/usr/bin/env bash
#
# stop.sh - Stops the host runner stack
#

set -Eeuo pipefail

# Change to script directory
cd "$(dirname "${BASH_SOURCE[0]}")"

# Check if we need sudo for docker
DOCKER_CMD="docker"
if ! docker ps >/dev/null 2>&1; then
    if sudo docker ps >/dev/null 2>&1; then
        DOCKER_CMD="sudo docker"
    fi
fi

COMPOSE_CMD="$DOCKER_CMD compose"

echo "Stopping host runner stack..."
$COMPOSE_CMD down

echo "Host runner stack stopped."

