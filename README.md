# cloudgaming

A [Games on Whales: Wolf](https://games-on-whales.github.io/) deployment with remote wake, availability detection and sleep prevention

## Features

- Web Dashboard:
  - Utilization display, so that you can tell if the PC is free
  - Get notified when it becomes free
  - Remotely wake the PC if needed
- Wolf depoloyment
  - System sleep prevention if a client is active

## Deployment

Deploy Wolf with tailscale access and the added components using host-runner/docker-compose.yml

Deploy the dashboard with the control-panel docker image
