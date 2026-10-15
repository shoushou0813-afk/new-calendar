import { describe, expect, it } from 'vitest';
import { createImportLink, readImportLink, readPastedImportLink } from './importLink';

describe('importLink', () => {
  it('日本語を含む ics を往復できる', async () => {
    const ics = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:【締切】テスト\\, ES\r\nDTSTART:20261016T020000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
    const link = await createImportLink('https://example.com/', ics);
    expect(link.startsWith('https://example.com/#import=x.')).toBe(true);
    // Markdown で壊れやすい記号を含まない
    expect(/^[0-9a-f]+$/.test(link.split('x.')[1])).toBe(true);
    expect(await readImportLink(new URL(link).hash)).toBe(ics);
  });

  it('貼り付けたリンク(改行入り)からも読める', async () => {
    const ics = 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n';
    const link = await createImportLink('https://example.com/', ics);
    const pasted = `${link.slice(0, 40)}\n${link.slice(40)} `;
    expect(await readPastedImportLink(pasted)).toBe(ics);
    expect(await readPastedImportLink('こんにちは')).toBeNull();
  });

  it('途中で切れたリンクはわかりやすいエラー', async () => {
    const link = await createImportLink('https://example.com/', 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n');
    await expect(readImportLink(new URL(link).hash.slice(0, -3))).rejects.toThrow('途中で切れ');
  });

  it('取り込みリンクでなければ null', async () => {
    expect(await readImportLink('')).toBeNull();
    expect(await readImportLink('#foo')).toBeNull();
  });

  it('壊れたリンクはエラー', async () => {
    await expect(readImportLink('#import=x.abc')).rejects.toThrow();
  });
});
