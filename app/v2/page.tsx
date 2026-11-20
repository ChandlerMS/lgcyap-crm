import { redirect } from "next/navigation";
import { requireAppUser } from "../app-auth";

export const dynamic = "force-dynamic";

export default async function VersionTwo() {
  await requireAppUser("/v2");
  // Use a top-level navigation: the external site's embedding policy and
  // SameSite sign-in cookie cannot be changed by this CRM's iframe.
  redirect("https://lgcy-onboard.carlos-831.workers.dev/");
}
