import { differenceInCalendarDays, format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import type { ForecastDay } from '../../lib/planner/forecast';
import type { Task } from '../../types/task';
import { formatMinutes } from './DayTodoCard';
import './Todo.css';

interface Props {
  title: string;
  days: ForecastDay[];
  tasks: Task[];
}

interface Row {
  task: Task;
  minutes: number;
  dayCount: number;
}

/** 期間中にやることを、タスクごとに1行(締切順)でまとめる */
export function WeekSummary({ title, days, tasks }: Props) {
  if (days.length === 0) return null;
  const from = days[0].date;
  const to = days[days.length - 1].date;
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const rows = new Map<string, Row>();
  for (const day of days) {
    const seen = new Set<string>();
    for (const item of day.items) {
      const task = byId.get(item.task_id);
      if (!task || task.done) continue;
      const row = rows.get(task.id) ?? { task, minutes: 0, dayCount: 0 };
      row.minutes += Math.max(0, toMin(item.end) - toMin(item.start));
      if (!seen.has(task.id)) row.dayCount++;
      seen.add(task.id);
      rows.set(task.id, row);
    }
  }
  // 期間中が締切なのに、割り振られた作業がないもの(もう終わる見込み・空きがない)も出す
  for (const t of tasks) {
    if (!t.done && t.deadline >= from && t.deadline <= to && !rows.has(t.id)) rows.set(t.id, { task: t, minutes: 0, dayCount: 0 });
  }
  const list = [...rows.values()].sort(
    (a, b) => a.task.deadline.localeCompare(b.task.deadline) || (a.task.deadline_time ?? '99').localeCompare(b.task.deadline_time ?? '99'),
  );
  const total = list.reduce((s, r) => s + r.minutes, 0);

  return (
    <div className="week-summary">
      <div className="week-summary-header">
        <h3>{title}</h3>
        <span>{list.length > 0 ? `${list.length}件・合計 ${formatMinutes(total)}` : ''}</span>
      </div>
      {list.length === 0 ? (
        <p className="todo-hint">この期間にやることはありません</p>
      ) : (
        <ul>
          {list.map(({ task, minutes, dayCount }) => {
            const left = differenceInCalendarDays(parseISO(task.deadline), parseISO(from));
            const dueInRange = task.deadline <= to;
            const remaining = task.estimated_minutes - task.spent_minutes;
            return (
              <li key={task.id} className={dueInRange ? 'is-due' : ''}>
                <span className="week-summary-deadline">
                  {format(parseISO(task.deadline), 'M/d(EEE)', { locale: ja })}
                  <small>{left < 0 ? '超過' : left === 0 ? '今日締切' : `あと${left}日`}</small>
                </span>
                <span className="week-summary-title">
                  {task.title}
                  <small>
                    {minutes > 0 ? `この期間に ${formatMinutes(minutes)}(${dayCount}日に分けて)` : 'この期間の作業なし'}
                    {remaining > minutes ? ` ・ 全体の残り ${formatMinutes(remaining)}` : ''}
                  </small>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
