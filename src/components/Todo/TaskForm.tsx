import { useState, type FormEvent } from 'react';
import { format } from 'date-fns';
import type { Task, TaskDraft, TaskPriority } from '../../types/task';
import './Todo.css';

interface TaskFormProps {
  initialTask?: Task;
  defaultDeadline: Date;
  onSave: (draft: TaskDraft) => Promise<void>;
  onCancel: () => void;
}

export function TaskForm({ initialTask, defaultDeadline, onSave, onCancel }: TaskFormProps) {
  const [title, setTitle] = useState(initialTask?.title ?? '');
  const [deadline, setDeadline] = useState(initialTask?.deadline ?? format(defaultDeadline, 'yyyy-MM-dd'));
  const [deadlineTime, setDeadlineTime] = useState(initialTask?.deadline_time ?? '');
  const [hours, setHours] = useState(String(Math.floor((initialTask?.estimated_minutes ?? 120) / 60)));
  const [minutes, setMinutes] = useState(String((initialTask?.estimated_minutes ?? 120) % 60));
  const [spent, setSpent] = useState(String(initialTask?.spent_minutes ?? 0));
  const [priority, setPriority] = useState<TaskPriority>(initialTask?.priority ?? 'normal');
  const [note, setNote] = useState(initialTask?.note ?? '');
  const [saving, setSaving] = useState(false);

  const estimated = Number(hours || 0) * 60 + Number(minutes || 0);
  const canSave = title.trim() !== '' && deadline !== '' && estimated > 0;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    try {
      await onSave({
        title: title.trim(),
        deadline,
        deadline_time: deadlineTime || null,
        estimated_minutes: estimated,
        spent_minutes: Math.min(Number(spent || 0), estimated),
        priority,
        note: note.trim() || null,
        done: initialTask?.done ?? false,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="todo-dialog-backdrop">
      <form className="todo-dialog" onSubmit={handleSubmit}>
        <h3>{initialTask ? 'タスクを編集' : '締切のあるタスクを追加'}</h3>
        <label>
          やること
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例: 統計学のレポート" autoFocus />
        </label>
        <div className="todo-dialog-row">
          <label>
            締切日
            <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </label>
          <label>
            締切時刻(任意)
            <input type="time" value={deadlineTime} onChange={(e) => setDeadlineTime(e.target.value)} />
          </label>
        </div>
        <div className="todo-dialog-row">
          <label>
            全体でかかりそうな時間
            <span className="todo-dialog-inline">
              <input type="number" min={0} value={hours} onChange={(e) => setHours(e.target.value)} />時間
              <input type="number" min={0} max={59} step={5} value={minutes} onChange={(e) => setMinutes(e.target.value)} />分
            </span>
          </label>
          <label>
            もう終わった分(分)
            <input type="number" min={0} step={5} value={spent} onChange={(e) => setSpent(e.target.value)} />
          </label>
        </div>
        <label>
          優先度
          <select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
            <option value="high">高い</option>
            <option value="normal">ふつう</option>
            <option value="low">低い</option>
          </select>
        </label>
        <label>
          メモ(AIへの補足にもなります)
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="例: 調べ物→下書き→清書の3段階。朝のほうが集中できる" />
        </label>
        <div className="todo-dialog-actions">
          <button type="submit" disabled={!canSave || saving}>
            {saving ? '保存中...' : '保存'}
          </button>
          <button type="button" className="todo-secondary" onClick={onCancel}>
            キャンセル
          </button>
        </div>
      </form>
    </div>
  );
}
