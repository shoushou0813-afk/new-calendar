import { useState } from 'react';
import { isDeadlineEvent, taskTitleFromEvent } from '../../lib/deadlineTasks';
import { eventOccursOn } from '../../lib/eventSpan';
import { buildDayFlow } from '../../lib/planner/dayFlow';
import type { ForecastDay } from '../../lib/planner/forecast';
import { groupByTask } from '../../lib/planner/groupItems';
import type { EventRow } from '../../types/event';
import type { PlanItem } from '../../types/task';
import { formatMinutes } from './DayTodoCard';
import './Todo.css';

interface DayFlowProps {
  day: ForecastDay;
  events: EventRow[];
  /** 今の時刻(締切の過ぎた予定を出さないため) */
  now: Date;
  onToggle: (day: ForecastDay, items: PlanItem[]) => void;
}

/**
 * 大まかな1日の流れ。細かい時刻は出さず、決まっている予定(授業など)の間に「ここでこれをやる」を並べる。
 * 同じタスクは1行にまとめ、チェックするとその日の分が終わったことになる。
 */
export function DayFlow({ day, events, now, onToggle }: DayFlowProps) {
  const [showDone, setShowDone] = useState(false);
  const blocks = buildDayFlow(day.date, day.items, events);
  const doneGroups = groupByTask(day.doneItems);
  const isToday = formatDate(now) === day.date;
  const nowHHmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const dayEvents = events.filter((e) => eventOccursOn(e, day.date) && !e.task_id);
  const allDay = dayEvents.filter((e) => e.starts_at === '00:00' && !e.ends_at && !isDeadlineEvent(e));
  // 今日の締切(時刻が過ぎたものは出さない)
  const deadlines = [
    ...dayEvents
      .filter((e) => isDeadlineEvent(e) && e.date === day.date)
      .map((e) => {
        const time = e.ends_at ?? (e.starts_at === '00:00' ? null : e.starts_at);
        return { key: e.id, title: taskTitleFromEvent(e.title), time };
      }),
    ...day.deadlines.map((t) => ({ key: t.id, title: t.title, time: t.deadline_time })),
  ].filter((d) => !(isToday && d.time && d.time <= nowHHmm));

  return (
    <div className="flow">
      {(allDay.length > 0 || deadlines.length > 0) && (
        <ul className="flow-notes">
          {allDay.map((e) => (
            <li key={e.id}>終日 {e.title}</li>
          ))}
          {deadlines.map((d) => (
            <li key={d.key} className="is-deadline">
              締切{d.time ? ` ${d.time}` : ''} {d.title}
            </li>
          ))}
        </ul>
      )}

      {blocks.length === 0 ? (
        <p className="todo-hint">{doneGroups.length > 0 ? 'この日のやることは全部終わりました' : 'この日のやることはありません'}</p>
      ) : (
        <ol className="flow-blocks">
          {blocks.map((b) =>
            b.kind === 'event' ? (
              <li key={b.key} className="flow-event">
                <span className="flow-event-time">{b.start === '00:00' ? '前日から' : b.start}</span>
                <span className="flow-event-title">{b.title}</span>
              </li>
            ) : (
              <li key={b.key} className="flow-gap">
                <div className="flow-gap-label">
                  {b.label}
                  <span>{formatMinutes(b.minutes)}</span>
                </div>
                <ul className="todo-items">
                  {b.groups.map((g) => (
                    <li key={g.key}>
                      <label>
                        <input type="checkbox" checked={false} onChange={() => onToggle(day, g.items)} aria-label={`${g.title}を完了にする`} />
                        <span className="todo-item-body">
                          <span className="todo-item-title">{g.title}</span>
                        </span>
                        <span className="flow-minutes">{formatMinutes(g.minutes)}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </li>
            ),
          )}
        </ol>
      )}

      {doneGroups.length > 0 && (
        <div className="day-todo-done">
          <button type="button" className="todo-link" onClick={() => setShowDone((v) => !v)}>
            完了 {doneGroups.length}件 {showDone ? '▲' : '▼'}
          </button>
          {showDone && (
            <ul className="todo-items">
              {doneGroups.map((g) => (
                <li key={g.key} className="is-done">
                  <label>
                    <input type="checkbox" checked onChange={() => onToggle(day, g.items)} aria-label={`${g.title}を未完了に戻す`} />
                    <span className="todo-item-body">
                      <span className="todo-item-title">{g.title}</span>
                    </span>
                    <span className="flow-minutes">{formatMinutes(g.minutes)}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
