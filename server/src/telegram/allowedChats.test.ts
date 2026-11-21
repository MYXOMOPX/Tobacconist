import { describe, expect, it } from 'vitest';
import { createTestDb, createDb, closeDb } from '../db/client';
import { allowChat, disallowChat, isChatAllowed, listAllowedChatIds } from './allowedChats';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('allowed chats', () => {
  it('persists multiple chats, ignores repeated starts, and removes only the stopped chat', async () => {
    const db = createTestDb();
    expect(await listAllowedChatIds(db)).toEqual([]);
    await allowChat(db, '-1001');
    await allowChat(db, '-1002');
    await allowChat(db, '-1001');
    expect(await listAllowedChatIds(db)).toEqual(['-1001', '-1002']);
    expect(await isChatAllowed(db, '-1002')).toBe(true);
    await disallowChat(db, '-1001');
    expect(await listAllowedChatIds(db)).toEqual(['-1002']);
    expect(await isChatAllowed(db, '-1001')).toBe(false);
  });

  it('keeps chat access after reopening the database', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tobacconist-chats-'));
    const path = join(dir, 'app.sqlite3');
    try {
      const first = createDb(path);
      await allowChat(first, '-1001');
      closeDb(first);
      const reopened = createDb(path);
      expect(await listAllowedChatIds(reopened)).toEqual(['-1001']);
      closeDb(reopened);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
