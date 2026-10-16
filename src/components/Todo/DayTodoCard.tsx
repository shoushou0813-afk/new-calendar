import { useState } from 'react';
import { format, isToday, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { groupByTask, groupTimeLabel } from '../../lib/planner/groupItems';
import type { ForecastDay } from '../../lib/planner/forecast';
import type { PlanItem } from '../../types/task';
import './Todo.css';

interface DayTodoCardProps {
  day: ForecastDay;
  /** 1週間・1ヶ月表示では日付の見出しを出し、理由の行を省く */
  compact?: boolean;
  /** 休憩とみなす間(分)。これ以内で続く作業は「9:00〜12:50」のように1つの時間帯で出す */
  breakMinutes: number;
  /** まとめた行のチェック。その日の同じタスクの作業を全部まとめて完了/未完了にする */
  onToggle: (day: ForecastDay, items: PlanItem[]) => void;
}

export function formatMinutes(m: number): string {
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}時間${m % 60 ? `${m % 60}分` : ''}` : `${m}分`;
}

/** 1日ぶんの「やること」。同じタスクは1行にまとめる。チェックすると一覧から消える(「完了 N件」から戻せる)。 */
export function DayTodoCard({ day, compact, breakMinutes, onToggle }: DayTodoCardProps) {
  const [showDone, setShowDone] = useState(false);
  const groups = groupByTask(day.items);
  const doneGroups = groupByTask(day.doneItems);
  const remaining = groups.reduce((s, g) => s + g.minutes, 0);
  const date = parseISO(day.date);

  return (
    <div className={`day-todo${compact ? ' is-compact' : ''}${isToday(date) ? ' is-today' : ''}`}>
      {compact && (
        <div className="day-todo-header">
          <span className="day-todo-date">
            {format(date, 'M/d(EEE)', { locale: ja })}
            {isToday(date) && <span className="day-todo-today">今日</span>}
          </span>
          <span className="day-todo-total">{remaining > 0 ? `残り ${formatMinutes(remaining)}` : ''}</span>
        </div>
      )}

      {day.deadlines.length > 0 && (
        <ul className="day-todo-deadlines">
          {day.deadlines.map((t) => (
            <li key={t.id}>
              締切 {t.deadline_time ?? ''} {t.title}
            </li>
          ))}
        </ul>
      )}

      {groups.length === 0 ? (
        <p className="todo-hint">{doneGroups.length > 0 ? 'この日のやることは全部終わりました' : 'やることはありません'}</p>
      ) : (
        <ul className="todo-items">
          {groups.map((g) => (
            <li key={g.key}>
              <label>
                <input type="checkbox" checked={false} onChange={() => onToggle(day, g.items)} aria-label={`${g.title}を完了にする`} />
                <span className="todo-item-time">{formatMinutes(g.minutes)}</span>
                <span className="todo-item-body">
                  <span className="todo-item-title">{g.title}</span>
                  <span className="todo-item-reason">
                    {groupTimeLabel(g, breakMinutes)}
                    {!compact && g.items[0].reason ? ` ・ ${g.items[0].reason}` : ''}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
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
                    <span className="todo-item-time">{formatMinutes(g.minutes)}</span>
                    <span className="todo-item-body">
                      <span className="todo-item-title">{g.title}</span>
                    </span>
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
