import { requireAppUser } from "../app-auth";
import VersionSwitch from "../version-switch";
import SourceFrame from "./source-frame";

export const dynamic = "force-dynamic";

export default async function VersionTwo() {
  await requireAppUser("/v2");
  return <><VersionSwitch version={2} /><SourceFrame /></>;
}
