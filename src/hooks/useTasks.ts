import { useCallback, useEffect, useState } from 'react';
import { dbDeleteTask, dbGetAllTasks, dbPutTask } from '../lib/localDb';
import type { Task, TaskDraft } from '../types/task';

export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    const rows = await dbGetAllTasks();
    setTasks(rows.sort((a, b) => Number(a.done) - Number(b.done) || a.deadline.localeCompare(b.deadline)));
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const createTask = async (draft: TaskDraft) => {
    const now = new Date().toISOString();
    await dbPutTask({ ...draft, id: crypto.randomUUID(), created_at: now, updated_at: now });
    await reload();
  };

  const createTasks = async (drafts: TaskDraft[]) => {
    const now = new Date().toISOString();
    for (const draft of drafts) await dbPutTask({ ...draft, id: crypto.randomUUID(), created_at: now, updated_at: now });
    await reload();
  };

  const updateTask = async (id: string, patch: Partial<TaskDraft>) => {
    const existing = tasks.find((t) => t.id === id);
    if (!existing) throw new Error('task not found');
    await dbPutTask({ ...existing, ...patch, updated_at: new Date().toISOString() });
    await reload();
  };

  const deleteTasks = async (ids: string[]) => {
    for (const id of ids) await dbDeleteTask(id);
    await reload();
  };

  const deleteTask = async (id: string) => {
    await dbDeleteTask(id);
    await reload();
  };

  return { tasks, loading, reload, createTask, createTasks, updateTask, deleteTask, deleteTasks };
}
