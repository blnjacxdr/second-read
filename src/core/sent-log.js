// The "What we sent to the cloud" record. Every string that leaves the device
// is recorded here, in full, before it is sent: the prompt wording as well as
// the public names inside it. The panel shows exactly this list.

/**
 * @returns {{
 *   record: (purpose: string, text: string) => void,
 *   entries: () => Array<{ purpose: string, text: string, at: string }>,
 *   clear: () => void,
 *   addUsage: (meta: object) => void,
 *   usage: () => { input: number, output: number, calls: number },
 * }}
 */
export function createSentLog(now = () => new Date().toISOString()) {
  let items = [];
  // Token counts Google reports back (no text), so the test page can show what a run cost.
  let tokens = { input: 0, output: 0, calls: 0 };
  return {
    addUsage(meta) {
      if (!meta) return;
      tokens.input += Number(meta.promptTokenCount ?? 0);
      tokens.output += Number(meta.candidatesTokenCount ?? 0) + Number(meta.thoughtsTokenCount ?? 0); // thinking bills as output
      tokens.calls += 1;
    },
    usage() {
      return { ...tokens };
    },
    record(purpose, text) {
      if (typeof text !== 'string' || text.length === 0) throw new Error('sent log: text must be a non-empty string');
      items.push({ purpose, text, at: now() });
    },
    entries() {
      return items.map((item) => ({ ...item }));
    },
    clear() {
      items = [];
      tokens = { input: 0, output: 0, calls: 0 };
    },
  };
}
