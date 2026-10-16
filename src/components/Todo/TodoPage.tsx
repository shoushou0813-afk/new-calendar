import { useMemo, useState } from 'react';
import { addDays, differenceInCalendarDays, format, isToday, parseISO, startOfToday } from 'date-fns';
import { ja } from 'date-fns/locale';
import { usePlans } from '../../hooks/usePlans';
import { forecastDays, type ForecastDay } from '../../lib/planner/forecast';
import { toMinutes, totalMinutes } from '../../lib/planner/freeSlots';
import { planLocally, type PlanResult } from '../../lib/planner/localPlanner';
import { buildPlanningContext } from '../../lib/planner/planningContext';
import type { AppSettings } from '../../lib/settings';
import type { EventDraft, EventRow } from '../../types/event';
import type { DayPlan, PlanItem, Task, TaskDraft } from '../../types/task';
import { DayFlow } from './DayFlow';
import { DayTodoCard, formatMinutes } from './DayTodoCard';
import { QuickScheduleDialog } from './QuickScheduleDialog';
import { DeadlineImportDialog } from './DeadlineImportDialog';
import { WeekSummary } from './WeekSummary';
import { TaskForm } from './TaskForm';
import './Todo.css';

interface TodoPageProps {
  events: EventRow[];
  tasks: Task[];
  settings: AppSettings;
  onCreateTask: (draft: TaskDraft) => Promise<void>;
  onCreateTasks: (drafts: TaskDraft[]) => Promise<void>;
  onUpdateTask: (id: string, patch: Partial<TaskDraft>) => Promise<void>;
  onDeleteTask: (id: string) => Promise<void>;
  onReplacePlanEvents: (date: string, drafts: EventDraft[]) => Promise<void>;
  onImportEvents: (drafts: EventDraft[]) => Promise<void>;
  onOpenSettings: () => void;
}

const PRIORITY_LABEL = { high: '高', normal: '中', low: '低' } as const;

function itemMinutes(item: PlanItem): number {
  return toMinutes(item.end) - toMinutes(item.start);
}

type Range = 'day' | 'week' | 'month';
const RANGE_DAYS: Record<Range, number> = { day: 1, week: 7, month: 30 };
const RANGE_KEY = 'todo-range';

function loadRange(): Range {
  try {
    const v = localStorage.getItem(RANGE_KEY);
    return v === 'week' || v === 'month' ? v : 'day';
  } catch {
    return 'day';
  }
}

