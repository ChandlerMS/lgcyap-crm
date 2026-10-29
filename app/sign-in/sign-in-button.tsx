"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import styles from "./auth.module.css";

export default function SignInButton({ ready, returnTo }: { ready: boolean; returnTo: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function signIn() {
    setPending(true); setError(null);
    try {
      const result = await authClient.signIn.social({ provider: "google", callbackURL: returnTo, errorCallbackURL: "/sign-in?error=denied" });
      if (result.error) { setError("Sign-in could not be completed. Use your approved Google work account or contact the app owner."); setPending(false); }
    } catch { setError("Sign-in is temporarily unavailable. Please try again."); setPending(false); }
  }
  return <><button className={`btn btn-primary ${styles.action}`} disabled={!ready || pending} onClick={() => void signIn()}>{pending ? "Opening Google…" : "Continue with Google"}</button>{error && <p className={styles.notice} role="alert">{error}</p>}</>;
}
