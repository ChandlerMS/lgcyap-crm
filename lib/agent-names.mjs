// One agent identity across HubSpot, PolicyTek and the WhatsApp sales data.
// HubSpot and PolicyTek record legal names. The WhatsApp chats and the LAP Daily Agent Reports use what the
// group shows: nicknames ("Tony Lewis"), first names ("Paul"), and labels added to a contact (a start month
// such as "January 2026" or "March 26", or a city such as "TPA" or "Miami").
//
// Only two kinds of match are made, so different people are never merged by guesswork:
// - a trailing start-month or city label is dropped, when at least two words remain;
// - an explicit pair below. Each pair was confirmed on 2026-11-19 by matching the WhatsApp posts to the same agent's
//   HubSpot Sold deals or PolicyTek applications by date (within two days) and exact premium, by HubSpot's own
//   spelling of the same agent, or, for a few, by the RingCX spellings in lib/svp-ringcx-calls.mjs.
// Accents, initials and other near-spellings are not folded: "José" and "Jose" stay two agents.

const START_MONTH = /\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+(?:20)?\d{2})?$/;
const CITY = /\s+(?:tpa|tampa|orl|orlando|miami|mia)$/;

export const AGENT_NAME_ALIASES = Object.freeze(new Map([
  // WhatsApp name → HubSpot / PolicyTek name
  ['aldon', 'aldon jarrett'], ['alandy', 'alandy sinophat'], ['alex espinosa', 'alexander espinosa-liranzo'], ['alex jimenez', 'alexander jimenez'],
  ['anthony g', 'anthony gonzales'], ['anthony r', 'anthony rodriguez'], ['arshia vi', 'arshia vicaruddin'], ['ersh', 'arshia vicaruddin'],
  ['ashton gray', 'ashton platero gray'], ['avi', 'aviad alfassi'], ['becky saintil', 'rebekah saintil'], ['becky new number', 'rebekah saintil'],
  ['bella lonsdale', 'isabella lonsdale'], ['branden g.', 'branden gallant'], ['brittany winders', 'britany winders'], ['connor o’day', 'connor oday'],
  ['curt surprenant', 'curtis surprenant'], ['diego lucena paredes', 'diego lucena'], ['eli vega', 'elizabeth vega'], ['ezra gonzalez', 'ezra gonzales'],
  ['fernando b', 'fernando bernardino'], ['fernando bernadino', 'fernando bernardino'], ['gabi santiago', 'gabriela santiago'], ['greg hardy', 'gregory hardy'],
  ['hanna johnny', 'hanna elagha'], ['harrison', 'harrison trager'], ['jake', 'sidney snyderman'], ['jay hamilton', 'howard hamilton'],
  ['jennifer sun', 'jennifer sunseri'], ['joey schroeter', 'joseph schroeter'], ['john gordon', 'johnathan gordon'], ['josh neudigate', 'joshua neudigate'],
  ['josh ziegler', 'joshua ziegler'], ['kevin figueroa', 'kevin figueroa cabrera'], ['matt hurley', 'matthew hurley'], ['mike vogt', 'michael vogt'],
  ['mike winn', 'michael winn'], ['naun f. nuñez', 'naun nunez'], ['noah korfant', 'walter noah korfant'], ['oshana balerezo', 'oshana balarezo'],
  ['oshana jimenez', 'oshana balarezo'], ['oví stephen overton', 'stephen overton'], ['parker gillion', 'julian gillion'], ['paul', 'paul krueger'],
  ['philip atland', 'philip altland'], ['rachel santil', 'rachel saintil'], ['reinaldo remy martinez', 'reinaldo martinez'], ['ricardo rivera galan', 'ricardo rivera'],
  ['sam ramzy', 'samuel ramzy'], ['samantha apontelegacy', 'samantha aponte'], ['santiago kent', 'santiago albornoz'], ['stu burdette', 'stuart burdette'],
  ['tj feegel', 'thomas feegel'], ['tony lewis', 'anthony lewis'], ['x ixo utermöhl', 'ixo utermohl'],
  // HubSpot spelling → PolicyTek spelling of the same agent
  ['alendy sinophat', 'alandy sinophat'],
]));

/** The comparison key for an agent name: NFC, trimmed, single-spaced, lowercase, without a start-month or city label, then the verified pair if one exists. */
export function agentNameKey(name) {
  let key = String(name).normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
  for (const label of [START_MONTH, CITY]) {
    const shorter = key.replace(label, '');
    if (shorter !== key && shorter.split(' ').length >= 2) key = shorter;
  }
  return AGENT_NAME_ALIASES.get(key) ?? key;
}
