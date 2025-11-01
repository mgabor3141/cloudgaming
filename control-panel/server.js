import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { wake } from 'wake_on_lan';
import ping from 'ping';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const MAC_ADDRESS = process.env.MAC_ADDRESS;
const DEVICE_IP = process.env.DEVICE_IP;

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

// Device status endpoint
app.get('/api/status', async (req, res) => {
  if (!DEVICE_IP) {
    return res.status(503).json({
      success: false,
      error: 'DEVICE_IP not configured'
    });
  }

  try {
    const result = await ping.promise.probe(DEVICE_IP, {
      timeout: 2,
      min_reply: 1
    });

    res.json({
      success: true,
      online: result.alive,
      latency: result.alive ? parseFloat(result.time) : null
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

app.listen(PORT, () => {
  console.log(`Control Panel server running on http://localhost:${PORT}`);
  console.log(`Target MAC Address: ${MAC_ADDRESS}`);
  if (DEVICE_IP) {
    console.log(`Device IP: ${DEVICE_IP}`);
  }
});

