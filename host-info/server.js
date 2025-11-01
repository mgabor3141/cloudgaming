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

// Check if system is busy based on thresholds
function isBusy() {
  const cutoff = Date.now() - METRICS_RETENTION_MS;
  const recentMetrics = metricsHistory.filter((m) => m.timestamp >= cutoff);

  if (recentMetrics.length === 0) {
    return false; // No data, assume not busy
  }

  // Check if any metric exceeded threshold in the past 5 minutes
  const exceededThreshold = recentMetrics.some((metric) => {
    const cpuBusy = metric.cpuUtilization >= CPU_UTIL_THRESHOLD;
    const gpuUtilBusy =
      metric.gpuUtilization !== null &&
      metric.gpuUtilization >= GPU_UTIL_THRESHOLD;
    const gpuMemBusy =
      metric.gpuMemoryPercent !== null &&
      metric.gpuMemoryPercent >= GPU_MEM_THRESHOLD;

    return cpuBusy || gpuUtilBusy || gpuMemBusy;
  });

  return exceededThreshold;
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

    res.json({
      success: true,
      ...metric,
      busy: isBusy(),
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
    const recentMetrics = metricsHistory.filter(
      (m) => m.timestamp >= Date.now() - METRICS_RETENTION_MS
    );

    const latest = recentMetrics[recentMetrics.length - 1] || null;

    res.json({
      success: true,
      busy,
      thresholds: {
        cpu: CPU_UTIL_THRESHOLD,
        gpuUtil: GPU_UTIL_THRESHOLD,
        gpuMem: GPU_MEM_THRESHOLD,
      },
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
});

