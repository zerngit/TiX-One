-- ============================================================
-- TiX-One: 2FA Push Check-In Requests
-- Paste into Supabase SQL Editor and run.
-- ============================================================

-- 1. Create the table
create table if not exists check_in_requests (
  id            uuid        primary key default gen_random_uuid(),
  ticket_id     text        not null,
  owner_address text        not null,
  status        text        not null default 'pending'
                            check (status in ('pending', 'approved', 'denied')),
  signature     text,
  created_at    timestamptz not null default now()
);

-- 2. Row-Level Security (open policies are fine for a permissioned app)
alter table check_in_requests enable row level security;

create policy "Public insert"  on check_in_requests for insert with check (true);
create policy "Public select"  on check_in_requests for select using (true);
create policy "Public update"  on check_in_requests for update using (true);

-- 3. Enable Realtime
alter publication supabase_realtime add table check_in_requests;

-- 4. Auto-expire old requests (optional cleanup — run as a cron or manually)
-- delete from check_in_requests where created_at < now() - interval '10 minutes';
