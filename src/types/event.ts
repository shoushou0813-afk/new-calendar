import type { WarningLogEntry } from '../lib/validation';

/** Row shape as stored in the browser's IndexedDB (see src/lib/localDb.ts). */
export interface EventRow {
  id: string;
  title: string;
  category: string;
  date: string;
  doors_at: string | null;
  starts_at: string;
  ends_at: string | null;
  source_url: string | null;
  /** Ticket image, stored as a Blob directly in IndexedDB (no external storage). */
  image: Blob | null;
  note: string | null;
  has_alarm: boolean;
  time_confirmed: boolean;
  warnings: WarningLogEntry[];
  /** Reserved for the future memory-test feature (spec 1/8) — unused for now. */
  memory_checked_at: string | null;
  /** Reserved for the future memory-test feature (spec 1/8) — unused for now. */
  miss_count: number;
  created_at: string;
  updated_at: string;
}

export type EventDraft = Omit<
  EventRow,
  'id' | 'warnings' | 'memory_checked_at' | 'miss_count' | 'created_at' | 'updated_at'
> & {
  warnings?: WarningLogEntry[];
};
