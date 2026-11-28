// The only file that talks to Firebase AI Logic. Browser-only (it imports the
// Firebase SDK from Google's CDN), so it has no Node tests; the logic it uses
// lives in src/core/ and is tested there.
//
// Models chosen by what the text is, never by what is convenient:
//   privateModel, factsModel, mentionModel...: ONLY_ON_DEVICE. Application text stays on the laptop.
//   publicModel:  ONLY_IN_CLOUD with Google Search. Public names only.
//   createConsentedHybridModels: PREFER_ON_DEVICE, the hybrid fallback. Built only after the counselor says yes to
//     reading this PDF in the cloud (src/core/consent.js). Nowhere else: PREFER_* modes can send a prompt to the
//     cloud on their own, so test/guards.test.js allows PREFER_ON_DEVICE only in that one function, and
//     PREFER_IN_CLOUD nowhere.
//   createChosenCloudModels: ONLY_IN_CLOUD, no Search. Built only when a counselor whose laptop has Nano picks
//     "Gemini in Google's cloud" on the start page.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-app-check.js';
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-ai.js';

import { firebaseConfig, recaptchaSiteKey } from './firebase-config.js';
import { assertOnDevice } from './core/privacy.js';
import { CONTRADICTION_SCHEMA, contradictionPrompt, FACTS_SCHEMA, factsPrompt, CLAIM_SCHEMA, claimPrompt, NAMES_SCHEMA, namesPrompt } from './core/prompts.js';
import { cloudNamesPrompt, parseCloudAnswer } from './core/cloud-names.js';
import { MENTION_SCHEMA, mentionPrompt } from './core/ai-checks.js';
import { CONTEXT_SCHEMA, contextPrompt } from './core/name-context.js';
import { readGroundedAnswer } from './core/grounding.js';
import { withJsonShape, parseModelJson, CLOUD_PURPOSE } from './core/consent.js';
import { WHOLE_READ_SCHEMA, wholeReadPrompt, VERIFY_SCHEMA, verifyPrompt } from './core/whole-read.js';

export const CLOUD_MODEL = 'gemini-3.5-flash-lite';
// The search-grounded check uses full Flash: Flash-Lite often skips the search or returns no grounding data,
// and judges and students should see sources every time. Still a fraction of a cent per check.
export const GROUNDED_MODEL = 'gemini-3.5-flash';
// The model that reads application text in the cloud (the picked cloud reading, the closer read). Nov 27: 3.8 Flash
// beat 3.5 Flash on practice-1 (26 vs 25 of 31 in reach, fewer false alarms, no inexact quotes) at half the price
// through Dec 31, 2026. Pinned on purpose: change it only after the test page compares models.
// The Google Search name check stays on GROUNDED_MODEL, which is what it was tested with.
export const READ_MODEL = 'gemini-3.8-flash';

