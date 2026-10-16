import { useEffect, useMemo, useState } from 'react';
import { format, parseISO, startOfMonth } from 'date-fns';
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
import { configureCloud, syncNow } from '../../lib/cloud/cloudSync';
import { eventOccursOn, eventSliceOn } from '../../lib/eventSpan';
import { useCloudStatus } from '../../hooks/useCloudStatus';
import { useMoney } from '../../hooks/useMoney';
import { MoneyPage } from '../Money/MoneyPage';
import { cardPaymentDate, shiftForecasts, yen } from '../../../api/_lib/money';
import '../Money/Money.css';
import type { EventDraft, EventRow } from '../../types/event';
import './CalendarPage.css';

type Tab = 'calendar' | 'todo' | 'money' | 'noEvidence';

export function CalendarPage() {
  const { events, loading, reload, createEvent, updateEvent, deleteEvent, deleteEvents, importEvents } = useEvents();
  const { categories, addCategory } = useCategories();
  const { tasks, loading: tasksLoading, createTask, createTasks, updateTask, deleteTask, deleteTasks } = useTasks();
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
  const cloud = useCloudStatus();
  const money = useMoney();
  const shifts = useMemo(() => shiftForecasts(events, money.jobs), [events, money.jobs]);

  // 合言葉が設定されていればネット保存を始める
  useEffect(() => {
    configureCloud(settings.cloudToken);
  }, [settings.cloudToken]);
  // 最初の予定・タスクの読み込みが終わったか(取り込み後の再読み込みでは false に戻さない)
  const [eventsReady, setEventsReady] = useState(false);
  if (!loading && !tasksLoading && !eventsReady) setEventsReady(true);

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
    () => {
      const day = format(selectedDate, 'yyyy-MM-dd');
      return events
        .filter((e) => eventOccursOn(e, day))
        .sort((a, b) => eventSliceOn(a, day).starts_at.localeCompare(eventSliceOn(b, day).starts_at));
    },
    [events, selectedDate],
  );

  /** 選んだ日のお金(使った額・シフトの見込み・カード引き落とし・給料日) */
  const dayMoney = useMemo(() => {
    const day = format(selectedDate, 'yyyy-MM-dd');
    const spent = money.transactions.filter((t) => t.date === day && t.kind === 'expense').reduce((s, t) => s + t.amount, 0);
    const shiftPay = shifts.filter((s) => s.date === day).reduce((s, x) => s + x.pay.total, 0);
    const payday = shifts.filter((s) => s.pay_date === day).reduce((s, x) => s + x.pay.total, 0);
    let cardPay = 0;
    for (const t of money.transactions) {
      if (t.kind !== 'expense' || t.method !== 'credit') continue;
      const card = money.cards.find((c) => c.name === t.card) ?? money.cards[0];
      if (card && cardPaymentDate(t.date, card) === day) cardPay += t.amount;
    }
    return [
      spent > 0 && { label: 'この日に使った', value: yen(spent) },
      shiftPay > 0 && { label: 'バイト代(見込み)', value: `+${yen(shiftPay)}` },
      cardPay > 0 && { label: '💳 カード引き落とし', value: `-${yen(cardPay)}` },
      payday > 0 && { label: '💰 給料日(見込み)', value: `+${yen(payday)}` },
    ].filter((x): x is { label: string; value: string } => Boolean(x));
  }, [selectedDate, money.transactions, money.cards, shifts]);

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
        <div className="calendar-page-title-row">
          <h1>予定時刻ミス検知カレンダー</h1>
          <div className="calendar-page-tools">
            <button type="button" onClick={() => void handleSync()} disabled={syncing}>
              {syncing ? '同期中…' : '↻ Google同期'}
            </button>
            <button type="button" onClick={() => setShowImport(true)}>
              インポート
            </button>
            <button type="button" onClick={() => setShowSettings(true)} aria-label="設定">
              ⚙ 設定
            </button>
          </div>
        </div>
        {cloud.state === 'off' ? (
          <p className="calendar-page-storage-note">この端末のブラウザ内にのみ保存されます</p>
        ) : (
          <button type="button" className={`calendar-page-cloud is-${cloud.state}`} onClick={() => void syncNow()} title="今すぐ同期">
            {cloud.state === 'syncing'
              ? '同期中…'
              : cloud.state === 'error'
                ? `⚠ ${cloud.error ?? '同期できませんでした'}`
                : `ネット保存中${cloud.lastSyncedAt ? `(${format(parseISO(cloud.lastSyncedAt), 'H:mm')} 同期)` : ''}`}
          </button>
        )}
      </header>

      <nav className="calendar-page-tabs">
        <button type="button" className={tab === 'calendar' ? 'is-active' : ''} onClick={() => setTab('calendar')}>
          カレンダー
        </button>
        <button type="button" className={tab === 'todo' ? 'is-active' : ''} onClick={() => setTab('todo')}>
          Todo
        </button>
        <button type="button" className={tab === 'money' ? 'is-active' : ''} onClick={() => setTab('money')}>
          家計簿
        </button>
        <button type="button" className={tab === 'noEvidence' ? 'is-active' : ''} onClick={() => setTab('noEvidence')}>
          情報不足 {noEvidenceEvents.length > 0 && `(${noEvidenceEvents.length})`}
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
            {dayMoney.length > 0 && (
              <ul className="calendar-page-money">
                {dayMoney.map((m) => (
                  <li key={m.label}>
                    <span>{m.label}</span>
                    <b>{m.value}</b>
                  </li>
                ))}
              </ul>
            )}
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
          events={events}
          tasks={tasks}
          settings={settings}
          onCreateTask={createTask}
          onCreateTasks={createTasks}
          onUpdateTask={updateTask}
          onDeleteTask={deleteTask}
          onReplacePlanEvents={replacePlanEvents}
          onImportEvents={importEvents}
          onOpenSettings={() => setShowSettings(true)}
        />
      ) : tab === 'money' ? (
        <MoneyPage events={events} money={money} />
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

      {/* リンクから開いたときは、登録済みの予定・タスクを読み終えてから出す(重複チェック・削除の照合のため) */}
      {showImport && (!linkIcsText || eventsReady) && (
        <ImportDialog
          categories={categories}
          initialText={linkIcsText ?? undefined}
          existingEvents={events}
          existingTasks={tasks}
          onImport={importEvents}
          onImportTasks={createTasks}
          onDeleteEvents={deleteEvents}
          onDeleteTasks={deleteTasks}
          onClose={() => {
            setShowImport(false);
            setLinkIcsText(null);
          }}
        />
      )}
    </div>
  );
}
