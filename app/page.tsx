import { requireAppUser } from "./app-auth";
import RecruitingWorkspace from "./recruiting-workspace";
import VersionSwitch from "./version-switch";
import styles from "./version-switch.module.css";

export const dynamic = "force-dynamic";

export default async function Home() {
  await requireAppUser("/");
  return <><VersionSwitch version={1} /><div className={styles.versionOne}><RecruitingWorkspace ringCentralClientId={process.env.RINGCENTRAL_CLIENT_ID ?? ""} /></div></>;
}
