import nextEnv from '@next/env';
import { authSetupIssues } from '../lib/auth-policy.mjs';

nextEnv.loadEnvConfig(process.cwd());
const issues = authSetupIssues(process.env);
if (!process.env.HUBSPOT_ACCESS_TOKEN?.trim()) issues.push('HUBSPOT_ACCESS_TOKEN');
if (!['false', 'true'].includes(process.env.RECRUITING_WRITES_ENABLED ?? 'false')) issues.push('RECRUITING_WRITES_ENABLED');
if (process.env.VERCEL_ENV === 'preview' && process.env.RECRUITING_WRITES_ENABLED === 'true') {
  issues.push('RECRUITING_WRITES_ENABLED must remain false in Preview');
}

if (issues.length) {
  console.error('Setup is incomplete. Configure these settings directly in the environment:');
  for (const issue of [...new Set(issues)]) console.error(`- ${issue}`);
  process.exitCode = 1;
} else {
  console.log('Configuration format checks passed. No secrets were printed.');
  console.log('Google login, database migrations/connectivity, HubSpot access, and Vercel deployment still require integration verification.');
  console.log(process.env.RECRUITING_WRITES_ENABLED === 'true' ? 'Write flag is enabled; verify this is the intended environment.' : 'HubSpot writes are disabled.');
}
