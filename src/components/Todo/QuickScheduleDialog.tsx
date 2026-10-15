import { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { parseQuickSchedule } from '../../lib/quickSchedule';
import type { EventDraft } from '../../types/event';
import './Todo.css';

interface QuickScheduleDialogProps {
  date: string;
  onImport: (drafts: EventDraft[]) => Promise<void>;
  onClose: () => void;
}

const EXAMPLE = '7:50 起きる\n8:20 朝飯\n9:00 陳列\n11:00 巡回\n16:00 商談\n19:30 めし\n23:00 ふろ\n24:00 ねる';

/** 「7:50 起きる」のように1行ずつ書いた1日の流れを、まとめて予定に入れる */
export function QuickScheduleDialog({ date: initialDate, onImport, onClose }: QuickScheduleDialogProps) {
  const [date, setDate] = useState(initialDate);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const { items, skipped } = useMemo(() => parseQuickSchedule(text, date), [text, date]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onImport(
        items.map((i) => ({
          title: i.title,
          category: 'その他',
          date: i.date,
          doors_at: null,
          starts_at: i.start,
          ends_at: i.end,
          source_url: null,
          image: null,
          note: null,
          has_alarm: false,
          // 自分で時刻を書いて入れたものなので、時刻ミスの警告は出さない
          time_confirmed: true,
        })),
      );
      setDone(items.length);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="todo-dialog-backdrop">
      <div className="todo-dialog">
        <h3>1日の流れをまとめて入力</h3>
        {done !== null ? (
          <>
            <p className="todo-notice">{done}件の予定を入れました。やることは、この予定の空き時間に自動で割り振られます。</p>
            <div className="todo-dialog-actions">
              <button type="button" onClick={onClose}>
                閉じる
              </button>
            </div>
          </>
        ) : (
          <>
            <label>
              日付
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label>
              1行に「時刻 やること」を書いてください(終わりは次の行の時刻になります)
              <textarea rows={9} value={text} onChange={(e) => setText(e.target.value)} placeholder={EXAMPLE} />
            </label>
            {items.length > 0 && (
              <ol className="timeline-rows quick-preview">
                {items.map((i, idx) => (
                  <li key={idx} className="timeline-row is-event">
                    <span className="timeline-time">{i.start}</span>
                    <span className="timeline-body">
                      <span className="timeline-title">
                        {i.title}
                        {i.date !== date && <span className="timeline-tag">{format(parseISO(i.date), 'M/d', { locale: ja })}</span>}
                      </span>
                      {i.end && <span className="timeline-end">〜{i.end}</span>}
                    </span>
                  </li>
                ))}
              </ol>
            )}
            {skipped.length > 0 && <p className="todo-error">時刻が読めなかった行: {skipped.join(' / ')}</p>}
            <div className="todo-dialog-actions">
              <button type="button" onClick={() => void handleSave()} disabled={items.length === 0 || saving}>
                {saving ? '入れています...' : `${items.length}件を予定に入れる`}
              </button>
              <button type="button" className="todo-secondary" onClick={onClose}>
                キャンセル
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
