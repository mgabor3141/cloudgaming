const wakeButton = document.getElementById('wakeButton');
const messageDiv = document.getElementById('message');
const statusText = document.getElementById('statusText');
const statusDot = document.getElementById('statusDot');
const availabilityStatus = document.getElementById('availabilityStatus');
const availabilityIcon = document.getElementById('availabilityIcon');
const availabilityText = document.getElementById('availabilityText');
const metricsChartContainer = document.getElementById('metricsChartContainer');
const metricsChart = document.getElementById('metricsChart');
const metricsLabel = document.getElementById('metricsLabel');

let statusCheckInterval = null;
let isWaitingForWake = false;

// Draw mini chart
function drawChart(dataPoints, timeRange) {
  if (!dataPoints || dataPoints.length === 0) {
    metricsChartContainer.style.display = 'none';
    return;
  }

  if (dataPoints.length < 2) {
    metricsChartContainer.style.display = 'none';
    return;
  }

  metricsChartContainer.style.display = 'flex';

  // Canvas dimensions (logical size)
  const logicalWidth = 120;
  const logicalHeight = 48;
  const padding = 3;

  // Get device pixel ratio for crisp rendering on high DPI displays
  const dpr = window.devicePixelRatio || 1;

  // Set actual canvas size accounting for device pixel ratio
  metricsChart.width = logicalWidth * dpr;
  metricsChart.height = logicalHeight * dpr;

  // Set CSS size to logical size
  metricsChart.style.width = logicalWidth + 'px';
  metricsChart.style.height = logicalHeight + 'px';

  const ctx = metricsChart.getContext('2d');
  
  // Scale context for high DPI
  ctx.scale(dpr, dpr);

  // Clear canvas
  ctx.clearRect(0, 0, logicalWidth, logicalHeight);

  // Fixed time scale - always 5 minutes (300000 ms)
  const now = Date.now();
  const fixedTimeRange = 5 * 60 * 1000; // 5 minutes in ms
  const timeStart = now - fixedTimeRange;
  const timeEnd = now;

  // Always scale from 0 to 100% on Y axis
  const drawWidth = logicalWidth - padding * 2;
  const drawHeight = logicalHeight - padding * 2;
  const baselineY = padding + drawHeight;

  // Find first and last data points (already sorted by timestamp from backend)
  const sortedPoints = [...dataPoints].sort((a, b) => a.timestamp - b.timestamp);
  const firstDataPoint = sortedPoints[0];
  const lastDataPoint = sortedPoints[sortedPoints.length - 1];
  
  // Calculate X positions based on timestamps within the fixed time range
  // Leave gap on left for time we don't have data for
  const points = sortedPoints
    .filter(point => point.timestamp >= timeStart && point.timestamp <= timeEnd)
    .map(point => {
      // Calculate X position based on timestamp relative to the fixed time range
      // This creates a fixed scale where the right edge is always "now"
      const timeOffset = point.timestamp - timeStart;
      const timeRatio = timeOffset / fixedTimeRange;
      // Map to full drawWidth - this leaves a gap on the left if data starts later
      const x = padding + (timeRatio * drawWidth);
      
      // Normalize to 0-100% scale (top edge = 100%, bottom edge = 0%)
      const normalized = Math.min(Math.max(point.utilization / 100, 0), 1);
      const y = padding + drawHeight - (normalized * drawHeight);
      
      return { x, y, timestamp: point.timestamp };
    });

  ctx.strokeStyle = '#667eea';
  ctx.fillStyle = 'rgba(102, 126, 234, 0.2)';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.beginPath();
  
  // Draw smooth curve using quadratic bezier curves
  if (points.length > 0) {
    // Start from first point
    ctx.moveTo(points[0].x, points[0].y);
    
    if (points.length === 1) {
      // Single point - just draw a line
      ctx.lineTo(points[0].x, baselineY);
      ctx.lineTo(points[0].x, baselineY);
    } else if (points.length === 2) {
      // Two points - straight line
      ctx.lineTo(points[1].x, points[1].y);
      ctx.lineTo(points[1].x, baselineY);
      ctx.lineTo(points[0].x, baselineY);
    } else {
      // Multiple points - smooth curve
      for (let i = 0; i < points.length - 1; i++) {
        const current = points[i];
        const next = points[i + 1];
        
        // Calculate control point for smooth curve between current and next
        // Use midpoints for smoother transitions
        const cpX = (current.x + next.x) / 2;
        const cpY = (current.y + next.y) / 2;
        
        ctx.quadraticCurveTo(current.x, current.y, cpX, cpY);
      }
      
      // Complete the curve to the last point
      ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
      
      // Close path for fill - to baseline
      ctx.lineTo(points[points.length - 1].x, baselineY);
      ctx.lineTo(points[0].x, baselineY);
    }
    
    ctx.closePath();
    ctx.fill();
    
    // Redraw just the top curve line with smooth curve
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    
    if (points.length > 2) {
      for (let i = 0; i < points.length - 1; i++) {
        const current = points[i];
        const next = points[i + 1];
        const cpX = (current.x + next.x) / 2;
        const cpY = (current.y + next.y) / 2;
        ctx.quadraticCurveTo(current.x, current.y, cpX, cpY);
      }
    }
    
    if (points.length > 1) {
      ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
    }
    ctx.stroke();
  }
}

