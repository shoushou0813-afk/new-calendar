import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyOps, emptyDoc, type CloudDoc, type CloudOp } from './_lib/cloudDoc';

// 保存場所(Vercel Blob)の代わりにメモリ上のデータを使う
let doc: CloudDoc = emptyDoc();
vi.mock('./_lib/store.js', async () => {
  const real = await vi.importActual<typeof import('./_lib/store')>('./_lib/store.js');
  return {
    tokenMatches: real.tokenMatches,
    storageReady: () => true,
    readDoc: async () => ({ doc, etag: null }),
    updateDoc: async <T>(make: (d: CloudDoc) => { ops: CloudOp[]; result: T }) => {
      const { ops, result } = make(doc);
      doc = applyOps(doc, ops);
      return { doc, result };
    },
  };
});

const { POST } = await import('./mcp');

async function rpc(method: string, params: unknown, key = 'secret') {
  const res = await POST(
    new Request(`https://example.com/api/mcp?key=${key}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }),
  );
  return { status: res.status, body: res.status === 200 ? await res.json() : await res.text() };
}

describe('/api/mcp', () => {
  beforeEach(() => {
    doc = emptyDoc();
    process.env.APP_TOKEN = 'secret';
  });

  it('合言葉が違えば断る', async () => {
    expect((await rpc('tools/list', {}, 'wrong')).status).toBe(401);
  });

  it('初期化・ツール一覧・予定の追加と一覧', async () => {
    const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    expect(init.status).toBe(200);
    expect(init.body.result.serverInfo.name).toBe('new-calendar');

    const tools = await rpc('tools/list', {});
    expect(tools.body.result.tools.map((t: { name: string }) => t.name).sort()).toEqual(
      ['add_event', 'add_task', 'delete_event', 'delete_task', 'list_events', 'list_tasks', 'update_event', 'update_task'],
    );

    const added = await rpc('tools/call', { name: 'add_event', arguments: { title: 'スタジオ練習', date: '2026-10-21', start: '16:50', end: '22:10' } });
    expect(JSON.parse(added.body.result.content[0].text)).toMatchObject({ ok: true, added: { title: 'スタジオ練習', start: '16:50' } });
    expect(Object.values(doc.events)).toHaveLength(1);

    const listed = await rpc('tools/call', { name: 'list_events', arguments: { from: '2026-10-01', to: '2026-10-31' } });
    expect(JSON.parse(listed.body.result.content[0].text).count).toBe(1);

    const bad = await rpc('tools/call', { name: 'add_task', arguments: { title: 'x', deadline: '2026-10-31' } });
    expect(bad.body.result.isError ?? bad.body.error).toBeTruthy(); // estimated_minutes が無い
  });
});
