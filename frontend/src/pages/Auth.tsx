import { supabase } from "@/lib/superbase/client"
import { createClient } from "@supabase/supabase-js"

export default function Auth() {

   async function login(provider: "github" | "google") {
        const {data, error } = await supabase.auth.signInWithOAuth({
            provider: provider
        })
        

    }

    return <div>
        <button onClick={() =>login ("google")}>Login with google</button>
        <button onClick={()  => login("github")}>Login with github</button>
    </div>
} 