// Chrome asks every on-device request to name its languages, so it can
// tune quality and safety checks for them. Loomis is English-only for now.
const english = {
  expectedInputs: [{ type: 'text', languages: ['en'] }],
  expectedOutputs: [{ type: 'text', languages: ['en'] }],
};

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
  // Reads a name in the student's own sentence against Google's answer. The sentence is private: on the device only.
  const contextModel = getGenerativeModel(ai, {
    mode: InferenceMode.ONLY_ON_DEVICE,
    onDeviceParams: { createOptions: english, promptOptions: { responseConstraint: CONTEXT_SCHEMA } },
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

  return { ai, privateModel, factsModel, claimModel, namesModel, mentionModel, contextModel, publicModel, publicModelWithoutSearch };
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
 * After the name check: does a detail in the student's sentence disagree with Google's answer? Asked on the
 * device only. Returns { agrees, quote }. Throws PrivacyError if the answer did not come from the device.
 */
export async function checkNameContextOnDevice(contextModel, name, google, sentence) {
  const result = await contextModel.generateContent(contextPrompt(name, google, sentence));
  assertOnDevice(result.response);
  return JSON.parse(result.response.text());
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

/**
 * The hybrid fallback, built only after the counselor says yes (src/core/consent.js). PREFER_ON_DEVICE: Gemini Nano
 * when Chrome has it, otherwise Gemini in the cloud. The same narrow questions as on the device; the cloud model is
 * asked for JSON and the shape is spelled out in the prompt.
 */
// cloudModel: the test page passes another Gemini model to compare (dev/eval.html); the app always uses the default.
export function createConsentedHybridModels(models, { cloudModel = READ_MODEL } = {}) {
  const make = (schema) => getGenerativeModel(models.ai, {
    mode: InferenceMode.PREFER_ON_DEVICE,
    onDeviceParams: { createOptions: english, promptOptions: { responseConstraint: schema } },
    inCloudParams: { model: cloudModel, generationConfig: { responseMimeType: 'application/json' } },
  });
  return { facts: make(FACTS_SCHEMA), mention: make(MENTION_SCHEMA), context: make(CONTEXT_SCHEMA), whole: make(WHOLE_READ_SCHEMA), verify: make(VERIFY_SCHEMA) };
}

/**
 * The cloud reading the counselor picked on the start page, on a laptop that HAS Gemini Nano (Nov 25, the builder's
 * decision). ONLY_IN_CLOUD, not the hybrid mode: with Nano here, PREFER_ON_DEVICE would quietly answer on the laptop,
 * which isn't what they picked. No Google Search: application text never goes with a search. Same shape as
 * createConsentedHybridModels, so the reading code treats both alike. app.js builds this only on a line that checks
 * cloudConsent === true (test/guards.test.js).
 */
export function createChosenCloudModels(models) {
  const cloud = getGenerativeModel(models.ai, {
    mode: InferenceMode.ONLY_IN_CLOUD,
    inCloudParams: { model: READ_MODEL, generationConfig: { responseMimeType: 'application/json' } },
  });
  return { facts: cloud, mention: cloud, context: cloud, whole: cloud, verify: cloud };
}

// Each prompt goes in the sent log before it is sent, so "What was sent" is complete.
async function askHybrid(model, prompt, schema, sentLog) {
  const full = withJsonShape(prompt, schema);
  sentLog.record(CLOUD_PURPOSE, full);
  const result = await model.generateContent(full);
  sentLog.addUsage?.(result.response.usageMetadata);
  return parseModelJson(result.response.text());
}

/** The `ask` function runAiChecks needs, through the consented hybrid models. Extraction design only. */
export function consentedAsker(hybrid, sentLog) {
  return (question) => {
    if (question.kind !== 'facts') throw new Error('the cloud fallback runs the extraction questions only');
    return askHybrid(hybrid.facts, factsPrompt(question.itemName, question.passage), FACTS_SCHEMA, sentLog);
  };
}

export async function askMentionConsented(hybrid, sentLog, collegeName, sentence) {
  return (await askHybrid(hybrid.mention, mentionPrompt(collegeName, sentence), MENTION_SCHEMA, sentLog)).aboutAttending === true;
}

export function checkNameContextConsented(hybrid, sentLog, name, google, sentence) {
  return askHybrid(hybrid.context, contextPrompt(name, google, sentence), CONTEXT_SCHEMA, sentLog);
}

/** The whole-application read (src/core/whole-read.js): cloud only, after the yes. Returns the model's conflicts. */
export function wholeReadConsented(hybrid, sentLog, app, options = {}) {
  return askHybrid(hybrid.whole, wholeReadPrompt(app, options), WHOLE_READ_SCHEMA, sentLog);
}

// The closer read (Nov 24, the builder's decision). For a counselor whose laptop HAS Gemini Nano: after Nano's reading, the
// results page offers "Read it closer". Only after that click (the yes, with what gets sent spelled out beside the
// button) does app.js build this model, on a line that checks closerConsent === true (test/guards.test.js).
// ONLY_IN_CLOUD: the counselor asked for the cloud by name, so it must never quietly run on the device instead.
export function createCloserReadModel(models) {
  return getGenerativeModel(models.ai, {
    mode: InferenceMode.ONLY_IN_CLOUD,
    inCloudParams: { model: READ_MODEL, generationConfig: { responseMimeType: 'application/json' } },
  });
}

/** The whole-application read through the closer-read model. Logged in the sent log before it is sent. */
export function closerReadConsented(model, sentLog, app) {
  return askHybrid(model, wholeReadPrompt(app, { layout: 'instructions-first' }), WHOLE_READ_SCHEMA, sentLog);
}

/** The check step: one question that gives a verdict on every flag the whole read found. */
export function verifyConsented(hybrid, sentLog, app, flags) {
  return askHybrid(hybrid.verify, verifyPrompt(app, flags), VERIFY_SCHEMA, sentLog);
}
