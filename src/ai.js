// The only file that talks to Firebase AI Logic. Browser-only (it imports the
// Firebase SDK from Google's CDN), so it has no Node tests; the logic it uses
// lives in src/core/ and is tested there.
//
// Models chosen by what the text is, never by what is convenient:
//   privateModel, mentionModel, secondOpinionModel: ONLY_ON_DEVICE. Application text. Never fall back to cloud.
//   publicModel:  ONLY_IN_CLOUD with Google Search. Public names only.
// Never use PREFER_ON_DEVICE or PREFER_IN_CLOUD here: both can silently send
// the prompt to the cloud (for example while the on-device model is still
// downloading). test/guards.test.js fails if either appears in src/.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-app-check.js';
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-ai.js';

import { firebaseConfig, recaptchaSiteKey } from './firebase-config.js';
import { assertOnDevice } from './core/privacy.js';
import { CONTRADICTION_SCHEMA, contradictionPrompt, publicNamesPrompt } from './core/prompts.js';
import { MENTION_SCHEMA, mentionPrompt, SECOND_OPINION_SCHEMA, secondOpinionPrompt } from './core/ai-checks.js';
import { readGroundedAnswer } from './core/grounding.js';

export const CLOUD_MODEL = 'gemini-3.5-flash-lite';

/**
 * Sets up Firebase, App Check and both models. Call once.
 * In development, set self.FIREBASE_APPCHECK_DEBUG_TOKEN before calling this
 * (dev/spike.js does). Production pages must never set it.
 */
export function createSecondReadAI() {
  const app = initializeApp(firebaseConfig);
  initializeAppCheck(app, {
    // Fraud Defense (formerly reCAPTCHA Enterprise). Firebase marks classic
    // reCAPTCHA v3 as deprecated, so we use this provider instead.
    provider: new ReCaptchaEnterpriseProvider(recaptchaSiteKey),
    isTokenAutoRefreshEnabled: true,
  });
  const ai = getAI(app, { backend: new GoogleAIBackend() });

  // Chrome asks every on-device request to name its languages, so it can
  // tune quality and safety checks for them. Second Read is English-only for now.
  const english = {
    expectedInputs: [{ type: 'text', languages: ['en'] }],
    expectedOutputs: [{ type: 'text', languages: ['en'] }],
  };

  // Each on-device model has one fixed answer shape (a JSON Schema), so each question gets its own model.
  const privateModel = getGenerativeModel(ai, {
    mode: InferenceMode.ONLY_ON_DEVICE,
    onDeviceParams: { createOptions: english, promptOptions: { responseConstraint: CONTRADICTION_SCHEMA } },
  });
  const mentionModel = getGenerativeModel(ai, {
    mode: InferenceMode.ONLY_ON_DEVICE,
    onDeviceParams: { createOptions: english, promptOptions: { responseConstraint: MENTION_SCHEMA } },
  });
  const secondOpinionModel = getGenerativeModel(ai, {
    mode: InferenceMode.ONLY_ON_DEVICE,
    onDeviceParams: { createOptions: english, promptOptions: { responseConstraint: SECOND_OPINION_SCHEMA } },
  });

  const publicModel = getGenerativeModel(ai, {
    mode: InferenceMode.ONLY_IN_CLOUD,
    inCloudParams: { model: CLOUD_MODEL, tools: [{ googleSearch: {} }] },
  });

  // Same cloud model without Google Search. Search grounding is not in the
  // Gemini free tier, so this is the fallback if billing is not linked: it
  // checks names from the model's own knowledge, with no sources to show.
  const publicModelWithoutSearch = getGenerativeModel(ai, {
    mode: InferenceMode.ONLY_IN_CLOUD,
    inCloudParams: { model: CLOUD_MODEL },
  });

  return { privateModel, mentionModel, secondOpinionModel, publicModel, publicModelWithoutSearch };
}

// Kept here too so older pages can import it from src/ai.js.
export { onDeviceAvailability } from './core/privacy.js';

/**
 * Starts (or joins) the one-time model download. Must be called from a click.
 * @param {(fraction: number) => void} onProgress  0..1
 */
export function prepareOnDeviceModel(privateModel, onProgress) {
  return privateModel.initializeDeviceModel(onProgress);
}

/**
 * Asks the on-device model for contradictions between one activity (or honor)
 * and one essay passage. Returns the parsed JSON. Throws PrivacyError if the
 * answer did not come from the device.
 */
export async function findContradictionsOnDevice(privateModel, itemText, essayText) {
  const result = await privateModel.generateContent(contradictionPrompt(itemText, essayText));
  assertOnDevice(result.response);
  return JSON.parse(result.response.text());
}

/**
 * Asks the on-device model whether one sentence is about attending the college
 * it names. Returns true or false. Throws PrivacyError if not answered on the device.
 */
export async function askMentionOnDevice(mentionModel, collegeName, sentence) {
  const result = await mentionModel.generateContent(mentionPrompt(collegeName, sentence));
  assertOnDevice(result.response);
  return JSON.parse(result.response.text()).aboutAttending === true;
}

/**
 * Checks public names in the cloud. Pass the model and withSearch together:
 * publicModel with withSearch true, or publicModelWithoutSearch with false.
 * The full prompt is recorded in sentLog before it is sent.
 */
export async function checkPublicNamesInCloud(publicModel, publicNames, sentLog, { withSearch = true } = {}) {
  const prompt = publicNamesPrompt(publicNames, { withSearch });
  sentLog.record(withSearch ? 'Check public names with Google Search' : 'Check public names (no search)', prompt);
  const result = await publicModel.generateContent(prompt);
  return readGroundedAnswer(result.response);
}

/**
 * Asks the on-device model whether one AI flag's two quotes really contradict.
 * Returns true or false. Throws PrivacyError if not answered on the device.
 */
export async function askSecondOpinionOnDevice(secondOpinionModel, flag) {
  const result = await secondOpinionModel.generateContent(secondOpinionPrompt(flag));
  assertOnDevice(result.response);
  return JSON.parse(result.response.text()).contradicts === true;
}
