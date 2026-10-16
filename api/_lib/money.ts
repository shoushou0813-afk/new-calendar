/**
 * 家計簿とバイト代の計算(サーバーとアプリで共通の純粋関数)。
 * 金額はすべて円(整数)。日付は yyyy-MM-dd、時刻は HH:mm(日本時間)。
 */

export type TxKind = 'expense' | 'income';
/** cash: 現金 / credit: クレジットカード(後払い) / emoney: 電子マネー・QR / bank: 口座振替・振込 */
export type TxMethod = 'cash' | 'credit' | 'emoney' | 'bank';

export interface Transaction {
  id: string;
  date: string;
  /** 円。支出も収入も正の数で持ち、kind で区別する */
  amount: number;
  kind: TxKind;
  method: TxMethod;
  /** method が credit のとき、どのカードか(CardProfile.name) */
  card: string | null;
  category: string;
  memo: string | null;
  /** manual: 手入力 / gmail: メールから自動 / claude: チャットから */
  source: 'manual' | 'gmail' | 'claude';
  /** 重複取り込みを防ぐための元データのID(GmailのメッセージIDなど) */
  source_id: string | null;
  created_at: string;
  updated_at: string;
}

/** バイト先。タイトルに keyword を含む予定をシフトとみなす */
export interface JobProfile {
  id: string;
  type: 'job';
  name: string;
  keyword: string;
  hourly_wage: number;
  /** 1回の交通費(円) */
  transport: number;
  /** 深夜(22:00〜5:00)の割増率。法定は 1.25 */
  night_rate: number;
  /** 給料の締め日(1〜31、31=月末) */
  closing_day: number;
  /** 給料日(1〜31、31=月末)。締めの翌月に払われる */
  pay_day: number;
}

/** クレジットカード。closing_day に締めて、翌月(または翌々月)の payment_day に引き落とし */
export interface CardProfile {
  id: string;
  type: 'card';
  name: string;
  closing_day: number;
  payment_day: number;
  /** 締めた月の何か月後に引き落とされるか(翌月払い=1、翌々月払い=2) */
  payment_month_offset: number;
}

export type Profile = JobProfile | CardProfile;

// ---- 日付のちょっとした計算(タイムゾーンに左右されないよう UTC で扱う) ----

