import { useEffect, useMemo, useState } from 'react';
import { differenceInCalendarDays, format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { dbGetPlan, dbPutPlan } from '../../lib/localDb';
import { toHHmm, toMinutes, totalMinutes } from '../../lib/planner/freeSlots';
import { planLocally, type PlanResult } from '../../lib/planner/localPlanner';
import { buildPlanningContext } from '../../lib/planner/planningContext';
import type { AppSettings } from '../../lib/settings';
import type { EventDraft, EventRow } from '../../types/event';
import type { DayPlan, PlanItem, Task, TaskDraft } from '../../types/task';
import { DeadlineImportDialog } from './DeadlineImportDialog';
import { TaskForm } from './TaskForm';
import './Todo.css';

interface TodoPageProps {
  date: Date;
  events: EventRow[];
  tasks: Task[];
  settings: AppSettings;
  onCreateTask: (draft: TaskDraft) => Promise<void>;
  onCreateTasks: (drafts: TaskDraft[]) => Promise<void>;
  onUpdateTask: (id: string, patch: Partial<TaskDraft>) => Promise<void>;
  onDeleteTask: (id: string) => Promise<void>;
  onReplacePlanEvents: (date: string, drafts: EventDraft[]) => Promise<void>;
  onOpenSettings: () => void;
}

const PRIORITY_LABEL = { high: '高', normal: '中', low: '低' } as const;

function itemMinutes(item: PlanItem): number {
  return toMinutes(item.end) - toMinutes(item.start);
}

function formatMinutes(m: number): string {
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}時間${m % 60 ? `${m % 60}分` : ''}` : `${m}分`;
}

export function TodoPage(props: TodoPageProps) {
  const { date, events, tasks, settings } = props;
  const dateKey = format(date, 'yyyy-MM-dd');
  const [plan, setPlan] = useState<DayPlan | null>(null);
  const [planning, setPlanning] = useState<'ai' | 'local' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<Task | 'new' | null>(null);
  const [showDeadlineImport, setShowDeadlineImport] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPlan(null);
    setError(null);
    setNotice(null);
    dbGetPlan(dateKey).then((p) => {
      if (!cancelled) setPlan(p);
    });
    return () => {
      cancelled = true;
    };
  }, [dateKey]);

  const context = useMemo(
    () => buildPlanningContext({ date: dateKey, now: new Date(), tasks, events, settings }),
    [dateKey, tasks, events, settings],
  );
  const freeToday = totalMinutes(context.slots);
  const activeTasks = tasks.filter((t) => !t.done);
  const doneTasks = tasks.filter((t) => t.done);

  const savePlan = async (result: PlanResult, by: DayPlan['generated_by']) => {
    const next: DayPlan = { date: dateKey, ...result, generated_by: by, created_at: new Date().toISOString() };
    await dbPutPlan(next);
    setPlan(next);
  };

  const generate = async (mode: 'ai' | 'local') => {
    setError(null);
    setNotice(null);
    if (mode === 'ai' && !settings.anthropicApiKey) {
      setError('AIで計画するには、設定で Claude の APIキーを入力してください。');
      return;
    }
    setPlanning(mode);
    try {
      // Claude SDK は大きいので、AIを使うときだけ読み込む
      const result =
        mode === 'ai'
          ? await (await import('../../lib/planner/aiPlanner')).planWithClaude(context, settings.anthropicApiKey)
          : planLocally(context);
      await savePlan(result, mode);
    } catch (err) {
      setError(err instanceof Error ? err.message : '計画の作成に失敗しました');
    } finally {
      setPlanning(null);
    }
  };

  const toggleItem = async (item: PlanItem) => {
    if (!plan) return;
    const nextDone = !item.done;
    const next: DayPlan = { ...plan, items: plan.items.map((i) => (i.id === item.id ? { ...i, done: nextDone } : i)) };
    setPlan(next);
    await dbPutPlan(next);
    // チェックした分だけタスクの進捗(終わった時間)を進める
    const task = tasks.find((t) => t.id === item.task_id);
    if (task) {
      const delta = nextDone ? itemMinutes(item) : -itemMinutes(item);
      const spent = Math.max(0, Math.min(task.estimated_minutes, task.spent_minutes + delta));
      await props.onUpdateTask(task.id, { spent_minutes: spent, done: spent >= task.estimated_minutes });
    }
  };

  const addPlanToCalendar = async () => {
    if (!plan) return;
    const drafts: EventDraft[] = plan.items.map((item) => ({
      title: `【作業】${item.title}`,
      category: '作業',
      date: dateKey,
      doors_at: null,
      starts_at: item.start,
      ends_at: item.end,
      source_url: null,
      image: null,
      note: item.reason,
      has_alarm: false,
      time_confirmed: true,
      task_id: item.task_id,
    }));
    await props.onReplacePlanEvents(dateKey, drafts);
    setNotice(`${drafts.length}件の作業ブロックをカレンダーに追加しました(Google同期で Google カレンダーにも反映されます)。`);
  };

  const handleSaveTask = async (draft: TaskDraft) => {
    if (editingTask && editingTask !== 'new') await props.onUpdateTask(editingTask.id, draft);
    else await props.onCreateTask(draft);
    setEditingTask(null);
  };

  const handleDeleteTask = async (task: Task) => {
    if (!window.confirm(`「${task.title}」を削除しますか？`)) return;
    await props.onDeleteTask(task.id);
  };

  const planDone = plan ? plan.items.filter((i) => i.done).reduce((s, i) => s + itemMinutes(i), 0) : 0;
  const planTotal = plan ? plan.items.reduce((s, i) => s + itemMinutes(i), 0) : 0;

  return (
    <div className="todo-page">
      <section className="todo-panel">
        <div className="todo-panel-header">
          <h2>{format(date, 'M月d日(EEE)', { locale: ja })}のTodo</h2>
          <span className="todo-free">
            空き時間 {formatMinutes(freeToday)}
            {context.slots.length > 0 && `(${context.slots.map((s) => `${toHHmm(s.start)}〜${toHHmm(s.end)}`).join('、')})`}
          </span>
        </div>

        <div className="todo-plan-actions">
          <button type="button" onClick={() => generate('ai')} disabled={planning !== null || activeTasks.length === 0}>
            {planning === 'ai' ? 'AIが計画中...' : 'AIで今日の計画を立てる'}
          </button>
          <button type="button" className="todo-secondary" onClick={() => generate('local')} disabled={planning !== null || activeTasks.length === 0}>
            {planning === 'local' ? '計算中...' : 'AIなしで自動割り当て'}
          </button>
          {!settings.anthropicApiKey && (
            <button type="button" className="todo-link" onClick={props.onOpenSettings}>
              APIキーを設定
            </button>
          )}
        </div>

        {error && <p className="todo-error">{error}</p>}
        {notice && <p className="todo-notice">{notice}</p>}

        {!plan ? (
          <p className="todo-hint">
            {activeTasks.length === 0
              ? 'まず下の「タスク」に締切のあるやることを追加してください。'
              : 'ボタンを押すと、締切と空き時間からこの日にやることを決めます。'}
          </p>
        ) : (
          <>
            <p className="todo-summary">
              <span className="todo-badge">{plan.generated_by === 'ai' ? 'AI' : '自動'}</span>
              {plan.summary}
            </p>
            {plan.warnings.length > 0 && (
              <ul className="todo-warnings">
                {plan.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
            {plan.items.length > 0 && (
              <>
                <div className="todo-progress">
                  <div className="todo-progress-bar" style={{ width: `${planTotal ? (planDone / planTotal) * 100 : 0}%` }} />
                  <span>
                    {formatMinutes(planDone)} / {formatMinutes(planTotal)}
                  </span>
                </div>
                <ul className="todo-items">
                  {plan.items.map((item) => (
                    <li key={item.id} className={item.done ? 'is-done' : ''}>
                      <label>
                        <input type="checkbox" checked={item.done} onChange={() => void toggleItem(item)} />
                        <span className="todo-item-time">
                          {item.start}〜{item.end}
                        </span>
                        <span className="todo-item-body">
                          <span className="todo-item-title">{item.title}</span>
                          <span className="todo-item-reason">{item.reason}</span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                <button type="button" className="todo-secondary" onClick={() => void addPlanToCalendar()}>
                  この計画をカレンダーに入れる
                </button>
              </>
            )}
          </>
        )}
      </section>

      <section className="todo-panel">
        <div className="todo-panel-header">
          <h2>タスク(締切のあるやること)</h2>
          <div className="todo-panel-header-actions">
            <button type="button" onClick={() => setEditingTask('new')}>
              + タスクを追加
            </button>
            <button type="button" className="todo-secondary" onClick={() => setShowDeadlineImport(true)}>
              提出・練習をまとめて追加
            </button>
          </div>
        </div>
        {activeTasks.length === 0 ? (
          <p className="todo-hint">未完了のタスクはありません</p>
        ) : (
          <ul className="todo-tasks">
            {activeTasks.map((task) => {
              const info = context.tasks.find((t) => t.task.id === task.id);
              const days = differenceInCalendarDays(parseISO(task.deadline), date);
              const progress = Math.round((task.spent_minutes / task.estimated_minutes) * 100);
              return (
                <li key={task.id} className={info && (info.shortage > 0 || info.overdue) ? 'is-risk' : ''}>
                  <div className="todo-task-main" onClick={() => setEditingTask(task)}>
                    <div className="todo-task-top">
                      <span className={`todo-priority is-${task.priority}`}>{PRIORITY_LABEL[task.priority]}</span>
                      <span className="todo-task-title">{task.title}</span>
                    </div>
                    <div className="todo-task-meta">
                      締切 {format(parseISO(task.deadline), 'M/d(EEE)', { locale: ja })}
                      {task.deadline_time && ` ${task.deadline_time}`}
                      {' ・ '}
                      {days < 0 ? `${-days}日超過` : days === 0 ? '今日' : `あと${days}日`}
                      {' ・ '}残り {formatMinutes(task.estimated_minutes - task.spent_minutes)}({progress}%済)
                      {info && info.mandatoryToday > 0 && ` ・ 今日必須 ${formatMinutes(info.mandatoryToday)}`}
                    </div>
                  </div>
                  <div className="todo-task-actions">
                    <button type="button" className="todo-secondary" onClick={() => void props.onUpdateTask(task.id, { done: true })}>
                      完了
                    </button>
                    <button type="button" className="todo-danger" onClick={() => void handleDeleteTask(task)}>
                      削除
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {doneTasks.length > 0 && (
          <details className="todo-done-list">
            <summary>完了したタスク({doneTasks.length})</summary>
            <ul>
              {doneTasks.map((task) => (
                <li key={task.id}>
                  <span>{task.title}</span>
                  <button type="button" className="todo-link" onClick={() => void props.onUpdateTask(task.id, { done: false })}>
                    戻す
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {showDeadlineImport && (
        <DeadlineImportDialog
          events={events}
          tasks={tasks}
          today={format(new Date(), 'yyyy-MM-dd')}
          onImport={props.onCreateTasks}
          onClose={() => setShowDeadlineImport(false)}
        />
      )}

      {editingTask && (
        <TaskForm
          initialTask={editingTask === 'new' ? undefined : editingTask}
          defaultDeadline={date}
          onSave={handleSaveTask}
          onCancel={() => setEditingTask(null)}
        />
      )}
    </div>
  );
}
