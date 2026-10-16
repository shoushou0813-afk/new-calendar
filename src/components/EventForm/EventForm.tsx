import { type FormEvent, useEffect, useState } from 'react';
import { addDays, format, parseISO } from 'date-fns';
import { validateEvent, type EventInput, type Warning, type WarningLogEntry } from '../../lib/validation';
import { appendWarningLog } from '../../lib/warningsLog';
import { toEventInput } from '../../lib/eventMapper';
import { WarningDialog } from '../WarningDialog/WarningDialog';
import type { EventDraft, EventRow } from '../../types/event';
import './EventForm.css';

interface EventFormProps {
  categories: string[];
  defaultDate: Date;
  initialEvent?: EventRow;
  history: EventRow[];
  onAddCategory: (name: string) => Promise<void>;
  onSave: (draft: EventDraft) => Promise<void>;
  onCancel: () => void;
}

interface FormState {
  title: string;
  category: string;
  date: string;
  doorsAt: string;
  startsAt: string;
  endsAt: string;
  /** 終わる日(空なら開始と同じ日。終了時刻が開始より前なら翌日として保存) */
  endDate: string;
  sourceUrl: string;
  note: string;
  hasAlarm: boolean;
  timeConfirmed: boolean;
  image: Blob | null;
}

function toFormState(event: EventRow | undefined, defaultDate: Date, defaultCategory: string): FormState {
  if (event) {
    return {
      title: event.title,
      category: event.category,
      date: event.date,
      doorsAt: event.doors_at ?? '',
      startsAt: event.starts_at,
      endsAt: event.ends_at ?? '',
      endDate: event.end_date && event.end_date > event.date ? event.end_date : '',
      sourceUrl: event.source_url ?? '',
      note: event.note ?? '',
      hasAlarm: event.has_alarm,
      timeConfirmed: event.time_confirmed,
      image: event.image,
    };
  }
  return {
    title: '',
    category: defaultCategory,
    date: format(defaultDate, 'yyyy-MM-dd'),
    doorsAt: '',
    startsAt: '10:00',
    endsAt: '',
    endDate: '',
    sourceUrl: '',
    note: '',
    hasAlarm: false,
    timeConfirmed: false,
    image: null,
  };
}

/**
 * 保存する「終わる日」。終了日を選んでいればその日、選んでいなくても終了時刻が開始時刻より前
 * (例: 17:00〜0:04)なら翌日に終わる予定とみなす。同じ日に終わるなら null。
 */
function resolvedEndDate(form: FormState): string | null {
  if (form.endDate && form.endDate > form.date) return form.endDate;
  if (form.endsAt && form.startsAt && form.endsAt < form.startsAt) return format(addDays(parseISO(form.date), 1), 'yyyy-MM-dd');
  return null;
}

function toEventInputFromForm(form: FormState): EventInput {
  return {
    title: form.title,
    category: form.category,
    date: form.date,
    doorsAt: form.doorsAt || null,
    startsAt: form.startsAt,
    endsAt: form.endsAt || null,
    sourceUrl: form.sourceUrl || null,
    sourceImagePath: form.image ? 'local-image' : null,
    note: form.note || null,
    hasAlarm: form.hasAlarm,
    timeConfirmed: form.timeConfirmed,
  };
}

function ImagePreview({ image }: { image: Blob }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(image);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [image]);

  if (!url) return null;
  return <img src={url} alt="添付された画像" className="event-form-image-preview" />;
}

