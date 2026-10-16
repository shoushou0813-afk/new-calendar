import { useCallback, useEffect, useState } from 'react';
import {
  dbDeleteProfile,
  dbDeleteTransaction,
  dbGetAllProfiles,
  dbGetAllTransactions,
  dbPutProfile,
  dbPutTransaction,
} from '../lib/localDb';
import { CLOUD_CHANGED_EVENT } from '../lib/cloud/cloudSync';
import { isCard, isJob, type CardProfile, type JobProfile, type Profile, type Transaction } from '../../api/_lib/money';

export type TransactionDraft = Omit<Transaction, 'id' | 'created_at' | 'updated_at'>;

/** 家計簿の記録と、バイト先・カードの設定 */
export function useMoney() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  /** 最初の読み込みが終わったか(重複チェックの前に必要) */
  const [ready, setReady] = useState(false);

  const reload = useCallback(async () => {
    const [txs, ps] = await Promise.all([dbGetAllTransactions(), dbGetAllProfiles()]);
    setTransactions(txs.sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at)));
    setProfiles(ps);
    setReady(true);
  }, []);

  useEffect(() => {
    void reload();
    const onCloud = () => void reload();
    window.addEventListener(CLOUD_CHANGED_EVENT, onCloud);
    return () => window.removeEventListener(CLOUD_CHANGED_EVENT, onCloud);
  }, [reload]);

  /** まとめて追加(Googleカレンダーからの取り込み用。読み直しは最後に1回) */
  const addTransactions = async (drafts: TransactionDraft[]) => {
    const now = new Date().toISOString();
    for (const draft of drafts) await dbPutTransaction({ ...draft, id: crypto.randomUUID(), created_at: now, updated_at: now });
    await reload();
  };

  const saveTransaction = async (draft: TransactionDraft, id?: string) => {
    const now = new Date().toISOString();
    const existing = id ? transactions.find((t) => t.id === id) : undefined;
    await dbPutTransaction({ ...draft, id: existing?.id ?? crypto.randomUUID(), created_at: existing?.created_at ?? now, updated_at: now });
    await reload();
  };

  const deleteTransaction = async (id: string) => {
    await dbDeleteTransaction(id);
    await reload();
  };

  const saveProfile = async (profile: Profile) => {
    await dbPutProfile(profile);
    await reload();
  };

  const deleteProfile = async (id: string) => {
    await dbDeleteProfile(id);
    await reload();
  };

  const jobs: JobProfile[] = profiles.filter(isJob);
  const cards: CardProfile[] = profiles.filter(isCard);
  return { ready, transactions, jobs, cards, addTransactions, saveTransaction, deleteTransaction, saveProfile, deleteProfile };
}