// Check device status
async function checkDeviceStatus() {
  try {
    const response = await fetch('/api/status');
    const data = await response.json();

    if (data.success) {
      updateAvailabilityStatus(data);
      updateDeviceStatus(data.online, data.latency);
      
      // Draw chart if metrics available
      if (data.metricsAvailable && data.metrics && data.metrics.graph) {
        drawChart(data.metrics.graph.dataPoints);
        const util = data.metrics.overallUtilization !== undefined 
          ? Math.round(data.metrics.overallUtilization) 
          : 'N/A';
        metricsLabel.innerHTML = `${util}% average utilization<br/>(last 5 minutes)`;
      } else {
        metricsChartContainer.style.display = 'none';
      }
    } else {
      // If DEVICE_IP not configured, show warning but don't disable functionality
      if (data.error && data.error.includes('DEVICE_IP')) {
        availabilityText.textContent = 'Configuration required';
        availabilityIcon.className = 'availability-icon unavailable';
        statusText.textContent = 'Status check unavailable';
        statusDot.className = 'status-dot checking';
        wakeButton.disabled = false;
      } else {
        updateAvailabilityStatus({ availability: 'unavailable', availabilityStatus: 'error' });
        updateDeviceStatus(false);
      }
    }
  } catch (error) {
    console.error('Error checking device status:', error);
    updateAvailabilityStatus({ availability: 'unavailable', availabilityStatus: 'error' });
    updateDeviceStatus(false);
  }
}

// Update availability status - most prominent display
function updateAvailabilityStatus(data) {
  const { availability, availabilityStatus: status, statusMessage } = data;

  availabilityText.textContent = statusMessage || 'Checking...';

  // Remove all status classes
  availabilityStatus.className = 'availability-status';
  availabilityIcon.className = 'availability-icon';

  if (availability === 'available') {
    availabilityStatus.classList.add('available');
    availabilityIcon.classList.add('available');
    availabilityIcon.textContent = '✓';
  } else if (availability === 'unavailable') {
    availabilityStatus.classList.add('unavailable');
    availabilityIcon.classList.add('unavailable');
    
    if (status === 'online_busy') {
      availabilityIcon.textContent = '⏸';
    } else if (status === 'online_no_metrics') {
      availabilityIcon.textContent = '⚠';
    } else {
      availabilityIcon.textContent = '✗';
    }
  } else {
    availabilityStatus.classList.add('checking');
    availabilityIcon.classList.add('checking');
    availabilityIcon.textContent = '⋯';
  }
}

// Update device status display
function updateDeviceStatus(online, latency = null) {
  if (online) {
    statusText.textContent = latency ? `Online (${latency}ms)` : 'Online';
    statusDot.className = 'status-dot online';
    
    // Wake button disabled when online
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
        updateAvailabilityStatus(data);
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
