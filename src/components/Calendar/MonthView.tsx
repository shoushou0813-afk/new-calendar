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
import type { EventRow } from '../../types/event';
import { hasNoEvidence } from '../../lib/validation';
import { toEventInput } from '../../lib/eventMapper';
import './MonthView.css';

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

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

  return (
    <div className="month-view">
      <div className="month-view-header">
        <button type="button" onClick={() => onChangeMonth(subMonths(month, 1))} aria-label="前の月">
          ←
        </button>
        <h2>{format(month, 'yyyy年 M月', { locale: ja })}</h2>
        <button type="button" onClick={() => onChangeMonth(addMonths(month, 1))} aria-label="次の月">
          →
        </button>
      </div>
      <div className="month-view-weekdays">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label}>{label}</div>
        ))}
      </div>
      <div className="month-view-grid">
        {days.map((day) => {
          const key = format(day, 'yyyy-MM-dd');
          const dayEvents = eventsByDate.get(key) ?? [];
          const noEvidenceCount = dayEvents.filter((e) => hasNoEvidence(toEventInput(e))).length;
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
            >
              <span className="month-view-day-number">{format(day, 'd')}</span>
              {dayEvents.length > 0 && (
                <span className="month-view-day-dots">
                  {dayEvents.slice(0, 4).map((e) => (
                    <span key={e.id} className={`dot ${e.time_confirmed ? 'dot-ok' : 'dot-plain'}`} />
                  ))}
                </span>
              )}
              {noEvidenceCount > 0 && <span className="month-view-day-flag">裏付けなし {noEvidenceCount}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
