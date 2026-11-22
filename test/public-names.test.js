// Public-name finder. Nano's answers are faked, including the mistakes a small
// model makes (an invented name, a person, a generic phrase). Made-up text only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildRows } from '../src/core/pdf-lines.js';
import { readCommonApp } from '../src/core/common-app.js';
import { namesFromStructure, mergePublicNames, isSpecificName, cleanName, nameSearchTexts } from '../src/core/public-names.js';
import { findPublicNames } from '../src/core/run-ai.js';
import { namesPrompt } from '../src/core/prompts.js';

const result = {
  activities: [
    { id: 'activity-1', heading: 'Lakeview High School Varsity Soccer, Captain', description: 'Led warmups.' },
    { id: 'activity-2', heading: 'Lakeview Robotics (FIRST Tech Challenge), Lead Programmer', description: 'Spent a summer at the Penn Engineering Summer Academy.' },
    { id: 'activity-3', heading: 'Tutoring Club, Founder', description: 'Tutored freshmen in algebra.' },
  ],
  honors: [{ id: 'honor-1', title: 'Regional Science Fair, 2nd Place' }],
};
const sections = {
  'activity-1': 'Athletics\nLakeview High School Varsity Soccer, Captain\nLed warmups.',
  'activity-2': 'Robotics\nLakeview Robotics (FIRST Tech Challenge), Lead Programmer\nSpent a summer at the Penn Engineering Summer Academy.',
  'activity-3': 'Other\nTutoring Club, Founder\nTutored freshmen in algebra.',
  'honor-1': 'Regional Science Fair, 2nd Place\nRegional\n11',
  'personal-essay': 'My coach, Maria Lopez, told me to apply to Carleton College.',
};

test('code reads organizations from headings and honors, never the position', () => {
  const names = namesFromStructure(result).map((n) => n.name);
  assert.ok(names.includes('FIRST Tech Challenge'));
  assert.ok(names.includes('Regional Science Fair'));
  assert.ok(!names.some((n) => /Captain|Programmer|Founder|2nd Place/.test(n)));
});

test('generic names are not worth checking', () => {
  assert.equal(isSpecificName('Tutoring Club'), false);
  assert.equal(isSpecificName('Varsity Soccer'), false);
  assert.equal(isSpecificName('FIRST Tech Challenge'), true);
  assert.equal(isSpecificName('Key Club'), true);
  assert.equal(cleanName('  the "Science Olympiad", '), 'Science Olympiad');
});

test('Nano\'s mistakes are dropped: invented names, people, generic phrases', () => {
  const nano = [
    { name: 'Penn Engineering Summer Academy', kind: 'program' },
    { name: 'Carleton College', kind: 'college' },
    { name: 'Maria Lopez', kind: 'person' },
    { name: 'MIT Launch', kind: 'program' }, // not in the application
    { name: 'math club', kind: 'organization' },
  ];
  const { names, dropped } = mergePublicNames(namesFromStructure(result), nano, sections);
  const kept = names.map((n) => n.name);
  assert.ok(kept.includes('Penn Engineering Summer Academy'));
  assert.ok(kept.includes('Carleton College'));
  assert.ok(!kept.includes('Maria Lopez'));
  assert.ok(!kept.includes('MIT Launch'));
  assert.ok(dropped.some((d) => d.name === 'Maria Lopez' && /person/.test(d.reason)));
  assert.ok(dropped.some((d) => d.name === 'MIT Launch' && /word for word/.test(d.reason)));
  assert.ok(!kept.includes('Tutoring Club'));
});

test('the student\'s own school is offered but unticked; the rest start ticked', () => {
  const { names } = mergePublicNames(namesFromStructure(result), [], sections);
  const school = names.find((n) => /High School/.test(n.name));
  assert.equal(school.defaultOn, false);
  assert.equal(names.find((n) => n.name === 'FIRST Tech Challenge').defaultOn, true);
});

test('a short name inside a longer one is merged', () => {
  const s = { a: 'Research Science Institute (RSI) at Stanford University' };
  const { names } = mergePublicNames([], [{ name: 'Research Science Institute (RSI)', kind: 'program' }, { name: 'RSI', kind: 'program' }], s);
  assert.deepEqual(names.map((n) => n.name), ['Research Science Institute']); // brackets split, then RSI merges by first letters
});

test('Nano reads a few texts, not one per sentence, and its prompt has no real applicant text', async () => {
  const texts = nameSearchTexts({ ...result, personalEssay: { text: sections['personal-essay'] }, collegeEssays: [{ id: 'college-essay-1', text: 'Why us.' }] });
  assert.deepEqual(texts.map((t) => t.id), ['activities-and-honors', 'personal-essay', 'college-essay-1']);
  assert.ok(namesPrompt('THE TEXT').trimEnd().endsWith('THE TEXT'));
});

