import { useState } from 'react';
import { parseIcs, type ParsedIcsEvent } from '../../lib/icsImport';
import type { EventDraft, EventRow } from '../../types/event';
import './ImportDialog.css';

interface ImportDialogProps {
  categories: string[];
  /** 取り込みリンクから開いたときの .ics テキスト */
  initialText?: string;
  /** 登録済みの予定(同じ日時・タイトルの予定は最初からチェックを外す) */
  existingEvents?: EventRow[];
  onImport: (drafts: EventDraft[]) => Promise<void>;
  onClose: () => void;
}

function eventKey(e: { date: string; startsAt: string; title: string }): string {
  return `${e.date} ${e.startsAt} ${e.title}`;
}

export function ImportDialog({ categories, initialText, existingEvents = [], onImport, onClose }: ImportDialogProps) {
  const existingKeys = new Set(existingEvents.map((e) => eventKey({ date: e.date, startsAt: e.starts_at, title: e.title })));
  const initialParsed = initialText ? parseIcs(initialText) : null;
  const [parsedEvents, setParsedEvents] = useState<ParsedIcsEvent[] | null>(
    initialParsed && initialParsed.length > 0 ? initialParsed : null,
  );
  const [selected, setSelected] = useState<Set<number>>(() => selectNew(initialParsed ?? []));
  const [category, setCategory] = useState(categories.includes('その他') ? 'その他' : (categories[0] ?? 'その他'));
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(
    initialParsed && initialParsed.length === 0 ? '取り込みリンクに予定が入っていませんでした。' : null,
  );
  const [done, setDone] = useState<number | null>(null);

  function selectNew(events: ParsedIcsEvent[]): Set<number> {
    return new Set(events.map((e, i) => (existingKeys.has(eventKey(e)) ? -1 : i)).filter((i) => i >= 0));
  }

  const handleFile = async (file: File) => {
    setError(null);
    setDone(null);
    try {
      const text = await file.text();
      const events = parseIcs(text);
      if (events.length === 0) {
        setError('予定が見つかりませんでした。.ics ファイルを確認してください。');
        setParsedEvents(null);
        return;
      }
      setParsedEvents(events);
      setSelected(selectNew(events));
    } catch {
      setError('ファイルの読み込みに失敗しました。');
    }
  };

  const toggle = (index: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const handleImport = async () => {
    if (!parsedEvents) return;
    setImporting(true);
    setError(null);
    try {
      const drafts: EventDraft[] = parsedEvents
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
      await onImport(drafts);
      setDone(drafts.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : '取り込みに失敗しました');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="import-dialog-backdrop">
      <div className="import-dialog">
        <h3>カレンダーをインポート</h3>
        <p className="import-dialog-hint">
          Googleカレンダー等からエクスポートした .ics ファイルを読み込んで、まとめて予定を取り込みます。
        </p>

        {done !== null ? (
          <>
            <p className="import-dialog-done">{done}件の予定を取り込みました。</p>
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

            {error && <p className="import-dialog-error">{error}</p>}

            {parsedEvents && (
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
                  {parsedEvents.length}件見つかりました({selected.size}件を選択中)
                </p>
                <ul className="import-dialog-list">
                  {parsedEvents.map((event, i) => (
                    <li key={i}>
                      <label>
                        <input type="checkbox" checked={selected.has(i)} onChange={() => toggle(i)} />
                        <span className="import-dialog-item-date">
                          {event.date} {event.startsAt}
                        </span>
                        <span className="import-dialog-item-title">
                          {event.title}
                          {existingKeys.has(eventKey(event)) && <span className="import-dialog-item-dup">登録済み</span>}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </>
            )}

            <div className="import-dialog-actions">
              <button type="button" onClick={handleImport} disabled={!parsedEvents || selected.size === 0 || importing}>
                {importing ? '取り込み中...' : `${selected.size}件を取り込む`}
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
