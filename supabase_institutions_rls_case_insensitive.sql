-- ============================================================
-- Run in Supabase Dashboard → SQL Editor
-- Makes institution admin check work regardless of email casing
-- (e.g. Rikash04rikash@gmail.com vs rikash04rikash@gmail.com)
-- ============================================================

-- Drop the existing SELECT policy for institution admins
DROP POLICY IF EXISTS "inst_admin_read_own" ON institutions;

-- Recreate: allow SELECT when admin_email matches JWT email (case-insensitive)
CREATE POLICY "inst_admin_read_own" ON institutions
  FOR SELECT
  USING (lower(admin_email) = lower(auth.jwt() ->> 'email'));
