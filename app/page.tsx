import { requireChatGPTUser } from "./chatgpt-auth";
import RecruitingWorkspace from "./recruiting-workspace";

export const dynamic = "force-dynamic";

export default async function Home() {
  await requireChatGPTUser("/");
  return <RecruitingWorkspace />;
}