export function EventForm({ categories, defaultDate, initialEvent, history, onAddCategory, onSave, onCancel }: EventFormProps) {
  const [form, setForm] = useState<FormState>(() => toFormState(initialEvent, defaultDate, categories.includes('その他') ? 'その他' : (categories[0] ?? 'その他')));
  const [newCategoryName, setNewCategoryName] = useState('');
  const [addingCategory, setAddingCategory] = useState(false);
  const [pendingWarnings, setPendingWarnings] = useState<Warning[] | null>(null);
  const [sessionLog, setSessionLog] = useState<WarningLogEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // フォームを開いている間は、後ろのカレンダーがスクロールしないようにする
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const otherHistory: EventInput[] = history.filter((e) => e.id !== initialEvent?.id).map(toEventInput);

  const updateField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'doorsAt' || key === 'startsAt' || key === 'endsAt' || key === 'endDate') {
        next.timeConfirmed = false;
      }
      return next;
    });
  };

  const persist = async (finalForm: FormState, extraLog: WarningLogEntry[]) => {
    setSaving(true);
    setFormError(null);
    try {
      const draft: EventDraft = {
        title: finalForm.title,
        category: finalForm.category,
        date: finalForm.date,
        doors_at: finalForm.doorsAt || null,
        starts_at: finalForm.startsAt,
        ends_at: finalForm.endsAt || null,
        end_date: resolvedEndDate(finalForm),
        source_url: finalForm.sourceUrl || null,
        image: finalForm.image,
        note: finalForm.note || null,
        has_alarm: finalForm.hasAlarm,
        time_confirmed: finalForm.timeConfirmed,
        warnings: [...(initialEvent?.warnings ?? []), ...extraLog],
      };
      await onSave(draft);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) {
      setFormError('予定名を入力してください');
      return;
    }
    const eventInput = toEventInputFromForm(form);
    const warnings = validateEvent(eventInput, otherHistory);
    if (warnings.length > 0) {
      setPendingWarnings(warnings);
      return;
    }
    await persist(form, []);
  };

  const handleApplyFix = (warning: Warning) => {
    if (!warning.suggestedValue || warning.suggestedField !== 'startsAt') return;
    const nextForm = { ...form, startsAt: warning.suggestedValue };
    const nextLog = appendWarningLog([], [warning], 'accepted');
    setSessionLog((prev) => [...prev, ...nextLog]);
    setForm(nextForm);

    const remaining = validateEvent(toEventInputFromForm(nextForm), otherHistory);
    if (remaining.length === 0) {
      setPendingWarnings(null);
      void persist({ ...nextForm, timeConfirmed: true }, [...sessionLog, ...nextLog]);
    } else {
      setPendingWarnings(remaining);
    }
  };

  const handleConfirmAsIs = () => {
    if (!pendingWarnings) return;
    const nextLog = appendWarningLog([], pendingWarnings, 'dismissed');
    const confirmedForm = { ...form, timeConfirmed: true };
    setPendingWarnings(null);
    setForm(confirmedForm);
    void persist(confirmedForm, [...sessionLog, ...nextLog]);
  };

  const handleAddCategory = async () => {
    if (!newCategoryName.trim()) return;
    setAddingCategory(true);
    await onAddCategory(newCategoryName.trim());
    updateField('category', newCategoryName.trim());
    setNewCategoryName('');
    setAddingCategory(false);
  };

  return (
    <div className="event-form-backdrop">
      <form className="event-form" onSubmit={handleSubmit}>
        <div className="event-form-header">
          <h3>{initialEvent ? '予定を編集' : '予定を追加'}</h3>
          <button type="button" className="event-form-close" onClick={onCancel} aria-label="閉じる">
            ×
          </button>
        </div>

        <label>
          予定名
          <input value={form.title} onChange={(e) => updateField('title', e.target.value)} required />
        </label>

        <label>
          カテゴリ
          <select value={form.category} onChange={(e) => updateField('category', e.target.value)}>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <div className="event-form-add-category">
          <input
            placeholder="新しいカテゴリを追加"
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
          />
          <button type="button" onClick={handleAddCategory} disabled={addingCategory || !newCategoryName.trim()}>
            追加
          </button>
        </div>

        <label>
          日付
          <input type="date" value={form.date} onChange={(e) => updateField('date', e.target.value)} required />
        </label>

        <div className="event-form-time-row">
          <label>
            <span>集合・受付</span>
            <input type="time" value={form.doorsAt} onChange={(e) => updateField('doorsAt', e.target.value)} />
          </label>
          <label>
            <span>
              開始 <span className="required">*</span>
            </span>
            <input type="time" value={form.startsAt} onChange={(e) => updateField('startsAt', e.target.value)} required />
          </label>
          <label>
            <span>終了</span>
            <input type="time" value={form.endsAt} onChange={(e) => updateField('endsAt', e.target.value)} />
          </label>
        </div>

        <label>
          終了日(日をまたぐ予定のとき)
          <input
            type="date"
            value={form.endDate}
            min={form.date}
            onChange={(e) => updateField('endDate', e.target.value)}
          />
        </label>
        {(() => {
          const end = resolvedEndDate(form);
          return end ? (
            <p className="event-form-hint">
              {format(parseISO(form.date), 'M/d')} {form.startsAt} 〜 {format(parseISO(end), 'M/d')} {form.endsAt || '(終了時刻なし)'} の予定として保存します
            </p>
          ) : null;
        })()}

        <label>
          関連URL(案内・申込ページ・チケットなど)
          <input type="url" value={form.sourceUrl} onChange={(e) => updateField('sourceUrl', e.target.value)} placeholder="https://..." />
        </label>

        <label>
          画像(案内・確認メール・チケットのスクショなど)
          <input
            key={form.image ? 'has-image' : 'no-image'}
            type="file"
            accept="image/*"
            onChange={(e) => updateField('image', e.target.files?.[0] ?? null)}
          />
        </label>
        {form.image && (
          <div className="event-form-image">
            <ImagePreview image={form.image} />
            <button type="button" className="event-form-image-remove" onClick={() => updateField('image', null)}>
              画像を外す
            </button>
          </div>
        )}

        <label>
          メモ
          <textarea value={form.note} onChange={(e) => updateField('note', e.target.value)} rows={2} />
        </label>

        <label className="event-form-checkbox">
          <input type="checkbox" checked={form.hasAlarm} onChange={(e) => updateField('hasAlarm', e.target.checked)} />
          通知アラームを設定する
        </label>

        {formError && <p className="event-form-error">{formError}</p>}

        <div className="event-form-actions">
          <button type="submit" disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </button>
          <button type="button" className="event-form-cancel" onClick={onCancel} disabled={saving}>
            キャンセル
          </button>
        </div>
      </form>

      {pendingWarnings && (
        <WarningDialog
          warnings={pendingWarnings}
          onApplyFix={handleApplyFix}
          onConfirmAsIs={handleConfirmAsIs}
          onCancel={() => setPendingWarnings(null)}
        />
      )}
    </div>
  );
}
