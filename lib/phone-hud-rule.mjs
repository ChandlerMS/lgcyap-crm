// Which "available" agents make it onto the Phone HUD, and which are shown dimmed.
//
// PolicyTek leaves an agent "available" until they change it, so someone who walked away, closed the tab or lost
// their connection can still be listed as available. Each agent carries three signals (epoch ms, or null when
// PolicyTek sent none):
//   lastSeen    the last heartbeat from their open PolicyTek tab
//   lastActive  the last time they clicked or typed in PolicyTek
//   idle        PolicyTek's own idle flag
//
// For reference, PolicyTek's HUD hides anyone whose heartbeat is over 5 minutes old, and dims anyone idle or
// without activity for over 11 minutes.
export function availableRule(agent, now) { // eslint-disable-line @typescript-eslint/no-unused-vars -- Keep the swappable rule's agent/time parameters until its filtering policy is defined.
  // TODO(Legacy): decide who counts as available on the wall. Until then, everyone PolicyTek lists is shown.
  return 'show';
}
