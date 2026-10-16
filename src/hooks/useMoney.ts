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

  const reload = useCallback(async () => {
    const [txs, ps] = await Promise.all([dbGetAllTransactions(), dbGetAllProfiles()]);
    setTransactions(txs.sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at)));
    setProfiles(ps);
  }, []);

  useEffect(() => {
    void reload();
    const onCloud = () => void reload();
    window.addEventListener(CLOUD_CHANGED_EVENT, onCloud);
    return () => window.removeEventListener(CLOUD_CHANGED_EVENT, onCloud);
  }, [reload]);

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
  return { transactions, jobs, cards, saveTransaction, deleteTransaction, saveProfile, deleteProfile };
}
