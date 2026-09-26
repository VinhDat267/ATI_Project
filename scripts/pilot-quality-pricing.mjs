/** Explicit operator selection only; no automatic model fallback. */
export function pilotQualityModel(model = 'gemini-3.7-flash') {
  const titles = {
    'gemini-3.7-flash': 'Gemini 3.7 Flash',
    'gemini-3.8-flash': 'Gemini 3.8 Flash',
    'gemini-3.1-flash-lite': 'Gemini 3.1 Flash-Lite',
  };
  if (!Object.hasOwn(titles, model)) throw new Error('QUALITY_MODEL_NOT_ALLOWLISTED');
  return { model, title: titles[model] };
}

/** Fail closed unless the exact model section lists free standard input and output. */
export function verifyExactFreeTierPrice(html, modelId, modelTitle) {
  const headings = [...html.matchAll(/<h2\b[^>]*>/gi)].map((match) => match.index);
  for (let index = 0; index < headings.length; index += 1) {
    const close = html.indexOf('</h2>', headings[index]);
    if (close < 0) throw new Error('PRICE_SOURCE_FORMAT_CHANGED');
    const title = html.slice(headings[index], close + 5).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (title !== modelTitle) continue;
    const section = html.slice(close + 5, headings[index + 1] ?? html.length);
    const subheadings = [...section.matchAll(/<h3\b[^>]*>/gi)].map((match) => match.index);
    const standardIndex = subheadings.findIndex((start) => {
      const end = section.indexOf('</h3>', start);
      return end > start && section.slice(start, end + 5).replace(/<[^>]*>/g, ' ').trim() === 'Standard';
    });
    if (standardIndex < 0) throw new Error('MODEL_STANDARD_SECTION_NOT_FOUND');
    const standard = section.slice(subheadings[standardIndex], subheadings[standardIndex + 1] ?? section.length)
      .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    if (!section.includes(modelId) ||
        !/Standard\s+Free Tier\s+Paid Tier[^]*?Input price\s+Free of charge[^]*?Output price \(including thinking tokens\)\s+Free of charge/i.test(standard)) {
      throw new Error('MODEL_FREE_TIER_PRICE_NOT_FOUND');
    }
    return;
  }
  throw new Error('MODEL_PRICE_SECTION_NOT_FOUND');
}
