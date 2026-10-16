/**
 * 通知の文面づくり(純粋関数)。毎晩「明日の予定」、日曜の夜に「来週(月〜日)の予定」を送る。
 */
import type { CloudDoc } from './cloudDoc.js';

const WEEKDAY = ['日', '月', '火', '水', '木', '金', '土'];

export function addDaysStr(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function label(date: string): string {
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}(${WEEKDAY[weekdayOf(date)]})`;
}

interface Line {
  date: string;
  time: string;
  text: string;
}

/** その期間の予定(AIの作業ブロックは除く)と、締切のタスク */
function linesBetween(doc: CloudDoc, from: string, to: string): Line[] {
  const lines: Line[] = [];
  for (const e of Object.values(doc.events)) {
    if (e.task_id) continue;
    const start = String(e.date);
    const end = e.end_date && String(e.end_date) > start ? String(e.end_date) : start;
    if (start > to || end < from) continue;
    const date = start < from ? from : start;
    const allDay = e.starts_at === '00:00' && !e.ends_at;
    const time = start < from ? '前日から' : allDay ? '終日' : String(e.starts_at);
    lines.push({ date, time, text: String(e.title ?? '') });
  }
  for (const t of Object.values(doc.tasks)) {
    if (t.done) continue;
    const deadline = String(t.deadline);
    if (deadline < from || deadline > to) continue;
    lines.push({ date: deadline, time: t.deadline_time ? String(t.deadline_time) : '締切', text: `締切: ${String(t.title)}` });
  }
  const rank = (time: string) => (time === '前日から' ? '0' : time === '終日' ? '1' : time === '締切' ? '3' : `2${time}`);
  return lines.sort((a, b) => a.date.localeCompare(b.date) || rank(a.time).localeCompare(rank(b.time)));
}

export interface Digest {
  title: string;
  body: string;
  /** 通知をまとめる・置き換えるための名前 */
  tag: string;
}

/** 明日の予定 */
export function dailyDigest(doc: CloudDoc, tomorrow: string): Digest {
  const lines = linesBetween(doc, tomorrow, tomorrow);
  return {
    title: `明日 ${label(tomorrow)} の予定${lines.length ? ` ${lines.length}件` : ''}`,
    body: lines.length ? lines.map((l) => `${l.time === '締切' ? '' : `${l.time} `}${l.text}`).join('\n') : '予定はありません',
    tag: `daily-${tomorrow}`,
  };
}

/** 来週(weekStart から7日間)の予定 */
export function weeklyDigest(doc: CloudDoc, weekStart: string): Digest {
  const weekEnd = addDaysStr(weekStart, 6);
  const lines = linesBetween(doc, weekStart, weekEnd);
  const deadlines = lines.filter((l) => l.text.startsWith('締切: ')).length;
  const byDay = new Map<string, string[]>();
  for (const l of lines) byDay.set(l.date, [...(byDay.get(l.date) ?? []), l.text.replace(/^締切: /, '〆')]);
  return {
    title: `来週 ${label(weekStart)}〜${label(weekEnd)}: 予定${lines.length - deadlines}件・締切${deadlines}件`,
    body: lines.length ? [...byDay.entries()].map(([d, texts]) => `${label(d)} ${texts.join('、')}`).join('\n') : '予定はありません',
    tag: `weekly-${weekStart}`,
  };
}

/** 今夜送る通知(日本時間の今日の日付から決める)。日曜の夜は来週のまとめも送る */
export function digestsFor(doc: CloudDoc, todayJst: string): Digest[] {
  const tomorrow = addDaysStr(todayJst, 1);
  const result = [dailyDigest(doc, tomorrow)];
  if (weekdayOf(todayJst) === 0) result.push(weeklyDigest(doc, tomorrow));
  return result;
}
