export const MODEL = 'deepseek-flash';
const ENDPOINT = 'https://api.deepseek.com/chat/completions';
const OUTPUT_TOKENS = 600;
const PROMPT = '你是项目沟通材料审计助手。材料完全虚构。用简体中文，只输出 JSON 对象，精确包含 commitments 和 risks 两个数组。每个数组最多四项。每项只包含 summary 和 evidenceIds。summary 概述候选承诺或风险，最多100字，未知期限明确写未知，区分提议和已承诺。evidenceIds 必须引用当前案例确实存在的段落 ID，至少一个，不要捏造事实或引用。可使用空数组。';
const plainText = /^[\p{Script=Han}\p{L}\p{N}\p{M} ，。；：、？！“”‘’（）()《》—·,.!?:%-]+$/u;
const sensitive = /(?:\d{7,}|(?:api[ -]?key|secret|token|password)\b|\bsk-|https?:|\bwww\.)/iu;
export function validateResult(raw, example) {
  if (!raw || Object.keys(raw).sort().join(',') !== 'commitments,risks') throw Error('OUTPUT_REJECTED');
  const validIds = new Map(example.records.map(r => [r.id, r]));
  const result = {};
  for (const category of ['commitments', 'risks']) {
    if (!Array.isArray(raw[category]) || raw[category].length > 4) throw Error('OUTPUT_REJECTED');
    result[category] = raw[category].map(item => {
      if (!item || Object.keys(item).sort().join(',') !== 'evidenceIds,summary' ||
          typeof item.summary !== 'string' || !item.summary.trim() || item.summary.length > 140 ||
          !plainText.test(item.summary) || sensitive.test(item.summary) ||
          !Array.isArray(item.evidenceIds) || item.evidenceIds.length < 1 ||
          item.evidenceIds.length > 3 || new Set(item.evidenceIds).size !== item.evidenceIds.length ||
          item.evidenceIds.some(id => typeof id !== 'string' || !validIds.has(id))) {
        throw Error('OUTPUT_REJECTED');
      }
      return { summary: item.summary, evidence: item.evidenceIds.map(id => validIds.get(id)) };
    });
  }
  return result;
}

async function readEnvelope(response) {
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw Error('PROVIDER_UNAVAILABLE');
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 32 * 1024) throw Error('PROVIDER_ENVELOPE_LIMIT');
      chunks.push(value);
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export function createProvider(key, transport = fetch, timeout = 20_000) {
  return async example => {
    const content = JSON.stringify(example.records);
    if (Buffer.byteLength(content) > 2500) throw Error('CASE_LIMIT');
    const response = await transport(ENDPOINT, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(timeout),
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model: MODEL, stream: false, thinking: { type: 'disabled' }, max_tokens: OUTPUT_TOKENS,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: PROMPT }, { role: 'user', content }],
      }),
    });
    const envelope = await readEnvelope(response);
    const choice = envelope?.choices?.[0];
    const output = choice?.message?.content;
    const usage = envelope?.usage;
    if (!Array.isArray(envelope?.choices) || envelope.choices.length !== 1 ||
        choice?.finish_reason !== 'stop' || choice.message?.tool_calls?.length ||
        typeof output !== 'string' || !output.trim() || Buffer.byteLength(output) > 7000 ||
        !Number.isSafeInteger(usage?.completion_tokens) || usage.completion_tokens < 1 ||
        usage.completion_tokens > OUTPUT_TOKENS) throw Error('OUTPUT_REJECTED');
    return validateResult(JSON.parse(output), example);
  };
}
