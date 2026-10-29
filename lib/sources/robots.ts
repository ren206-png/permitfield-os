// Gate 6.7: robots.txt for source checks (master prompt §10 "do not bypass
// ... source restrictions"; 6.3 known limit). Before a registered source
// is fetched, its site's robots.txt is read and the most specific group for
// our user agent (else "*") decides: the longest matching Allow/Disallow
// rule wins, Allow winning a tie, with "*" and "$" wildcards (RFC 9309).
//
// A missing robots.txt (4xx) allows everything; a server error (5xx) or an
// unreachable robots.txt disallows for now -- the check is retried later,
// never forced.

export const ROBOTS_AGENT_TOKEN = 'permitfieldos-sourcecheck';

interface Group {
  agents: string[];
  rules: { allow: boolean; pattern: string }[];
}

function parse(text: string): Group[] {
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const match = /^([a-zA-Z-]+)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    const field = match[1].toLowerCase();
    const value = match[2].trim();
    if (field === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (field === 'allow' || field === 'disallow') {
      // An empty Disallow allows everything; ignore it.
      if (value === '' && field === 'disallow') continue;
      current.rules.push({ allow: field === 'allow', pattern: value });
    }
  }
  return groups;
}

function patternMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const regex = new RegExp(`^${body.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}${anchored ? '$' : ''}`);
  return regex.test(path);
}

export function isAllowedByRobots(robotsTxt: string, pathAndQuery: string, agentToken: string = ROBOTS_AGENT_TOKEN): boolean {
  const groups = parse(robotsTxt);
  const token = agentToken.toLowerCase();
  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && token.includes(a)));
  const chosen = specific.length > 0 ? specific : groups.filter((g) => g.agents.includes('*'));
  const rules = chosen.flatMap((g) => g.rules);
  let best: { allow: boolean; length: number } | null = null;
  for (const rule of rules) {
    if (!patternMatches(rule.pattern, pathAndQuery)) continue;
    const length = rule.pattern.length;
    if (!best || length > best.length || (length === best.length && rule.allow)) best = { allow: rule.allow, length };
  }
  return best ? best.allow : true;
}

export type RobotsVerdict = 'allowed' | 'disallowed' | 'unavailable';

export function robotsVerdict(status: number | null, body: string | null, pathAndQuery: string): RobotsVerdict {
  if (status === null) return 'unavailable';
  if (status >= 400 && status < 500) return 'allowed';
  if (status < 200 || status >= 300 || body === null) return 'unavailable';
  return isAllowedByRobots(body, pathAndQuery) ? 'allowed' : 'disallowed';
}
