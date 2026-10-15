import { useCallback, useEffect, useState } from 'react';
import { dbGetAllPlans, dbPutPlan } from '../lib/localDb';
import { CLOUD_CHANGED_EVENT } from '../lib/cloud/cloudSync';
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
    // ネット保存から新しいデータが届いたら読み直す
    const onCloud = () => void reload();
    window.addEventListener(CLOUD_CHANGED_EVENT, onCloud);
    return () => window.removeEventListener(CLOUD_CHANGED_EVENT, onCloud);
  }, [reload]);

  const savePlan = async (plan: DayPlan) => {
    setPlans((prev) => new Map(prev).set(plan.date, plan));
    await dbPutPlan(plan);
  };

  return { plans, savePlan };
}
