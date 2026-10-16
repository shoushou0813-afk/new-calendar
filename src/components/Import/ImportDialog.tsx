import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { parseIcs, type ParsedIcsEvent } from '../../lib/icsImport';
import { readPastedImportLink } from '../../lib/importLink';
import { parseImportPayload } from '../../lib/importPayload';
import type { EventDraft, EventRow } from '../../types/event';
import type { Task, TaskDraft } from '../../types/task';
import './ImportDialog.css';

interface ImportDialogProps {
  categories: string[];
  /** 取り込みリンクから開いたときの中身(.ics か、予定+タスクの JSON) */
  initialText?: string;
  /** 登録済みの予定(同じ日時・タイトルの予定は最初からチェックを外す) */
  existingEvents?: EventRow[];
  /** 登録済みのタスク(同じ名前・締切のタスクは最初からチェックを外す) */
  existingTasks?: Task[];
  onImport: (drafts: EventDraft[]) => Promise<void>;
  onImportTasks?: (drafts: TaskDraft[]) => Promise<void>;
  onDeleteEvents?: (ids: string[]) => Promise<void>;
  onDeleteTasks?: (ids: string[]) => Promise<void>;
  onClose: () => void;
}

function eventKey(e: { date: string; startsAt: string; title: string }): string {
  return `${e.date} ${e.startsAt} ${e.title}`;
}

function taskKey(t: { title: string; deadline: string }): string {
  return `${t.title}|${t.deadline}`;
}

