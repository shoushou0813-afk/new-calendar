import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';
import { ja } from 'date-fns/locale';
import { useRef, useState, type TouchEvent } from 'react';
import type { EventRow } from '../../types/event';
import { isDeadlineEvent } from '../../lib/deadlineTasks';
import './MonthView.css';

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

/** 1マスに表示する予定の数(これを超えたら「+N」) */
const MAX_CHIPS = 4;

/** 予定の色分け: 締切は赤、作業ブロックは紫、それ以外はカテゴリごとに決まった色 */
function chipClass(e: EventRow): string {
  if (isDeadlineEvent(e)) return 'chip-deadline';
  if (e.task_id) return 'chip-work';
  let hash = 0;
  for (const ch of e.category) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return `chip-c${hash % 6}`;
}

/** マスは狭いので、先頭の【締切】【オンライン】などは外して名前を見せる(締切は色でわかる) */
function chipLabel(title: string): string {
  return title.replace(/^(\s*【[^】]*】\s*)+/, '').trim() || title;
}

/** 終日の予定(0:00開始・終了なし)を先に、あとは開始時刻順 */
function sortForCell(a: EventRow, b: EventRow): number {
  const allDay = (e: EventRow) => (e.starts_at === '00:00' && !e.ends_at ? 0 : 1);
  return allDay(a) - allDay(b) || a.starts_at.localeCompare(b.starts_at);
}

/** これ以上横に動かしたら「スワイプ」とみなす(px) */
const SWIPE_THRESHOLD = 50;

interface MonthViewProps {
  month: Date;
  events: EventRow[];
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
  onChangeMonth: (month: Date) => void;
}

export function MonthView({ month, events, selectedDate, onSelectDate, onChangeMonth }: MonthViewProps) {
  const gridStart = startOfWeek(startOfMonth(month));
  const gridEnd = endOfWeek(endOfMonth(month));
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  const eventsByDate = new Map<string, EventRow[]>();
  for (const event of events) {
    const list = eventsByDate.get(event.date) ?? [];
    list.push(event);
    eventsByDate.set(event.date, list);
  }

  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const [slide, setSlide] = useState<'next' | 'prev' | null>(null);

  const goTo = (direction: 'next' | 'prev') => {
    setSlide(direction);
    onChangeMonth(direction === 'next' ? addMonths(month, 1) : subMonths(month, 1));
  };

  const handleTouchStart = (e: TouchEvent) => {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  };

  // 左にスワイプ → 次の月、右にスワイプ → 前の月。縦スクロールと区別するため、横の動きが十分大きいときだけ
  const handleTouchEnd = (e: TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    goTo(dx < 0 ? 'next' : 'prev');
  };

  return (
    <div className="month-view" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      <div className="month-view-header">
        <button type="button" onClick={() => goTo('prev')} aria-label="前の月">
          ←
        </button>
        <h2>{format(month, 'yyyy年 M月', { locale: ja })}</h2>
        <button type="button" onClick={() => goTo('next')} aria-label="次の月">
          →
        </button>
      </div>
      <div className="month-view-weekdays">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label}>{label}</div>
        ))}
      </div>
      <div
        key={format(month, 'yyyy-MM')}
        className={`month-view-grid${slide ? ` is-slide-${slide}` : ''}`}
        onAnimationEnd={() => setSlide(null)}
      >
        {days.map((day) => {
          const key = format(day, 'yyyy-MM-dd');
          const dayEvents = eventsByDate.get(key) ?? [];
          const sorted = [...dayEvents].sort(sortForCell);
          const hidden = sorted.length - MAX_CHIPS;
          return (
            <button
              type="button"
              key={key}
              className={[
                'month-view-day',
                !isSameMonth(day, month) && 'is-outside',
                isSameDay(day, selectedDate) && 'is-selected',
                isToday(day) && 'is-today',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => onSelectDate(day)}
              aria-label={`${format(day, 'M月d日', { locale: ja })} ${dayEvents.length}件の予定`}
            >
              <span className="month-view-day-number">{format(day, 'd')}</span>
              {sorted.slice(0, hidden > 0 ? MAX_CHIPS - 1 : MAX_CHIPS).map((e) => (
                <span key={e.id} className={`month-view-chip ${chipClass(e)}`}>
                  {chipLabel(e.title)}
                </span>
              ))}
              {hidden > 0 && <span className="month-view-more">+{hidden + 1}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