test('on the fictional Michigan PDF, code alone finds the program names, and a failing Nano call is not fatal', async () => {
  const readJson = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
  const michigan = readCommonApp(buildRows(readJson('./fixtures/michigan-items.json').pages));
  const codeOnly = await findPublicNames({ result: michigan });
  const kept = codeOnly.names.map((n) => n.name);
  assert.ok(kept.some((n) => /FIRST Robotics Competition/.test(n)), kept.join(' | '));
  assert.ok(kept.every((n) => !/Co-Captain|Lead Programmer/.test(n)));

  const warn = console.warn; console.warn = () => {};
  try {
    const withNano = await findPublicNames({ result: michigan, askNames: async () => { throw new Error('busy'); } });
    assert.ok(withNano.failed > 0);
    assert.equal(withNano.names.length, codeOnly.names.length);
  } finally { console.warn = warn; }
});

test('abbreviations merge by rule for any program: written inside, or first letters', async () => {
  const { isAbbreviationOf, initialsOf } = await import('../src/core/public-names.js');
  assert.equal(initialsOf('Massachusetts Institute of Technology'), 'MIT');
  assert.equal(isAbbreviationOf('RSI', 'Research Science Institute'), true);
  assert.equal(isAbbreviationOf('FBLA', 'Future Business Leaders of America'), true);
  assert.equal(isAbbreviationOf('NHS', 'National Honor Society (NHS)'), true);
  assert.equal(isAbbreviationOf('MIT', 'Michigan Robotics League'), false);
  assert.equal(isAbbreviationOf('Key Club', 'Key Club International'), false); // not an abbreviation: both stay
  const s = { a: 'Research Science Institute in summer.', b: 'At RSI I learned to fail fast.' };
  const { names } = mergePublicNames([], [{ name: 'Research Science Institute', kind: 'program' }, { name: 'RSI', kind: 'program' }], s);
  assert.deepEqual(names.map((n) => n.name), ['Research Science Institute']);
});

test('role and filler words come off; two names joined by "&" split; one name with "&" stays', async () => {
  const { coreName, splitNames } = await import('../src/core/public-names.js');
  assert.equal(coreName('Inducted Member - National Honor Society'), 'National Honor Society');
  assert.equal(coreName('Partnership with Lakeview Clinic'), 'Lakeview Clinic');
  assert.equal(coreName('Westbrook FC state team'), 'Westbrook FC');
  assert.equal(coreName('Ohio State'), 'Ohio State');
  assert.equal(coreName('Telluride Summer Program'), 'Telluride Summer Program');
  assert.deepEqual(splitNames('Brookfield College & Close Up Foundation'), ['Brookfield College', 'Close Up Foundation']);
  assert.deepEqual(splitNames('Johnson & Johnson'), ['Johnson & Johnson']);
  assert.deepEqual(splitNames('ECNL (top youth league)'), ['ECNL', 'top youth league']);
});

test('the position is split off even with odd spacing before the comma', () => {
  const r = { activities: [{ id: 'activity-1', heading: 'Rivertown FC Academy , Winger/Midfielder' }], honors: [{ id: 'honor-1', title: 'Honor Roll' }] };
  const names = namesFromStructure(r).map((n) => n.name);
  assert.deepEqual(names, ['Rivertown FC Academy', 'Honor Roll']);
  const { names: kept } = mergePublicNames(namesFromStructure(r), [], { 'activity-1': 'Athletics\nRivertown FC Academy , Winger/Midfielder', 'honor-1': 'Honor Roll' });
  assert.deepEqual(kept.map((n) => n.name), ['Rivertown FC Academy']); // "Honor Roll" is too generic to check
});

test('names with a person inside, or only in essays, are shown but start unticked', () => {
  const s = {
    'activity-1': 'Other\nSam Ortiz\'s Kids Sports Camps, Coach',
    'activity-2': 'Science\nBrookfield Science Center, Volunteer',
    'personal-essay': 'I built a robot I called Gizmotron and posted it on VideoTube.',
  };
  const fromCode = [{ name: 'Sam Ortiz\'s Kids Sports Camps' }, { name: 'Brookfield Science Center' }];
  const nano = [{ name: 'Sam Ortiz', kind: 'person' }, { name: 'Gizmotron', kind: 'program' }, { name: 'VideoTube', kind: 'organization' }];
  const { names } = mergePublicNames(fromCode, nano, s);
  const by = Object.fromEntries(names.map((n) => [n.name, n]));
  assert.equal(by['Brookfield Science Center'].defaultOn, true);
  assert.equal(by["Sam Ortiz's Kids Sports Camps"].defaultOn, false);
  assert.equal(by.Gizmotron.defaultOn, false);
  assert.match(by.Gizmotron.why, /essays/);
  assert.equal(names[0].name, 'Brookfield Science Center'); // ticked names come first
});
