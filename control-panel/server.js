import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import wol from 'wake-on-lan';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const MAC_ADDRESS = process.env.MAC_ADDRESS;

if (!MAC_ADDRESS) {
  console.error('Error: MAC_ADDRESS environment variable is not set');
  process.exit(1);
}

// Middleware
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

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
      wol(targetMac, (error) => {
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
});

