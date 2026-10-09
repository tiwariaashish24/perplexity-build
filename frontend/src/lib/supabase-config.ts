interface SupabaseConfig {
  supabaseUrl: string;
  supabasePublishableKey: string;
}

export async function getSupabaseConfig(): Promise<SupabaseConfig> {
  const response = await fetch("/api/config");
  if (!response.ok) {
    throw new Error("Unable to load Supabase configuration");
  }

  const config = (await response.json()) as Partial<SupabaseConfig>;
  if (!config.supabaseUrl || !config.supabasePublishableKey) {
    throw new Error("Missing Supabase environment variables");
  }

  return {
    supabaseUrl: config.supabaseUrl,
    supabasePublishableKey: config.supabasePublishableKey,
  };
}