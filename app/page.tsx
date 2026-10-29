import { requireAppUser } from "./app-auth";
import RecruitingWorkspace from "./recruiting-workspace";

export const dynamic = "force-dynamic";

export default async function Home() {
  await requireAppUser("/");
  return <RecruitingWorkspace />;
}
