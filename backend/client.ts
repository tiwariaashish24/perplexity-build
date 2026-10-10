import { createClient } from '@supabase/supabase-js'

export function createSupabaseClient() {
  return createClient(  
"https://lhajtlcykpoveaqktpxx.supabase.co",
    process.env.SUPABASE_API_SECRET!    
  )
}








