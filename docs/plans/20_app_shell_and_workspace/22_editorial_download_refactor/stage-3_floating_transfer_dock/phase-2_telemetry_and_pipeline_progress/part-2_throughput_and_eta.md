# Stage 3 · Phase 2 · Part 2: Real-time Throughput & Dynamic ETA

## 1. Objectives
Calculate transfer velocity (MB/s) and dynamic time remaining (ETA) on the client side from sequential polling deltas.

## 2. Technical Specification

### 2.1 Velocity Calculator Algorithm (`reader/static/app.js`)
```javascript
let lastSample = { time: 0, done: 0 };
let currentRate = 0; // bytes per second

function recordJobProgress(j) {
  if (!j || !j.done || j.total <= 100000) {
    lastSample = { time: 0, done: 0 };
    currentRate = 0;
    return;
  }
  const now = performance.now();
  if (lastSample.time > 0) {
    const elapsedSec = (now - lastSample.time) / 1000;
    if (elapsedSec >= 0.5) {
      const deltaBytes = j.done - lastSample.done;
      if (deltaBytes > 0) {
        const instantRate = deltaBytes / elapsedSec;
        // Exponential moving average to avoid jitter
        currentRate = currentRate === 0 ? instantRate : (currentRate * 0.7) + (instantRate * 0.3);
      }
      lastSample = { time: now, done: j.done };
    }
  } else {
    lastSample = { time: now, done: j.done };
  }
}

function calculateETA(j) {
  if (!j || !j.total || !j.done || currentRate <= 0) return null;
  const remainingBytes = j.total - j.done;
  const seconds = Math.ceil(remainingBytes / currentRate);
  if (seconds <= 0) return '0s';
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  return `${mins}m ${seconds % 60}s`;
}
```

### 2.2 Telemetry Display Line
```javascript
const rateText = currentRate > 102400 ? `${(currentRate / 1048576).toFixed(1)} MB/s` : '';
const etaText = calculateETA(j) ? `ETA ${calculateETA(j)}` : '';
const speedInfo = [rateText, etaText].filter(Boolean).join(' · ');
```

## 3. Acceptance Criteria
- [ ] Transfer rate smoothly adjusts without wild fluctuations.
- [ ] ETA formats cleanly as seconds or minutes/seconds.
- [ ] Calculation gracefully clears once download completes.
