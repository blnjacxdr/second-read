// Privacy guards. Pure functions, no Firebase imports, so Node can test them.
//
// Rule: private application text is only ever given to the on-device model.
// The Firebase SDK already enforces this when a model is created with
// InferenceMode.ONLY_ON_DEVICE (it throws instead of falling back to the cloud).
// These guards are a second lock: if anything ever answers from the cloud,
// the answer is thrown away and the user is told.

export const ON_DEVICE = 'on_device';
export const IN_CLOUD = 'in_cloud';

export class PrivacyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PrivacyError';
  }
}

/**
 * Throws unless the response says it came from the on-device model.
 * @param {{ inferenceSource?: string }} response  result.response from the Firebase SDK
 */
export function assertOnDevice(response) {
  if (!response || response.inferenceSource !== ON_DEVICE) {
    const where = response && response.inferenceSource ? response.inferenceSource : 'unknown';
    throw new PrivacyError(`Expected an on-device answer but got "${where}". The answer was discarded.`);
  }
}

/**
 * Explains why on-device checks can't run, in words for the user.
 * Second Read never falls back to the cloud for private text; it runs the
 * code-only checks and says so.
 *
 * @param {string|undefined} availability  result of LanguageModel.availability(), or undefined if the API is missing
 * @returns {{ canRun: boolean, message: string }}
 */
export function describeOnDeviceStatus(availability) {
  switch (availability) {
    case 'available':
      return { canRun: true, message: 'The on-device model is ready.' };
    case 'downloadable':
      return { canRun: false, message: 'The on-device model needs a one-time download (several minutes). Click "Prepare on-device model" to start it.' };
    case 'downloading':
      return { canRun: false, message: 'The on-device model is downloading. You can keep using the code checks meanwhile.' };
    case 'unavailable':
      return { canRun: false, message: 'This computer can\'t run the on-device model. Loomis will run the code checks only and won\'t send any text anywhere.' };
    default:
      return { canRun: false, message: 'This browser has no on-device model (it needs desktop Chrome with on-device AI turned on). Loomis will run the code checks only and won\'t send any text anywhere.' };
  }
}

/**
 * Chrome's own report on Gemini Nano ('available', 'downloadable', 'downloading',
 * 'unavailable'), or undefined where the browser has no on-device model.
 * Needs no Firebase, so it works even when Google's servers can't be reached.
 */
export async function onDeviceAvailability({ timeoutMs = 4000 } = {}) {
  if (typeof globalThis.LanguageModel === 'undefined') return undefined;
  // Some browsers have LanguageModel but never answer (seen in headless Chrome, Nov 25). Without a time limit the
  // page would wait forever and the reading picker would have nothing picked. No answer counts as no Nano.
  let timer;
  const giveUp = new Promise((resolve) => { timer = setTimeout(() => resolve('unavailable'), timeoutMs); });
  try {
    return await Promise.race([globalThis.LanguageModel.availability({
      expectedInputs: [{ type: 'text', languages: ['en'] }],
      expectedOutputs: [{ type: 'text', languages: ['en'] }],
    }), giveUp]);
  } catch {
    return 'unavailable';
  } finally {
    clearTimeout(timer);
  }
}
