const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const cheerio = require('cheerio');
const iconv = require('iconv-lite');
const XLSX = require('xlsx');
const {
  chinaDate,
  normalizeSpace,
  stripHtml,
  hashId,
  keywordExcerpt,
  extractDate,
  classifyMatch,
  classifyStatus,
  summarize
} = require('./common');

const ROOT = path.resolve(__dirname, '..');
const DATA_FILE = path.join(ROOT, 'data', 'jobs.json');
const PUBLIC_DATA_FILE = path.join(ROOT, 'public', 'data', 'jobs.json');
const execFileAsync = promisify(execFile);
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/137.0 Safari/537.36';

async function fetchResponse(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeout || 20000);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': USER_AGENT, accept: options.accept || '*/*', ...(options.headers || {}) }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

async function curlBuffer(url, accept = '*/*') {
  const executable = process.platform === 'win32' ? 'curl.exe' : 'curl';
  const { stdout } = await execFileAsync(executable, [
    '-k', '-sS', '-L', '--retry', '2', '--max-time', '30',
    '-A', USER_AGENT, '-H', `Accept: ${accept}`, url
  ], { encoding: 'buffer', maxBuffer: 30 * 1024 * 1024 });
  return Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
}

async function fetchBuffer(url, options = {}) {
  try {
    const response = await fetchResponse(url, options);
    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get('content-type') || ''
    };
  } catch (error) {
    console.warn(`  标准请求失败，使用兼容模式：${new URL(url).hostname} (${error.message})`);
    return { buffer: await curlBuffer(url, options.accept), contentType: '' };
  }
}

async function fetchText(url) {
  const { buffer, contentType } = await fetchBuffer(url, { accept: 'text/html,application/json' });
  const header = contentType;
  const head = buffer.subarray(0, 2048).toString('latin1');
  const charset = `${header} ${head}`.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1]?.toLowerCase();
  return /gb2312|gbk|gb18030/.test(charset || '') ? iconv.decode(buffer, 'gb18030') : buffer.toString('utf8');
}

async function fetchJson(url) {
  return JSON.parse(await fetchText(url));
}

function isOpeningNotice(title) {
  return /(招聘|选聘|招录|人才引进)/.test(title)
    && !/(成绩|体检|考察|资格复审|面试|笔试|拟聘|公示|录取|补录|通知单)/.test(title);
}

function isQinhuangdaoRelevantTitle(title) {
  return /(秦皇岛|海港区|开发区|山海关|北戴河|抚宁|昌黎|卢龙|青龙|河北港口集团|秦皇岛港口医院)/.test(title);
}

function employerCategory(text) {
  const value = normalizeSpace(text);
  if (/(制药|药业|药企|医药公司|医药集团|生物医药|中药饮片)/.test(value)) return '药企医药';
  if (/(药房|药店|大药房|医药连锁)/.test(value)) return '药店药房';
  if (/(疗养院|康养|养老院|养老服务|护理院)/.test(value)) return '疗养康养';
  if (/(医院|卫生院|妇幼保健|诊所|社区卫生服务|疾控中心|医疗集团)/.test(value)) return '医疗机构';
  if (/(政府|卫健委|卫生健康|人社局|事业单位|机关|检验中心|监督管理局|研究院)/.test(value)) return '政府事业单位';
  if (/(大学|学院|学校|职业技术|科研院所)/.test(value)) return '学校科研';
  return '其他单位';
}

function isSpecificRecruitmentResult(title) {
  return /(中药|药师|药剂|医院|卫生院|诊所|妇幼|公司|集团|制药|药业|药房|药店|疗养|康养|养老|事业单位|政府|学校|学院|研究院)/.test(title);
}

