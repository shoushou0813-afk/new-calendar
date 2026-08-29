-- 予定時刻ミス検知カレンダー: 初期スキーマ
-- events: 予定本体。doors_at(開場) / starts_at(開演) / ends_at(終了) を別カラムで持つ
-- warnings: バリデーションで検知した警告の履歴 (jsonb 配列)
-- memory_checked_at / miss_count: 将来の記憶テスト機能用に予約 (今回は未使用)

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  category text not null,
  date date not null,
  doors_at time,
  starts_at time not null,
  ends_at time,
  source_url text,
  source_image_path text,
  note text,
  has_alarm boolean not null default false,
  time_confirmed boolean not null default false,
  warnings jsonb not null default '[]'::jsonb,
  memory_checked_at timestamptz,
  miss_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists events_user_date_idx on public.events (user_id, date);
create index if not exists events_user_category_idx on public.events (user_id, category);

alter table public.events enable row level security;

create policy "events_select_own" on public.events
  for select using (auth.uid() = user_id);
create policy "events_insert_own" on public.events
  for insert with check (auth.uid() = user_id);
create policy "events_update_own" on public.events
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "events_delete_own" on public.events
  for delete using (auth.uid() = user_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists events_set_updated_at on public.events;
create trigger events_set_updated_at
  before update on public.events
  for each row execute function public.set_updated_at();

-- ユーザーが追加できるカテゴリ。初期カテゴリ (ライブ/仕事/学校/病院/飲み会/旅行/その他) は
-- アプリ側の定数として扱い、ここにはユーザー追加分のみ保存する。
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

alter table public.categories enable row level security;

create policy "categories_select_own" on public.categories
  for select using (auth.uid() = user_id);
create policy "categories_insert_own" on public.categories
  for insert with check (auth.uid() = user_id);
create policy "categories_delete_own" on public.categories
  for delete using (auth.uid() = user_id);

-- チケット画像等の添付用ストレージバケット。パスは `${user_id}/...` で保存する想定。
insert into storage.buckets (id, name, public)
values ('event-images', 'event-images', false)
on conflict (id) do nothing;

create policy "event_images_select_own" on storage.objects
  for select to authenticated
  using (bucket_id = 'event-images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "event_images_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'event-images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "event_images_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'event-images' and (storage.foldername(name))[1] = auth.uid()::text);
