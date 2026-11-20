import { PORTAL_ID } from "../lib/recruiting-config.mjs";

import styles from "./hubspot-workspace.module.css";

export default function RecruitsHubSpotLink() {
  return <a className={styles.nativeLink} href={`https://app.hubspot.com/contacts/${PORTAL_ID}/objects/0-5`} target="_blank" rel="noopener noreferrer">Open in HubSpot<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M14 3h7v7M21 3 10 14M10 3H3v18h18v-7" /></svg><span className="sr-only"> (opens in a new tab)</span></a>;
}
