import { describe, expect, it } from 'vitest';
import { applyOps, emptyDoc, isCloudOp, type CloudOp } from './cloudDoc';

describe('cloudDoc', () => {
  it('追加・更新・削除を適用し、元のdocは変えない', () => {
    const base = emptyDoc();
    const ops: CloudOp[] = [
      { op: 'put', collection: 'events', record: { id: 'e1', title: 'A', image: null } },
      { op: 'put', collection: 'tasks', record: { id: 't1', title: 'T' } },
      { op: 'put', collection: 'plans', record: { date: '2026-10-20', items: [] } },
      { op: 'put', collection: 'categories', key: 'バンド' },
      { op: 'put', collection: 'categories', key: 'バンド' },
      { op: 'put', collection: 'events', record: { id: 'e1', title: 'A2', image: null } },
      { op: 'delete', collection: 'tasks', key: 't1' },
    ];
    const next = applyOps(base, ops, new Date('2026-10-16T00:00:00Z'));
    expect(next.events.e1.title).toBe('A2');
    expect(next.tasks).toEqual({});
    expect(Object.keys(next.plans)).toEqual(['2026-10-20']);
    expect(next.categories).toEqual(['バンド']);
    expect(next.updated_at).toBe('2026-10-16T00:00:00.000Z');
    expect(base.events).toEqual({});
    // 同じ op をもう一度適用しても変わらない
    expect(applyOps(next, ops, new Date('2026-10-16T00:00:00Z'))).toEqual(next);
  });

  it('不正な op を見分ける', () => {
    expect(isCloudOp({ op: 'put', collection: 'events', record: { id: 'x' } })).toBe(true);
    expect(isCloudOp({ op: 'delete', collection: 'plans', key: '2026-10-20' })).toBe(true);
    expect(isCloudOp({ op: 'put', collection: 'events', record: { title: 'idなし' } })).toBe(false);
    expect(isCloudOp({ op: 'drop', collection: 'events', key: 'x' })).toBe(false);
    expect(isCloudOp({ op: 'delete', collection: 'users', key: 'x' })).toBe(false);
    expect(isCloudOp(null)).toBe(false);
  });
});
