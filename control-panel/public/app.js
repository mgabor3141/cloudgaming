const wakeButton = document.getElementById('wakeButton');
const messageDiv = document.getElementById('message');
const statusText = document.getElementById('statusText');
const statusDot = document.getElementById('statusDot');

let statusCheckInterval = null;
let isWaitingForWake = false;

// Check device status
async function checkDeviceStatus() {
  try {
    const response = await fetch('/api/status');
    const data = await response.json();

    if (data.success) {
      updateDeviceStatus(data.online, data.latency);
    } else {
      // If DEVICE_IP not configured, show warning but don't disable functionality
      if (data.error && data.error.includes('DEVICE_IP')) {
        statusText.textContent = 'Status check unavailable';
        statusDot.className = 'status-dot checking';
        wakeButton.disabled = false;
      } else {
        updateDeviceStatus(false);
      }
    }
  } catch (error) {
    console.error('Error checking device status:', error);
    updateDeviceStatus(false);
  }
}

// Update device status display
function updateDeviceStatus(online, latency = null) {
  if (online) {
    statusText.textContent = latency ? `Online (${latency}ms)` : 'Online';
    statusDot.className = 'status-dot online';
    wakeButton.disabled = true;
    wakeButton.textContent = 'Device is Awake';
    
    // If we were waiting for wake, show success message
    if (isWaitingForWake) {
      isWaitingForWake = false;
      messageDiv.className = 'message success';
      messageDiv.textContent = 'Device is now online!';
      messageDiv.style.display = 'block';
      setTimeout(() => {
        messageDiv.style.display = 'none';
      }, 5000);
    }
  } else {
    statusText.textContent = 'Offline';
    statusDot.className = 'status-dot offline';
    wakeButton.disabled = false;
    wakeButton.textContent = 'Wake Device';
  }
}

// Wait for device to come online after wake signal
async function waitForDeviceWake(maxWaitTime = 60000, checkInterval = 2000) {
  const startTime = Date.now();
  isWaitingForWake = true;
  
  messageDiv.className = 'message';
  messageDiv.textContent = 'Wake signal sent. Waiting for device to come online...';
  messageDiv.style.display = 'block';
  
  while (Date.now() - startTime < maxWaitTime) {
    await new Promise(resolve => setTimeout(resolve, checkInterval));
    
    try {
      const response = await fetch('/api/status');
      const data = await response.json();
      
      if (data.success && data.online) {
        updateDeviceStatus(true, data.latency);
        return true;
      }
    } catch (error) {
      console.error('Error checking status while waiting:', error);
    }
    
    // Update message with elapsed time
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    messageDiv.textContent = `Wake signal sent. Waiting for device... (${elapsed}s)`;
  }
  
  // Timeout reached
  isWaitingForWake = false;
  messageDiv.className = 'message error';
  messageDiv.textContent = 'Wake signal sent, but device did not come online within the timeout period.';
  return false;
}

// Handle wake button click
wakeButton.addEventListener('click', async () => {
  // Disable button during request
  wakeButton.disabled = true;
  wakeButton.textContent = 'Waking...';

  try {
    const response = await fetch('/api/wake', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();

    if (data.success) {
      // Wait for device to come online
      await waitForDeviceWake();
    } else {
      messageDiv.className = 'message error';
      messageDiv.textContent = data.error || 'Failed to send wake signal';
      messageDiv.style.display = 'block';
      wakeButton.disabled = false;
      wakeButton.textContent = 'Wake Device';
      
      setTimeout(() => {
        messageDiv.style.display = 'none';
      }, 5000);
    }
  } catch (error) {
    messageDiv.className = 'message error';
    messageDiv.textContent = 'Network error: ' + error.message;
    messageDiv.style.display = 'block';
    wakeButton.disabled = false;
    wakeButton.textContent = 'Wake Device';
    
    setTimeout(() => {
      messageDiv.style.display = 'none';
    }, 5000);
  }
});

// Start periodic status checking
function startStatusPolling() {
  // Check immediately
  checkDeviceStatus();
  
  // Then check every 5 seconds
  statusCheckInterval = setInterval(checkDeviceStatus, 5000);
}

// Stop periodic status checking
function stopStatusPolling() {
  if (statusCheckInterval) {
    clearInterval(statusCheckInterval);
    statusCheckInterval = null;
  }
}

// Start polling on page load
startStatusPolling();

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  stopStatusPolling();
});
