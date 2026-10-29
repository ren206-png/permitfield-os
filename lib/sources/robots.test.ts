import { describe, expect, it } from 'vitest';
import { isAllowedByRobots, robotsVerdict } from './robots';

describe('isAllowedByRobots', () => {
  const robots = `
User-agent: *
Disallow: /private/
Allow: /private/public-forms/
Disallow: /*.pdf$

User-agent: BadBot
Disallow: /
`;
  it('applies the * group: longest match wins, Allow wins ties', () => {
    expect(isAllowedByRobots(robots, '/permits/building')).toBe(true);
    expect(isAllowedByRobots(robots, '/private/staff')).toBe(false);
    expect(isAllowedByRobots(robots, '/private/public-forms/a.html')).toBe(true);
  });
  it('supports * and $ wildcards', () => {
    expect(isAllowedByRobots(robots, '/docs/fees.pdf')).toBe(false);
    expect(isAllowedByRobots(robots, '/docs/fees.pdf?v=2')).toBe(true);
  });
  it('a group naming our bot overrides *', () => {
    const ours = `User-agent: *\nDisallow: /\n\nUser-agent: PermitFieldOS-SourceCheck\nAllow: /\n`;
    expect(isAllowedByRobots(ours, '/anything')).toBe(true);
    const blocked = `User-agent: PermitFieldOS-SourceCheck\nDisallow: /fees\n`;
    expect(isAllowedByRobots(blocked, '/fees/2026')).toBe(false);
    expect(isAllowedByRobots(blocked, '/forms')).toBe(true);
  });
  it('an empty Disallow allows everything; comments are ignored', () => {
    expect(isAllowedByRobots('User-agent: *\nDisallow:   # nothing\n', '/x')).toBe(true);
  });
});

describe('robotsVerdict', () => {
  it('missing robots.txt allows; server error or no response holds off', () => {
    expect(robotsVerdict(404, null, '/x')).toBe('allowed');
    expect(robotsVerdict(503, null, '/x')).toBe('unavailable');
    expect(robotsVerdict(null, null, '/x')).toBe('unavailable');
    expect(robotsVerdict(200, 'User-agent: *\nDisallow: /x', '/x')).toBe('disallowed');
  });
});
