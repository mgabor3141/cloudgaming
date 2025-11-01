import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { wake } from 'wake_on_lan';
import ping from 'ping';

// Use global fetch if available (Node 18+), otherwise we'll need to handle differently
const fetch = globalThis.fetch;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const MAC_ADDRESS = process.env.MAC_ADDRESS;
const DEVICE_IP = process.env.DEVICE_IP;
const HOST_INFO_URL = process.env.HOST_INFO_URL || 'http://localhost:3001';

if (!MAC_ADDRESS) {
  console.error('Error: MAC_ADDRESS environment variable is not set');
  process.exit(1);
}

if (!DEVICE_IP) {
  console.warn('Warning: DEVICE_IP environment variable is not set. Status checking will be disabled.');
}

// Middleware
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// Combined status endpoint - checks ping and host-info metrics
app.get('/api/status', async (req, res) => {
  if (!DEVICE_IP) {
    return res.status(503).json({
      success: false,
      error: 'DEVICE_IP not configured'
    });
  }

  try {
    // Check ping status
    const pingResult = await ping.promise.probe(DEVICE_IP, {
      timeout: 2,
      min_reply: 1
    });

    const online = pingResult.alive;
    const latency = online ? parseFloat(pingResult.time) : null;

    // If online, try to get metrics from host-info
    let metrics = null;
    let metricsAvailable = false;
    
    if (online) {
      try {
        // Use AbortController for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        
        const metricsResponse = await fetch(`${HOST_INFO_URL}/api/metrics`, {
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (metricsResponse.ok) {
          metrics = await metricsResponse.json();
          metricsAvailable = true;
        }
      } catch (error) {
        // Metrics unavailable - host is online but game server not responding
        metricsAvailable = false;
      }
    }

    // Determine availability state
    let availability = null;
    let availabilityStatus = null;
    let statusMessage = null;

    if (!online) {
      // Host offline - available for wake
      availability = 'available';
      availabilityStatus = 'offline_available';
      statusMessage = 'Host is offline - Available for gaming (can be woken)';
    } else if (metricsAvailable && metrics.success) {
      if (!metrics.busy) {
        // Online and not busy - available
        availability = 'available';
        availabilityStatus = 'online_available';
        statusMessage = 'Host is online and available for gaming';
      } else {
        // Online but busy - unavailable
        availability = 'unavailable';
        availabilityStatus = 'online_busy';
        statusMessage = 'Host is busy - Not available for gaming';
      }
    } else {
      // Online but metrics unavailable - game server unavailable
      availability = 'unavailable';
      availabilityStatus = 'online_no_metrics';
      statusMessage = 'Host is online but game server is unavailable';
    }

    res.json({
      success: true,
      online,
      latency,
      metricsAvailable,
      metrics: metricsAvailable && metrics ? {
        busy: metrics.busy,
        overallUtilization: metrics.overallUtilization,
        graph: metrics.graph
      } : null,
      availability,
      availabilityStatus,
      statusMessage
    });
  } catch (error) {
    console.error('Error checking device status:', error);
    res.status(500).json({
      success: false,
      online: false,
      error: 'Failed to check device status'
    });
  }
});

// Wake-on-LAN endpoint
app.post('/api/wake', async (req, res) => {
  try {
    const targetMac = MAC_ADDRESS;
    
    // Validate MAC address format (basic check)
    if (!/^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/.test(targetMac)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid MAC address format' 
      });
    }

    // Send Wake-on-LAN packet
    await new Promise((resolve, reject) => {
      wake(targetMac, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });

    res.json({ 
      success: true, 
      message: `Wake-on-LAN packet sent to ${targetMac}` 
    });
  } catch (error) {
    console.error('Error sending Wake-on-LAN packet:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to send Wake-on-LAN packet',
      details: error.message 
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Control Panel server running on http://0.0.0.0:${PORT}`);
  console.log(`Server accessible from LAN at http://<your-ip>:${PORT}`);
  console.log(`Target MAC Address: ${MAC_ADDRESS}`);
  if (DEVICE_IP) {
    console.log(`Device IP: ${DEVICE_IP}`);
  }
});

