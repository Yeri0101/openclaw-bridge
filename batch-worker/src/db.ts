/**
 * SOAT Phase 3 — Supabase DB client (mirrors backend/src/db.ts)
 *
 * Uses same SUPABASE_URL + SUPABASE_SERVICE_KEY env vars.
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY!;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('[DB] Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars');
    process.exit(1);
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
