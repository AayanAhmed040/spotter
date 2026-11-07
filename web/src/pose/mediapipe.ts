/**
 * Lazy MediaPipe Pose Landmarker loader. Everything runs on-device: the WASM
 * runtime and model are downloaded once (then cached by the service worker),
 * and camera frames never leave the browser.
 */
import type { PoseLandmarker } from '@mediapipe/tasks-vision'

const TASKS_VERSION = '1.2.2' // keep in sync with package.json
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}/wasm`
const MODELS = {
  lite: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  full: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
}

let cached: Promise<PoseLandmarker> | null = null

function isLikelyMobile(): boolean {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.hardwareConcurrency ?? 8) <= 4
}

export function loadPoseLandmarker(): Promise<PoseLandmarker> {
  if (!cached) {
    cached = (async () => {
      const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision')
      const vision = await FilesetResolver.forVisionTasks(WASM_URL)
      const options = (delegate: 'GPU' | 'CPU') => ({
        baseOptions: { modelAssetPath: isLikelyMobile() ? MODELS.lite : MODELS.full, delegate },
        runningMode: 'VIDEO' as const,
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      })
      try {
        return await PoseLandmarker.createFromOptions(vision, options('GPU'))
      } catch (e) {
        console.warn('GPU delegate unavailable, falling back to CPU', e)
        return await PoseLandmarker.createFromOptions(vision, options('CPU'))
      }
    })()
    cached = cached.catch((e) => {
      cached = null // allow a retry after a network failure
      console.error('Pose model failed to load', e)
      throw new Error("Couldn't download the pose-tracking model. Check your internet connection and try again.")
    })
  }
  return cached
}

export type CameraFacing = 'user' | 'environment'

export class CameraError extends Error {
  kind: 'denied' | 'not-found' | 'insecure' | 'in-use' | 'unknown'
  constructor(kind: CameraError['kind'], message: string) {
    super(message)
    this.kind = kind
  }
}

export async function openCamera(facing: CameraFacing): Promise<MediaStream> {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    throw new CameraError('insecure', 'Camera access needs HTTPS. Open the app over https:// (or localhost).')
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
    })
  } catch (e) {
    const name = (e as DOMException).name
    if (name === 'NotAllowedError' || name === 'SecurityError')
      throw new CameraError('denied', 'Camera permission was blocked. Allow camera access in your browser settings, then try again.')
    if (name === 'NotFoundError' || name === 'OverconstrainedError')
      throw new CameraError('not-found', 'No camera was found on this device.')
    if (name === 'NotReadableError')
      throw new CameraError('in-use', 'The camera is being used by another app. Close it and try again.')
    throw new CameraError('unknown', `Couldn't start the camera (${name || 'unknown error'}).`)
  }
}
