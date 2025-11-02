#!/usr/bin/env bash
#
# start.sh - Starts the host runner stack with proper initialization
#

set -Eeuo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $*"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $*"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $*"
}

# Check if we need sudo for docker
DOCKER_CMD="docker"
if ! docker ps >/dev/null 2>&1; then
    if sudo docker ps >/dev/null 2>&1; then
        DOCKER_CMD="sudo docker"
        log_warn "Using sudo for docker commands"
    else
        log_error "Cannot access docker. Please ensure docker is running and you have permission."
        exit 1
    fi
fi

COMPOSE_CMD="$DOCKER_CMD compose"

# Change to script directory
cd "$(dirname "${BASH_SOURCE[0]}")"

# Check for .env file
if [[ ! -f .env ]]; then
    log_warn ".env file not found. Creating from .env.example..."
    cp .env.example .env
    log_warn "Please edit .env file and add your TS_AUTHKEY before continuing."
    log_warn "Generate a key at: https://login.tailscale.com/admin/settings/keys"
    exit 1
fi

# Check for Tailscale auth key
if ! grep -q "^TS_AUTHKEY=.\+" .env; then
    log_error "TS_AUTHKEY not set in .env file"
    log_error "Generate a key at: https://login.tailscale.com/admin/settings/keys"
    exit 1
fi

# Ensure nvidia-driver-vol volume exists
log_info "Checking for nvidia-driver-vol volume..."
if ! $DOCKER_CMD volume inspect nvidia-driver-vol >/dev/null 2>&1; then
    log_info "Creating nvidia-driver-vol volume..."
    $DOCKER_CMD volume create nvidia-driver-vol
fi

# Ensure wolf socket directory exists with correct permissions
log_info "Ensuring /var/run/wolf directory exists..."
if [[ ! -d /var/run/wolf ]]; then
    if [[ "$EUID" -ne 0 ]]; then
        sudo mkdir -p /var/run/wolf
        sudo chmod 755 /var/run/wolf
    else
        mkdir -p /var/run/wolf
        chmod 755 /var/run/wolf
    fi
fi

# Start the stack
log_info "Starting host runner stack..."
$COMPOSE_CMD up -d

# Wait for wolf socket to appear
log_info "Waiting for wolf socket to appear..."
TIMEOUT=30
COUNTER=0
while [[ ! -S /var/run/wolf/wolf.sock ]] && [[ $COUNTER -lt $TIMEOUT ]]; do
    sleep 1
    ((COUNTER++))
done

if [[ -S /var/run/wolf/wolf.sock ]]; then
    log_info "Wolf socket detected!"
    
    # Make socket accessible
    if [[ "$EUID" -ne 0 ]]; then
        sudo chmod 666 /var/run/wolf/wolf.sock
    else
        chmod 666 /var/run/wolf/wolf.sock
    fi
    
    log_info "Socket permissions updated"
else
    log_warn "Wolf socket did not appear within ${TIMEOUT}s"
    log_warn "Check logs with: $COMPOSE_CMD logs wolf"
fi

log_info "Host runner stack started successfully!"
log_info ""
log_info "Useful commands:"
log_info "  View logs:        $COMPOSE_CMD logs -f"
log_info "  Stop services:    $COMPOSE_CMD down"
log_info "  Restart services: $COMPOSE_CMD restart"
log_info "  View status:      $COMPOSE_CMD ps"

