// The "What we sent to the cloud" record. Every string that leaves the device
// is recorded here, in full, before it is sent: the prompt wording as well as
// the public names inside it. The panel shows exactly this list.

/**
 * @returns {{
 *   record: (purpose: string, text: string) => void,
 *   entries: () => Array<{ purpose: string, text: string, at: string }>,
 *   clear: () => void,
 * }}
 */
export function createSentLog(now = () => new Date().toISOString()) {
  let items = [];
  return {
    record(purpose, text) {
      if (typeof text !== 'string' || text.length === 0) throw new Error('sent log: text must be a non-empty string');
      items.push({ purpose, text, at: now() });
    },
    entries() {
      return items.map((item) => ({ ...item }));
    },
    clear() {
      items = [];
    },
  };
}
