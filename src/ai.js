// The only file that talks to Firebase AI Logic. Browser-only (it imports the
// Firebase SDK from Google's CDN), so it has no Node tests; the logic it uses
// lives in src/core/ and is tested there.
//
// Models chosen by what the text is, never by what is convenient:
//   privateModel, mentionModel: ONLY_ON_DEVICE. Application text. Never fall back to cloud.
//   publicModel:  ONLY_IN_CLOUD with Google Search. Public names only.
// Never use PREFER_ON_DEVICE or PREFER_IN_CLOUD here: both can silently send
// the prompt to the cloud (for example while the on-device model is still
// downloading). test/guards.test.js fails if either appears in src/.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-app-check.js';
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-ai.js';

import { firebaseConfig, recaptchaSiteKey } from './firebase-config.js';
import { assertOnDevice } from './core/privacy.js';
import { CONTRADICTION_SCHEMA, contradictionPrompt, FACTS_SCHEMA, factsPrompt, CLAIM_SCHEMA, claimPrompt, NAMES_SCHEMA, namesPrompt } from './core/prompts.js';
import { cloudNamesPrompt, parseCloudAnswer } from './core/cloud-names.js';
import { MENTION_SCHEMA, mentionPrompt } from './core/ai-checks.js';
import { readGroundedAnswer } from './core/grounding.js';

export const CLOUD_MODEL = 'gemini-3.5-flash-lite';
// The search-grounded check uses full Flash: Flash-Lite often skips the search or returns no grounding data,
// and judges and students should see sources every time. Still a fraction of a cent per check.
export const GROUNDED_MODEL = 'gemini-3.5-flash';

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
  // Replay protection: every cloud request gets a fresh single-use App Check token (5-minute life), so a token
  // copied out of the browser can't be reused from someone else's script. Enforced in the Firebase console
  // (App Check > APIs > Firebase AI Logic > Replay protection). On-device calls never use a token.
  const ai = getAI(app, { backend: new GoogleAIBackend(), useLimitedUseAppCheckTokens: true });

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
  const factsModel = getGenerativeModel(ai, {
    mode: InferenceMode.ONLY_ON_DEVICE,
    onDeviceParams: { createOptions: english, promptOptions: { responseConstraint: FACTS_SCHEMA } },
  });
  const claimModel = getGenerativeModel(ai, {
    mode: InferenceMode.ONLY_ON_DEVICE,
    onDeviceParams: { createOptions: english, promptOptions: { responseConstraint: CLAIM_SCHEMA } },
  });
  const namesModel = getGenerativeModel(ai, {
    mode: InferenceMode.ONLY_ON_DEVICE,
    onDeviceParams: { createOptions: english, promptOptions: { responseConstraint: NAMES_SCHEMA } },
  });
  const mentionModel = getGenerativeModel(ai, {
    mode: InferenceMode.ONLY_ON_DEVICE,
    onDeviceParams: { createOptions: english, promptOptions: { responseConstraint: MENTION_SCHEMA } },
  });

  const publicModel = getGenerativeModel(ai, {
    mode: InferenceMode.ONLY_IN_CLOUD,
    inCloudParams: { model: GROUNDED_MODEL, tools: [{ googleSearch: {} }] },
  });

  // Same cloud model without Google Search. Search grounding is not in the
  // Gemini free tier, so this is the fallback if billing is not linked: it
  // checks names from the model's own knowledge, with no sources to show.
  const publicModelWithoutSearch = getGenerativeModel(ai, {
    mode: InferenceMode.ONLY_IN_CLOUD,
    inCloudParams: { model: CLOUD_MODEL },
  });

  return { privateModel, factsModel, claimModel, namesModel, mentionModel, publicModel, publicModelWithoutSearch };
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
 * Extraction design: asks the on-device model what one essay paragraph says
 * about one activity or honor (hours, title, placing, with quotes). Returns the
 * parsed JSON. Throws PrivacyError if the answer did not come from the device.
 */
export async function extractFactsOnDevice(factsModel, itemName, passage) {
  const result = await factsModel.generateContent(factsPrompt(itemName, passage));
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
 * The cloud name check: sends the questions the student ticked (public names only) and reads the answer.
 * Pass the model and withSearch together: publicModel with true, or publicModelWithoutSearch with false.
 * The full prompt is recorded in sentLog BEFORE it is sent, so the "What we sent" panel is complete.
 */
export async function checkNamesInCloud(publicModel, questions, sentLog, { withSearch = true } = {}) {
  const prompt = cloudNamesPrompt(questions, { withSearch });
  sentLog.record(withSearch ? 'Fact-check names with Google Search' : 'Fact-check names (no search)', prompt);
  const result = await publicModel.generateContent(prompt);
  const answer = readGroundedAnswer(result.response);
  return { ...answer, ...parseCloudAnswer(answer.text, questions) };
}

/**
 * Claim design: asks the on-device model whether one paragraph agrees with,
 * disagrees with or doesn't state each claim from the activity list.
 */
export async function checkClaimsOnDevice(claimModel, claims, passage) {
  const result = await claimModel.generateContent(claimPrompt(claims, passage));
  assertOnDevice(result.response);
  return JSON.parse(result.response.text());
}

/**
 * Public-name finder: asks the on-device model for the public names in one
 * text. Private text never leaves the computer here; only names the student
 * later ticks go to the cloud, through checkNamesInCloud.
 */
export async function findNamesOnDevice(namesModel, text) {
  const result = await namesModel.generateContent(namesPrompt(text));
  assertOnDevice(result.response);
  return JSON.parse(result.response.text());
}

/** The `ask` function runAiChecks needs: sends each question to the right on-device model. */
export function onDeviceAsker(models) {
  return (question) => {
    if (question.kind === 'facts') return extractFactsOnDevice(models.factsModel, question.itemName, question.passage);
    if (question.kind === 'claims') return checkClaimsOnDevice(models.claimModel, question.claims, question.passage);
    return findContradictionsOnDevice(models.privateModel, question.itemText, question.passage);
  };
}
