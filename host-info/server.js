import express from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Configuration from environment variables
const GPU_UTIL_THRESHOLD = parseFloat(process.env.GPU_UTIL_THRESHOLD || '80'); // %
const GPU_MEM_THRESHOLD = parseFloat(process.env.GPU_MEM_THRESHOLD || '50'); // %
const CPU_UTIL_THRESHOLD = parseFloat(process.env.CPU_UTIL_THRESHOLD || '80'); // %
const METRICS_RETENTION_MS = 5 * 60 * 1000; // 5 minutes
const BUSY_THRESHOLD_PERCENT = parseFloat(process.env.BUSY_THRESHOLD_PERCENT || '60'); // % of samples that must exceed thresholds

// In-memory metrics storage
const metricsHistory = [];

// CPU utilization calculation - needs two measurements over time
let previousCpuMeasurements = null;

function calculateCpuUtilization() {
  const cpus = os.cpus();
  let totalIdle = 0;
  let totalTick = 0;

  cpus.forEach((cpu) => {
    for (const type in cpu.times) {
      totalTick += cpu.times[type];
    }
    totalIdle += cpu.times.idle;
  });

  const idle = totalIdle / cpus.length;
  const total = totalTick / cpus.length;

  if (previousCpuMeasurements === null) {
    previousCpuMeasurements = { idle, total };
    return null; // Need second measurement
  }

  const idleDiff = idle - previousCpuMeasurements.idle;
  const totalDiff = total - previousCpuMeasurements.total;
  const usage = 100 - ((idleDiff / totalDiff) * 100);

  previousCpuMeasurements = { idle, total };
  return Math.max(0, Math.min(100, usage));
}

async function getCpuUtilization() {
  // Calculate immediately
  let usage = calculateCpuUtilization();
  
  // If null, we need a second measurement - wait and recalculate
  if (usage === null) {
    await new Promise(resolve => setTimeout(resolve, 100));
    usage = calculateCpuUtilization();
  }
  
  return usage !== null ? usage : 0;
}

// Get GPU metrics via nvidia-smi
async function getGpuMetrics() {
  try {
    const { stdout } = await execAsync(
      'nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits'
    );

    const lines = stdout.trim().split('\n');
    if (lines.length === 0) {
      return null;
    }

    // Get the first GPU (or aggregate if multiple)
    const metrics = lines.map((line) => {
      const [util, memUsed, memTotal] = line.split(', ').map(Number);
      return {
        utilization: util,
        memoryUsed: memUsed,
        memoryTotal: memTotal,
        memoryPercent: (memUsed / memTotal) * 100,
      };
    });

    // For now, return the first GPU or average if multiple
    if (metrics.length === 1) {
      return metrics[0];
    }

    // Aggregate multiple GPUs (average utilization, sum memory)
    const avgUtil = metrics.reduce((sum, m) => sum + m.utilization, 0) / metrics.length;
    const totalMemUsed = metrics.reduce((sum, m) => sum + m.memoryUsed, 0);
    const totalMemTotal = metrics.reduce((sum, m) => sum + m.memoryTotal, 0);

    return {
      utilization: avgUtil,
      memoryUsed: totalMemUsed,
      memoryTotal: totalMemTotal,
      memoryPercent: (totalMemUsed / totalMemTotal) * 100,
    };
  } catch (error) {
    console.error('Error getting GPU metrics:', error.message);
    return null;
  }
}

// Collect metrics and store in history
async function collectMetrics() {
  const timestamp = Date.now();

  try {
    const [cpuUtil, gpuMetrics] = await Promise.all([
      getCpuUtilization(),
      getGpuMetrics(),
    ]);

    const metric = {
      timestamp,
      cpuUtilization: cpuUtil,
      gpuUtilization: gpuMetrics?.utilization ?? null,
      gpuMemoryPercent: gpuMetrics?.memoryPercent ?? null,
    };

    metricsHistory.push(metric);

    // Clean up old metrics (older than retention period)
    const cutoff = timestamp - METRICS_RETENTION_MS;
    const index = metricsHistory.findIndex((m) => m.timestamp > cutoff);
    if (index > 0) {
      metricsHistory.splice(0, index);
    }

    return metric;
  } catch (error) {
    console.error('Error collecting metrics:', error);
    return null;
  }
}

