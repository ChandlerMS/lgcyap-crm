import { getAppUser } from '@/app/app-auth';
import { listClasses, saveClass, cancelClass } from '@/db/training-classes.mjs';
import { handleTrainingClasses } from '@/lib/training-class-request.mjs';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const handle = (request: Request) => handleTrainingClasses(request, { getUser: getAppUser, env: process.env, list: listClasses, save: saveClass, cancel: cancelClass });
export const GET = handle;
export const POST = handle;
