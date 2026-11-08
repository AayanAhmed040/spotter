/** Squat thresholds and scoring weights. Mirrored in api/app/scoring/squat.py. */

export const SQUAT_DETECTOR = {
  minVisibility: 0.5,
  /** Knee angle (hip–knee–ankle) considered standing tall. */
  standAngle: 160,
  /** Leaving the top: a rep starts below this knee angle. */
  descentStartAngle: 145,
  /**
   * Knee must bend to this angle or lower for the rep to count. The internal
   * hip–knee–ankle angle is ~55–65° at parallel and ~110° at a half squat, so this
   * accepts a bit deeper than a half squat — reachable for beginners, scored by depth.
   */
  validDepthAngle: 105,
  /** Mean-to-max torso lean above this means it wasn't a squat (e.g. bending over). */
  maxValidTorsoLean: 70,
  /** Torso lean (from vertical) that triggers a "chest up" cue. */
  leanWarning: 50,
  /** To start, stand with the torso within this many degrees of vertical. */
  standingMaxLean: 30,
  /** Shoulder width ÷ torso length above this = facing the camera, not side-on. */
  frontViewRatio: 0.55,
  minRepDurationMs: 500,
  maxRepDurationMs: 12_000,
  readyFrames: 6,
  smoothing: 0.4,
  lostFramesLimit: 20,
}

export const SQUAT_SCORING = {
  version: 1,
  finalFormWeight: 0.7,
  finalRepWeight: 0.3,
  defaultTargetReps: 20,
  componentWeights: { depth: 0.45, torso: 0.25, lockout: 0.15, control: 0.15 },
  consistencyWeight: 0.15,
  consistencyPenaltyPerStdev: 2.5,
  // Linear ramps: [value scoring 100, value scoring 0]
  depthRamp: [70, 115] as const, // deepest knee angle, degrees (≈ parallel scores 100)
  torsoRamp: [40, 65] as const, // max torso lean from vertical during the rep, degrees
  lockoutRamp: [172, 158] as const, // knee angle when standing before the rep, degrees
  controlRamp: [1200, 600] as const, // rep duration, ms
}
