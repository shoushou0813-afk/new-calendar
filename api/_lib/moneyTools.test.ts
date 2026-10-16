import { describe, expect, it } from 'vitest';
import { applyOps, emptyDoc } from './cloudDoc';
import { addTransaction, listTransactions, moneySummary, setCard, setJob } from './moneyTools';

const now = new Date('2026-10-16T03:00:00Z');

describe('moneyTools', () => {
  it('同じ source_id は二重に取り込まない', () => {
    let doc = emptyDoc();
    const a = addTransaction(doc, { date: '2026-10-15', amount: 1280, method: 'credit', source: 'gmail', source_id: 'm1' }, now);
    doc = applyOps(doc, a.ops);
    const b = addTransaction(doc, { date: '2026-10-15', amount: 1280, method: 'credit', source: 'gmail', source_id: 'm1' }, now);
    expect(b.ops).toEqual([]);
    expect(b.result).toMatchObject({ skipped: 'すでに取り込み済み' });
    expect(listTransactions(doc, {}, now).result).toMatchObject({ count: 1, expense_total: 1280 });
  });

  it('不正な金額ははじく', () => {
    expect(addTransaction(emptyDoc(), { date: '2026-10-15', amount: 0, method: 'cash' }, now).result).toMatchObject({ ok: false });
  });

  it('カード・バイト先を設定するとまとめに反映され、同じ名前は上書きになる', () => {
    let doc = emptyDoc();
    doc = applyOps(doc, setCard(doc, { name: '楽天', closing_day: 31, payment_day: 27 }).ops);
    doc = applyOps(doc, setCard(doc, { name: '楽天', payment_day: 26 }).ops);
    doc = applyOps(doc, setJob(doc, { name: 'カフェ', hourly_wage: 1100 }).ops);
    expect(Object.keys(doc.profiles)).toHaveLength(2);
    doc = applyOps(doc, addTransaction(doc, { date: '2026-09-30', amount: 4000, method: 'credit' }, now).ops);
    doc = applyOps(doc, [
      { op: 'put', collection: 'events', record: { id: 'e1', title: 'カフェ', date: '2026-10-20', starts_at: '10:00', ends_at: '14:00', image: null } },
    ]);
    const r = moneySummary(doc, {}, now).result as Record<string, unknown>;
    expect(r.card_payments).toEqual([{ card: '楽天', date: '2026-10-26', amount: 4000 }]);
    expect(r).toMatchObject({ shift_total: 4400, shift_count: 1 });
  });

  it('家計簿ができる前のデータ(transactions が無い)でも動く', () => {
    const old = { ...emptyDoc() } as Partial<ReturnType<typeof emptyDoc>>;
    delete old.transactions;
    delete old.profiles;
    const doc = applyOps(old as ReturnType<typeof emptyDoc>, []);
    expect(doc.transactions).toEqual({});
    expect(listTransactions(old as ReturnType<typeof emptyDoc>, {}, now).result).toMatchObject({ count: 0 });
  });
});
