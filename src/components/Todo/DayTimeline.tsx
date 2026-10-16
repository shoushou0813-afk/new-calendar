import { useState } from 'react';
import { isDeadlineEvent } from '../../lib/deadlineTasks';
import { eventOccursOn, eventSliceOn } from '../../lib/eventSpan';
import type { ForecastDay } from '../../lib/planner/forecast';
import { groupByTask, mergeRuns, type ItemGroup } from '../../lib/planner/groupItems';
import type { EventRow } from '../../types/event';
import type { PlanItem } from '../../types/task';
import './Todo.css';

interface DayTimelineProps {
  day: ForecastDay;
  events: EventRow[];
  /** 休憩とみなす間(分)。同じタスクがこれ以内の間で続くときは1行にまとめる */
  breakMinutes: number;
  onToggle: (day: ForecastDay, items: PlanItem[]) => void;
}

type Row =
  | { kind: 'event'; time: string; end: string | null; title: string; key: string; deadline: boolean }
  | { kind: 'todo'; time: string; end: string; title: string; key: string; group: ItemGroup };

/**
 * 1日の流れ。予定(決まっていること)とやること(Todo)を時刻順に1行ずつ並べる。
 * やることはチェックすると一覧から消え、下の「完了 N件」から戻せる。
 */
export function DayTimeline({ day, events, breakMinutes, onToggle }: DayTimelineProps) {
  const [showDone, setShowDone] = useState(false);
  const doneGroups = groupByTask(day.doneItems);
  // 日をまたぐ予定は、この日にかかっている時間帯(前日から / 翌日まで)で出す
  const dayEvents = events
    .filter((e) => eventOccursOn(e, day.date) && !e.task_id)
    .map((e) => {
      const slice = eventSliceOn(e, day.date);
      const title = `${e.title}${slice.continued ? '(前日から)' : ''}${slice.continues ? '(翌日まで)' : ''}`;
      return { ...e, ...slice, ends_at: slice.ends_at === '24:00' ? null : slice.ends_at, title };
    });
  const allDay = dayEvents.filter((e) => e.starts_at === '00:00' && !e.ends_at && !isDeadlineEvent(e));

  const rows: Row[] = [
    ...dayEvents
      .filter((e) => !allDay.includes(e))
      .map((e) => {
        const deadline = isDeadlineEvent(e);
        // 締切の予定は「締切の時刻」(終わりの時刻)に1行で出す。終日の締切は一番上に出す
        const time = deadline ? (e.ends_at ?? (e.starts_at === '00:00' ? '' : e.starts_at)) : e.starts_at;
        return { kind: 'event' as const, time, end: deadline ? null : e.ends_at, title: e.title.replace(/^【作業】/, ''), key: e.id, deadline };
      }),
    // 休憩をはさんで続く同じタスクは「9:00〜12:50 ○○」の1行にする
    ...mergeRuns(day.items, breakMinutes).map((group) => ({
      kind: 'todo' as const,
      time: group.start,
      end: group.end,
      title: group.title,
      key: group.key,
      group,
    })),
  ].sort((a, b) => a.time.localeCompare(b.time) || (a.kind === 'event' ? -1 : 1));

  return (
    <div className="timeline">
      {allDay.length > 0 && (
        <ul className="timeline-allday">
          {allDay.map((e) => (
            <li key={e.id}>終日 {e.title}</li>
          ))}
        </ul>
      )}
      {rows.length === 0 ? (
        <p className="todo-hint">{day.doneItems.length > 0 ? 'この日のやることは全部終わりました' : 'この日の予定もやることもありません'}</p>
      ) : (
        <ol className="timeline-rows">
          {rows.map((row) => (
            <li key={row.key} className={`timeline-row is-${row.kind}${row.kind === 'event' && row.deadline ? ' is-deadline' : ''}`}>
              <span className="timeline-time">{row.time || '終日'}</span>
              {row.kind === 'todo' ? (
                <label className="timeline-body">
                  <input type="checkbox" checked={false} onChange={() => onToggle(day, row.group.items)} aria-label={`${row.title}を完了にする`} />
                  <span className="timeline-title">{row.title}</span>
                  <span className="timeline-end">〜{row.end}</span>
                </label>
              ) : (
                <span className="timeline-body">
                  <span className="timeline-title">
                    {row.deadline && <span className="timeline-tag">締切</span>}
                    {row.title.replace(/^\s*【[^】]*(締切|〆切|期限)[^】]*】\s*/, '')}
                  </span>
                  {row.end && <span className="timeline-end">〜{row.end}</span>}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
      {day.doneItems.length > 0 && (
        <div className="day-todo-done">
          <button type="button" className="todo-link" onClick={() => setShowDone((v) => !v)}>
            完了 {doneGroups.length}件 {showDone ? '▲' : '▼'}
          </button>
          {showDone && (
            <ol className="timeline-rows">
              {doneGroups.map((g) => (
                <li key={g.key} className="timeline-row is-todo is-done">
                  <span className="timeline-time">{g.start}</span>
                  <label className="timeline-body">
                    <input type="checkbox" checked onChange={() => onToggle(day, g.items)} aria-label={`${g.title}を未完了に戻す`} />
                    <span className="timeline-title">{g.title}</span>
                  </label>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
