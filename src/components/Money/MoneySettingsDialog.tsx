import { useState } from 'react';
import { makeCard, makeJob, type CardProfile, type JobProfile, type Profile } from '../../../api/_lib/money';
import '../Todo/Todo.css';

interface Props {
  jobs: JobProfile[];
  cards: CardProfile[];
  onSave: (profile: Profile) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onClose: () => void;
}

function num(v: string): number {
  return Number(v) || 0;
}

function JobEditor({ job, onSave, onDelete }: { job?: JobProfile; onSave: (p: Profile) => Promise<void>; onDelete?: () => Promise<void> }) {
  const [name, setName] = useState(job?.name ?? '');
  const [keyword, setKeyword] = useState(job?.keyword ?? '');
  const [wage, setWage] = useState(job ? String(job.hourly_wage) : '');
  const [transport, setTransport] = useState(job ? String(job.transport) : '0');
  const [closing, setClosing] = useState(String(job?.closing_day ?? 31));
  const [payDay, setPayDay] = useState(String(job?.pay_day ?? 25));
  const canSave = name.trim() !== '' && num(wage) > 0;
  return (
    <fieldset>
      <legend>{job ? job.name : 'バイト先を追加'}</legend>
      <div className="todo-dialog-row">
        <label>
          名前
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例: セブン" />
        </label>
        <label>
          予定名に入っている言葉
          <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="空なら名前と同じ" />
        </label>
      </div>
      <div className="todo-dialog-row">
        <label>
          時給(円)
          <input type="number" inputMode="numeric" value={wage} onChange={(e) => setWage(e.target.value)} placeholder="例: 1200" />
        </label>
        <label>
          交通費 1回(円)
          <input type="number" inputMode="numeric" value={transport} onChange={(e) => setTransport(e.target.value)} />
        </label>
      </div>
      <div className="todo-dialog-row">
        <label>
          締め日(31=月末)
          <input type="number" min={1} max={31} value={closing} onChange={(e) => setClosing(e.target.value)} />
        </label>
        <label>
          給料日(翌月)
          <input type="number" min={1} max={31} value={payDay} onChange={(e) => setPayDay(e.target.value)} />
        </label>
      </div>
      <div className="todo-dialog-actions">
        {onDelete && (
          <button type="button" className="todo-secondary" onClick={() => window.confirm(`「${job?.name}」を消しますか？`) && void onDelete()}>
            削除
          </button>
        )}
        <button
          type="button"
          disabled={!canSave}
          onClick={() =>
            void onSave(
              makeJob({
                ...job,
                name,
                keyword: keyword.trim() || name,
                hourly_wage: num(wage),
                transport: num(transport),
                closing_day: num(closing),
                pay_day: num(payDay),
              }),
            ).then(() => {
              if (!job) {
                setName('');
                setKeyword('');
                setWage('');
              }
            })
          }
        >
          {job ? '更新' : '追加'}
        </button>
      </div>
    </fieldset>
  );
}

function CardEditor({ card, onSave, onDelete }: { card?: CardProfile; onSave: (p: Profile) => Promise<void>; onDelete?: () => Promise<void> }) {
  const [name, setName] = useState(card?.name ?? '');
  const [closing, setClosing] = useState(String(card?.closing_day ?? 31));
  const [payDay, setPayDay] = useState(String(card?.payment_day ?? 27));
  const [offset, setOffset] = useState(String(card?.payment_month_offset ?? 1));
  return (
    <fieldset>
      <legend>{card ? card.name : 'クレジットカードを追加'}</legend>
      <label>
        カード名
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例: 楽天カード" />
      </label>
      <div className="todo-dialog-row">
        <label>
          締め日(31=月末)
          <input type="number" min={1} max={31} value={closing} onChange={(e) => setClosing(e.target.value)} />
        </label>
        <label>
          引き落とし日
          <span className="todo-dialog-inline">
            <select value={offset} onChange={(e) => setOffset(e.target.value)}>
              <option value="1">翌月</option>
              <option value="2">翌々月</option>
            </select>
            <input type="number" min={1} max={31} value={payDay} onChange={(e) => setPayDay(e.target.value)} />日
          </span>
        </label>
      </div>
      <div className="todo-dialog-actions">
        {onDelete && (
          <button type="button" className="todo-secondary" onClick={() => window.confirm(`「${card?.name}」を消しますか？`) && void onDelete()}>
            削除
          </button>
        )}
        <button
          type="button"
          disabled={!name.trim()}
          onClick={() =>
            void onSave(makeCard({ ...card, name, closing_day: num(closing), payment_day: num(payDay), payment_month_offset: num(offset) })).then(() => {
              if (!card) setName('');
            })
          }
        >
          {card ? '更新' : '追加'}
        </button>
      </div>
    </fieldset>
  );
}

export function MoneySettingsDialog({ jobs, cards, onSave, onDelete, onClose }: Props) {
  return (
    <div className="todo-dialog-backdrop">
      <div className="todo-dialog">
        <h3>バイト・カード設定</h3>
        <p className="todo-hint">
          カレンダーの予定名にバイト先の言葉が入っていて、開始と終了の時刻があると、その予定をシフトとして給料を計算します。
          休憩は6時間を超えたら45分、8時間を超えたら1時間を引き、22時〜5時は25%増しで計算します。
        </p>
        {jobs.map((j) => (
          <JobEditor key={j.id + j.name} job={j} onSave={onSave} onDelete={() => onDelete(j.id)} />
        ))}
        <JobEditor onSave={onSave} />
        {cards.map((c) => (
          <CardEditor key={c.id + c.name} card={c} onSave={onSave} onDelete={() => onDelete(c.id)} />
        ))}
        <CardEditor onSave={onSave} />
        <div className="todo-dialog-actions">
          <button type="button" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
