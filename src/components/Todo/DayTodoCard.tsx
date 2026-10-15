import { useState } from 'react';
import { format, isToday, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { toMinutes } from '../../lib/planner/freeSlots';
import type { ForecastDay } from '../../lib/planner/forecast';
import type { PlanItem } from '../../types/task';
import './Todo.css';

interface DayTodoCardProps {
  day: ForecastDay;
  /** 1週間・1ヶ月表示では日付の見出しを出し、理由の行を省く */
  compact?: boolean;
  onToggle: (day: ForecastDay, item: PlanItem) => void;
}

function minutesOf(item: PlanItem): number {
  return toMinutes(item.end) - toMinutes(item.start);
}

export function formatMinutes(m: number): string {
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}時間${m % 60 ? `${m % 60}分` : ''}` : `${m}分`;
}

/** 1日ぶんの「やること」。チェックすると一覧から消える(「完了 N件」から戻せる)。 */
export function DayTodoCard({ day, compact, onToggle }: DayTodoCardProps) {
  const [showDone, setShowDone] = useState(false);
  const remaining = day.items.reduce((s, i) => s + minutesOf(i), 0);
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

      {day.items.length === 0 ? (
        <p className="todo-hint">{day.doneItems.length > 0 ? 'この日のやることは全部終わりました' : 'やることはありません'}</p>
      ) : (
        <ul className="todo-items">
          {day.items.map((item) => (
            <li key={item.id}>
              <label>
                <input type="checkbox" checked={false} onChange={() => onToggle(day, item)} aria-label={`${item.title}を完了にする`} />
                <span className="todo-item-time">
                  {item.start}〜{item.end}
                </span>
                <span className="todo-item-body">
                  <span className="todo-item-title">{item.title}</span>
                  {!compact && <span className="todo-item-reason">{item.reason}</span>}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}

      {day.doneItems.length > 0 && (
        <div className="day-todo-done">
          <button type="button" className="todo-link" onClick={() => setShowDone((v) => !v)}>
            完了 {day.doneItems.length}件 {showDone ? '▲' : '▼'}
          </button>
          {showDone && (
            <ul className="todo-items">
              {day.doneItems.map((item) => (
                <li key={item.id} className="is-done">
                  <label>
                    <input type="checkbox" checked onChange={() => onToggle(day, item)} aria-label={`${item.title}を未完了に戻す`} />
                    <span className="todo-item-time">
                      {item.start}〜{item.end}
                    </span>
                    <span className="todo-item-body">
                      <span className="todo-item-title">{item.title}</span>
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
