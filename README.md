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
   export PORT=3000  # Optional, defaults to 3000
   ```

   Or create a `.env` file in the `control-panel` directory:
   ```
   MAC_ADDRESS=00:11:22:33:44:55
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
     --name control-panel \
     control-panel
   ```

   Or using docker-compose (create a `docker-compose.yml` if needed):
   ```bash
   docker run -d -p 3000:3000 -e MAC_ADDRESS=00:11:22:33:44:55 control-panel
   ```

### Environment Variables

- `MAC_ADDRESS` (required): The MAC address of the target device in format `XX:XX:XX:XX:XX:XX` or `XX-XX-XX-XX-XX-XX`
- `PORT` (optional): Server port, defaults to 3000

### Usage

1. Open the web interface at `http://localhost:3000`
2. Click the "Wake Device" button
3. A Wake-on-LAN packet will be sent to the configured MAC address

