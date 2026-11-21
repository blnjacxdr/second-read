// Nov 20 spike: proves one on-device prompt and one grounded cloud prompt work
// end to end. Development only.

// App Check debug mode. Must run before createSecondReadAI() initializes App Check.
// With `true`, the SDK prints a debug token in the DevTools console the first
// time; register it in the Firebase console (Security > App Check > Apps >
// three-dot menu > Manage debug tokens). Never set this in production code.
self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;

import {
  createSecondReadAI, onDeviceAvailability, prepareOnDeviceModel,
  findContradictionsOnDevice, checkPublicNamesInCloud,
} from '../src/ai.js';
import { describeOnDeviceStatus } from '../src/core/privacy.js';
import { keepVerifiedFlags } from '../src/core/quotes.js';
import { createSentLog } from '../src/core/sent-log.js';
import { applicationSections } from '../src/core/sections.js';

const $ = (id) => document.getElementById(id);
const sentLog = createSentLog();
const { privateModel, publicModel } = createSecondReadAI();
const sample = await (await fetch('../sample/application.json')).json();

// The spike pairs the Robotics activity with the main-essay paragraph about it.
// (Finding which pairs to compare is Nov 23 work.)
const activitySection = applicationSections(sample)['activity-2'];
const essayText = sample.personalEssay.text.split('\n\n')[1];

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text; // textContent: model output is never parsed as HTML
  if (className) node.className = className;
  return node;
}

async function refreshStatus() {
  const status = describeOnDeviceStatus(await onDeviceAvailability());
  $('status').textContent = status.message;
  $('status').className = status.canRun ? 'ok' : 'muted';
}

$('prepare').addEventListener('click', async () => {
  $('status').textContent = 'Starting download…';
  try {
    await prepareOnDeviceModel(privateModel, (fraction) => {
      $('status').textContent = `Downloading on-device model: ${Math.round(fraction * 100)}%`;
    });
  } catch (err) {
    $('status').textContent = `Could not prepare the model: ${err.message}`;
  }
  await refreshStatus();
});

$('runDevice').addEventListener('click', async () => {
  const out = $('deviceOut');
  out.replaceChildren(el('p', 'Running on this computer…', 'muted'));
  try {
    const json = await findContradictionsOnDevice(privateModel, activitySection, essayText);
    const sections = { activity: activitySection, essay: essayText };
    const flags = json.contradictions.map((c) => ({
      kind: c.kind,
      citations: [
        { sectionId: 'activity', quote: c.activityQuote },
        { sectionId: 'essay', quote: c.essayQuote },
      ],
    }));
    const { kept, dropped } = keepVerifiedFlags(sections, flags);
    out.replaceChildren(
      el('p', 'Answered by: on_device (checked)', 'ok'),
      el('p', `${kept.length} flag(s) with verified quotes, ${dropped.length} dropped because a quote did not match.`),
      el('pre', JSON.stringify({ kept, dropped }, null, 2)),
    );
  } catch (err) {
    out.replaceChildren(el('p', `${err.name}: ${err.message}`, 'bad'));
  }
});

$('runCloud').addEventListener('click', async () => {
  const out = $('cloudOut');
  out.replaceChildren(el('p', 'Asking the cloud model…', 'muted'));
  try {
    const answer = await checkPublicNamesInCloud(publicModel, sample.publicNames, sentLog);
    out.replaceChildren(
      el('p', `Answered by: ${answer.inferenceSource}. Grounded: ${answer.grounded ? 'yes' : 'no (the model did not search)'}`),
      el('pre', answer.text),
    );

    // Required by Google: show the search suggestions as provided. Shadow DOM
    // keeps their styles from leaking into the page.
    const host = $('suggestions');
    host.replaceChildren();
    if (answer.searchSuggestionsHtml) {
      const shadow = host.shadowRoot || host.attachShadow({ mode: 'open' });
      shadow.innerHTML = answer.searchSuggestionsHtml;
    }

    // Required by Google: show the sources.
    const list = el('ul');
    for (const source of answer.sources) {
      const li = el('li');
      const a = el('a', source.title);
      a.href = source.uri; a.target = '_blank'; a.rel = 'noopener noreferrer';
      li.append(a); list.append(li);
    }
    $('sources').replaceChildren(el('p', 'Sources:'), list);
  } catch (err) {
    out.replaceChildren(el('p', `${err.name}: ${err.message}`, 'bad'));
  }
  renderSentLog();
});

function renderSentLog() {
  const entries = sentLog.entries();
  if (entries.length === 0) return;
  $('sent').replaceChildren(...entries.map((e) => {
    const box = el('div');
    box.append(el('p', `${e.at}: ${e.purpose}`, 'muted'), el('pre', e.text));
    return box;
  }));
}

await refreshStatus();
