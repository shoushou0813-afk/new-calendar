import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import type { PlanItem } from '../../types/task';
import { toHHmm, toMinutes } from './freeSlots';
import type { PlanResult } from './localPlanner';
import type { PlanningContext } from './planningContext';

const MODEL = 'claude-opus-5-5';

const PlanSchema = z.object({
  summary: z.string().describe('今日の計画の方針を2〜3文で。'),
  items: z.array(
    z.object({
      task_id: z.string().describe('入力の tasks[].id のいずれか'),
      start: z.string().describe('HH:mm(24時間表記)'),
      end: z.string().describe('HH:mm(24時間表記)'),
      reason: z.string().describe('この時間にこのタスクをやる理由を短く'),
    }),
  ),
  warnings: z.array(z.string()).describe('締切に間に合わない恐れなど、ユーザーが知っておくべきこと'),
});

const SYSTEM_PROMPT = `あなたは学生・社会人の1日の作業計画を立てるアシスタントです。
締切のあるタスクと、その日の予定・空き時間が与えられるので、「今日どの時間に何をやるか」を決めてください。

守ること:
- 作業は必ず free_slots の中に入れる。予定のある時間や作業時間帯の外には入れない。
- 1コマは max_block_minutes 以内にし、コマの間には break_minutes 以上の休憩を空ける。
- mandatory_today_minutes は「今日やらないと締切に間に合わない分」なので最優先で確保する。
- 余裕があれば pace_today_minutes を目安に前倒しで進め、締切直前に詰め込まないようにする。
- 集中力が要るもの・優先度 high のものは、なるべく早い時間や長い空き時間に置く。
- 空き時間を全部埋める必要はない。無理のない量にする。
- shortage_minutes が 0 より大きいタスクは間に合わない恐れがあるので warnings で伝える。
- summary・reason・warnings は日本語で、短く具体的に書く。`;

export async function planWithClaude(ctx: PlanningContext, apiKey: string): Promise<PlanResult> {
  // ブラウザから直接APIを呼ぶ。キーはこの端末の localStorage にだけ保存され、ユーザー本人のもの。
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  const input = {
    date: ctx.date,
    work_hours: { start: ctx.settings.workStart, end: ctx.settings.workEnd },
    max_block_minutes: ctx.settings.maxBlockMinutes,
    break_minutes: ctx.settings.breakMinutes,
    free_slots: ctx.slots.map((s) => ({ start: toHHmm(s.start), end: toHHmm(s.end) })),
    events_today: ctx.dayEvents.map((e) => ({ title: e.title, start: e.starts_at, end: e.ends_at })),
    upcoming_free_minutes_per_day: ctx.dailyFreeMinutes.slice(0, 14),
    tasks: ctx.tasks.map((t) => ({
      id: t.task.id,
      title: t.task.title,
      deadline: t.task.deadline_time ? `${t.task.deadline} ${t.task.deadline_time}` : t.task.deadline,
      days_until_deadline: t.daysUntilDeadline,
      priority: t.task.priority,
      remaining_minutes: t.remaining,
      mandatory_today_minutes: t.mandatoryToday,
      pace_today_minutes: t.paceToday,
      shortage_minutes: t.shortage,
      note: t.task.note,
    })),
  };

  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium', format: betaZodOutputFormat(PlanSchema) },
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `次の情報から今日の作業計画を立ててください。\n\n${JSON.stringify(input, null, 2)}` }],
  });

  if (response.stop_reason === 'refusal') throw new Error('AIが計画の作成を断りました。内容を変えて再度お試しください。');
  if (response.stop_reason === 'max_tokens') throw new Error('AIの応答が途中で切れました。もう一度お試しください。');
  const parsed = response.parsed_output;
  if (!parsed) throw new Error('AIの応答を読み取れませんでした。');

  return sanitize(parsed, ctx);
}

/** AIの出力を信用しすぎないよう、空き時間外・重なり・存在しないタスクを取り除く。 */
export function sanitize(raw: z.infer<typeof PlanSchema>, ctx: PlanningContext): PlanResult {
  const titles = new Map(ctx.tasks.map((t) => [t.task.id, t.task.title]));
  const cutoffs = new Map(
    ctx.tasks
      .filter((t) => !t.overdue && t.daysUntilDeadline === 0 && t.task.deadline_time)
      .map((t) => [t.task.id, toMinutes(t.task.deadline_time!)]),
  );
  const valid = /^([01]\d|2[0-3]):[0-5]\d$/;
  const warnings = [...raw.warnings];
  const accepted: PlanItem[] = [];
  let dropped = 0;

  const sorted = raw.items
    .filter((i) => valid.test(i.start) && valid.test(i.end))
    .sort((a, b) => a.start.localeCompare(b.start));
  dropped += raw.items.length - sorted.length;

  for (const item of sorted) {
    const start = toMinutes(item.start);
    const end = toMinutes(item.end);
    const title = titles.get(item.task_id);
    const insideFree = ctx.slots.some((s) => start >= s.start && end <= s.end);
    const overlaps = accepted.some((a) => start < toMinutes(a.end) && end > toMinutes(a.start));
    const afterDeadline = end > (cutoffs.get(item.task_id) ?? Infinity);
    if (!title || end <= start || !insideFree || overlaps || afterDeadline) {
      dropped++;
      continue;
    }
    accepted.push({ id: crypto.randomUUID(), task_id: item.task_id, title, start: item.start, end: item.end, reason: item.reason, done: false });
  }

  if (dropped > 0) warnings.push(`AIの提案のうち${dropped}件は空き時間と合わなかったため除外しました。`);
  return { items: accepted, summary: raw.summary, warnings };
}
