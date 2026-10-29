import Image from "next/image";
import Link from "next/link";
import { getAuthSetupIssues } from "@/lib/auth";
import SignOutButton from "./sign-out-button";
import styles from "../sign-in/auth.module.css";

export const dynamic = "force-dynamic";

export default function SignOut() {
  const ready = getAuthSetupIssues().length === 0;
  return <main className={styles.shell}><section className={styles.card} aria-labelledby="sign-out-title"><Image unoptimized className={styles.logo} src="/legacy-logo.png" alt="Legacy Agency Partners" width="178" height="116" /><p className={styles.eyebrow}>Private recruiting workspace</p><h1 className={styles.title} id="sign-out-title">Sign out of recruiting</h1><p className={styles.copy}>Confirm to end this app session on this browser.</p><SignOutButton ready={ready} /><Link className={styles.link} href="/">Return to recruiting</Link></section></main>;
}
