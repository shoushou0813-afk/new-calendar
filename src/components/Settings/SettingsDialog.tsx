import { useState } from 'react';
import type { AppSettings } from '../../lib/settings';
import '../Todo/Todo.css';

interface SettingsDialogProps {
  settings: AppSettings;
  categories: string[];
  envClientId: string;
  onSave: (settings: AppSettings) => void;
  onClose: () => void;
}

export function SettingsDialog({ settings, categories, envClientId, onSave, onClose }: SettingsDialogProps) {
  const [draft, setDraft] = useState<AppSettings>(settings);
  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => setDraft((d) => ({ ...d, [key]: value }));

  return (
    <div className="todo-dialog-backdrop">
      <form
        className="todo-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(draft);
        }}
      >
        <h3>設定</h3>

        <fieldset>
          <legend>Googleカレンダー同期</legend>
          <label>
            OAuth クライアントID
            <input
              value={draft.googleClientId}
              onChange={(e) => set('googleClientId', e.target.value)}
              placeholder={envClientId ? `未入力なら環境変数の値を使用(${envClientId.slice(0, 12)}…)` : 'xxxx.apps.googleusercontent.com'}
            />
          </label>
          <label>
            カレンダーID
            <input value={draft.googleCalendarId} onChange={(e) => set('googleCalendarId', e.target.value)} placeholder="primary" />
          </label>
          <label>
            Googleから取り込んだ予定のカテゴリ
            <select value={draft.googleImportCategory} onChange={(e) => set('googleImportCategory', e.target.value)}>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </fieldset>

        <fieldset>
          <legend>AIプランナー</legend>
          <label>
            Claude APIキー
            <input
              type="password"
              value={draft.anthropicApiKey}
              onChange={(e) => set('anthropicApiKey', e.target.value)}
              placeholder="sk-ant-..."
              autoComplete="off"
            />
          </label>
          <p className="todo-hint">キーはこのブラウザ内にだけ保存され、Anthropic のAPIに直接送られます。共有PCでは入力しないでください。</p>
          <div className="todo-dialog-row">
            <label>
              作業開始
              <input type="time" value={draft.workStart} onChange={(e) => set('workStart', e.target.value)} />
            </label>
            <label>
              作業終了
              <input type="time" value={draft.workEnd} onChange={(e) => set('workEnd', e.target.value)} />
            </label>
          </div>
          <div className="todo-dialog-row">
            <label>
              1コマの長さ(分)
              <input type="number" min={15} step={5} value={draft.maxBlockMinutes} onChange={(e) => set('maxBlockMinutes', Math.max(15, Number(e.target.value)))} />
            </label>
            <label>
              休憩(分)
              <input type="number" min={0} step={5} value={draft.breakMinutes} onChange={(e) => set('breakMinutes', Math.max(0, Number(e.target.value)))} />
            </label>
          </div>
        </fieldset>

        <div className="todo-dialog-actions">
          <button type="submit">保存</button>
          <button type="button" className="todo-secondary" onClick={onClose}>
            キャンセル
          </button>
        </div>
      </form>
    </div>
  );
}
