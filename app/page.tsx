import Script from "next/script";
import { requireAppUser } from "./app-auth";
import RecruitingWorkspace from "./recruiting-workspace";

export const dynamic = "force-dynamic";

export default async function Home() {
  await requireAppUser("/");
  return <>
    <RecruitingWorkspace />
    {/* Load HubSpot chat without the tracking loader's automatic form collection. */}
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
