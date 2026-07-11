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

function chinaDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(date);
}

function isTodayJob(job) {
  return job.firstSeenDate === chinaDateKey();
}

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
  const todayJobs = state.jobs.filter(isTodayJob);
  const open = state.jobs.filter(job => ['open', 'possible'].includes(job.status)).length;
  const strict = state.jobs.filter(job => job.match === 'strict').length;
  const summary = document.querySelector('#summary');
  summary.innerHTML = `
    <button class="summary-card summary-card--action" type="button" data-summary="today" ${todayJobs.length ? '' : 'disabled'} aria-label="查看今日新增的招聘信息">
      <strong>${todayJobs.length}</strong><span>今日新增</span><small>${todayJobs.length ? '点击查看 ↓' : '暂无新增'}</small>
    </button>
    <div class="summary-card"><strong>${open}</strong><span>可能在招</span></div>
    <div class="summary-card"><strong>${strict}</strong><span>明确匹配</span></div>`;
}

function filteredJobs() {
  if (state.filter === 'today') return state.jobs.filter(isTodayJob);
  if (state.filter === 'all') return state.jobs;
  if (state.filter === 'open') return state.jobs.filter(job => ['open', 'possible'].includes(job.status));
  return state.jobs.filter(job => job.status === state.filter);
}

function renderJobs({ focusFirst = false } = {}) {
  const container = document.querySelector('#jobs');
  const empty = document.querySelector('#empty');
  const template = document.querySelector('#jobTemplate');
  const statusOrder = { open: 0, possible: 0, unknown: 1, closed: 2 };
  const jobs = filteredJobs()
    .slice()
    .sort((a, b) => {
      if (state.filter === 'today') {
        return String(b.firstSeenDate || '').localeCompare(String(a.firstSeenDate || ''))
          || String(b.publishedDate || '').localeCompare(String(a.publishedDate || ''));
      }
      return (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9)
        || String(b.publishedDate || '').localeCompare(String(a.publishedDate || ''));
    });

  document.querySelector('#listTitle').textContent = state.filter === 'today' ? '今日新增' : '最新匹配';
  document.querySelector('#count').textContent = `${jobs.length} 条`;
  container.replaceChildren();
  empty.hidden = jobs.length > 0;

  for (const job of jobs) {
    const card = template.content.cloneNode(true);
    const article = card.querySelector('.job-card');
    if (isTodayJob(job)) article.classList.add('job-card--today');
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

  if (focusFirst && jobs.length) {
    requestAnimationFrame(() => {
      const first = container.querySelector('.job-card');
      first.classList.add('job-card--focused');
      first.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(() => first.classList.remove('job-card--focused'), 1800);
    });
  }
}

function renderSources(sources) {
  const root = document.querySelector('#sources');
  root.replaceChildren();
  const title = document.createElement('h3');
  title.textContent = '本次检查';
  root.append(title);
  for (const source of sources) {
    const row = document.createElement('p');
    const dot = document.createElement('i');
    const result = document.createElement('span');
    dot.className = source.ok ? 'ok' : 'bad';
    row.append(dot, document.createTextNode(source.name));
    result.textContent = source.ok ? `匹配 ${source.matched} 条` : '暂时无法访问';
    row.append(result);
    root.append(row);
  }
}

document.querySelector('.filters').addEventListener('click', event => {
  const button = event.target.closest('[data-filter]');
  if (!button) return;
  document.querySelectorAll('.filter').forEach(item => item.classList.remove('active'));
  button.classList.add('active');
  state.filter = button.dataset.filter;
  renderJobs();
});

document.querySelector('#summary').addEventListener('click', event => {
  const button = event.target.closest('[data-summary="today"]');
  if (!button || button.disabled) return;
  document.querySelectorAll('.filter').forEach(item => item.classList.remove('active'));
  state.filter = 'today';
  renderJobs({ focusFirst: true });
});

async function loadData() {
  const refresh = document.querySelector('#refresh');
  refresh.disabled = true;
  refresh.textContent = '刷新中…';
  try {
    const response = await fetch(`./data/jobs.json?v=${Date.now()}`, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    state.jobs = data.jobs || [];
    state.updatedAt = data.updatedAt;
    document.querySelector('#updated').textContent = data.updatedAt
      ? `最近更新 ${new Intl.DateTimeFormat('zh-CN', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(data.updatedAt))}`
      : '尚未执行首次抓取';
    if (data.updatedAt) renderFreshness(data.updatedAt);
    renderSummary();
    renderJobs();
    renderSources(data.sources || []);
  } catch (error) {
    document.querySelector('#updated').textContent = '数据读取失败，请检查网络后重试';
    document.querySelector('#empty').hidden = false;
  } finally {
    refresh.disabled = false;
    refresh.textContent = '立即刷新';
  }
}

document.querySelector('#refresh').addEventListener('click', loadData);
loadData();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js?v=4', { updateViaCache: 'none' })
    .then(registration => registration.update())
    .catch(() => {});
}
