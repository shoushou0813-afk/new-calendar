export type TaskPriority = 'high' | 'normal' | 'low';

/** 締切のあるやること(課題・レポート・準備など)。予定(EventRow)とは別に管理する。 */
export interface Task {
  id: string;
  title: string;
  /** 締切日 yyyy-MM-dd */
  deadline: string;
  /** 締切時刻 HH:mm。null なら締切日の作業終了時刻まで。 */
  deadline_time: string | null;
  /** 全体の見積もり作業時間(分) */
  estimated_minutes: number;
  /** これまでに終わらせた作業時間(分) */
  spent_minutes: number;
  priority: TaskPriority;
  note: string | null;
  done: boolean;
  created_at: string;
  updated_at: string;
}

export type TaskDraft = Omit<Task, 'id' | 'created_at' | 'updated_at'>;

/** 1日のTodoリストの1行。ある時間帯にどのタスクを何分やるか。 */
export interface PlanItem {
  id: string;
  task_id: string;
  title: string;
  /** HH:mm */
  start: string;
  /** HH:mm */
  end: string;
  reason: string;
  done: boolean;
}

export interface DayPlan {
  /** yyyy-MM-dd (主キー) */
  date: string;
  items: PlanItem[];
  summary: string;
  warnings: string[];
  generated_by: 'ai' | 'local';
  created_at: string;
}
