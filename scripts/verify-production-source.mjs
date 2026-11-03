import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const REPOSITORY = 'https://github.com/ChandlerMS/lgcyap-crm.git';
const SHA = /^[a-f0-9]{40}$/;

function readGithubMain() {
  const output = execFileSync('git', ['ls-remote', REPOSITORY, 'refs/heads/main'], {
    encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  const [sha, ref, ...extra] = output.split(/\s+/);
  if (!SHA.test(sha ?? '') || ref !== 'refs/heads/main' || extra.length) throw new Error('GitHub main could not be verified.');
  return sha;
}

/** Deployment guard, not an access-control boundary against Vercel administrators. */
export function verifyProductionSource({ env = process.env, readMainSha = readGithubMain } = {}) {
  if (env.VERCEL_ENV !== 'production' && env.VERCEL_TARGET_ENV !== 'production') return { production: false };
  const reject = reason => { throw new Error(`Production deployment blocked: ${reason} Push changes to ChandlerMS/lgcyap-crm main and let the GitHub integration deploy them.`); };
  if (env.VERCEL !== '1' || env.VERCEL_PROJECT_ID !== 'prj_tAhuHcbCr3HXxant1EGPbaFLjc6E') reject('the Vercel production project could not be verified.');
  if (env.VERCEL_GIT_PROVIDER !== 'github' || env.VERCEL_GIT_REPO_OWNER !== 'ChandlerMS' || env.VERCEL_GIT_REPO_SLUG !== 'lgcyap-crm' || env.VERCEL_GIT_REPO_ID !== '1439230490') reject('the expected GitHub repository metadata is missing or different.');
  if (env.VERCEL_GIT_COMMIT_REF !== 'main') reject('only the main branch can build for production.');
  const sha = env.VERCEL_GIT_COMMIT_SHA;
  if (!SHA.test(sha ?? '')) reject('the GitHub commit SHA is missing or invalid.');
  let latest;
  try { latest = readMainSha(); } catch { reject('the latest GitHub main commit could not be checked.'); }
  if (!SHA.test(latest ?? '') || sha !== latest) reject('this commit is not the current GitHub main HEAD.');
  return { production: true, sha };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = verifyProductionSource();
    console.log(result.production ? `Production source verified: GitHub main @ ${result.sha}.` : 'Local/preview build: production source check not required.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
