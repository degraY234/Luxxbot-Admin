import fs from 'fs';
import path from 'path';
import { getWaHealth } from '../wa-status.js';
import { getDiscordDiagnostics } from './discord-radio.js';
import { getYoutubeCookiesStatus } from '../utils/youtube-cookies.js';
import { getSessionDiagnostics } from '../utils/wa-session.js';
import { getRadioPublicUrl, getLanIPv4 } from '../utils/radio-url.js';

const GUARDIAN_MAX_ALERTS = 60;
const CONFIG_DIR = path.resolve('./config');
const ENV_PATH = path.resolve('./.env');
const HEALTH_CHECK_INTERVAL_MS = 15_000;

const alerts = [];
const watchers = new Map();
let healthTimer = null;
let lastHealthIssues = [];
let lastHealthAt = null;
let lastConfigChangeAt = null;
let lastConfigChangedFiles = [];

function makeAlert(type, message, metadata = {}) {
  const alert = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    type,
    message,
    metadata,
    createdAt: new Date().toISOString(),
    acknowledged: false
  };

  alerts.unshift(alert);
  if (alerts.length > GUARDIAN_MAX_ALERTS) alerts.length = GUARDIAN_MAX_ALERTS;
  return alert;
}

function normalizeIssues(items = []) {
  return [...new Set(items)].map((item) => String(item).trim()).filter(Boolean);
}

function onConfigChanged(filePath) {
  const fileName = path.basename(filePath);
  const now = new Date();
  if (lastConfigChangedFiles[0] !== fileName) {
    lastConfigChangedFiles.unshift(fileName);
    if (lastConfigChangedFiles.length > 10) lastConfigChangedFiles.length = 10;
  }
  lastConfigChangeAt = now.toISOString();
  makeAlert('config', `Config berubah: ${fileName}`, { filePath });
}

function gatherConfigPaths() {
  const paths = [ENV_PATH];
  if (fs.existsSync(CONFIG_DIR)) {
    try {
      for (const file of fs.readdirSync(CONFIG_DIR)) {
        const filePath = path.join(CONFIG_DIR, file);
        try {
          if (fs.statSync(filePath).isFile()) paths.push(filePath);
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }
  }
  return [...new Set(paths)];
}

function watchPath(filePath) {
  if (watchers.has(filePath)) return;
  try {
    const watcher = fs.watch(filePath, { persistent: false }, (_eventType, filename) => {
      if (!filename) return;
      onConfigChanged(filePath);
      if (path.basename(filePath) === path.basename(CONFIG_DIR)) {
        scheduleWatchReload();
      }
    });
    watchers.set(filePath, watcher);
  } catch {
    // ignore
  }
}

let watchReloadTimeout = null;
function scheduleWatchReload() {
  if (watchReloadTimeout) return;
  watchReloadTimeout = setTimeout(() => {
    watchReloadTimeout = null;
    refreshConfigWatchers();
  }, 800);
}

function refreshConfigWatchers() {
  stopConfigWatchers();
  const paths = gatherConfigPaths();
  for (const filePath of paths) {
    watchPath(filePath);
  }
  if (fs.existsSync(CONFIG_DIR)) {
    watchPath(CONFIG_DIR);
  }
}

function stopConfigWatchers() {
  for (const watcher of watchers.values()) {
    try { watcher.close(); } catch { }
  }
  watchers.clear();
}

function getIssues() {
  const wa = getWaHealth();
  const session = getSessionDiagnostics();
  const discord = getDiscordDiagnostics();
  const yt = getYoutubeCookiesStatus();
  const publicUrl = getRadioPublicUrl();
  const lanUrl = getLanIPv4();

  const issues = [];
  if (!wa.connected) issues.push('WhatsApp tidak terkoneksi');
  if (wa.connected && wa.connection !== 'open') issues.push(`WhatsApp state: ${wa.connection}`);
  if (wa.connected && !wa.handlersReady) issues.push('WhatsApp handler belum siap');
  if (!session.paired) issues.push('Session WA belum pair');
  if (!discord.slashReady) issues.push('Discord slash command belum siap');
  if (!yt.ready) issues.push('YouTube cookies belum aktif');
  if (!publicUrl && !lanUrl) issues.push('Public / LAN URL belum tersedia');
  return { wa, session, discord, yt, publicUrl, lanUrl, issues: normalizeIssues(issues) };
}

function runHealthCheck() {
  const result = getIssues();
  lastHealthAt = new Date().toISOString();

  const currentIssues = result.issues;
  const currentKey = currentIssues.join(' | ');
  const previousKey = lastHealthIssues.join(' | ');

  if (currentKey !== previousKey) {
    if (currentIssues.length > 0) {
      makeAlert('health', `Health check: ${currentIssues.join('; ')}`, { issues: currentIssues });
    } else if (lastHealthIssues.length > 0) {
      makeAlert('health-resolved', 'Semua layanan sehat kembali.', { previous: lastHealthIssues });
    }
    lastHealthIssues = currentIssues;
  }
}

export function getGuardianStatus() {
  return {
    lastCheck: lastHealthAt,
    issues: lastHealthIssues,
    config: {
      lastChangeAt: lastConfigChangeAt,
      changedFiles: lastConfigChangedFiles.slice(0, 5)
    },
    alertCount: alerts.length,
    activeAlerts: alerts.slice(0, 8)
  };
}

export function getGuardianAlerts() {
  return [...alerts];
}

export function acknowledgeGuardianAlert(id) {
  const alert = alerts.find((item) => item.id === id);
  if (alert) alert.acknowledged = true;
  return alert;
}

export function startGuardian() {
  if (healthTimer) return;
  refreshConfigWatchers();
  runHealthCheck();
  healthTimer = setInterval(runHealthCheck, HEALTH_CHECK_INTERVAL_MS);
}

export function stopGuardian() {
  if (healthTimer) {
    clearInterval(healthTimer);
    healthTimer = null;
  }
  stopConfigWatchers();
}
