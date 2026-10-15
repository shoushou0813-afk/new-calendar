import { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { deadlineCandidates } from '../../lib/deadlineTasks';
import type { EventRow } from '../../types/event';
import type { Task, TaskDraft } from '../../types/task';
import './Todo.css';

interface DeadlineImportDialogProps {
  events: EventRow[];
  tasks: Task[];
  today: string;
  onImport: (drafts: TaskDraft[]) => Promise<void>;
  onClose: () => void;
}

const MINUTE_OPTIONS = [30, 60, 90, 120, 180, 240, 300, 480];

function formatMinutes(m: number): string {
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}時間${m % 60 ? `${m % 60}分` : ''}` : `${m}分`;
}

export function DeadlineImportDialog({ events, tasks, today, onImport, onClose }: DeadlineImportDialogProps) {
  const candidates = useMemo(() => deadlineCandidates(events, tasks, today), [events, tasks, today]);
  const [checked, setChecked] = useState<Set<number>>(
    () => new Set(candidates.map((c, i) => (c.defaultChecked ? i : -1)).filter((i) => i >= 0)),
  );
  const [minutes, setMinutes] = useState<number[]>(() => candidates.map((c) => c.draft.estimated_minutes));
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<number | null>(null);

  const toggle = (i: number) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const total = [...checked].reduce((sum, i) => sum + minutes[i], 0);

  const handleImport = async () => {
    setSaving(true);
    try {
      const drafts = [...checked].sort((a, b) => a - b).map((i) => ({ ...candidates[i].draft, estimated_minutes: minutes[i] }));
      await onImport(drafts);
      setDone(drafts.length);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="todo-dialog-backdrop">
      <div className="todo-dialog">
        <h3>提出・練習をまとめてタスクにする</h3>
        {done !== null ? (
          <>
            <p className="todo-notice">{done}件のタスクを追加しました。「AIなしで自動割り当て」で今日やることを決められます。</p>
            <div className="todo-dialog-actions">
              <button type="button" onClick={onClose}>
                閉じる
              </button>
            </div>
          </>
        ) : candidates.length === 0 ? (
          <>
            <p className="todo-hint">今日以降の【締切】やレッスン・試験の予定が見つかりませんでした。先に予定を取り込んでください。</p>
            <div className="todo-dialog-actions">
              <button type="button" className="todo-secondary" onClick={onClose}>
                閉じる
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="todo-hint">
              カレンダーの【締切】の予定(提出)と、レッスン・試験・本番の予定(練習・勉強)から作ります。
              練習はレッスンの開始まで、勉強は前の日までに終わらせる計画になります。作業時間は目安なので、必要なら変えてください。
              予備締切と登録済みのものは最初はチェックを外しています。
            </p>
            <ul className="deadline-list">
              {candidates.map((c, i) => (
                <li key={c.event.id} className={c.alreadyAdded ? 'is-added' : ''}>
                  <label className="deadline-check">
                    <input type="checkbox" checked={checked.has(i)} onChange={() => toggle(i)} />
                    <span className="deadline-body">
                      <span className="deadline-title">
                        <span className={`deadline-kind is-${c.kind}`}>{c.kind === 'submit' ? '提出' : '練習'}</span>
                        {c.draft.title}
                        {c.alreadyAdded && <span className="deadline-tag">登録済み</span>}
                      </span>
                      <span className="deadline-meta">
                        締切 {format(parseISO(c.draft.deadline), 'M/d(EEE)', { locale: ja })}
                        {c.draft.deadline_time && ` ${c.draft.deadline_time}`}
                      </span>
                    </span>
                  </label>
                  <select
                    aria-label={`${c.draft.title}の作業時間`}
                    value={minutes[i]}
                    onChange={(e) => setMinutes((prev) => prev.map((m, j) => (j === i ? Number(e.target.value) : m)))}
                  >
                    {[...new Set([...MINUTE_OPTIONS, minutes[i]])]
                      .sort((a, b) => a - b)
                      .map((m) => (
                        <option key={m} value={m}>
                          {formatMinutes(m)}
                        </option>
                      ))}
                  </select>
                </li>
              ))}
            </ul>
            <div className="todo-dialog-actions">
              <button type="button" onClick={() => void handleImport()} disabled={checked.size === 0 || saving}>
                {saving ? '追加中...' : `${checked.size}件をタスクにする(計${formatMinutes(total)})`}
              </button>
              <button type="button" className="todo-secondary" onClick={onClose} disabled={saving}>
                キャンセル
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