function dateInText(text) {
  const match = normalizeSpace(text).match(/(20\d{2})[年\-/\.](\d{1,2})[月\-/\.](\d{1,2})日?/);
  return match ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` : null;
}

function isPortHospital2026Job(job) {
  const text = `${job.title || ''} ${job.evidence || ''} ${job.source || ''}`;
  return /(河北港口集团|秦皇岛中西医结合医院|秦皇岛这家医院)/.test(text)
    && /2026/.test(`${job.publishedDate || ''} ${text}`)
    && /(中药学|药物分析|中药师)/.test(text);
}

function canonicalJobId(job, port2026Id) {
  if (isPortHospital2026Job(job)) return port2026Id;
  const text = `${job.title || ''} ${job.evidence || ''}`;
  if (job.title === '河北港口集团有限公司港口医院招聘中药学专业人员') {
    return hashId(job.title);
  }
  if (job.publishedDate && /(秦皇岛港口医院|河北港口集团有限公司港口医院)/.test(text) && /中药学/.test(text)) {
    return hashId(`秦皇岛港口医院-${job.publishedDate}-中药学招聘`);
  }
  return job.id;
}

async function attachmentText(html, baseUrl) {
  const $ = cheerio.load(html || '');
  const links = [];
  $('a[href]').each((_, element) => {
    const href = $(element).attr('href');
    if (/\.xlsx?(?:$|\?)/i.test(href || '')) links.push(new URL(href, baseUrl).href);
  });
  const texts = [];
  for (const url of links.slice(0, 4)) {
    try {
      const { buffer } = await fetchBuffer(url, { accept: 'application/vnd.ms-excel,*/*' });
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      for (const name of workbook.SheetNames) {
        texts.push(XLSX.utils.sheet_to_csv(workbook.Sheets[name]));
      }
    } catch (error) {
      console.warn(`  附件读取失败 ${url}: ${error.message}`);
    }
  }
  return texts.join('\n');
}

function buildJob({ title, source, url, publishedDate, body, firstSeenDate, sourceKind = 'official' }) {
  const match = classifyMatch(body);
  if (!match) return null;
  const deadline = extractDate(body);
  const titleKey = normalizeSpace(title).replace(/[\s【】\[\]（）()，,。·:：—_-]/g, '');
  const status = classifyStatus(deadline, body);
  const staleBefore = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
  return {
    id: hashId(titleKey),
    title: normalizeSpace(title),
    source,
    sourceKind,
    employerCategory: employerCategory(title) === '其他单位' ? employerCategory(body) : employerCategory(title),
    url,
    publishedDate: publishedDate || null,
    firstSeenDate: firstSeenDate || chinaDate(),
    deadline,
    status: status === 'unknown' && publishedDate && publishedDate < staleBefore ? 'closed' : status,
    match,
    summary: summarize(body),
    evidence: keywordExcerpt(body),
    fetchedAt: new Date().toISOString()
  };
}

async function crawlFirstHospital() {
  const source = '秦皇岛市第一医院';
  const base = 'https://www.qhdsdyyy.com';
  const list = await fetchJson(`${base}/articles?page=1&perPage=50&category_id=301668`);
  const notices = (list.articles || []).filter(item => isOpeningNotice(item.Title));
  const jobs = [];
  for (const item of notices) {
    const detail = await fetchJson(`${base}/articles/${item.Id}`);
    const current = detail.current || {};
    const attachment = await attachmentText(current.ContentDetail, base);
    const body = `${stripHtml(current.ContentDetail)}\n${attachment}`;
    const job = buildJob({
      title: item.Title,
      source,
      url: `${base}/detial?category_id=301668&articleId=${item.Id}`,
      publishedDate: chinaDate(item.CreatedDatetime),
      body
    });
    if (job) jobs.push(job);
  }
  return jobs;
}

async function crawlSecondHospital() {
  const source = '秦皇岛市第二医院';
  const base = 'https://www.qhddeyy.com';
  const jobs = [];
  for (let page = 1; page <= 3; page += 1) {
    const listUrl = `${base}/wap/Content/browse/cid/0713/${page > 1 ? `p/${page}` : ''}`;
    const html = await fetchText(listUrl);
    const $ = cheerio.load(html);
    const notices = [];
    $('.annou-list li').each((_, element) => {
      const anchor = $(element).find('a').first();
      const title = normalizeSpace(anchor.text());
      if (!isOpeningNotice(title)) return;
      notices.push({
        title,
        url: new URL(anchor.attr('href'), base).href,
        date: normalizeSpace($(element).find('span').first().text())
      });
    });
    for (const item of notices) {
      const detailHtml = await fetchText(item.url);
      const attachment = await attachmentText(detailHtml, base);
      const body = `${stripHtml(detailHtml)}\n${attachment}`;
      const job = buildJob({ title: item.title, source, url: item.url, publishedDate: item.date, body });
      if (job) jobs.push(job);
    }
  }
  return jobs;
}

async function crawlGenericOfficial(source, listUrl) {
  const html = await fetchText(listUrl);
  const $ = cheerio.load(html);
  const candidates = [];
  $('a[href]').each((_, element) => {
    const title = normalizeSpace($(element).text());
    const href = $(element).attr('href');
    if (title.length < 8 || !isOpeningNotice(title) || !href || /^(javascript:|#)/i.test(href)) return;
    try {
      const url = new URL(href, listUrl).href;
      const context = normalizeSpace($(element).closest('li, tr, div').text());
      candidates.push({ title, url, publishedDate: dateInText(context) });
    } catch {}
  });
  const unique = candidates.filter((item, index, all) => all.findIndex(other => other.url === item.url) === index).slice(0, 20);
  const jobs = [];
  for (const item of unique) {
    try {
      const detailHtml = await fetchText(item.url);
      const attachment = await attachmentText(detailHtml, item.url);
      const body = `${stripHtml(detailHtml)}\n${attachment}`;
      const job = buildJob({ title: item.title, source, url: item.url, publishedDate: item.publishedDate, body });
      if (job) jobs.push(job);
    } catch (error) {
      console.warn(`  详情读取失败 ${item.url}: ${error.message}`);
    }
  }
  return jobs;
}

async function crawlWechatSearch() {
  const queries = [
    '秦皇岛 中药学 招聘',
    '秦皇岛 中药师 招聘',
    '秦皇岛 中药调剂 招聘',
    '秦皇岛 药企 中药学 招聘',
    '秦皇岛 药房 中药师 招聘',
    '秦皇岛 疗养院 中药学 招聘',
    '秦皇岛 康养 中药学 招聘',
    '秦皇岛 事业单位 中药学 招聘',
    '秦皇岛 医疗卫生 中药学 招聘',
    '秦皇岛 海港区 开发区 北戴河新区 中药学 招聘',
    '山海关 抚宁 昌黎 卢龙 青龙 中药学 招聘'
  ];
  const browserHeaders = {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/137.0 Safari/537.36',
    'accept-language': 'zh-CN,zh;q=0.9'
  };
  const jobs = [];
  for (const query of queries) {
    const searchUrl = `https://weixin.sogou.com/weixin?type=2&query=${encodeURIComponent(query)}`;
    const response = await fetchResponse(searchUrl, { accept: 'text/html', headers: browserHeaders });
    const html = await response.text();
    const $ = cheerio.load(html);
    $('.news-list > li').each((_, element) => {
      const title = normalizeSpace($(element).find('.txt-box h3 a').text());
      const description = normalizeSpace($(element).find('.txt-info').text());
      const publisher = normalizeSpace($(element).find('.s-p .all-time-y2').text()) || '微信公众号';
      const combined = `${title} ${description}`;
      if (!isOpeningNotice(title) || !isSpecificRecruitmentResult(title) || !isQinhuangdaoRelevantTitle(title) || !combined.includes('中药学')) return;
      const timeHtml = $(element).find('.s-p .s2').html() || '';
      const timestamp = timeHtml.match(/timeConvert\(['"]?(\d{9,13})/);
      const publishedDate = timestamp ? chinaDate(new Date(Number(timestamp[1]) * 1000)) : null;
      const stableUrl = `https://weixin.sogou.com/weixin?type=2&query=${encodeURIComponent(title)}`;
      const job = buildJob({
        title,
        source: publisher,
        sourceKind: 'wechat-index',
        url: stableUrl,
        publishedDate,
        body: combined
      });
      if (job) jobs.push(job);
    });
  }
  return jobs;
}

async function crawlWebSearch() {
  const queries = [
    '秦皇岛 中药学 招聘 2026',
    '秦皇岛 中药师 招聘 2026',
    '秦皇岛 中药调剂 招聘 2026',
    '秦皇岛 药企 中药学 招聘',
    '秦皇岛 制药 中药学 招聘',
    '秦皇岛 药房 中药师 招聘',
    '秦皇岛 疗养院 中药学 招聘',
    '秦皇岛 康养 中药学 招聘',
    '秦皇岛 政府 事业单位 中药学 招聘',
    '秦皇岛 学校 中药学 招聘',
    '秦皇岛 海港区 开发区 北戴河新区 中药学 招聘',
    '山海关 抚宁 昌黎 卢龙 青龙 中药学 招聘'
  ];
  const browserHeaders = {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/137.0 Safari/537.36',
    'accept-language': 'zh-CN,zh;q=0.9'
  };
  const jobs = [];
  for (const query of queries) {
    const searchUrl = `https://www.sogou.com/web?ie=utf8&query=${encodeURIComponent(query)}`;
    const response = await fetchResponse(searchUrl, { accept: 'text/html', headers: browserHeaders });
    const html = await response.text();
    const $ = cheerio.load(html);
    $('.results .vrwrap').each((_, element) => {
      const titleAnchor = $(element).find('h3 a').first();
      const title = normalizeSpace(titleAnchor.text());
      const description = normalizeSpace($(element).find('.fz-mid, .str_info, [id*="summary"]').first().text());
      const combined = `${title} ${description}`;
      if (!isOpeningNotice(title) || !isSpecificRecruitmentResult(title) || !isQinhuangdaoRelevantTitle(title) || !combined.includes('中药学')) return;
      const cite = $(element).find('.citeLinkClass span');
      const publisher = normalizeSpace(cite.first().text()) || '公开网页搜索';
      const dateText = normalizeSpace(cite.last().text());
      const publishedDate = /^20\d{2}-\d{2}-\d{2}$/.test(dateText) ? dateText : dateInText(combined);
      const href = titleAnchor.attr('href') || '';
      const url = /^https?:\/\//.test(href)
        ? href
        : `https://www.sogou.com/web?ie=utf8&query=${encodeURIComponent(title)}`;
      const job = buildJob({ title, source: publisher, sourceKind: 'search-index', url, publishedDate, body: combined });
      if (job) {
        job.match = 'review';
        jobs.push(job);
      }
    });
  }
  return jobs;
}

function knownVerifiedJobs() {
  const jobs = [];
  const openBody = '药学部中药师2人。学历：硕士研究生及以上。专业：中药学、药物分析。2026年应届毕业生，年龄一般不超过30周岁。报名时间：2026年3月5日至招满为止。邮箱：gkyyzzk@163.com，电话：0335-3453062，地址：秦皇岛市海港区东港路33号医院行政楼人事科。';
  const openJob = buildJob({
    title: '河北港口集团秦皇岛中西医结合医院2026年招聘药学部中药师',
    source: '河北港口集团秦皇岛中西医结合医院',
    sourceKind: 'official-wechat',
    url: 'https://mp.weixin.qq.com/s/GeyasHSPz4QLiQm2_S4axw',
    publishedDate: '2026-03-05',
    firstSeenDate: '2026-03-05',
    body: openBody
  });
  if (openJob) {
    openJob.deadline = null;
    openJob.status = 'possible';
    openJob.statusNote = '招满为止，投递前请电话确认是否仍有名额';
    openJob.summary = '岗位：药学部中药师；人数：2人；学历：硕士研究生及以上；专业：中药学、药物分析；2026届';
    openJob.seeded = true;
    jobs.push(openJob);
  }

  const closedBody = '中药师1人，要求全日制大学本科及以上学历，中药学专业。报名时间：2026年4月21日-2026年4月27日。';
  const closedJob = buildJob({
    title: '秦皇岛市抚宁区人民医院2026年度院内聘用人员招聘信息',
    source: '秦皇岛市抚宁区人民医院',
    sourceKind: 'verified-repost',
    url: 'https://fenbi.com/page/fenxiaozhaokaodetail/16/0/465798290229248',
    publishedDate: '2026-04-21',
    firstSeenDate: '2026-04-21',
    body: closedBody
  });
  if (closedJob) {
    closedJob.seeded = true;
    jobs.push(closedJob);
  }

  const unifiedUrl = 'https://rsj.qhd.gov.cn/home/rNews/detail?code=cmpzTmV3cw%ce%b3%ce%b3&condition=cnNqTmV3c05vdGljZQ%ce%b3%ce%b3&id=1686';
  const unifiedJobs = [
    {
      title: '秦皇岛市2026年事业单位统一招聘—卢龙县乡镇卫生院药学（专技B）',
      source: '秦皇岛市人力资源和社会保障局',
      body: '卢龙县乡镇卫生院药学（专技B），岗位代码154006，招聘1人，专科及以上，专业包含（620302）中药学。报名截止日期：2026年2月13日。'
    },
    {
      title: '秦皇岛市2026年事业单位统一招聘—抚宁区乡镇卫生院药剂（专技）',
      source: '秦皇岛市人力资源和社会保障局',
      body: '抚宁区乡镇卫生院、社区卫生服务中心药剂（专技），岗位代码243006，招聘1人，专科及以上，专业包含（620302）中药学、（100801）中药学、（1008）中药学，具有药士及以上专业技术资格。报名截止日期：2026年2月13日。'
    }
  ];
  for (const item of unifiedJobs) {
    const job = buildJob({
      ...item,
      sourceKind: 'official',
      url: unifiedUrl,
      publishedDate: '2026-01-24',
      firstSeenDate: '2026-01-24'
    });
    if (job) {
      job.seeded = true;
      jobs.push(job);
    }
  }
  return jobs;
}

async function loadExisting() {
  try { return JSON.parse(await fs.readFile(DATA_FILE, 'utf8')); }
  catch { return { updatedAt: null, sources: [], jobs: [] }; }
}

async function main() {
  const existing = await loadExisting();
  const retainedJobs = (existing.jobs || []).filter(job => {
    if (['official', 'official-wechat', 'verified-repost'].includes(job.sourceKind)) return true;
    return isQinhuangdaoRelevantTitle(job.title) && isSpecificRecruitmentResult(job.title);
  });
  const portJobId = hashId('河北港口集团秦皇岛中西医结合医院-2026-中药师');
  const previous = new Map();
  for (const job of retainedJobs) {
    const id = canonicalJobId(job, portJobId);
    const candidate = { ...job, id };
    const current = previous.get(id);
    if (!current || (!current.publishedDate && candidate.publishedDate)) previous.set(id, candidate);
  }
  const sourceResults = [];
  const found = [];
  const crawlers = [
    ['秦皇岛市第一医院', crawlFirstHospital],
    ['秦皇岛市第二医院', crawlSecondHospital],
    ['秦皇岛市卫健委', () => crawlGenericOfficial('秦皇岛市卫生健康委员会', 'http://wjw.qhd.gov.cn/home/list?code=Nw%ce%b3%ce%b3&pcode=MQ%ce%b3%ce%b3')],
    ['秦皇岛市人社局', () => crawlGenericOfficial('秦皇岛市人力资源和社会保障局', 'https://rsj.qhd.gov.cn/home/rNews/list?code=cmpzTmV3cw%ce%b3%ce%b3&condition=cnNqTmV3c05vdGljZQ%ce%b3%ce%b3&currentPage=1')],
    ['秦皇岛市妇幼保健院', () => crawlGenericOfficial('秦皇岛市妇幼保健院', 'https://www.qhdfy.com.cn/article_cat.php?id=30')],
    ['秦皇岛市九龙山医院', () => crawlGenericOfficial('秦皇岛市九龙山医院', 'http://www.qhdsjlsyy.cn/list/114.html')],
    ['秦皇岛市工人医院', () => crawlGenericOfficial('秦皇岛市工人医院', 'http://www.qhdgryy.com/index_b33_t34.html')],
    ['微信公众号搜索', crawlWechatSearch],
    ['公开网页招聘平台搜索', crawlWebSearch]
  ];

  for (const [name, crawler] of crawlers) {
    process.stdout.write(`抓取 ${name}... `);
    try {
      const jobs = await crawler();
      found.push(...jobs);
      sourceResults.push({ name, ok: true, matched: jobs.length, checkedAt: new Date().toISOString() });
      console.log(`匹配 ${jobs.length} 条`);
    } catch (error) {
      sourceResults.push({ name, ok: false, error: error.message, checkedAt: new Date().toISOString() });
      console.log(`失败：${error.message}`);
    }
  }

  found.push(...knownVerifiedJobs());
  for (const job of found) {
    job.id = canonicalJobId(job, portJobId);
  }
  const sourceRank = { official: 4, 'official-wechat': 4, 'verified-repost': 3, 'wechat-index': 2, 'search-index': 1 };
  const merged = new Map(previous);
  for (const job of found) {
    const old = previous.get(job.id);
    const current = merged.get(job.id);
    const alternatives = [
      ...(current?.alternatives || []),
      ...(current && current.url !== job.url ? [{ source: current.source, url: current.url, sourceKind: current.sourceKind }] : []),
      ...(current && current.url === job.url ? [] : [{ source: job.source, url: job.url, sourceKind: job.sourceKind }])
    ].filter((item, index, all) => all.findIndex(other => other.url === item.url) === index);
    const jobRank = sourceRank[job.sourceKind] || 0;
    const currentRank = sourceRank[current?.sourceKind] || 0;
    const preferred = !current || jobRank > currentRank
      || (jobRank === currentRank && (!current.publishedDate || (job.publishedDate && job.publishedDate >= current.publishedDate)))
      ? job
      : current;
    merged.set(job.id, {
      ...old,
      ...preferred,
      firstSeenDate: job.seeded ? job.firstSeenDate : (old?.firstSeenDate || job.firstSeenDate),
      alternatives
    });
  }
  const jobs = [...merged.values()].sort((a, b) =>
    String(b.publishedDate || '').localeCompare(String(a.publishedDate || ''))
  );
  if (!existing.initializedAt) {
    for (const job of jobs) {
      if (job.publishedDate && job.publishedDate < chinaDate()) job.firstSeenDate = job.publishedDate;
    }
  }
  for (const job of jobs) delete job.seeded;
  const output = {
    initializedAt: existing.initializedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sources: sourceResults,
    jobs
  };
  const temp = `${DATA_FILE}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  await fs.rename(temp, DATA_FILE);
  await fs.mkdir(path.dirname(PUBLIC_DATA_FILE), { recursive: true });
  await fs.writeFile(PUBLIC_DATA_FILE, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(`完成：共保存 ${jobs.length} 条中药学匹配信息。`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
