import { ArrowLeft, Github, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { supabase } from "@/lib/superbase/client";

export default function Auth() {
  const navigate = useNavigate();
  const [pendingProvider, setPendingProvider] = useState<"google" | "github" | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) navigate("/", { replace: true });
    });
    return () => subscription.unsubscribe();
  }, [navigate]);

  async function login(provider: "github" | "google") {
    setPendingProvider(provider);
    setError("");
    try {
      const { error: loginError } = await supabase.auth.signInWithOAuth({ provider });
      if (loginError) throw loginError;
    } catch (loginError) {
      console.error("Unable to start sign-in:", loginError);
      setError(loginError instanceof Error ? loginError.message : "Sign-in couldn't be started.");
      setPendingProvider(null);
    }
  }

  return (
    <main className="auth-page">
      <button className="auth-back" onClick={() => navigate("/")}>
        <ArrowLeft size={17} />
        Back to search
      </button>
      <section className="auth-card">
        <div className="auth-brand">
          <span className="auth-brand-icon">
            <Sparkles size={20} />
          </span>
          <span>perplexity</span>
          <span className="brand-pro">pro</span>
        </div>
        <h1>Answers start with a question.</h1>
        <p className="auth-description">
          Sign in to search the web, explore ideas, and keep your conversations in one place.
        </p>

        <div className="auth-providers">
          <button
            className="provider-button"
            onClick={() => void login("google")}
            disabled={pendingProvider !== null}
          >
            <span className="google-g">G</span>
            {pendingProvider === "google" ? "Connecting to Google…" : "Continue with Google"}
          </button>
          <button
            className="provider-button"
            onClick={() => void login("github")}
            disabled={pendingProvider !== null}
          >
            <Github size={19} />
            {pendingProvider === "github" ? "Connecting to GitHub…" : "Continue with GitHub"}
          </button>
        </div>
        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
        <p className="auth-legal">
          Sign in securely with your existing Google or GitHub account.
        </p>
      </section>
      <p className="auth-footer">Your curiosity, without the clutter.</p>
    </main>
  );
}
