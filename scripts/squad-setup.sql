-- 1. Create Tables (from squad-tables.sql)
CREATE TABLE IF NOT EXISTS squads (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT NOT NULL,
  vibe        TEXT NOT NULL DEFAULT '',
  concert_id  TEXT NOT NULL,
  max_members INT  NOT NULL DEFAULT 5,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS squad_members (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  squad_id   UUID NOT NULL REFERENCES squads(id) ON DELETE CASCADE,
  wallet     TEXT NOT NULL,
  bio        TEXT DEFAULT '',
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(squad_id, wallet)
);

CREATE TABLE IF NOT EXISTS squad_messages (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  squad_id   UUID NOT NULL REFERENCES squads(id) ON DELETE CASCADE,
  sender     TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Insert Dummy Data (from squad-tables.sql)
INSERT INTO squads (id, name, vibe, concert_id) VALUES
  ('a1111111-1111-1111-1111-111111111111', 'Front Row Ravers',     'High energy EDM lovers', '1'),
  ('d4444444-4444-4444-4444-444444444444', 'Swifties United',      'Die-hard Taylor Swift fans', '2')
ON CONFLICT DO NOTHING;

INSERT INTO squad_members (squad_id, wallet, bio) VALUES
  ('a1111111-1111-1111-1111-111111111111', '0xAlice01...demo', 'EDM fanatic')
ON CONFLICT DO NOTHING;

INSERT INTO squad_messages (squad_id, sender, content) VALUES
  ('a1111111-1111-1111-1111-111111111111', '0xAlice01...demo', 'Hyped for this show!')
ON CONFLICT DO NOTHING;

-- 3. Enable RLS & Policies
ALTER TABLE squads ENABLE ROW LEVEL SECURITY;
ALTER TABLE squad_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE squad_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read squads" ON squads FOR SELECT USING (true);
CREATE POLICY "Public insert squads" ON squads FOR INSERT WITH CHECK (true);
CREATE POLICY "Public read members" ON squad_members FOR SELECT USING (true);
CREATE POLICY "Public join members" ON squad_members FOR INSERT WITH CHECK (true);
CREATE POLICY "Public leave members" ON squad_members FOR DELETE USING (true);
CREATE POLICY "Public read messages" ON squad_messages FOR SELECT USING (true);
CREATE POLICY "Public send messages" ON squad_messages FOR INSERT WITH CHECK (true);

-- 4. ENABLE REALTIME (Crucial step missing in squad-tables.sql)
-- Checking if publication exists first to avoid errors
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END
$$;
ALTER PUBLICATION supabase_realtime ADD TABLE squads, squad_members, squad_messages;