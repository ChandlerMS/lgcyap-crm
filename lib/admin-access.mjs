import { accessOverrides } from '../db/admin-access.mjs';
import { effectivePolicy } from './admin-policy.mjs';
export async function currentAccessPolicy() { return effectivePolicy(process.env, await accessOverrides()); }