export function TodoPage(props: TodoPageProps) {
  const { events, tasks, settings } = props;
  // Todoは今日を基本にする(カレンダーで選んだ日付とは別。‹ › で移動できる)
  const [date, setDate] = useState(startOfToday);
  const [showQuick, setShowQuick] = useState(false);
  const dateKey = format(date, 'yyyy-MM-dd');
  const { plans, savePlan: persistPlan } = usePlans();
  const [range, setRangeState] = useState<Range>(loadRange);
  const [planning, setPlanning] = useState<'ai' | 'local' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // 直前のチェック。items: その日の作業をチェックした / task: 課題ごと完了にした
  const [undo, setUndo] = useState<
    { kind: 'items'; date: string; itemIds: string[]; taskId: string; title: string } | { kind: 'task'; taskId: string; title: string } | null
  >(null);
  const [editingTask, setEditingTask] = useState<Task | 'new' | null>(null);
  const [showDeadlineImport, setShowDeadlineImport] = useState(false);

  const setRange = (next: Range) => {
    setRangeState(next);
    try {
      localStorage.setItem(RANGE_KEY, next);
    } catch {
      // 保存できなくても表示の切り替えはできる
    }
  };

  const context = useMemo(
    () => buildPlanningContext({ date: dateKey, now: new Date(), tasks, events, settings }),
    [dateKey, tasks, events, settings],
  );
  const freeToday = totalMinutes(context.slots);
  const days = useMemo(
    () => forecastDays({ startDate: dateKey, days: RANGE_DAYS[range], now: new Date(), tasks, events, settings, savedPlans: plans }),
    [dateKey, range, tasks, events, settings, plans],
  );
  // 「1週間でやること」はどの表示でも出す(1ヶ月表示ではその期間のまとめ)
  const weekDays = useMemo(
    () => (range === 'week' ? days : forecastDays({ startDate: dateKey, days: 7, now: new Date(), tasks, events, settings, savedPlans: plans })),
    [range, days, dateKey, tasks, events, settings, plans],
  );
  const today = days[0];
  const plan = today?.plan ?? null;
  const activeTasks = tasks.filter((t) => !t.done);
  const doneTasks = tasks.filter((t) => t.done);

  const savePlan = async (result: PlanResult, by: DayPlan['generated_by']) => {
    await persistPlan({ date: dateKey, ...result, generated_by: by, created_at: new Date().toISOString() });
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

  /**
   * まとめた行(同じタスクの作業いくつか)のチェックを切り替える。見込みの日なら、その日の計画として保存してから記録する。
   * チェックした分だけタスクの進捗(終わった時間)を進め、外したら戻す。
   */
  const toggleItems = async (dayPlan: DayPlan, itemIds: string[]) => {
    const targets = dayPlan.items.filter((i) => itemIds.includes(i.id));
    if (targets.length === 0) return null;
    const nextDone = !targets[0].done;
    await persistPlan({
      ...dayPlan,
      created_at: dayPlan.created_at || new Date().toISOString(),
      items: dayPlan.items.map((i) => (itemIds.includes(i.id) ? { ...i, done: nextDone } : i)),
    });
    const changed = targets.filter((i) => i.done !== nextDone);
    const task = tasks.find((t) => t.id === targets[0].task_id);
    if (task && changed.length > 0) {
      const minutes = changed.reduce((s, i) => s + itemMinutes(i), 0);
      const spent = Math.max(0, Math.min(task.estimated_minutes, task.spent_minutes + (nextDone ? minutes : -minutes)));
      await props.onUpdateTask(task.id, { spent_minutes: spent, done: spent >= task.estimated_minutes });
    }
    return { nextDone, title: targets[0].title, taskId: targets[0].task_id };
  };

  const handleToggle = async (day: ForecastDay, items: PlanItem[]) => {
    const ids = items.map((i) => i.id);
    const r = await toggleItems(day.plan, ids);
    setUndo(r?.nextDone ? { kind: 'items', date: day.date, itemIds: ids, taskId: r.taskId, title: r.title } : null);
  };

  /** 課題そのものを完了にする(残りの作業は全部の日の一覧から消える) */
  const completeTask = async (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    await props.onUpdateTask(task.id, { done: true });
    setUndo({ kind: 'task', taskId: task.id, title: task.title });
  };

  const handleUndo = async () => {
    if (!undo) return;
    setUndo(null);
    if (undo.kind === 'task') {
      await props.onUpdateTask(undo.taskId, { done: false });
      return;
    }
    const dayPlan = plans.get(undo.date);
    if (dayPlan) await toggleItems(dayPlan, undo.itemIds);
  };

  const addPlanToCalendar = async () => {
    if (!today) return;
    const drafts: EventDraft[] = today.items.map((item) => ({
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

  const rangeLabel = range === 'day' ? 'のやること' : range === 'week' ? 'から1週間' : 'から1ヶ月';

  return (
    <div className="todo-page">
      <section className="todo-panel">
        <div className="todo-panel-header">
          <div className="todo-date-nav">
            <button type="button" onClick={() => setDate((d) => addDays(d, -1))} aria-label="前の日">
              ‹
            </button>
            <h2>
              {format(date, 'M月d日(EEE)', { locale: ja })}
              {rangeLabel}
            </h2>
            <button type="button" onClick={() => setDate((d) => addDays(d, 1))} aria-label="次の日">
              ›
            </button>
            {!isToday(date) && (
              <button type="button" onClick={() => setDate(startOfToday())}>
                今日
              </button>
            )}
          </div>
          <div className="todo-range" role="tablist" aria-label="表示する期間">
            {(['day', 'week', 'month'] as const).map((r) => (
              <button key={r} type="button" role="tab" aria-selected={range === r} className={range === r ? 'is-active' : ''} onClick={() => setRange(r)}>
                {r === 'day' ? '今日' : r === 'week' ? '1週間' : '1ヶ月'}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="todo-error">{error}</p>}
        {notice && <p className="todo-notice">{notice}</p>}
        {undo && (
          <div className="todo-undo">
            <span>{undo.kind === 'task' ? `「${undo.title}」の課題を完了にしました` : `「${undo.title}」のこの日の分を完了にしました`}</span>
            <span className="todo-undo-actions">
              {undo.kind === 'items' && tasks.some((t) => t.id === undo.taskId && !t.done) && (
                <button type="button" className="todo-link" onClick={() => void completeTask(undo.taskId)}>
                  課題ごと完了
                </button>
              )}
              <button type="button" className="todo-link" onClick={() => void handleUndo()}>
                元に戻す
              </button>
            </span>
          </div>
        )}

        {range === 'day' && today ? (
          <>
            {activeTasks.length === 0 && (
              <p className="todo-hint">締切のあるやることは、下の「タスク」に追加すると空き時間に自動で入ります。</p>
            )}
            {plan && plan.warnings.length > 0 && (
              <ul className="todo-warnings">
                {plan.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
            <DayFlow day={today} events={events} now={new Date()} onToggle={(d, i) => void handleToggle(d, i)} />
            <WeekSummary title="1週間でやること" days={weekDays} tasks={tasks} onComplete={(id) => void completeTask(id)} />
            <details className="todo-more">
              <summary>組み直し・その他</summary>
              <span className="todo-free">空き時間 {formatMinutes(freeToday)}</span>
              <div className="todo-plan-actions">
                <button type="button" className="todo-secondary" onClick={() => generate('local')} disabled={planning !== null || activeTasks.length === 0}>
                  {planning === 'local' ? '計算中...' : '自動で組み直す'}
                </button>
                <button type="button" className="todo-secondary" onClick={() => generate('ai')} disabled={planning !== null || activeTasks.length === 0}>
                  {planning === 'ai' ? 'AIが計画中...' : 'AIで計画し直す'}
                </button>
                {!settings.anthropicApiKey && (
                  <button type="button" className="todo-link" onClick={props.onOpenSettings}>
                    APIキーを設定
                  </button>
                )}
                <button type="button" className="todo-secondary" onClick={() => setShowQuick(true)}>
                  1日の流れをまとめて入力
                </button>
                {today.items.length > 0 && (
                  <button type="button" className="todo-secondary" onClick={() => void addPlanToCalendar()}>
                    やることをカレンダーに入れる
                  </button>
                )}
              </div>
            </details>
          </>
        ) : (
          <>
            <WeekSummary
              title={range === 'week' ? '1週間でやること' : '1ヶ月でやること'}
              days={days}
              tasks={tasks}
              onComplete={(id) => void completeTask(id)}
            />
            <p className="todo-hint">
              保存した計画がない日は、締切に間に合うよう自動で割り振った見込みです。前の日の分を予定どおり終えた前提で計算しています。
            </p>
            <div className="day-todo-list">
              {days.map((d) => (
                <DayTodoCard key={d.date} day={d} compact onToggle={(day, i) => void handleToggle(day, i)} />
              ))}
            </div>
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
                  <input
                    type="checkbox"
                    className="todo-task-check"
                    checked={false}
                    onChange={() => void completeTask(task.id)}
                    aria-label={`${task.title}を完了にする`}
                  />
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

      {showQuick && (
        <QuickScheduleDialog date={dateKey} onImport={props.onImportEvents} onClose={() => setShowQuick(false)} />
      )}

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
