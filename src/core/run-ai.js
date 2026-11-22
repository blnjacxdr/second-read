// The AI check loop, shared by the dev pages and (later) the real app.
// It never calls Firebase itself: the caller passes in the two on-device
// questions, so this file stays free of Firebase and can be tested in Node
// with fake answers.
import { planComparisons, aiFlagsFromAnswer, dedupeFlags } from './ai-checks.js';

/**
 * Runs every planned comparison and every college-mention question.
 * @param {object} args
 * @param {object} args.app        checkInputFromPdf(result)
 * @param {object[]} args.codeFlags runCodeChecks(app)
 * @param {(itemText: string, passage: string) => Promise<object>} args.compare   on-device contradiction question
 * @param {(collegeName: string, sentence: string) => Promise<object>} args.askMention on-device mention question
 * @param {(message: string) => void} [args.onProgress]
 * @returns {Promise<{ flags, dropped, log, mentionAnswers, comparisons, failed }>}
 */
export async function runAiChecks({ app, codeFlags, compare, askMention, onProgress = () => {} }) {
  const plan = planComparisons(app);
  const kept = [];
  const dropped = [];
  const log = []; // every answer and what happened to it (dev screens only)
  let failed = 0;

  for (const [i, pair] of plan.entries()) {
    onProgress(`Comparing ${i + 1} of ${plan.length} on this computer…`);
    try {
      const answer = await compare(pair.itemText, pair.passage);
      const out = aiFlagsFromAnswer(pair, answer, app.sections);
      kept.push(...out.kept);
      dropped.push(...out.dropped);
      const pairName = `${pair.itemId} vs ${pair.essayId} (shared: ${pair.shared.join(', ')})`;
      if ((answer?.contradictions ?? []).length === 0) log.push({ pair: pairName, outcome: 'no contradiction reported' });
      for (const d of out.dropped) log.push({ pair: pairName, outcome: `dropped: ${d.reason}`, answer: d.contradiction });
      for (const f of out.kept) log.push({ pair: pairName, outcome: 'passed the quote check and guard', flagId: f.id, kind: f.kind, quotes: f.citations.map((c) => c.quote) });
    } catch (err) {
      failed += 1;
      console.warn('comparison failed:', err.name, err.message); // the error only, never the text
    }
  }

  const mentionAnswers = new Map();
  for (const flag of codeFlags.filter((f) => f.kind === 'other-college-name')) {
    onProgress(`Reading the ${flag.mentionName} mention on this computer…`);
    try {
      mentionAnswers.set(flag.id, await askMention(flag.mentionName, flag.citations[0].quote));
    } catch (err) {
      console.warn('mention question failed:', err.name, err.message);
    }
  }

  return { flags: dedupeFlags(kept), dropped, log, mentionAnswers, comparisons: plan.length, failed };
}
