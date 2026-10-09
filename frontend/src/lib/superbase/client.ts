import { createClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "../supabase-config";

const { supabaseUrl, supabasePublishableKey } =
  await getSupabaseConfig();

export const supabase = createClient(
  supabaseUrl,
  supabasePublishableKey
);