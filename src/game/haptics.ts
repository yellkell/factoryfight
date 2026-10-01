/**
 * A short haptic tick on one controller. The IWSDK gamepad wrapper is a
 * pure state tracker, so this talks to the raw WebXR input source; on
 * hardware without an actuator it's a silent no-op. (RAVE RAID kept this
 * inside PlayerSystem; here three systems buzz, so it lives alone.)
 */

import type { World } from '@iwsdk/core';

export function buzz(world: World, hand: 'left' | 'right' | 'both', intensity: number, ms: number): void {
  const session = world.session;
  if (!session?.inputSources) return;
  for (const src of session.inputSources) {
    if (hand !== 'both' && src.handedness !== hand) continue;
    const actuator = (
      src.gamepad as { hapticActuators?: readonly { pulse?: (i: number, ms: number) => void }[] } | undefined
    )?.hapticActuators?.[0];
    try {
      actuator?.pulse?.(Math.min(1, intensity), ms);
    } catch {
      /* some browsers throw on unsupported pulse — fine, it's garnish */
    }
  }
}
