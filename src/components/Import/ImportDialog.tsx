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
}

export function ImportDialog({
  categories,
  initialText,
  existingEvents = [],
  existingTasks = [],
  onImport,
  onImportTasks,
  onClose,
}: ImportDialogProps) {
  const existingEventKeys = new Set(existingEvents.map((e) => eventKey({ date: e.date, startsAt: e.starts_at, title: e.title })));
  const existingTaskKeys = new Set(existingTasks.map(taskKey));

  const parse = (text: string): Loaded => {
    const payload = parseImportPayload(text);
    return { events: payload.ics ? parseIcs(payload.ics) : [], tasks: payload.tasks };
  };
  const newEventIndexes = (events: ParsedIcsEvent[]) =>
    new Set(events.map((e, i) => (existingEventKeys.has(eventKey(e)) ? -1 : i)).filter((i) => i >= 0));
  const newTaskIndexes = (tasks: TaskDraft[]) =>
    new Set(tasks.map((t, i) => (existingTaskKeys.has(taskKey(t)) ? -1 : i)).filter((i) => i >= 0));

  const [initial] = useState<{ loaded: Loaded | null; error: string | null }>(() => {
    if (!initialText) return { loaded: null, error: null };
    try {
      const loaded = parse(initialText);
      if (loaded.events.length === 0 && loaded.tasks.length === 0) return { loaded: null, error: '取り込みリンクに予定が入っていませんでした。' };
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
  const [done, setDone] = useState<{ events: number; tasks: number } | null>(null);
  const [pasted, setPasted] = useState('');

  const load = (text: string, emptyMessage: string) => {
    const next = parse(text);
    if (next.events.length === 0 && next.tasks.length === 0) {
      setError(emptyMessage);
      setLoaded(null);
      return;
    }
    setLoaded(next);
    setSelected(newEventIndexes(next.events));
    setSelectedTasks(newTaskIndexes(next.tasks));
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

  const totalSelected = selected.size + (onImportTasks ? selectedTasks.size : 0);

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
          source_url: e.sourceUrl,
          image: null,
          note: e.note,
          has_alarm: false,
          time_confirmed: false,
        }));
      const taskDrafts = onImportTasks ? loaded.tasks.filter((_, i) => selectedTasks.has(i)) : [];
      if (drafts.length > 0) await onImport(drafts);
      if (taskDrafts.length > 0) await onImportTasks!(taskDrafts);
      setDone({ events: drafts.length, tasks: taskDrafts.length });
    } catch (err) {
      setError(err instanceof Error ? err.message : '取り込みに失敗しました');
    } finally {
      setImporting(false);
    }
  };

  const doneText = done
    ? [done.events > 0 && `${done.events}件の予定`, done.tasks > 0 && `${done.tasks}件のタスク`].filter(Boolean).join('と') + 'を取り込みました。'
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

            <div className="import-dialog-actions">
              <button type="button" onClick={handleImport} disabled={!loaded || totalSelected === 0 || importing}>
                {importing ? '取り込み中...' : `${totalSelected}件を取り込む`}
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
