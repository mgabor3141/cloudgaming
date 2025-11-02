# cloudgaming

A [Games on Whales](https://games-on-whales.github.io/) deployment with remote wake, availability and smart system sleep inhibit

<img width="250" alt="image" src="https://github.com/user-attachments/assets/02c79524-0341-4047-8cf5-23c47161fcfc" /> <img width="250" alt="image" src="https://github.com/user-attachments/assets/4dae285e-8d36-4c46-9cd1-2d222533132c" /> <img width="250" alt="image" src="https://github.com/user-attachments/assets/1372c3a8-6854-4320-af52-2edbd6174bdb" />


## Features

- Web Dashboard
  - Utilization display, so that you can tell if the PC is free
  - Get notified when it becomes free
  - Remotely wake the PC if needed
- Wolf deployment
  - System sleep prevention if a client is active

## Deployment

Deploy Wolf with tailscale access and the added components using [host-runner/docker-compose.yml](host-runner)

Deploy the dashboard with the [control-panel](control-panel) docker image
