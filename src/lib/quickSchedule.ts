import { addDays, format, parseISO } from 'date-fns';

/**
 * 「7:50 起きる」「9:00 陳列」のように1行ずつ書いた1日の流れを、予定に変換する。
 * - 時刻は 7:50 / 07:50 / 7：50 / 9時 / 9時30分 / 9:00-10:00(終わりも指定)に対応
 * - 終わりの時刻を書かなければ、次の行の開始時刻を終わりにする(最後の行は終わりなし)
 * - 24:00 以降は次の日の 0:00 以降として扱う(「24:00 ねる」→ 翌日 0:00)
 */
export interface QuickScheduleItem {
  date: string;
  start: string;
  end: string | null;
  title: string;
}

export interface QuickScheduleResult {
  items: QuickScheduleItem[];
  /** 時刻が読めなかった行 */
  skipped: string[];
}

const TIME = String.raw`(\d{1,2})\s*(?:[:：]\s*(\d{2})|時\s*(?:(\d{1,2})\s*分?)?)`;
const LINE = new RegExp(String.raw`^\s*${TIME}\s*(?:[~〜\-－ー]\s*${TIME})?\s*[\s　、,]\s*(.+?)\s*$`);

function toHalfWidth(s: string): string {
  return s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

function minutesOf(h: string, m1?: string, m2?: string): number {
  return Number(h) * 60 + Number(m1 ?? m2 ?? 0);
}

function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export function parseQuickSchedule(text: string, date: string): QuickScheduleResult {
  const parsed: { start: number; end: number | null; title: string }[] = [];
  const skipped: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = toHalfWidth(raw).trim();
    if (!line) continue;
    const m = line.match(LINE);
    if (!m) {
      skipped.push(raw.trim());
      continue;
    }
    const [, h1, m1a, m1b, h2, m2a, m2b, title] = m;
    const start = minutesOf(h1, m1a, m1b);
    const end = h2 !== undefined ? minutesOf(h2, m2a, m2b) : null;
    if (start >= 48 * 60 || (m1a ?? m1b ?? '0').length > 2 || Number(m1a ?? m1b ?? 0) > 59) {
      skipped.push(raw.trim());
      continue;
    }
    parsed.push({ start, end, title });
  }

  const items: QuickScheduleItem[] = parsed.map((p, i) => {
    const next = parsed[i + 1];
    // 終わりを書いていなければ次の行の開始まで(次の行のほうが後のときだけ)
    let end = p.end ?? (next && next.start > p.start ? next.start : null);
    const dayOffset = Math.floor(p.start / (24 * 60));
    const startInDay = p.start % (24 * 60);
    // 日をまたぐ終わりの時刻は持たない(アプリの予定は同じ日の中で終わる形)
    if (end !== null && (end <= p.start || Math.floor(end / (24 * 60)) !== dayOffset || end % (24 * 60) === 0)) end = null;
    return {
      date: dayOffset > 0 ? format(addDays(parseISO(date), dayOffset), 'yyyy-MM-dd') : date,
      start: hhmm(startInDay),
      end: end === null ? null : hhmm(end % (24 * 60)),
      title: p.title,
    };
  });
  return { items, skipped };
}
