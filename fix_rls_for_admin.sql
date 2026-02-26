-- ============================================================
-- Easy-Score: Fix RLS policies so admin (anon role) can INSERT
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- Drop old restrictive INSERT policies
DROP POLICY IF EXISTS "rooms_insert"  ON rooms;
DROP POLICY IF EXISTS "judges_insert" ON judges;
DROP POLICY IF EXISTS "events_insert" ON events;
DROP POLICY IF EXISTS "scores_insert" ON scores;
DROP POLICY IF EXISTS "scores_update" ON scores;

-- Allow INSERT for everyone (anon + authenticated)
-- App-level guards (sessionStorage + email check) protect the admin UI
CREATE POLICY "rooms_insert"  ON rooms  FOR INSERT WITH CHECK (true);
CREATE POLICY "judges_insert" ON judges FOR INSERT WITH CHECK (true);
CREATE POLICY "events_insert" ON events FOR INSERT WITH CHECK (true);
CREATE POLICY "scores_insert" ON scores FOR INSERT WITH CHECK (true);
CREATE POLICY "scores_update" ON scores FOR UPDATE USING (true);
