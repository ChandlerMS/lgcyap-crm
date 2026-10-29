import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { handleRecruitRequest, readRecruitingData } from '@/lib/hubspot.mjs';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return handleRecruitRequest(request, {
    getUser: getChatGPTUser,
    readData: () => readRecruitingData({ accessToken: (env as { HUBSPOT_ACCESS_TOKEN?: string }).HUBSPOT_ACCESS_TOKEN }),
  });
}

export async function GET(request: Request) {
  return handleRecruitRequest(request, { getUser: getChatGPTUser, readData: () => Promise.reject() });
}
