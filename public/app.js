const state = { jobs: [], filter: 'all', updatedAt: null };
const labels = {
  open: ['可报名', 'status--open'],
  possible: ['可能在招', 'status--possible'],
  unknown: ['待确认', 'status--unknown'],
  closed: ['已截止', 'status--closed']
};
const sourceLabels = {
  official: '官方来源',
  'verified-repost': '经核验转载',
  'official-wechat': '官方公众号',
  'wechat-index': '公众号文章',
  'search-index': '招聘平台线索'
};

function expectedCloudUpdate(now = Date.now()) {
  const china = new Date(now + 8 * 60 * 60 * 1000);
  const year = china.getUTCFullYear();
  const month = china.getUTCMonth();
  const day = china.getUTCDate();
  const minutes = china.getUTCHours() * 60 + china.getUTCMinutes();
  let hour = 18;
  let minute = 30;
  let dayOffset = -1;
  if (minutes >= 18 * 60 + 30) {
    dayOffset = 0;
  } else if (minutes >= 12 * 60 + 30) {
    hour = 12;
    dayOffset = 0;
  } else if (minutes >= 6 * 60 + 30) {
    hour = 6;
    dayOffset = 0;
  }
  return Date.UTC(year, month, day + dayOffset, hour - 8, minute);
}

function renderFreshness(updatedAt) {
  const root = document.querySelector('#freshness');
  const updated = new Date(updatedAt).getTime();
  const expected = expectedCloudUpdate();
  const grace = 45 * 60 * 1000;
  const stale = Number.isFinite(updated) && Date.now() > expected + grace && updated < expected;
  root.hidden = !stale;
  root.textContent = stale ? '⚠ 云端更新延迟，系统将在下一次冗余任务自动重试' : '';
}

function formatDate(value) {
  if (!value) return '日期未知';
  const date = new Date(value.length === 10 ? `${value}T00:00:00+08:00` : value);
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(date);
}

function renderSummary() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
  const todayJobs = state.jobs.filter(job => job.firstSeenDate === today);
  const open = state.jobs.filter(job => ['open', 'possible'].includes(job.status)).length;
  const strict = state.jobs.filter(job => job.match === 'strict').length;
  document.querySelector('#summary').innerHTML = `
    <div><strong>${todayJobs.length}</strong><span>今日新增</span></div>
    <div><strong>${open}</strong><span>可能在招</span></div>
    <div><strong>${strict}</strong><span>明确匹配</span></div>`;
}

function renderJobs() {
  const container = document.querySelector('#jobs');
  const empty = document.querySelector('#empty');
  const template = document.querySelector('#jobTemplate');
  const statusOrder = { open: 0, possible: 0, unknown: 1, closed: 2 };
  const jobs = (state.filter === 'all' ? state.jobs : state.jobs.filter(job => state.filter === 'open' ? ['open', 'possible'].includes(job.status) : job.status === state.filter))
    .slice()
    .sort((a, b) => (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9) || String(b.publishedDate || '').localeCompare(String(a.publishedDate || '')));
  container.replaceChildren();
  document.querySelector('#count').textContent = `${jobs.length} 条`;
  empty.hidden = jobs.length > 0;
  for (const job of jobs) {
    const card = template.content.cloneNode(true);
    const status = card.querySelector('.status');
    status.textContent = labels[job.status]?.[0] || '待确认';
    status.classList.add(labels[job.status]?.[1] || 'status--unknown');
    card.querySelector('time').textContent = formatDate(job.publishedDate);
    card.querySelector('h3').textContent = job.title;
    card.querySelector('.source').textContent = `${job.employerCategory || '其他单位'} · ${job.source} · ${sourceLabels[job.sourceKind] || '公开来源'}`;
    card.querySelector('.summary-text').textContent = job.summary;
    card.querySelector('.evidence').textContent = `匹配依据：${job.evidence}`;
    card.querySelector('.deadline').textContent = job.statusNote || (job.deadline ? `截止 ${job.deadline}` : '截止时间待确认');
    card.querySelector('a').href = job.url;
    container.append(card);
  }
}

function renderSources(sources) {
  const root = document.querySelector('#sources');
  root.innerHTML = '<h3>本次检查</h3>' + sources.map(source =>
    `<p><i class="${source.ok ? 'ok' : 'bad'}"></i>${source.name}<span>${source.ok ? `匹配 ${source.matched} 条` : '暂时无法访问'}</span></p>`
  ).join('');
}

document.querySelector('.filters').addEventListener('click', event => {
  const button = event.target.closest('[data-filter]');
  if (!button) return;
  document.querySelectorAll('.filter').forEach(item => item.classList.remove('active'));
  button.classList.add('active');
  state.filter = button.dataset.filter;
  renderJobs();
});

fetch(`./data/jobs.json?v=${Date.now()}`, { cache: 'no-store' })
  .then(response => response.json())
  .then(data => {
    state.jobs = data.jobs || [];
    state.updatedAt = data.updatedAt;
    document.querySelector('#updated').textContent = data.updatedAt
      ? `最近更新 ${new Intl.DateTimeFormat('zh-CN', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(data.updatedAt))}`
      : '尚未执行首次抓取';
    if (data.updatedAt) renderFreshness(data.updatedAt);
    renderSummary();
    renderJobs();
    renderSources(data.sources || []);
  })
  .catch(() => {
    document.querySelector('#updated').textContent = '数据读取失败，请稍后重试';
    document.querySelector('#empty').hidden = false;
  });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
