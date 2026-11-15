import { describe, expect, it } from 'vitest';
import { inAimCone } from '../src/game/player';

describe('mouse aim', () => {
  it('hits what is in front of the swing, not behind', () => {
    expect(inAimCone(1, 0, 20, 3)).toBe(true); // ahead
    expect(inAimCone(1, 0, -20, 0)).toBe(false); // behind
    expect(inAimCone(0, -1, 2, -20)).toBe(true); // up
    expect(inAimCone(0, -1, 20, 0)).toBe(false); // 90° off
  });

  it('always hits something touching the player', () => {
    expect(inAimCone(1, 0, -5, 0)).toBe(true);
  });
});
