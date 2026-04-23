import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { configureMcp, resolveMcpLaunch } from '../src/setup.js';

describe('setup', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prefers a local index.js next to setup over npx', () => {
    const dir = mkdtempSync(join(tmpdir(), 'td-bridge-setup-'));
    writeFileSync(join(dir, 'index.js'), '#!/usr/bin/env node\n');

    const launch = resolveMcpLaunch(dir);
    expect(launch).toEqual({
      command: process.execPath,
      args: [join(dir, 'index.js')],
      source: 'local',
    });

    rmSync(dir, { recursive: true, force: true });
  });

  it('falls back to npx when no local bridge binary exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'td-bridge-setup-'));
    const launch = resolveMcpLaunch(dir);
    expect(launch.source).toBe('npx');
    expect(launch.args).toEqual(['-y', 'arcticgrey-td-bridge']);
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes MCP config using the resolved launch command', () => {
    const dir = mkdtempSync(join(tmpdir(), 'td-bridge-setup-'));
    const configPath = join(dir, 'claude.json');
    configureMcp(configPath, 'Claude Desktop', {
      command: '/usr/local/bin/node',
      args: ['/tmp/td-bridge/index.js'],
      source: 'local',
    });

    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(config.mcpServers['arcticgrey-td-bridge']).toEqual({
      command: '/usr/local/bin/node',
      args: ['/tmp/td-bridge/index.js'],
    });

    rmSync(dir, { recursive: true, force: true });
  });
});