function formatMinutes(m: number): string {
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}時間${m % 60 ? `${m % 60}分` : ''}` : `${m}分`;
}

interface Loaded {
  events: ParsedIcsEvent[];
  tasks: TaskDraft[];
  /** 削除の指定に一致した、登録済みの予定・タスク */
  removeEvents: EventRow[];
  removeTasks: Task[];
}

export function ImportDialog({
  categories,
  initialText,
  existingEvents = [],
  existingTasks = [],
  onImport,
  onImportTasks,
  onDeleteEvents,
  onDeleteTasks,
  onClose,
}: ImportDialogProps) {
  const existingEventKeys = new Set(existingEvents.map((e) => eventKey({ date: e.date, startsAt: e.starts_at, title: e.title })));
  const existingTaskKeys = new Set(existingTasks.map(taskKey));

  const parse = (text: string): Loaded => {
    const payload = parseImportPayload(text);
    const removeEventKeys = new Set(payload.removeEvents.map((r) => `${r.date} ${r.starts_at} ${r.title}`));
    const removeTaskKeys = new Set(payload.removeTasks.map(taskKey));
    return {
      events: payload.ics ? parseIcs(payload.ics) : [],
      tasks: payload.tasks,
      removeEvents: onDeleteEvents ? existingEvents.filter((e) => removeEventKeys.has(`${e.date} ${e.starts_at} ${e.title}`)) : [],
      removeTasks: onDeleteTasks ? existingTasks.filter((t) => removeTaskKeys.has(taskKey(t))) : [],
    };
  };
  const isEmpty = (l: Loaded) => l.events.length + l.tasks.length + l.removeEvents.length + l.removeTasks.length === 0;
  const newEventIndexes = (events: ParsedIcsEvent[]) =>
    new Set(events.map((e, i) => (existingEventKeys.has(eventKey(e)) ? -1 : i)).filter((i) => i >= 0));
  const newTaskIndexes = (tasks: TaskDraft[]) =>
    new Set(tasks.map((t, i) => (existingTaskKeys.has(taskKey(t)) ? -1 : i)).filter((i) => i >= 0));

  const [initial] = useState<{ loaded: Loaded | null; error: string | null }>(() => {
    if (!initialText) return { loaded: null, error: null };
    try {
      const loaded = parse(initialText);
      if (isEmpty(loaded)) return { loaded: null, error: '取り込みリンクの内容は、すべて取り込み済み・削除済みでした。' };
      return { loaded, error: null };
    } catch (err) {
      return { loaded: null, error: err instanceof Error ? err.message : '取り込みリンクを読めませんでした。' };
    }
  });
  const [loaded, setLoaded] = useState<Loaded | null>(initial.loaded);
  const [selected, setSelected] = useState<Set<number>>(() => newEventIndexes(initial.loaded?.events ?? []));
  const [selectedTasks, setSelectedTasks] = useState<Set<number>>(() => newTaskIndexes(initial.loaded?.tasks ?? []));
  const [category, setCategory] = useState(categories.includes('その他') ? 'その他' : (categories[0] ?? 'その他'));
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(initial.error);
  const [done, setDone] = useState<{ events: number; tasks: number; removed: number } | null>(null);
  const [selectedRemovals, setSelectedRemovals] = useState<Set<string>>(
    () => new Set([...(initial.loaded?.removeEvents ?? []).map((e) => e.id), ...(initial.loaded?.removeTasks ?? []).map((t) => t.id)]),
  );
  const [pasted, setPasted] = useState('');

  const load = (text: string, emptyMessage: string) => {
    const next = parse(text);
    if (isEmpty(next)) {
      setError(emptyMessage);
      setLoaded(null);
      return;
    }
    setLoaded(next);
    setSelected(newEventIndexes(next.events));
    setSelectedTasks(newTaskIndexes(next.tasks));
    setSelectedRemovals(new Set([...next.removeEvents.map((e) => e.id), ...next.removeTasks.map((t) => t.id)]));
  };

  const handlePaste = async () => {
    setError(null);
    setDone(null);
    try {
      const text = (await readPastedImportLink(pasted)) ?? (pasted.includes('BEGIN:VCALENDAR') ? pasted : null);
      if (text === null) {
        setError('取り込みリンクが見つかりませんでした。リンク全体を貼り付けてください。');
        return;
      }
      load(text, '予定が見つかりませんでした。');
    } catch (err) {
      setError(err instanceof Error ? err.message : '読み込みに失敗しました。');
    }
  };

  const handleFile = async (file: File) => {
    setError(null);
    setDone(null);
    try {
      load(await file.text(), '予定が見つかりませんでした。.ics ファイルを確認してください。');
    } catch {
      setError('ファイルの読み込みに失敗しました。');
    }
  };

  const toggleIn = (setter: typeof setSelected) => (index: number) =>
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  const toggle = toggleIn(setSelected);
  const toggleTask = toggleIn(setSelectedTasks);

  const toggleRemoval = (id: string) =>
    setSelectedRemovals((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const totalSelected = selected.size + (onImportTasks ? selectedTasks.size : 0) + selectedRemovals.size;

  const handleImport = async () => {
    if (!loaded) return;
    setImporting(true);
    setError(null);
    try {
      const drafts: EventDraft[] = loaded.events
        .filter((_, i) => selected.has(i))
        .map((e) => ({
          title: e.title,
          category,
          date: e.date,
          doors_at: null,
          starts_at: e.startsAt,
          ends_at: e.endsAt,
          end_date: e.endDate,
          source_url: e.sourceUrl,
          image: null,
          note: e.note,
          has_alarm: false,
          time_confirmed: false,
        }));
      const taskDrafts = onImportTasks ? loaded.tasks.filter((_, i) => selectedTasks.has(i)) : [];
      const removeEventIds = loaded.removeEvents.filter((e) => selectedRemovals.has(e.id)).map((e) => e.id);
      const removeTaskIds = loaded.removeTasks.filter((t) => selectedRemovals.has(t.id)).map((t) => t.id);
      if (drafts.length > 0) await onImport(drafts);
      if (taskDrafts.length > 0) await onImportTasks!(taskDrafts);
      if (removeEventIds.length > 0) await onDeleteEvents!(removeEventIds);
      if (removeTaskIds.length > 0) await onDeleteTasks!(removeTaskIds);
      setDone({ events: drafts.length, tasks: taskDrafts.length, removed: removeEventIds.length + removeTaskIds.length });
    } catch (err) {
      setError(err instanceof Error ? err.message : '取り込みに失敗しました');
    } finally {
      setImporting(false);
    }
  };

  const doneText = done
    ? [
        done.events + done.tasks > 0 &&
          [done.events > 0 && `${done.events}件の予定`, done.tasks > 0 && `${done.tasks}件のタスク`].filter(Boolean).join('と') + 'を取り込みました。',
        done.removed > 0 && `${done.removed}件を削除しました。`,
      ]
        .filter(Boolean)
        .join('')
    : '';

  return (
    <div className="import-dialog-backdrop">
      <div className="import-dialog">
        <h3>カレンダーをインポート</h3>
        <p className="import-dialog-hint">
          Googleカレンダー等からエクスポートした .ics ファイルや、取り込みリンクから、まとめて予定を取り込みます。
        </p>

        {done !== null ? (
          <>
            <p className="import-dialog-done">{doneText}</p>
            <button type="button" onClick={onClose}>
              閉じる
            </button>
          </>
        ) : (
          <>
            {!initialText && (
              <label className="import-dialog-file">
                .ics ファイルを選択
                <input
                  type="file"
                  accept=".ics,text/calendar"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleFile(file);
                  }}
                />
              </label>
            )}

            {!initialText && !loaded && (
              <div className="import-dialog-paste">
                <label htmlFor="import-paste">または、取り込みリンクを貼り付け</label>
                <textarea
                  id="import-paste"
                  rows={3}
                  value={pasted}
                  onChange={(e) => setPasted(e.target.value)}
                  placeholder="https://…/#import=… をここに貼り付け"
                />
                <button type="button" className="import-dialog-cancel" onClick={() => void handlePaste()} disabled={!pasted.trim()}>
                  貼り付けたリンクを読み込む
                </button>
              </div>
            )}

            {error && <p className="import-dialog-error">{error}</p>}

            {loaded && loaded.events.length > 0 && (
              <>
                <label className="import-dialog-category">
                  取り込むカテゴリ(一括)
                  <select value={category} onChange={(e) => setCategory(e.target.value)}>
                    {categories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>

                <p className="import-dialog-count">
                  {loaded.events.length}件見つかりました({selected.size}件を選択中)
                </p>
                <ul className="import-dialog-list">
                  {loaded.events.map((event, i) => (
                    <li key={i}>
                      <label>
                        <input type="checkbox" checked={selected.has(i)} onChange={() => toggle(i)} />
                        <span className="import-dialog-item-date">
                          {event.date} {event.startsAt}
                          {event.endsAt && `〜${event.endsAt}`}
                        </span>
                        <span className="import-dialog-item-title">
                          {event.title}
                          {existingEventKeys.has(eventKey(event)) && <span className="import-dialog-item-dup">登録済み</span>}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {loaded && loaded.tasks.length > 0 && onImportTasks && (
              <>
                <p className="import-dialog-count">タスク {loaded.tasks.length}件(「今日のTodo」に入ります)</p>
                <ul className="import-dialog-list">
                  {loaded.tasks.map((task, i) => (
                    <li key={i}>
                      <label>
                        <input type="checkbox" checked={selectedTasks.has(i)} onChange={() => toggleTask(i)} />
                        <span className="import-dialog-item-date">
                          締切 {format(parseISO(task.deadline), 'M/d(EEE)', { locale: ja })}
                          {task.deadline_time && ` ${task.deadline_time}`}
                        </span>
                        <span className="import-dialog-item-title">
                          {task.title}({formatMinutes(task.estimated_minutes)})
                          {existingTaskKeys.has(taskKey(task)) && <span className="import-dialog-item-dup">登録済み</span>}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {loaded && loaded.removeEvents.length + loaded.removeTasks.length > 0 && (
              <>
                <p className="import-dialog-count is-remove">削除するもの {loaded.removeEvents.length + loaded.removeTasks.length}件</p>
                <ul className="import-dialog-list">
                  {loaded.removeEvents.map((e) => (
                    <li key={e.id}>
                      <label>
                        <input type="checkbox" checked={selectedRemovals.has(e.id)} onChange={() => toggleRemoval(e.id)} />
                        <span className="import-dialog-item-date">
                          予定 {e.date} {e.starts_at}
                        </span>
                        <span className="import-dialog-item-title is-remove">{e.title}</span>
                      </label>
                    </li>
                  ))}
                  {loaded.removeTasks.map((t) => (
                    <li key={t.id}>
                      <label>
                        <input type="checkbox" checked={selectedRemovals.has(t.id)} onChange={() => toggleRemoval(t.id)} />
                        <span className="import-dialog-item-date">タスク 締切 {format(parseISO(t.deadline), 'M/d', { locale: ja })}</span>
                        <span className="import-dialog-item-title is-remove">{t.title}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </>
            )}

            <div className="import-dialog-actions">
              <button type="button" onClick={handleImport} disabled={!loaded || totalSelected === 0 || importing}>
                {importing
                  ? '処理中...'
                  : selected.size + selectedTasks.size === 0
                    ? `${selectedRemovals.size}件を削除する`
                    : `${totalSelected}件を反映する`}
              </button>
              <button type="button" className="import-dialog-cancel" onClick={onClose} disabled={importing}>
                キャンセル
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
