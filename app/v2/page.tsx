import { requireAppUser } from "../app-auth";
import VersionSwitch from "../version-switch";
import styles from "./source-frame.module.css";

export const dynamic = "force-dynamic";

export default async function VersionTwo() {
  await requireAppUser("/v2");
  return <><VersionSwitch version={2} /><iframe className={styles.frame} src="/v2/app" title="Version 2 — LGCY Onboard" allow="clipboard-write" /></>;
}
