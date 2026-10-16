import { useState, type FormEvent } from 'react';
import { format } from 'date-fns';
import { EXPENSE_CATEGORIES, TX_METHOD_LABEL, type CardProfile, type Transaction, type TxKind, type TxMethod } from '../../../api/_lib/money';
import type { TransactionDraft } from '../../hooks/useMoney';
import '../Todo/Todo.css';

interface Props {
  initial?: Transaction;
  defaultDate: string;
  cards: CardProfile[];
  onSave: (draft: TransactionDraft) => Promise<void>;
  onDelete?: () => Promise<void>;
  onCancel: () => void;
}

export function TransactionForm({ initial, defaultDate, cards, onSave, onDelete, onCancel }: Props) {
  const [date, setDate] = useState(initial?.date ?? defaultDate);
  const [amount, setAmount] = useState(initial ? String(initial.amount) : '');
  const [kind, setKind] = useState<TxKind>(initial?.kind ?? 'expense');
  const [method, setMethod] = useState<TxMethod>(initial?.method ?? 'cash');
  const [card, setCard] = useState(initial?.card ?? cards[0]?.name ?? '');
  const [category, setCategory] = useState(initial?.category ?? '食費');
  const [memo, setMemo] = useState(initial?.memo ?? '');
  const [saving, setSaving] = useState(false);

  const value = Math.round(Number(amount));
  const canSave = /^\d{4}-\d{2}-\d{2}$/.test(date) && value > 0;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    try {
      await onSave({
        date,
        amount: value,
        kind,
        method,
        card: method === 'credit' ? card.trim() || null : null,
        category: kind === 'income' ? '収入' : category,
        memo: memo.trim() || null,
        source: initial?.source ?? 'manual',
        source_id: initial?.source_id ?? null,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="todo-dialog-backdrop">
      <form className="todo-dialog" onSubmit={handleSubmit}>
        <h3>{initial ? '記録を編集' : 'お金の記録を追加'}</h3>
        <div className="money-kind">
          <button type="button" className={kind === 'expense' ? '' : 'todo-secondary'} onClick={() => setKind('expense')}>
            使った
          </button>
          <button type="button" className={kind === 'income' ? '' : 'todo-secondary'} onClick={() => setKind('income')}>
            入った
          </button>
        </div>
        <div className="todo-dialog-row">
          <label>
            日付
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label>
            金額(円)
            <input type="number" inputMode="numeric" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="例: 1200" autoFocus={!initial} />
          </label>
        </div>
        <div className="todo-dialog-row">
          <label>
            払い方
            <select value={method} onChange={(e) => setMethod(e.target.value as TxMethod)}>
              {(Object.keys(TX_METHOD_LABEL) as TxMethod[]).map((m) => (
                <option key={m} value={m}>
                  {TX_METHOD_LABEL[m]}
                </option>
              ))}
            </select>
          </label>
          {method === 'credit' && (
            <label>
              カード
              {cards.length > 0 ? (
                <select value={card} onChange={(e) => setCard(e.target.value)}>
                  {cards.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input value={card} onChange={(e) => setCard(e.target.value)} placeholder="カード名" />
              )}
            </label>
          )}
        </div>
        {kind === 'expense' && (
          <label>
            分類
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              {[...new Set([...EXPENSE_CATEGORIES, category])].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          メモ(お店など)
          <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="例: セブンイレブン" />
        </label>
        {method === 'credit' && cards.length === 0 && (
          <p className="todo-hint">「バイト・カード設定」でカードの締め日と引き落とし日を入れると、いつ引き落とされるかが出ます。</p>
        )}
        <div className="todo-dialog-actions">
          {onDelete && (
            <button
              type="button"
              className="todo-secondary"
              onClick={() => {
                if (window.confirm('この記録を削除しますか？')) void onDelete();
              }}
            >
              削除
            </button>
          )}
          <button type="button" className="todo-secondary" onClick={onCancel}>
            キャンセル
          </button>
          <button type="submit" disabled={!canSave || saving}>
            保存
          </button>
        </div>
      </form>
    </div>
  );
}

export function todayString(): string {
  return format(new Date(), 'yyyy-MM-dd');
}
