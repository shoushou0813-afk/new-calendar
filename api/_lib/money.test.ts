import { describe, expect, it } from 'vitest';
import {
  cardPaymentDate,
  isDuplicateSpending,
  jobPayDate,
  makeCard,
  makeJob,
  monthSummary,
  parseBillEvent,
  parseSpendingEvent,
  shiftForecasts,
  shiftPay,
  type Transaction,
} from './money';

const job = makeJob({ name: 'コンビニ', hourly_wage: 1200, transport: 300, closing_day: 31, pay_day: 25 });

function tx(p: Partial<Transaction>): Transaction {
  return {
    id: crypto.randomUUID(),
    date: '2026-10-10',
    amount: 1000,
    kind: 'expense',
    method: 'cash',
    card: null,
    category: '食費',
    memo: null,
    source: 'manual',
    source_id: null,
    created_at: '',
    updated_at: '',
    ...p,
  };
}

describe('cardPaymentDate', () => {
  const card = makeCard({ name: 'A', closing_day: 15, payment_day: 10 });
  it('締め日までの利用は翌月、過ぎたら翌々月に落ちる', () => {
    expect(cardPaymentDate('2026-10-15', card)).toBe('2026-11-10');
    expect(cardPaymentDate('2026-10-16', card)).toBe('2026-12-10');
  });
  it('月末締め・年またぎ・月末日の丸め', () => {
    const eom = makeCard({ name: 'B', closing_day: 31, payment_day: 31 });
    expect(cardPaymentDate('2026-12-31', eom)).toBe('2027-01-31');
    expect(cardPaymentDate('2027-01-20', eom)).toBe('2027-02-28');
    const two = makeCard({ name: 'C', closing_day: 31, payment_day: 4, payment_month_offset: 2 });
    expect(cardPaymentDate('2026-11-30', two)).toBe('2027-01-04');
  });
});

describe('shiftPay', () => {
  it('6時間以内は休憩なし', () => {
    const p = shiftPay({ date: '2026-10-10', start: '10:00', end: '16:00' }, job);
    expect(p).toMatchObject({ worked_minutes: 360, break_minutes: 0, wage: 7200, total: 7500 });
  });
  it('6時間超は45分、8時間超は60分の休憩を引く', () => {
    expect(shiftPay({ date: '2026-10-10', start: '10:00', end: '17:00' }, job).worked_minutes).toBe(375);
    expect(shiftPay({ date: '2026-10-10', start: '09:00', end: '18:00' }, job).worked_minutes).toBe(480);
  });
  it('22時以降は25%増し、日をまたぐシフトも計算できる', () => {
    const p = shiftPay({ date: '2026-10-10', start: '20:00', end: '00:00', end_date: '2026-10-11' }, job);
    // 普通 2時間 2400 + 深夜 2時間 1500×2 = 5400
    expect(p).toMatchObject({ worked_minutes: 240, night_minutes: 120, wage: 5400 });
    expect(shiftPay({ date: '2026-10-10', start: '20:00', end: '00:00' }, job).wage).toBe(5400);
  });
});

describe('jobPayDate / shiftForecasts', () => {
  it('末締め翌月25日払い', () => {
    expect(jobPayDate('2026-10-31', job)).toBe('2026-11-25');
    expect(jobPayDate('2026-12-01', job)).toBe('2027-01-25');
  });
  it('タイトルにキーワードを含み終了時刻のある予定だけをシフトにする', () => {
    const f = shiftForecasts(
      [
        { id: '1', title: 'コンビニ バイト', date: '2026-10-12', starts_at: '17:00', ends_at: '21:00' },
        { id: '2', title: 'コンビニ', date: '2026-10-13', starts_at: '17:00', ends_at: null },
        { id: '3', title: '授業', date: '2026-10-13', starts_at: '09:00', ends_at: '10:30' },
      ],
      [job],
    );
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ event_id: '1', pay_date: '2026-11-25' });
    expect(f[0].pay.total).toBe(4800 + 300);
  });
});

describe('monthSummary', () => {
  it('支払い方法別の合計と、その月に落ちるカード代を出す', () => {
    const card = makeCard({ name: '楽天', closing_day: 31, payment_day: 27 });
    const txs = [
      tx({ amount: 500 }),
      tx({ amount: 2000, method: 'credit', card: '楽天' }),
      tx({ date: '2026-09-20', amount: 3000, method: 'credit', card: '楽天' }),
      tx({ amount: 800, kind: 'income' }),
    ];
    const s = monthSummary('2026-10', txs, [], [card]);
    expect(s.expense_total).toBe(2500);
    expect(s.expense_by_method).toMatchObject({ cash: 500, credit: 2000 });
    expect(s.income_total).toBe(800);
    expect(s.card_payments).toEqual([{ card: '楽天', date: '2026-10-27', amount: 3000 }]);
    expect(monthSummary('2026-11', txs, [], [card]).card_payments).toEqual([{ card: '楽天', date: '2026-11-27', amount: 2000 }]);
  });
});

describe('Googleカレンダーに書かれたお金の予定', () => {
  const cards = [{ name: '楽天カード' }];
  it('【支出】の予定名からクレカの支出を読む', () => {
    expect(parseSpendingEvent('【支出】楽天カード 1,280円 Amazon', '分類: 食費', cards)).toEqual({
      amount: 1280,
      method: 'credit',
      card: '楽天カード',
      memo: 'Amazon',
      category: '食費',
      kind: 'expense',
    });
    expect(parseSpendingEvent('【支出】楽天 ¥500 セブン', null, cards)).toMatchObject({ card: '楽天カード', amount: 500, category: 'その他' });
    expect(parseSpendingEvent('【支出】PayPay 300円 ローソン', null, cards)).toMatchObject({ method: 'emoney', card: null, memo: 'ローソン' });
    expect(parseSpendingEvent('【支出】楽天カード 2000円 返金 Amazon', null, cards)).toMatchObject({ kind: 'income' });
  });
  it('タグがない・金額がないものは読まない', () => {
    expect(parseSpendingEvent('楽天カード 1,280円', null, cards)).toBeNull();
    expect(parseSpendingEvent('【支出】楽天カード', null, cards)).toBeNull();
  });
  it('【引落】から確定した請求額を読む', () => {
    expect(parseBillEvent('【引落】楽天カード 45,000円')).toEqual({ card: '楽天カード', amount: 45000 });
    expect(parseBillEvent('楽天カード 45,000円')).toBeNull();
  });
  it('同じ日・金額・店・カードの支出は重複とみなす', () => {
    const p = parseSpendingEvent('【支出】楽天カード 1,280円 Amazon', null, cards)!;
    const t = tx({ date: '2026-10-10', amount: 1280, method: 'credit', card: '楽天カード', memo: 'Amazon', source: 'gmail', source_id: 'gcal:x' });
    expect(isDuplicateSpending([t], '2026-10-10', p, 'gcal:y')).toBe(true);
    expect(isDuplicateSpending([t], '2026-10-11', p, 'gcal:y')).toBe(false);
  });
});
