import { useCallback, useEffect, useState } from 'react';
import { dbGetAllPlans, dbPutPlan } from '../lib/localDb';
import type { DayPlan } from '../types/task';

/** 保存済みの1日の計画(日付 → 計画) */
export function usePlans() {
  const [plans, setPlans] = useState<Map<string, DayPlan>>(new Map());

  const reload = useCallback(async () => {
    const rows = await dbGetAllPlans();
    setPlans(new Map(rows.map((p) => [p.date, p])));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const savePlan = async (plan: DayPlan) => {
    setPlans((prev) => new Map(prev).set(plan.date, plan));
    await dbPutPlan(plan);
  };

  return { plans, savePlan };
}
