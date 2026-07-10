const crypto = require('node:crypto');

const TZ_OFFSET_MS = 8 * 60 * 60 * 1000;

function chinaDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(date.getTime() + TZ_OFFSET_MS).toISOString().slice(0, 10);
}

function normalizeSpace(value = '') {
  return String(value)
    .replace(/\u00a0/g, ' ')
    .replace(/[\t\r\n ]+/g, ' ')
    .trim();
}

function stripHtml(value = '') {
  return normalizeSpace(
    String(value)
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>|<\/tr>|<\/li>|<\/h\d>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
  );
}

function hashId(...parts) {
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 20);
}

function keywordExcerpt(text, keyword = '中药学', radius = 110) {
  const clean = normalizeSpace(text);
  const index = clean.indexOf(keyword);
  if (index < 0) return clean.slice(0, radius * 2);
  const start = Math.max(0, index - radius);
  const end = Math.min(clean.length, index + keyword.length + radius);
  return `${start > 0 ? '…' : ''}${clean.slice(start, end)}${end < clean.length ? '…' : ''}`;
}

function extractDate(text) {
  const value = normalizeSpace(text);
  const labels = /报名(?:时间|截止时间|截止日期)?|截止(?:时间|日期)?/g;
  const candidates = [];
  for (const label of value.matchAll(labels)) {
    const window = value.slice(label.index, label.index + 180).split(/[。；]/)[0];
    const fullDates = [...window.matchAll(/(20\d{2})[年\-/\.](\d{1,2})[月\-/\.](\d{1,2})日?/g)];
    const year = fullDates[0]?.[1] || String(new Date().getFullYear());
    for (const match of fullDates) {
      candidates.push(`${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`);
    }
    for (const match of window.matchAll(/(?<!\d)(\d{1,2})月(\d{1,2})日/g)) {
      candidates.push(`${year}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`);
    }
  }
  return candidates.sort().at(-1) || null;
}

function classifyMatch(text) {
  const clean = normalizeSpace(text);
  if (/中药学(?:专业|类|\s*\(?\d{4,6}\)?|[、，,。；;）)]|及|$)/.test(clean)) return 'strict';
  if (/(?:药学类|药学相关专业|药剂学)/.test(clean) && /中药|中药师/.test(clean)) return 'review';
  return null;
}

function classifyStatus(deadline, text = '') {
  const today = chinaDate();
  if (deadline) return deadline < today ? 'closed' : 'open';
  if (/报名已结束|停止报名|报名截止/.test(text) && !/报名截止(?:时间|日期)?[:：]?\s*20\d{2}/.test(text)) return 'closed';
  return 'unknown';
}

function summarize(text) {
  const clean = normalizeSpace(text);
  const around = keywordExcerpt(clean, '中药学', 90);
  const headcount = around.match(/(?:招聘|招录|选聘|中药师|药剂)[^。；，,]{0,15}?(\d+)\s*人/);
  const education = around.match(/(?:全日制)?(?:大学)?(?:专科|大专|本科|硕士研究生|研究生)(?:及以上)?(?:学历)?/);
  const role = around.match(/(?:中药师|中药士|药剂科[^，。；]{0,12}|药师|药剂[^，。；]{0,12})/);
  const pieces = [];
  if (role) pieces.push(`岗位：${role[0]}`);
  if (headcount) pieces.push(`人数：${headcount[1]}人`);
  if (education) pieces.push(`学历：${education[0]}`);
  pieces.push('专业：中药学');
  return pieces.join('；');
}

module.exports = {
  chinaDate,
  normalizeSpace,
  stripHtml,
  hashId,
  keywordExcerpt,
  extractDate,
  classifyMatch,
  classifyStatus,
  summarize
};
