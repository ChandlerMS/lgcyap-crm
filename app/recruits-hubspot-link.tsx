import { PORTAL_ID } from "../lib/recruiting-config.mjs";

export default function RecruitsHubSpotLink() {
  return <a className="btn btn-secondary" href={`https://app.hubspot.com/contacts/${PORTAL_ID}/objects/0-5`} target="_blank" rel="noopener noreferrer">Open in HubSpot<span className="sr-only"> (opens in a new tab)</span></a>;
}
