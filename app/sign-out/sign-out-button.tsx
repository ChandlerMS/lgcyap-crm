"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import styles from "../sign-in/auth.module.css";

export default function SignOutButton({ ready }: { ready: boolean }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  async function signOut() {
    setPending(true); setError(false);
    try {
      const result = await authClient.signOut();
      if (result.error) { setError(true); setPending(false); return; }
      window.location.replace("/sign-in");
    } catch { setError(true); setPending(false); }
  }
  return <><button className={`btn btn-primary ${styles.action}`} disabled={!ready || pending} onClick={() => void signOut()}>{pending ? "Signing out…" : "Sign out"}</button>{error && <p className={styles.notice} role="alert">Sign-out could not be completed. Please try again.</p>}</>;
}
