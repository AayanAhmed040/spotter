/** Plank thresholds and scoring. Mirrored in api/app/scoring/plank.py. */

export const PLANK_DETECTOR = {
  minVisibility: 0.5,
  /** Shoulder→ankle line must be within this many degrees of horizontal. */
  maxBodyTilt: 30,
  /** Body-line deviation beyond this (big sag or pike) stops the timer. */
  maxValidDeviation: 28,
  /** Hip–knee–ankle angle below this means knees are down. */
  minLegAngle: 150,
  /** Hold a valid position this long before the timer starts. */
  enterMs: 600,
  /** Brief wobbles shorter than this don't end the hold (but never count as time). */
  graceMs: 700,
  /** Measurements are summarised in windows of this length. */
  windowMs: 5000,
  minWindowMs: 300,
  /** Frame gaps longer than this (tab hidden, dropped frames) count only this much. */
  maxFrameGapMs: 250,
  /** Hip offset (fraction of body length) treated as sag / pike. */
  hipFaultThreshold: 0.035,
  /** Shoulder-over-support offset (fraction of arm length) that triggers a cue. */
  stackWarning: 0.5,
  lostFramesLimit: 20,
  smoothing: 0.5,
}

export const PLANK_SCORING = {
  version: 1,
  finalFormWeight: 0.7,
  finalHoldWeight: 0.3,
  defaultTargetSec: 60,
  componentWeights: { alignment: 0.6, stability: 0.25, stack: 0.15 },
  consistencyWeight: 0.15,
  consistencyPenaltyPerStdev: 2.5,
  /** Windows tracked with less confidence than this don't count as hold time. */
  minWindowConfidence: 0.4,
  // Linear ramps: [value scoring 100, value scoring 0]
  alignmentRamp: [6, 25] as const, // mean body-line deviation, degrees
  stabilityRamp: [0.006, 0.03] as const, // hip sway (std, fraction of body length)
  stackRamp: [0.25, 0.75] as const, // shoulders vs elbows/wrists offset, fraction of arm length
}
