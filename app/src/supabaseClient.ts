import { createClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@env';

// Thin wrapper around @supabase/supabase-js — SUPABASE_URL/SUPABASE_ANON_KEY are read at build
// time via the `react-native-dotenv` babel plugin (app/.env, gitignored; app/.env.example
// documents the shape). Local dev default is the Supabase CLI's fixed local API URL
// (`http://localhost:54321`, see SETUP.md) — no native linking required (unlike
// react-native-config, which needs Android/iOS project edits), matching this ticket's decision
// to keep app/src runnable/testable independent of whether the native project folders exist.
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;
