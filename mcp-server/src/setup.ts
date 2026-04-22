#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';
import { execSync } from 'node:child_process';

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

  // 3. Chrome extension
  console.log('\n3. Chrome Extension:');
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
