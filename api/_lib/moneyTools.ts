/**
 * Claude のチャット(MCP)から使う、家計簿の操作。calendarTools.ts と同じく「今のデータ → 変更(ops)と返事」の純粋関数。
 */
import type { CloudDoc, CloudOp } from './cloudDoc.js';
import { DATE_RE, todayInTokyo, type ToolResult } from './calendarTools.js';
import {
  isCard,
  isJob,
  makeCard,
  makeJob,
  monthSummary,
  parseBillEvent,
  shiftForecasts,
  type CardProfile,
  type JobProfile,
  type ShiftEventLike,
  type Transaction,
  type TxKind,
  type TxMethod,
} from './money.js';

const METHODS: TxMethod[] = ['cash', 'credit', 'emoney', 'bank'];

function fail(message: string): ToolResult {
  return { ops: [], result: { ok: false, error: message } };
}

export function txList(doc: CloudDoc): Transaction[] {
  return Object.values(doc.transactions ?? {}) as unknown as Transaction[];
}

export function jobList(doc: CloudDoc): JobProfile[] {
  return (Object.values(doc.profiles ?? {}) as object[]).filter(isJob);
}

export function cardList(doc: CloudDoc): CardProfile[] {
  return (Object.values(doc.profiles ?? {}) as object[]).filter(isCard);
}

function txSummary(t: Transaction) {
  return {
    id: t.id,
    date: t.date,
    amount: t.amount,
    kind: t.kind,
    method: t.method,
    card: t.card,
    category: t.category,
    memo: t.memo,
    source: t.source,
    source_id: t.source_id,
  };
}

export function listTransactions(doc: CloudDoc, args: { from?: string; to?: string; method?: TxMethod }, now = new Date()): ToolResult {
  const today = todayInTokyo(now);
  const from = args.from ?? `${today.slice(0, 7)}-01`;
  const to = args.to ?? today;
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) return fail('from / to は yyyy-MM-dd で指定してください。');
  const txs = txList(doc)
    .filter((t) => t.date >= from && t.date <= to && (!args.method || t.method === args.method))
    .sort((a, b) => a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at));
  const expense = txs.filter((t) => t.kind === 'expense').reduce((s, t) => s + t.amount, 0);
  const income = txs.filter((t) => t.kind === 'income').reduce((s, t) => s + t.amount, 0);
  return { ops: [], result: { from, to, count: txs.length, expense_total: expense, income_total: income, transactions: txs.map(txSummary) } };
}

export interface AddTransactionArgs {
  date: string;
  amount: number;
  kind?: TxKind;
  method: TxMethod;
  card?: string;
  category?: string;
  memo?: string;
  source?: 'manual' | 'gmail' | 'claude';
  source_id?: string;
}

/** 1件追加。source_id が同じものがすでにあれば、追加せずに知らせる(Gmailからの取り込みを何度やっても重複しない) */
export function addTransaction(doc: CloudDoc, args: AddTransactionArgs, now = new Date(), id: string = crypto.randomUUID()): ToolResult {
  if (!DATE_RE.test(args.date)) return fail('date は yyyy-MM-dd で指定してください。');
  const amount = Math.round(Number(args.amount));
  if (!(amount > 0)) return fail('amount は 1 以上の円(整数)にしてください。返金は kind: income で入れます。');
  if (!METHODS.includes(args.method)) return fail('method は cash / credit / emoney / bank のどれかです。');
  const sourceId = args.source_id?.trim() || null;
  if (sourceId) {
    const dup = txList(doc).find((t) => t.source_id === sourceId);
    if (dup) return { ops: [], result: { ok: true, skipped: 'すでに取り込み済み', existing: txSummary(dup) } };
  }
  const cards = cardList(doc);
  const card = args.method === 'credit' ? (args.card?.trim() || cards[0]?.name || null) : null;
  const ts = now.toISOString();
  const record: Transaction = {
    id,
    date: args.date,
    amount,
    kind: args.kind ?? 'expense',
    method: args.method,
    card,
    category: args.category?.trim() || 'その他',
    memo: args.memo?.trim() || null,
    source: args.source ?? 'claude',
    source_id: sourceId,
    created_at: ts,
    updated_at: ts,
  };
  const ops: CloudOp[] = [{ op: 'put', collection: 'transactions', record: record as unknown as Transaction & Record<string, unknown> }];
  return { ops, result: { ok: true, added: txSummary(record) } };
}

