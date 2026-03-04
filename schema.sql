-- ============================================================
-- Easy-Score Multi-Tenant Database Schema
-- ============================================================

-- Enable uuid-ossp extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- Drop existing tables (clean slate)
-- ============================================================
DROP TABLE IF EXISTS scores CASCADE;
DROP TABLE IF EXISTS events CASCADE;
DROP TABLE IF EXISTS judges CASCADE;
DROP TABLE IF EXISTS rooms CASCADE;
DROP TABLE IF EXISTS institutions CASCADE;

-- ============================================================
-- 1. Institutions Table
-- ============================================================
CREATE TABLE institutions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    admin_email TEXT UNIQUE NOT NULL,
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================
-- 2. Rooms Table
-- ============================================================
CREATE TABLE rooms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    institution_id UUID REFERENCES institutions(id) ON DELETE CASCADE,
    secret_code VARCHAR(8) UNIQUE NOT NULL,
    judge_count_required INT NOT NULL CHECK (judge_count_required IN (2, 3)),
    created_by TEXT NOT NULL,  -- admin email
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================
-- 3. Judges Table (room membership)
-- ============================================================
CREATE TABLE judges (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email TEXT NOT NULL,
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    UNIQUE(email, room_id)
);

-- ============================================================
-- 4. Events Table
-- ============================================================
CREATE TABLE events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    institution_id UUID REFERENCES institutions(id) ON DELETE CASCADE,
    event_name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT '',
    participant_count INT NOT NULL CHECK (participant_count >= 1 AND participant_count <= 30),
    created_by TEXT NOT NULL,  -- judge email
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================
-- 5. Scores Table
-- ============================================================
CREATE TABLE scores (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    institution_id UUID REFERENCES institutions(id) ON DELETE CASCADE,
    judge_email TEXT NOT NULL,
    participant_number INT NOT NULL CHECK (participant_number >= 1),
    score INT NOT NULL CHECK (score >= 0 AND score <= 100),
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    UNIQUE(event_id, judge_email, participant_number)
);

-- ============================================================
-- Enable Realtime
-- ============================================================
-- First check if publication exists, then add tables
-- In Supabase, 'supabase_realtime' usually exists.
-- If not, you might need: CREATE PUBLICATION supabase_realtime;
ALTER PUBLICATION supabase_realtime ADD TABLE institutions;
ALTER PUBLICATION supabase_realtime ADD TABLE rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE judges;
ALTER PUBLICATION supabase_realtime ADD TABLE events;
ALTER PUBLICATION supabase_realtime ADD TABLE scores;

-- ============================================================
-- Row Level Security
-- ============================================================
ALTER TABLE institutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms        ENABLE ROW LEVEL SECURITY;
ALTER TABLE judges       ENABLE ROW LEVEL SECURITY;
ALTER TABLE events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE scores       ENABLE ROW LEVEL SECURITY;

-- Helper function to check if user is Super Admin
CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN (auth.jwt() ->> 'email') = 'rikashrikash04@gmail.com';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper function to check if user is Institution Admin for a specific institution
CREATE OR REPLACE FUNCTION is_institution_admin(inst_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM institutions 
    WHERE id = inst_id AND admin_email = (auth.jwt() ->> 'email') AND is_active = TRUE
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Institutions policies
CREATE POLICY "super_admin_all" ON institutions FOR ALL USING (is_super_admin());
CREATE POLICY "inst_admin_read_own" ON institutions FOR SELECT USING (admin_email = (auth.jwt() ->> 'email'));

-- Rooms policies
CREATE POLICY "rooms_super_admin" ON rooms FOR ALL USING (is_super_admin());
CREATE POLICY "rooms_inst_admin" ON rooms FOR ALL USING (is_institution_admin(institution_id));
CREATE POLICY "rooms_judge_select" ON rooms FOR SELECT USING (true); -- Anyone can check room code

-- Judges policies
CREATE POLICY "judges_super_admin" ON judges FOR ALL USING (is_super_admin());
CREATE POLICY "judges_inst_admin" ON judges FOR ALL USING (EXISTS (
    SELECT 1 FROM rooms WHERE rooms.id = judges.room_id AND is_institution_admin(rooms.institution_id)
));
CREATE POLICY "judges_self" ON judges FOR ALL USING (email = (auth.jwt() ->> 'email'));

-- Events policies
CREATE POLICY "events_super_admin" ON events FOR ALL USING (is_super_admin());
CREATE POLICY "events_inst_admin" ON events FOR ALL USING (is_institution_admin(institution_id));
CREATE POLICY "events_judge_select" ON events FOR SELECT USING (EXISTS (
    SELECT 1 FROM judges WHERE judges.room_id = events.room_id AND judges.email = (auth.jwt() ->> 'email')
));
CREATE POLICY "events_judge_insert" ON events FOR INSERT WITH CHECK (EXISTS (
    SELECT 1 FROM judges WHERE judges.room_id = events.room_id AND judges.email = (auth.jwt() ->> 'email')
));

-- Scores policies
CREATE POLICY "scores_super_admin" ON scores FOR ALL USING (is_super_admin());
CREATE POLICY "scores_inst_admin" ON scores FOR ALL USING (is_institution_admin(institution_id));
CREATE POLICY "scores_judge_all" ON scores FOR ALL USING (judge_email = (auth.jwt() ->> 'email'));
