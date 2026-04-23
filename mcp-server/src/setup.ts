#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir, platform } from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PACKAGE_NAME = 'arcticgrey-td-bridge';
const CHROME_STORE_URL = 'https://chrome.google.com/webstore/detail/PLACEHOLDER_ID'; // TODO: replace after publishing

interface McpConfig {
  mcpServers?: Record<string, { command: string; args?: string[] }>;
  [key: string]: unknown;
}

function getClaudeDesktopConfigPath(): string {
  const os = platform();
  if (os === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  }
  if (os === 'win32') {
    return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
  }
  // Linux
  return join(homedir(), '.config', 'Claude', 'claude_desktop_config.json');
}

function getClaudeCodeSettingsPath(): string {
  return join(homedir(), '.claude', 'settings.json');
}

function readJsonFile(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return {};
  }
}

function writeJsonFile(path: string, data: Record<string, unknown>): void {
  const dir = join(path, '..');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
}

function getNpxPath(): string {
  try {
    return execSync('which npx', { encoding: 'utf-8' }).trim();
  } catch {
    return 'npx';
  }
}

function configureMcp(configPath: string, label: string): boolean {
  const config = readJsonFile(configPath) as McpConfig;
  if (!config.mcpServers) config.mcpServers = {};

  if (config.mcpServers[PACKAGE_NAME]) {
    console.log(`  [skip] ${label} — already configured`);
    return false;
  }

  config.mcpServers[PACKAGE_NAME] = {
    command: getNpxPath(),
    args: ['-y', PACKAGE_NAME],
  };

  writeJsonFile(configPath, config);
  console.log(`  [done] ${label} — configured at ${configPath}`);
  return true;
}

function openUrl(url: string): void {
  const os = platform();
  try {
    if (os === 'darwin') execSync(`open "${url}"`);
    else if (os === 'win32') execSync(`start "${url}"`);
    else execSync(`xdg-open "${url}"`);
  } catch {
    console.log(`  Open manually: ${url}`);
  }
}

function installHook(): void {
  const hookDir = join(homedir(), '.claude', 'hooks');
  mkdirSync(hookDir, { recursive: true });

  const hookDest = join(hookDir, 'ag-td-session-start.sh');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const hookSrc = join(__dirname, 'hooks', 'session-start.sh');

  if (existsSync(hookSrc)) {
    copyFileSync(hookSrc, hookDest);
    execSync(`chmod +x "${hookDest}"`);
  } else {
    // Inline fallback for the npm-install scenario where the hook source
    // wasn't shipped next to the compiled JS. Kept byte-for-byte in sync
    // with mcp-server/src/hooks/session-start.sh — if you edit one, edit
    // both.
    const hookScript = `#!/usr/bin/env bash
DB="$HOME/.td-claude-bridge/state.db"
[ ! -f "$DB" ] && exit 0

python3 <<'PY'
import sqlite3, time, os, json, sys

db_path = os.path.expanduser('~/.td-claude-bridge/state.db')
try:
    conn = sqlite3.connect(db_path)
    row = conn.execute(
        'SELECT ticket_id, since FROM active_ticket WHERE singleton=1'
    ).fetchone()
    if not row or not row[0]:
        sys.exit(0)
    ticket_id, since = row[0], row[1]
    sess = conn.execute(
        'SELECT title, url, created_at FROM sessions WHERE ticket_id=?',
        (ticket_id,),
    ).fetchone()
    conn.close()
except Exception:
    sys.exit(0)

title = (sess[0] if sess else '') or 'untitled'
url = (sess[1] if sess else '') or ''
ts = since or (sess[2] if sess else 0) or 0
if ts > 1e12:
    ts = ts / 1000

elapsed = max(0, int(time.time()) - int(ts)) if ts else 0
h, rem = divmod(elapsed, 3600)
m, _ = divmod(rem, 60)
parts = []
if h:
    parts.append(f'{h}h')
if m:
    parts.append(f'{m}m')
elapsed_str = ' '.join(parts) if parts else '<1m'

label_lines = [
    f'  Ticket:   #{ticket_id}',
    f'  Task:     {title}',
    f'  Elapsed:  {elapsed_str}',
]
if url:
    label_lines.append(f'  Monday:   {url}')

header = '  ArcticGrey Time Tracking \\u2014 ACTIVE'
inner = max(len(l) for l in label_lines + [header]) + 2
bar = '\\u2500' * inner

body = [
    f'\\u250c{bar}\\u2510',
    f'\\u2502{header.ljust(inner)}\\u2502',
    f'\\u2502{" " * inner}\\u2502',
]
for line in label_lines:
    body.append(f'\\u2502{line.ljust(inner)}\\u2502')
body.append(f'\\u2514{bar}\\u2518')

banner = '\\n'.join(body)

payload = {
    'hookSpecificOutput': {
        'hookEventName': 'SessionStart',
        'additionalContext': (
            f'Active Monday ticket: #{ticket_id} - {title}. '
            f'Elapsed {elapsed_str}. URL: {url}'
        ),
    },
    'systemMessage': banner,
}
print(json.dumps(payload))
PY
`;
    writeFileSync(hookDest, hookScript);
    execSync(`chmod +x "${hookDest}"`);
  }

  // Add hook to Claude Code settings
  const settingsPath = getClaudeCodeSettingsPath();
  const settings = readJsonFile(settingsPath) as Record<string, unknown>;

  type HookEntry = { hooks: Array<{ type: string; command: string }> };
  const hooks = (settings.hooks ?? {}) as Record<string, HookEntry[]>;
  if (!hooks.SessionStart) hooks.SessionStart = [];

  const hookCmd = `bash "${hookDest}"`;
  const alreadyInstalled = hooks.SessionStart.some(
    (h) => h.hooks?.some((hh) => hh.command.includes('ag-td-session-start'))
  );

  if (alreadyInstalled) {
    console.log('  [skip] Hook already installed');
  } else {
    hooks.SessionStart.push({
      hooks: [{ type: 'command', command: hookCmd }],
    });
    settings.hooks = hooks;
    writeJsonFile(settingsPath, settings);
    console.log(`  [done] Hook installed at ${hookDest}`);
  }
}

function run(): void {
  console.log('\n🔧 ArcticGrey TD Bridge — Setup\n');

  // 1. Configure Claude Desktop
  console.log('1. Claude Desktop:');
  const desktopPath = getClaudeDesktopConfigPath();
  configureMcp(desktopPath, 'Claude Desktop');

  // 2. Configure Claude Code
  console.log('\n2. Claude Code:');
  const codePath = getClaudeCodeSettingsPath();
  configureMcp(codePath, 'Claude Code');

  // 3. SessionStart hook for Claude Code
  console.log('\n3. Claude Code SessionStart hook:');
  installHook();

  // 4. Chrome extension
  console.log('\n4. Chrome Extension:');
  if (CHROME_STORE_URL.includes('PLACEHOLDER')) {
    console.log('  [pending] Extension not yet published to Chrome Web Store');
    console.log('  Install manually: load unpacked from browser-ext/dist/');
  } else {
    console.log('  Opening Chrome Web Store...');
    openUrl(CHROME_STORE_URL);
  }

  console.log('\n✅ Setup complete. Restart Claude Desktop / Claude Code to activate.\n');
}

run();