export function updateTransaction(
  doc: CloudDoc,
  args: Partial<Omit<AddTransactionArgs, 'source' | 'source_id' | 'memo' | 'card'>> & { id: string; memo?: string | null; card?: string | null },
  now = new Date(),
): ToolResult {
  const current = doc.transactions?.[args.id] as unknown as Transaction | undefined;
  if (!current) return fail('その id の記録が見つかりません。list_transactions で id を確かめてください。');
  if (args.date !== undefined && !DATE_RE.test(args.date)) return fail('date は yyyy-MM-dd で指定してください。');
  if (args.amount !== undefined && !(Math.round(Number(args.amount)) > 0)) return fail('amount は 1 以上にしてください。');
  if (args.method !== undefined && !METHODS.includes(args.method)) return fail('method は cash / credit / emoney / bank のどれかです。');
  const { id: _id, ...patch } = args;
  const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  const next: Transaction = { ...current, ...defined, id: current.id, updated_at: now.toISOString() } as Transaction;
  next.amount = Math.round(Number(next.amount));
  if (next.method !== 'credit') next.card = null;
  return { ops: [{ op: 'put', collection: 'transactions', record: next as unknown as Transaction & Record<string, unknown> }], result: { ok: true, updated: txSummary(next) } };
}

export function deleteTransaction(doc: CloudDoc, args: { id: string }): ToolResult {
  const current = doc.transactions?.[args.id] as unknown as Transaction | undefined;
  if (!current) return fail('その id の記録が見つかりません。');
  return { ops: [{ op: 'delete', collection: 'transactions', key: args.id }], result: { ok: true, deleted: txSummary(current) } };
}

export function listProfiles(doc: CloudDoc): ToolResult {
  return { ops: [], result: { jobs: jobList(doc), cards: cardList(doc) } };
}

/** バイト先を名前で追加・上書きする */
export function setJob(doc: CloudDoc, args: Partial<JobProfile> & { name: string }, id: string = crypto.randomUUID()): ToolResult {
  if (!args.name.trim()) return fail('name が空です。');
  const existing = jobList(doc).find((j) => j.name === args.name.trim());
  const job = makeJob({ ...existing, ...Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined)), name: args.name }, existing?.id ?? id);
  return { ops: [{ op: 'put', collection: 'profiles', record: job as unknown as JobProfile & Record<string, unknown> }], result: { ok: true, job } };
}

/** クレジットカードを名前で追加・上書きする */
export function setCard(doc: CloudDoc, args: Partial<CardProfile> & { name: string }, id: string = crypto.randomUUID()): ToolResult {
  if (!args.name.trim()) return fail('name が空です。');
  const existing = cardList(doc).find((c) => c.name === args.name.trim());
  const card = makeCard({ ...existing, ...Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined)), name: args.name }, existing?.id ?? id);
  return { ops: [{ op: 'put', collection: 'profiles', record: card as unknown as CardProfile & Record<string, unknown> }], result: { ok: true, card } };
}

export function deleteProfile(doc: CloudDoc, args: { id: string }): ToolResult {
  const current = doc.profiles?.[args.id];
  if (!current) return fail('その id の設定が見つかりません。list_money_settings で確かめてください。');
  return { ops: [{ op: 'delete', collection: 'profiles', key: args.id }], result: { ok: true, deleted: current } };
}

/** 月のまとめ(使った額・カードの引き落とし予定・バイト代の見込み) */
export function moneySummary(doc: CloudDoc, args: { month?: string }, now = new Date()): ToolResult {
  const month = args.month ?? todayInTokyo(now).slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return fail('month は yyyy-MM で指定してください。');
  const events = Object.values(doc.events) as unknown as ShiftEventLike[];
  const shifts = shiftForecasts(events, jobList(doc));
  const summary = monthSummary(month, txList(doc), shifts, cardList(doc));
  return {
    ops: [],
    result: {
      ...summary,
      shifts: shifts
        .filter((s) => s.date.startsWith(month))
        .map((s) => ({ date: s.date, title: s.title, job: s.job, hours: +(s.pay.worked_minutes / 60).toFixed(2), total: s.pay.total, pay_date: s.pay_date })),
      // Googleカレンダーに【引落】で入っている、確定した引き落とし額
      confirmed_bills: Object.values(doc.events)
        .filter((e) => String(e.date).startsWith(month))
        .map((e) => ({ date: String(e.date), bill: parseBillEvent(String(e.title ?? '')) }))
        .filter((b) => b.bill)
        .map((b) => ({ date: b.date, ...b.bill! })),
      note: jobList(doc).length === 0 ? 'バイト先が未設定なのでバイト代は計算していません(set_job で設定)。' : undefined,
    },
  };
}
