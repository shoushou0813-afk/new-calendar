import { useEffect, useMemo, useState } from 'react';
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
import { SettingsDialog } from '../Settings/SettingsDialog';
import { TodoPage } from '../Todo/TodoPage';
import { useSettings } from '../../hooks/useSettings';
import { useTasks } from '../../hooks/useTasks';
import { resolveGoogleClientId } from '../../lib/settings';
import { runGoogleSync } from '../../lib/google/runGoogleSync';
import { clearImportLink, readImportLink } from '../../lib/importLink';
import type { EventDraft, EventRow } from '../../types/event';
import './CalendarPage.css';

type Tab = 'calendar' | 'todo' | 'noEvidence';

export function CalendarPage() {
  const { events, loading, reload, createEvent, updateEvent, deleteEvent, importEvents } = useEvents();
  const { categories, addCategory } = useCategories();
  const { tasks, createTask, createTasks, updateTask, deleteTask } = useTasks();
  const { settings, updateSettings } = useSettings();
  const [showSettings, setShowSettings] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [tab, setTab] = useState<Tab>('calendar');
  const [editingEvent, setEditingEvent] = useState<EventRow | 'new' | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [linkIcsText, setLinkIcsText] = useState<string | null>(null);
  // 最初の予定読み込みが終わったか(取り込み後の再読み込みでは false に戻さない)
  const [eventsReady, setEventsReady] = useState(false);
  if (!loading && !eventsReady) setEventsReady(true);

  // 1タップ取り込みリンク(#import=...)から開かれたら、取り込み画面をすぐ出す
  useEffect(() => {
    const handle = () => {
      if (!window.location.hash.startsWith('#import=')) return;
      readImportLink(window.location.hash)
        .then((text) => {
          if (text === null) return;
          setLinkIcsText(text);
          setShowImport(true);
        })
        .catch((err: unknown) =>
          setSyncMessage({ kind: 'error', text: err instanceof Error ? err.message : '取り込みリンクを読めませんでした。' }),
        )
        .finally(clearImportLink);
    };
    handle();
    // すでにアプリを開いているタブでリンクを開いた場合は、# だけが変わる
    window.addEventListener('hashchange', handle);
    return () => window.removeEventListener('hashchange', handle);
  }, []);

  const dayEvents = useMemo(
    () => events.filter((e) => isSameDay(parseISO(e.date), selectedDate)).sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
    [events, selectedDate],
  );

  const noEvidenceEvents = useMemo(
    () => events.filter((e) => !e.task_id && hasNoEvidence(toEventInput(e))).sort((a, b) => a.date.localeCompare(b.date)),
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

  const handleSync = async () => {
    const clientId = resolveGoogleClientId(settings);
    if (!clientId) {
      setSyncMessage({ kind: 'error', text: '設定で Google の OAuth クライアントIDを入力してください(README参照)。' });
      setShowSettings(true);
      return;
    }
    setSyncing(true);
    setSyncMessage(null);
    try {
      const r = await runGoogleSync(clientId, settings);
      await reload();
      setSyncMessage({
        kind: 'ok',
        text: `同期しました: Googleから 追加${r.pulledNew}・更新${r.pulledUpdated}・削除${r.pulledDeleted} / Googleへ 追加${r.pushedNew}・更新${r.pushedUpdated}・削除${r.pushedDeleted}`,
      });
    } catch (err) {
      setSyncMessage({ kind: 'error', text: err instanceof Error ? err.message : '同期に失敗しました' });
    } finally {
      setSyncing(false);
    }
  };

  /** その日のAI作業ブロックを入れ替える(前回の計画で入れたブロックは消す) */
  const replacePlanEvents = async (date: string, drafts: EventDraft[]) => {
    for (const old of events.filter((e) => e.date === date && e.task_id)) await deleteEvent(old.id);
    await importEvents(drafts);
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
        <button type="button" className={tab === 'todo' ? 'is-active' : ''} onClick={() => setTab('todo')}>
          今日のTodo
        </button>
        <button type="button" className={tab === 'noEvidence' ? 'is-active' : ''} onClick={() => setTab('noEvidence')}>
          情報が足りない予定 {noEvidenceEvents.length > 0 && `(${noEvidenceEvents.length})`}
        </button>
        <button type="button" className="calendar-page-import-button" onClick={() => void handleSync()} disabled={syncing}>
          {syncing ? '同期中...' : 'Google同期'}
        </button>
        <button type="button" onClick={() => setShowImport(true)}>
          インポート
        </button>
        <button type="button" onClick={() => setShowSettings(true)}>
          設定
        </button>
      </nav>

      {syncMessage && <p className={`calendar-page-sync is-${syncMessage.kind}`}>{syncMessage.text}</p>}

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
      ) : tab === 'todo' ? (
        <TodoPage
          date={selectedDate}
          events={events}
          tasks={tasks}
          settings={settings}
          onCreateTask={createTask}
          onCreateTasks={createTasks}
          onUpdateTask={updateTask}
          onDeleteTask={deleteTask}
          onReplacePlanEvents={replacePlanEvents}
          onOpenSettings={() => setShowSettings(true)}
        />
      ) : (
        <div className="calendar-page-list">
          <p className="calendar-page-hint">
            URLも画像もメモもない予定です。あとで「何だっけ？」とならないよう、案内のURLやスクショ、メモを足しておきましょう。
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

      {showSettings && (
        <SettingsDialog
          settings={settings}
          categories={categories}
          envClientId={resolveGoogleClientId({ ...settings, googleClientId: '' })}
          onSave={(next) => {
            updateSettings(next);
            setShowSettings(false);
          }}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* リンクから開いたときは、登録済みの予定を読み終えてから出す(重複チェックのため) */}
      {showImport && (!linkIcsText || eventsReady) && (
        <ImportDialog
          categories={categories}
          initialText={linkIcsText ?? undefined}
          existingEvents={events}
          onImport={importEvents}
          onClose={() => {
            setShowImport(false);
            setLinkIcsText(null);
          }}
        />
      )}
    </div>
  );
}
