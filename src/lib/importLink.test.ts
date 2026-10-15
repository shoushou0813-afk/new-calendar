import { describe, expect, it } from 'vitest';
import { createImportLink, readImportLink } from './importLink';

describe('importLink', () => {
  it('日本語を含む ics を往復できる', async () => {
    const ics = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:【締切】テスト\\, ES\r\nDTSTART:20261016T020000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
    const link = await createImportLink('https://example.com/', ics);
    expect(link.startsWith('https://example.com/#import=z.')).toBe(true);
    expect(await readImportLink(new URL(link).hash)).toBe(ics);
  });

  it('取り込みリンクでなければ null', async () => {
    expect(await readImportLink('')).toBeNull();
    expect(await readImportLink('#foo')).toBeNull();
  });

  it('壊れたリンクはエラー', async () => {
    await expect(readImportLink('#import=x.abc')).rejects.toThrow();
  });
});
