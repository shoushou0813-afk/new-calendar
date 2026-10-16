import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import type { EventRow } from '../../types/event';
import { hasNoEvidence } from '../../lib/validation';
import { toEventInput } from '../../lib/eventMapper';
import { eventEndDate, isMultiDay } from '../../lib/eventSpan';
import './EventCard.css';

interface EventCardProps {
  event: EventRow;
  showDate?: boolean;
  onEdit: (event: EventRow) => void;
  onDelete: (event: EventRow) => void;
}

export function EventCard({ event, showDate, onEdit, onDelete }: EventCardProps) {
  const noEvidence = hasNoEvidence(toEventInput(event));
  return (
    <div className="event-card">
      <div className="event-card-main" onClick={() => onEdit(event)}>
        <div className="event-card-top">
          <span className="event-card-category">{event.category}</span>
          {showDate && <span className="event-card-date">{format(parseISO(event.date), 'M月d日(EEE)', { locale: ja })}</span>}
          {noEvidence && <span className="event-card-flag">情報なし</span>}
        </div>
        <div className="event-card-title">{event.title}</div>
        <div className="event-card-times">
          {event.doors_at && <span>集合 {event.doors_at}</span>}
          <span>{event.starts_at === '00:00' && !event.ends_at ? '終日' : `開始 ${event.starts_at}`}</span>
          {isMultiDay(event) ? (
            <span>
              終了 {format(parseISO(eventEndDate(event)), 'M/d', { locale: ja })} {event.ends_at ?? ''}
            </span>
          ) : (
            event.ends_at && <span>終了 {event.ends_at}</span>
          )}
        </div>
      </div>
      <button type="button" className="event-card-delete" onClick={() => onDelete(event)} aria-label="削除">
        削除
      </button>
    </div>
  );
}
