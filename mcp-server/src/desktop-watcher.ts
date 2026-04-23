import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';
import type { IngressEvent } from './types.js';

interface TDSessionInfo {
  identity?: {
    email?: string;
    companies?: Array<{
      lastTrack?: {
        online?: boolean;
        taskId?: string;
        projectId?: string;
        activeAt?: string;
      };
      name?: string;
      id?: string;
    }>;
  };
  trackerStatus?: string;
  userFullName?: string;
}

export interface DesktopWatcher {
  start(): void;
  stop(): void;
}

function getSessionInfoPath(): string {
  const os = platform();
  if (os === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'TD', 'timedoctor2', 'sessionInfo.json');
  }
  if (os === 'win32') {
    return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'TD', 'timedoctor2', 'sessionInfo.json');
  }
  return join(homedir(), '.config', 'TD', 'timedoctor2', 'sessionInfo.json');
}

function readSessionInfo(path: string): TDSessionInfo | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

export function createDesktopWatcher(
  onEvent: (event: IngressEvent) => void,
  intervalMs = 5000,
): DesktopWatcher {
  const sessionPath = getSessionInfoPath();
  let timer: ReturnType<typeof setInterval> | null = null;
  let lastOnline: boolean | null = null;
  let lastTaskId: string | null = null;

  function poll() {
    const info = readSessionInfo(sessionPath);
    if (!info?.identity?.companies?.length) return;

    const company = info.identity.companies[0];
    const track = company?.lastTrack;
    if (!track) return;

    const online = track.online ?? false;
    const taskId = track.taskId ?? null;
    const now = Date.now();

    // First poll — set baseline, don't emit
    if (lastOnline === null) {
      lastOnline = online;
      lastTaskId = taskId;
      if (online && taskId) {
        console.log(`[td-bridge:desktop] initial state: tracking ${taskId}`);
      }
      return;
    }

    // Started tracking
    if (online && !lastOnline && taskId) {
      console.log(`[td-bridge:desktop] tracking started: ${taskId}`);
      onEvent({
        action: 'start',
        ticket_id: taskId,
        source: 'desktop',
        timestamp: now,
        metadata: {
          title: company.name ?? null,
        },
      } as IngressEvent);
    }

    // Stopped tracking
    if (!online && lastOnline && lastTaskId) {
      console.log(`[td-bridge:desktop] tracking stopped: ${lastTaskId}`);
      onEvent({
        action: 'stop',
        ticket_id: lastTaskId,
        source: 'desktop',
        timestamp: now,
      });
    }

    // Switched task while tracking
    if (online && lastOnline && taskId && lastTaskId && taskId !== lastTaskId) {
      console.log(`[td-bridge:desktop] task switched: ${lastTaskId} → ${taskId}`);
      onEvent({
        action: 'stop',
        ticket_id: lastTaskId,
        source: 'desktop',
        timestamp: now,
      });
      onEvent({
        action: 'start',
        ticket_id: taskId,
        source: 'desktop',
        timestamp: now,
        metadata: {
          title: company.name ?? null,
        },
      } as IngressEvent);
    }

    lastOnline = online;
    lastTaskId = taskId;
  }

  return {
    start() {
      console.log(`[td-bridge:desktop] watching ${sessionPath} every ${intervalMs}ms`);
      poll(); // initial read
      timer = setInterval(poll, intervalMs);
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