function ymd(y: number, m: number, d: number): string {
  // m は 1〜12 以外も受け付けて繰り上げる
  const date = new Date(Date.UTC(y, m - 1, 1));
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

function parts(date: string): [number, number, number] {
  const [y, m, d] = date.split('-').map(Number);
  return [y, m, d];
}

function lastDayOf(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// ---- クレジットカードの引き落とし日 ----

/** その日の利用分が引き落とされる日 */
export function cardPaymentDate(useDate: string, card: Pick<CardProfile, 'closing_day' | 'payment_day' | 'payment_month_offset'>): string {
  const [y, m, d] = parts(useDate);
  const closing = Math.min(card.closing_day, lastDayOf(y, m));
  // 締め日を過ぎた利用は、次の月の締めに入る
  const closeMonth = d <= closing ? m : m + 1;
  return ymd(y, closeMonth + card.payment_month_offset, card.payment_day);
}

// ---- バイト代 ----

export interface ShiftInput {
  date: string;
  start: string;
  /** 終了時刻。翌日にまたぐ場合は end_date も渡す */
  end: string;
  end_date?: string | null;
}

export interface ShiftPay {
  /** 実際に働いた時間(休憩を引いたあと、分) */
  worked_minutes: number;
  break_minutes: number;
  /** そのうち深夜(22:00〜5:00)の分 */
  night_minutes: number;
  wage: number;
  transport: number;
  total: number;
}

/**
 * 休憩は労働基準法の最低ライン(6時間を超えたら45分、8時間を超えたら60分)で引く。
 * 休憩は深夜でない時間から引く(深夜手当が多めに出る計算にならないよう、実際の多くの職場に合わせて普通の時間から先に引く)。
 */
export function shiftPay(shift: ShiftInput, job: Pick<JobProfile, 'hourly_wage' | 'transport' | 'night_rate'>): ShiftPay {
  const start = toMinutes(shift.start);
  const days = shift.end_date && shift.end_date > shift.date ? Math.round((Date.parse(shift.end_date) - Date.parse(shift.date)) / 86400000) : 0;
  let end = toMinutes(shift.end) + days * 1440;
  if (end <= start) end += 1440; // 終了日なしで終わりが始まりより前なら、翌日まで
  const span = end - start;
  const breakMinutes = span > 8 * 60 ? 60 : span > 6 * 60 ? 45 : 0;

  // 深夜(22:00〜翌5:00)にかかる分を数える
  let night = 0;
  for (let t = start; t < end; t++) {
    const inDay = ((t % 1440) + 1440) % 1440;
    if (inDay >= 22 * 60 || inDay < 5 * 60) night++;
  }
  const worked = Math.max(0, span - breakMinutes);
  const normalWorked = Math.max(0, span - night - breakMinutes);
  const nightWorked = Math.min(night, worked);
  const wage = Math.floor((normalWorked * job.hourly_wage + nightWorked * job.hourly_wage * job.night_rate) / 60);
  return { worked_minutes: worked, break_minutes: breakMinutes, night_minutes: nightWorked, wage, transport: job.transport, total: wage + job.transport };
}

/** その日のシフトの給料が振り込まれる日 */
export function jobPayDate(shiftDate: string, job: Pick<JobProfile, 'closing_day' | 'pay_day'>): string {
  const [y, m, d] = parts(shiftDate);
  const closing = Math.min(job.closing_day, lastDayOf(y, m));
  const closeMonth = d <= closing ? m : m + 1;
  return ymd(y, closeMonth + 1, job.pay_day);
}

export interface ShiftEventLike {
  id: string;
  title: string;
  date: string;
  starts_at: string;
  ends_at: string | null;
  end_date?: string | null;
}

export interface ShiftForecast {
  event_id: string;
  title: string;
  date: string;
  job: string;
  pay: ShiftPay;
  pay_date: string;
}

/** 予定の中からシフト(タイトルにバイト先のキーワードを含み、終了時刻があるもの)を探して、バイト代を出す */
export function shiftForecasts(events: ShiftEventLike[], jobs: JobProfile[]): ShiftForecast[] {
  const result: ShiftForecast[] = [];
  for (const e of events) {
    if (!e.ends_at) continue;
    const job = jobs.find((j) => j.keyword && e.title.includes(j.keyword));
    if (!job || !(job.hourly_wage > 0)) continue;
    result.push({
      event_id: e.id,
      title: e.title,
      date: e.date,
      job: job.name,
      pay: shiftPay({ date: e.date, start: e.starts_at, end: e.ends_at, end_date: e.end_date }, job),
      pay_date: jobPayDate(e.date, job),
    });
  }
  return result.sort((a, b) => a.date.localeCompare(b.date));
}

// ---- 1か月のまとめ ----

export interface MonthSummary {
  month: string; // yyyy-MM
  expense_total: number;
  expense_by_method: Record<TxMethod, number>;
  expense_by_category: Record<string, number>;
  income_total: number;
  /** この月に働くシフトの見込み(交通費込み) */
  shift_total: number;
  shift_count: number;
  shift_minutes: number;
  /** この月に振り込まれる予定のバイト代 */
  pay_in_month: number;
  /** この月に引き落とされる予定のカード代(カードごと) */
  card_payments: { card: string; date: string; amount: number }[];
}

export function monthSummary(month: string, txs: Transaction[], shifts: ShiftForecast[], cards: CardProfile[]): MonthSummary {
  const inMonth = (d: string) => d.startsWith(month);
  const expense_by_method: Record<TxMethod, number> = { cash: 0, credit: 0, emoney: 0, bank: 0 };
  const expense_by_category: Record<string, number> = {};
  let expense_total = 0;
  let income_total = 0;
  for (const t of txs) {
    if (!inMonth(t.date)) continue;
    if (t.kind === 'income') {
      income_total += t.amount;
      continue;
    }
    expense_total += t.amount;
    expense_by_method[t.method] += t.amount;
    expense_by_category[t.category || 'その他'] = (expense_by_category[t.category || 'その他'] ?? 0) + t.amount;
  }

  // カードの引き落とし(どの月に使ったかに関係なく、この月に落ちる分)
  const payments = new Map<string, { card: string; date: string; amount: number }>();
  for (const t of txs) {
    if (t.kind !== 'expense' || t.method !== 'credit') continue;
    const card = cards.find((c) => c.name === t.card) ?? cards[0];
    if (!card) continue;
    const date = cardPaymentDate(t.date, card);
    if (!inMonth(date)) continue;
    const key = `${card.name}|${date}`;
    const cur = payments.get(key) ?? { card: card.name, date, amount: 0 };
    cur.amount += t.amount;
    payments.set(key, cur);
  }

  const monthShifts = shifts.filter((s) => inMonth(s.date));
  return {
    month,
    expense_total,
    expense_by_method,
    expense_by_category,
    income_total,
    shift_total: monthShifts.reduce((s, x) => s + x.pay.total, 0),
    shift_count: monthShifts.length,
    shift_minutes: monthShifts.reduce((s, x) => s + x.pay.worked_minutes, 0),
    pay_in_month: shifts.filter((s) => inMonth(s.pay_date)).reduce((s, x) => s + x.pay.total, 0),
    card_payments: [...payments.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}

export const TX_METHOD_LABEL: Record<TxMethod, string> = { cash: '現金', credit: 'クレカ', emoney: '電子マネー・QR', bank: '口座・振込' };
export const EXPENSE_CATEGORIES = ['食費', '交通', '日用品', '趣味・娯楽', '交際', '服・美容', '学び', '通信', 'サブスク', 'その他'];

// ---- 設定の初期値と、いろいろな形の入力を整える ----

export function makeJob(input: Partial<JobProfile> & { name: string }, id: string = crypto.randomUUID()): JobProfile {
  return {
    id: input.id ?? id,
    type: 'job',
    name: input.name.trim(),
    keyword: (input.keyword ?? input.name).trim(),
    hourly_wage: Math.max(0, Math.round(Number(input.hourly_wage) || 0)),
    transport: Math.max(0, Math.round(Number(input.transport) || 0)),
    night_rate: Number(input.night_rate) >= 1 ? Number(input.night_rate) : 1.25,
    closing_day: clampDay(input.closing_day, 31),
    pay_day: clampDay(input.pay_day, 25),
  };
}

export function makeCard(input: Partial<CardProfile> & { name: string }, id: string = crypto.randomUUID()): CardProfile {
  return {
    id: input.id ?? id,
    type: 'card',
    name: input.name.trim(),
    closing_day: clampDay(input.closing_day, 31),
    payment_day: clampDay(input.payment_day, 27),
    payment_month_offset: Number(input.payment_month_offset) === 2 ? 2 : 1,
  };
}

function clampDay(value: unknown, fallback: number): number {
  const n = Math.round(Number(value));
  return n >= 1 && n <= 31 ? n : fallback;
}

export function isJob(p: object): p is JobProfile {
  return !!p && typeof p === 'object' && (p as Profile).type === 'job';
}

export function isCard(p: object): p is CardProfile {
  return !!p && typeof p === 'object' && (p as Profile).type === 'card';
}

/** 円の表示(例: ¥12,340) */
export function yen(n: number): string {
  return `¥${Math.round(n).toLocaleString('ja-JP')}`;
}
