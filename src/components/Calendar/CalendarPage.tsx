import { useMemo, useState } from 'react';
import { format, isSameDay, parseISO, startOfMonth } from 'date-fns';
import { ja } from 'date-fns/locale';
import { useCategories } from '../../hooks/useCategories';
import { useEvents } from '../../hooks/useEvents';
import { hasNoEvidence } from '../../lib/validation';
import { toEventInput } from '../../lib/eventMapper';
import { MonthView } from './MonthView';
import { EventCard } from '../EventList/EventCard';
import { EventForm } from '../EventForm/EventForm';
import { ImportDialog } from '../Import/ImportDialog';
import type { EventDraft, EventRow } from '../../types/event';
import './CalendarPage.css';

type Tab = 'calendar' | 'noEvidence';

export function CalendarPage() {
  const { events, loading, createEvent, updateEvent, deleteEvent, importEvents } = useEvents();
  const { categories, addCategory } = useCategories();

  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [tab, setTab] = useState<Tab>('calendar');
  const [editingEvent, setEditingEvent] = useState<EventRow | 'new' | null>(null);
  const [showImport, setShowImport] = useState(false);

  const dayEvents = useMemo(
    () => events.filter((e) => isSameDay(parseISO(e.date), selectedDate)).sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
    [events, selectedDate],
  );

  const noEvidenceEvents = useMemo(
    () => events.filter((e) => hasNoEvidence(toEventInput(e))).sort((a, b) => a.date.localeCompare(b.date)),
    [events],
  );

  const handleSave = async (draft: EventDraft) => {
    if (editingEvent && editingEvent !== 'new') {
      await updateEvent(editingEvent.id, draft);
    } else {
      await createEvent(draft);
    }
    setEditingEvent(null);
  };

  const handleDelete = async (event: EventRow) => {
    if (!window.confirm(`「${event.title}」を削除しますか？`)) return;
    await deleteEvent(event.id);
  };

  return (
    <div className="calendar-page">
      <header className="calendar-page-header">
        <h1>予定時刻ミス検知カレンダー</h1>
        <p className="calendar-page-storage-note">この端末のブラウザ内にのみ保存されます</p>
      </header>

      <nav className="calendar-page-tabs">
        <button type="button" className={tab === 'calendar' ? 'is-active' : ''} onClick={() => setTab('calendar')}>
          カレンダー
        </button>
        <button type="button" className={tab === 'noEvidence' ? 'is-active' : ''} onClick={() => setTab('noEvidence')}>
          裏付けのない予定 {noEvidenceEvents.length > 0 && `(${noEvidenceEvents.length})`}
        </button>
        <button type="button" className="calendar-page-import-button" onClick={() => setShowImport(true)}>
          インポート
        </button>
      </nav>

      {tab === 'calendar' ? (
        <div className="calendar-page-body">
          <MonthView month={month} events={events} selectedDate={selectedDate} onSelectDate={setSelectedDate} onChangeMonth={setMonth} />
          <div className="calendar-page-day-panel">
            <div className="calendar-page-day-panel-header">
              <h2>{format(selectedDate, 'M月d日(EEE)', { locale: ja })}</h2>
              <button type="button" onClick={() => setEditingEvent('new')}>
                + 予定を追加
              </button>
            </div>
            {loading ? (
              <p className="calendar-page-hint">読み込み中...</p>
            ) : dayEvents.length === 0 ? (
              <p className="calendar-page-hint">この日の予定はありません</p>
            ) : (
              <div className="calendar-page-day-list">
                {dayEvents.map((event) => (
                  <EventCard key={event.id} event={event} onEdit={setEditingEvent} onDelete={handleDelete} />
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="calendar-page-list">
          <p className="calendar-page-hint">
            チケットURLも画像もメモもない予定です。まとめて見直して、必要なら情報を足しましょう。
          </p>
          {noEvidenceEvents.length === 0 ? (
            <p className="calendar-page-hint">該当する予定はありません</p>
          ) : (
            noEvidenceEvents.map((event) => (
              <EventCard key={event.id} event={event} showDate onEdit={setEditingEvent} onDelete={handleDelete} />
            ))
          )}
        </div>
      )}

      {editingEvent && (
        <EventForm
          categories={categories}
          defaultDate={selectedDate}
          initialEvent={editingEvent === 'new' ? undefined : editingEvent}
          history={events}
          onAddCategory={addCategory}
          onSave={handleSave}
          onCancel={() => setEditingEvent(null)}
        />
      )}

      {showImport && (
        <ImportDialog categories={categories} onImport={importEvents} onClose={() => setShowImport(false)} />
      )}
    </div>
  );
}