// Check if system is busy based on thresholds with time-weighted sampling
function isBusy() {
  const cutoff = Date.now() - METRICS_RETENTION_MS;
  const recentMetrics = metricsHistory.filter((m) => m.timestamp >= cutoff);

  if (recentMetrics.length === 0) {
    return false; // No data, assume not busy
  }

  const now = Date.now();
  let totalWeight = 0;
  let busyWeight = 0;
  
  // Use exponential decay - more recent samples get exponentially higher weights
  // Weight = e^(-age_in_minutes * decay_factor)
  // This gives recent samples much more weight
  const decayFactor = 2.0; // Higher = more bias toward recent
  
  recentMetrics.forEach((metric) => {
    const ageMinutes = (now - metric.timestamp) / (60 * 1000);
    // Exponential decay: weight decreases exponentially with age
    // Most recent sample (age ~0) has weight ~1.0
    // 1 minute ago has weight ~0.135 (e^-2)
    // 2.5 minutes ago has weight ~0.007
    const weight = Math.exp(-ageMinutes * decayFactor);
    
    const cpuBusy = metric.cpuUtilization >= CPU_UTIL_THRESHOLD;
    const gpuUtilBusy =
      metric.gpuUtilization !== null &&
      metric.gpuUtilization >= GPU_UTIL_THRESHOLD;
    const gpuMemBusy =
      metric.gpuMemoryPercent !== null &&
      metric.gpuMemoryPercent >= GPU_MEM_THRESHOLD;

    // Consider this sample busy if any metric exceeds threshold
    if (cpuBusy || gpuUtilBusy || gpuMemBusy) {
      busyWeight += weight;
    }
    
    totalWeight += weight;
  });

  // Calculate weighted busy percentage
  // If totalWeight is 0 (shouldn't happen), default to not busy
  if (totalWeight === 0) {
    return false;
  }
  
  const weightedBusyPercentage = (busyWeight / totalWeight) * 100;
  return weightedBusyPercentage >= BUSY_THRESHOLD_PERCENT;
}

// Calculate overall utilization (combination of CPU and GPU)
function calculateOverallUtilization(metric) {
  // Use the maximum of CPU and GPU utilization as overall utilization
  // This gives a better sense of system load
  const cpuUtil = metric.cpuUtilization || 0;
  const gpuUtil = metric.gpuUtilization !== null ? metric.gpuUtilization : 0;
  
  // Return the maximum, or average if you prefer more balanced view
  // Using max to show peak utilization
  return Math.max(cpuUtil, gpuUtil);
}

