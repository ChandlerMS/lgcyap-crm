import Script from "next/script";
import LegacyBotLauncher from "./legacy-bot-launcher";
import { requireAppUser } from "./app-auth";
import RecruitingWorkspace from "./recruiting-workspace";
import VersionSwitch from "./version-switch";
import styles from "./version-switch.module.css";

export const dynamic = "force-dynamic";

export default async function Home() {
  await requireAppUser("/");
  return <><VersionSwitch version={1} /><div className={styles.versionOne}><RecruitingWorkspace ringCentralClientId={process.env.RINGCENTRAL_CLIENT_ID ?? ""} /></div>
    {/* Chat only: do not enable automatic tracking or form collection in the CRM. */}
    <LegacyBotLauncher />
    <Script
      id="hubspot-messages-loader"
      src="https://js.usemessages.com/conversations-embed.js"
      strategy="afterInteractive"
      data-hsjs-portal="50894788"
      data-hsjs-env="prod"
      data-hsjs-hublet="na1"
    />
  </>;
}
