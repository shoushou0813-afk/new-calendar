import { useMemo, useState } from 'react';
import { addMonths, format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { monthSummary, parseBillEvent, shiftForecasts, TX_METHOD_LABEL, yen, type Transaction, type TxMethod } from '../../../api/_lib/money';
import { useMoney } from '../../hooks/useMoney';
import type { EventRow } from '../../types/event';
import { MoneySettingsDialog } from './MoneySettingsDialog';
import { TransactionForm, todayString } from './TransactionForm';
import '../Todo/Todo.css';
import './Money.css';

interface Props {
  events: EventRow[];
  money: ReturnType<typeof useMoney>;
}

function dayLabel(date: string): string {
  return format(parseISO(date), 'M/d(EEE)', { locale: ja });
}

function hours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}時間${m}分` : `${h}時間`;
}

export function MoneyPage({ events, money }: Props) {
  const { transactions, jobs, cards, saveTransaction, deleteTransaction, saveProfile, deleteProfile } = money;
  const [month, setMonth] = useState(() => todayString().slice(0, 7));
  const [editing, setEditing] = useState<Transaction | 'new' | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const shifts = useMemo(() => shiftForecasts(events, jobs), [events, jobs]);
  const summary = useMemo(() => monthSummary(month, transactions, shifts, cards), [month, transactions, shifts, cards]);
  const monthTxs = transactions.filter((t) => t.date.startsWith(month));
  const monthShifts = shifts.filter((s) => s.date.startsWith(month));
  const paydays = useMemo(() => {
    const map = new Map<string, { date: string; job: string; amount: number }>();
    for (const s of shifts) {
      if (!s.pay_date.startsWith(month)) continue;
      const key = `${s.job}|${s.pay_date}`;
      const cur = map.get(key) ?? { date: s.pay_date, job: s.job, amount: 0 };
      cur.amount += s.pay.total;
      map.set(key, cur);
    }
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [shifts, month]);

  // Googleカレンダーの【引落】(メールで届いた確定額)。同じカードの見込みより優先する
  const bills = events
    .filter((e) => e.date.startsWith(month))
    .map((e) => ({ date: e.date, bill: parseBillEvent(e.title) }))
    .filter((b): b is { date: string; bill: { card: string; amount: number } } => b.bill !== null);
  const sameCard = (a: string, b: string) => a.includes(b) || b.includes(a);
  const cardPayments = [
    ...summary.card_payments
      .filter((p) => !bills.some((b) => sameCard(b.bill.card, p.card)))
      .map((p) => ({ ...p, confirmed: false })),
    ...bills.map((b) => ({ card: b.bill.card, date: b.date, amount: b.bill.amount, confirmed: true })),
  ];
  const cardTotal = cardPayments.reduce((s, p) => s + p.amount, 0);
  const categories = Object.entries(summary.expense_by_category).sort((a, b) => b[1] - a[1]);
  const maxCategory = categories[0]?.[1] ?? 0;
  const byDate = new Map<string, Transaction[]>();
  for (const t of monthTxs) byDate.set(t.date, [...(byDate.get(t.date) ?? []), t]);

  const shift = (n: number) => setMonth(format(addMonths(parseISO(`${month}-01`), n), 'yyyy-MM'));

  return (
    <div className="todo-page money-page">
      <section className="todo-panel">
        <div className="todo-panel-header">
          <button type="button" className="todo-secondary" onClick={() => shift(-1)} aria-label="前の月">
            ‹
          </button>
          <h2>{format(parseISO(`${month}-01`), 'yyyy年M月')}の家計簿</h2>
          <button type="button" className="todo-secondary" onClick={() => shift(1)} aria-label="次の月">
            ›
          </button>
        </div>
        <div className="money-cards">
          <div className="money-stat">
            <span>使った</span>
            <strong>{yen(summary.expense_total)}</strong>
          </div>
          <div className="money-stat is-plus">
            <span>バイト見込み</span>
            <strong>{yen(summary.shift_total)}</strong>
            <small>
              {summary.shift_count}回・{hours(summary.shift_minutes)}
            </small>
          </div>
          <div className="money-stat is-minus">
            <span>カード引き落とし</span>
            <strong>{yen(cardTotal)}</strong>
          </div>
          <div className="money-stat is-plus">
            <span>給料振込</span>
            <strong>{yen(summary.pay_in_month)}</strong>
          </div>
        </div>
        <ul className="money-methods">
          {(Object.keys(TX_METHOD_LABEL) as TxMethod[]).map((m) => (
            <li key={m}>
              {TX_METHOD_LABEL[m]} <b>{yen(summary.expense_by_method[m])}</b>
            </li>
          ))}
          {summary.income_total > 0 && (
            <li>
              収入の記録 <b>{yen(summary.income_total)}</b>
            </li>
          )}
        </ul>
        <div className="todo-plan-actions">
          <button type="button" onClick={() => setEditing('new')}>
            + 記録する
          </button>
          <button type="button" className="todo-secondary" onClick={() => setShowSettings(true)}>
            バイト・カード設定
          </button>
        </div>
      </section>

      {(cardPayments.length > 0 || paydays.length > 0) && (
        <section className="todo-panel">
          <h2>この月のお金の予定</h2>
          <ul className="money-list">
            {[
              ...cardPayments.map((p) => ({ date: p.date, label: `💳 ${p.card} 引き落とし${p.confirmed ? '(確定)' : '(見込み)'}`, amount: -p.amount })),
              ...paydays.map((p) => ({ date: p.date, label: `💰 ${p.job} 給料日(見込み)`, amount: p.amount })),
            ]
              .sort((a, b) => a.date.localeCompare(b.date))
              .map((x) => (
                <li key={x.date + x.label}>
                  <span className="money-date">{dayLabel(x.date)}</span>
                  <span className="money-title">{x.label}</span>
                  <span className={x.amount < 0 ? 'money-amount is-minus' : 'money-amount is-plus'}>
                    {x.amount < 0 ? '-' : '+'}
                    {yen(Math.abs(x.amount))}
                  </span>
                </li>
              ))}
          </ul>
        </section>
      )}

      {categories.length > 0 && (
        <section className="todo-panel">
          <h2>何に使ったか</h2>
          <ul className="money-bars">
            {categories.map(([name, value]) => (
              <li key={name}>
                <span>{name}</span>
                <span className="money-bar">
                  <span style={{ width: `${(value / maxCategory) * 100}%` }} />
                </span>
                <b>{yen(value)}</b>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="todo-panel">
        <h2>シフト(バイト代の見込み)</h2>
        {jobs.length === 0 ? (
          <p className="todo-hint">「バイト・カード設定」でバイト先と時給を入れると、カレンダーのシフトから給料を計算します。</p>
        ) : monthShifts.length === 0 ? (
          <p className="todo-hint">
            この月のシフトはありません。予定名に「{jobs.map((j) => j.keyword).join('」「')}」を入れて、開始・終了時刻つきで予定を入れてください。
          </p>
        ) : (
          <ul className="money-list">
            {monthShifts.map((s) => (
              <li key={s.event_id}>
                <span className="money-date">{dayLabel(s.date)}</span>
                <span className="money-title">
                  {s.title}
                  <small>
                    {hours(s.pay.worked_minutes)}
                    {s.pay.break_minutes ? `(休憩${s.pay.break_minutes}分)` : ''}
                    {s.pay.night_minutes ? `・深夜${hours(s.pay.night_minutes)}` : ''}・{dayLabel(s.pay_date)}振込
                  </small>
                </span>
                <span className="money-amount is-plus">{yen(s.pay.total)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="todo-panel">
        <h2>記録</h2>
        {monthTxs.length === 0 ? (
          <p className="todo-hint">この月の記録はまだありません。</p>
        ) : (
          [...byDate.entries()].map(([date, list]) => (
            <div key={date} className="money-day">
              <h3>
                {dayLabel(date)}
                <span>{yen(list.filter((t) => t.kind === 'expense').reduce((s, t) => s + t.amount, 0))}</span>
              </h3>
              <ul className="money-list">
                {list.map((t) => (
                  <li key={t.id} onClick={() => setEditing(t)} role="button">
                    <span className="money-badge">{t.method === 'credit' && t.card ? t.card : TX_METHOD_LABEL[t.method]}</span>
                    <span className="money-title">
                      {t.memo || t.category}
                      <small>
                        {t.category}
                        {t.source === 'gmail' ? '・メールから' : t.source === 'claude' ? '・チャットから' : ''}
                      </small>
                    </span>
                    <span className={t.kind === 'income' ? 'money-amount is-plus' : 'money-amount'}>
                      {t.kind === 'income' ? '+' : ''}
                      {yen(t.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      {editing && (
        <TransactionForm
          initial={editing === 'new' ? undefined : editing}
          defaultDate={month === todayString().slice(0, 7) ? todayString() : `${month}-01`}
          cards={cards}
          onSave={async (draft) => {
            await saveTransaction(draft, editing === 'new' ? undefined : editing.id);
            setEditing(null);
          }}
          onDelete={
            editing === 'new'
              ? undefined
              : async () => {
                  await deleteTransaction(editing.id);
                  setEditing(null);
                }
          }
          onCancel={() => setEditing(null)}
        />
      )}
      {showSettings && (
        <MoneySettingsDialog jobs={jobs} cards={cards} onSave={saveProfile} onDelete={deleteProfile} onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}