// Get current metrics
app.get('/api/metrics', async (req, res) => {
  try {
    const metric = await collectMetrics();

    if (!metric) {
      return res.status(500).json({
        success: false,
        error: 'Failed to collect metrics',
      });
    }

    // Calculate weighted metrics for display
    const now = Date.now();
    const cutoff = now - METRICS_RETENTION_MS;
    const allRecentMetrics = metricsHistory.filter((m) => m.timestamp >= cutoff);
    let totalWeight = 0;
    let busyWeight = 0;
    let busySamples = 0;
    const decayFactor = 2.0;
    
    if (allRecentMetrics.length > 0) {
      allRecentMetrics.forEach((m) => {
        const ageMinutes = (now - m.timestamp) / (60 * 1000);
        const weight = Math.exp(-ageMinutes * decayFactor);
        
        const cpuBusy = m.cpuUtilization >= CPU_UTIL_THRESHOLD;
        const gpuUtilBusy =
          m.gpuUtilization !== null &&
          m.gpuUtilization >= GPU_UTIL_THRESHOLD;
        const gpuMemBusy =
          m.gpuMemoryPercent !== null &&
          m.gpuMemoryPercent >= GPU_MEM_THRESHOLD;

        if (cpuBusy || gpuUtilBusy || gpuMemBusy) {
          busyWeight += weight;
          busySamples++;
        }
        
        totalWeight += weight;
      });
    }
    
    const weightedBusyPercentage = totalWeight > 0 
      ? (busyWeight / totalWeight) * 100 
      : 0;

    // Prepare graph data - return metrics with overall utilization for graphing
    const graphData = allRecentMetrics
      .map((m) => ({
        timestamp: m.timestamp,
        utilization: calculateOverallUtilization(m),
      }))
      .sort((a, b) => a.timestamp - b.timestamp); // Sort by timestamp ascending

    // Calculate current overall utilization
    const currentUtilization = calculateOverallUtilization(metric);

    res.json({
      success: true,
      ...metric,
      overallUtilization: Math.round(currentUtilization * 10) / 10,
      busy: isBusy(),
      busyPercentage: Math.round(weightedBusyPercentage * 10) / 10,
      sampleCount: allRecentMetrics.length,
      busySampleCount: busySamples,
      graph: {
        dataPoints: graphData,
        // Provide time range for graph scaling
        timeRange: {
          start: cutoff,
          end: now,
          durationMs: METRICS_RETENTION_MS,
        },
      },
    });
  } catch (error) {
    console.error('Error in /api/metrics:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// Get busy status
app.get('/api/busy', async (req, res) => {
  try {
    // Collect current metrics first
    await collectMetrics();

    const busy = isBusy();
    const cutoff = Date.now() - METRICS_RETENTION_MS;
    const recentMetrics = metricsHistory.filter((m) => m.timestamp >= cutoff);

    const latest = recentMetrics[recentMetrics.length - 1] || null;

    // Calculate weighted busy percentage for additional context
    // More recent samples count more
    const now = Date.now();
    let totalWeight = 0;
    let busyWeight = 0;
    let busySamples = 0; // Also count for display
    
    const decayFactor = 2.0; // Same as in isBusy()
    
    if (recentMetrics.length > 0) {
      recentMetrics.forEach((metric) => {
        const ageMinutes = (now - metric.timestamp) / (60 * 1000);
        const weight = Math.exp(-ageMinutes * decayFactor);
        
        const cpuBusy = metric.cpuUtilization >= CPU_UTIL_THRESHOLD;
        const gpuUtilBusy =
          metric.gpuUtilization !== null &&
          metric.gpuUtilization >= GPU_UTIL_THRESHOLD;
        const gpuMemBusy =
          metric.gpuMemoryPercent !== null &&
          metric.gpuMemoryPercent >= GPU_MEM_THRESHOLD;

        if (cpuBusy || gpuUtilBusy || gpuMemBusy) {
          busyWeight += weight;
          busySamples++;
        }
        
        totalWeight += weight;
      });
    }
    
    const weightedBusyPercentage = totalWeight > 0 
      ? (busyWeight / totalWeight) * 100 
      : 0;
    const simpleBusyPercentage = recentMetrics.length > 0 
      ? (busySamples / recentMetrics.length) * 100 
      : 0;

    res.json({
      success: true,
      busy,
      thresholds: {
        cpu: CPU_UTIL_THRESHOLD,
        gpuUtil: GPU_UTIL_THRESHOLD,
        gpuMem: GPU_MEM_THRESHOLD,
        busyThresholdPercent: BUSY_THRESHOLD_PERCENT,
      },
      busyPercentage: Math.round(weightedBusyPercentage * 10) / 10,
      simpleBusyPercentage: Math.round(simpleBusyPercentage * 10) / 10,
      sampleCount: recentMetrics.length,
      busySampleCount: busySamples,
      latest: latest
        ? {
            cpuUtilization: latest.cpuUtilization,
            gpuUtilization: latest.gpuUtilization,
            gpuMemoryPercent: latest.gpuMemoryPercent,
          }
        : null,
    });
  } catch (error) {
    console.error('Error in /api/busy:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Start collecting metrics periodically (every 10 seconds)
setInterval(collectMetrics, 10000);

// Collect initial metrics
collectMetrics().catch(console.error);

app.listen(PORT, () => {
  console.log(`Host Info server running on http://localhost:${PORT}`);
  console.log(`Thresholds: CPU=${CPU_UTIL_THRESHOLD}%, GPU Util=${GPU_UTIL_THRESHOLD}%, GPU Mem=${GPU_MEM_THRESHOLD}%`);
  console.log(`Busy threshold: ${BUSY_THRESHOLD_PERCENT}% of samples must exceed thresholds (sustained load required)`);
});

