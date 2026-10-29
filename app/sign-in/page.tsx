import Image from "next/image";
import { getAuthSetupIssues } from "@/lib/auth";
import { safeReturnPath } from "@/lib/auth-policy.mjs";
import SignInButton from "./sign-in-button";
import styles from "./auth.module.css";

export const dynamic = "force-dynamic";

export default async function SignIn({ searchParams }: { searchParams: Promise<{ return_to?: string; error?: string }> }) {
  const params = await searchParams;
  const ready = getAuthSetupIssues().length === 0;
  return <main className={styles.shell}><section className={styles.card} aria-labelledby="sign-in-title"><Image unoptimized className={styles.logo} src="/legacy-logo.png" alt="Legacy Agency Partners" width="178" height="116" /><p className={styles.eyebrow}>Private recruiting workspace</p><h1 className={styles.title} id="sign-in-title">Welcome to Legacy</h1><p className={styles.copy}>Sign in with your approved Google work account to open recruiting.</p><SignInButton ready={ready} returnTo={safeReturnPath(params.return_to)} />{!ready ? <p className={styles.notice} role="status">Employee sign-in is being set up. Contact the app owner when you are ready to connect.</p> : params.error ? <p className={styles.notice} role="alert">Sign-in could not be completed. Check that your work account has access, then try again.</p> : null}<p className={styles.note}>Access is limited to approved employees.</p></section></main>;
}
