const $ = id => document.getElementById(id);
const modes = {
  disabled: '模型服务未启用。当前可核对合成案例与独立星图。',
  controlled: '受控测试。模型响应来自测试替身。',
  live: '选择内置合成案例后，可请求在线模型生成待核验结果。',
};
const messages = {
  LOGIN_FAILED: '账号或密码错误。', LOGIN_LIMIT: '登录尝试过多，请稍后重试。',
  LOGIN_REQUIRED: '请登录后继续。', REVIEW_CLOSED: '评审服务已关闭。',
  RATE_LIMITED: '分析间隔未到或已有分析运行，请稍后重试。',
  BUDGET_EXHAUSTED: '本轮评审调用额度已用完。', LEDGER_UNAVAILABLE: '调用额度暂不可验证。',
  MODEL_DISABLED: '模型服务未启用。', ANALYSIS_FAILED: '分析响应不可用或未通过结构与来源核验。',
};
let cases = [];
let processing = false;
let view = 0;
function notice(message) { $('notice').textContent = message; }
async function request(path, body) {
  const res = await fetch(path, body === undefined ? {} : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw Error(data.error);
  return data;
}
function showError(error) { notice(messages[error.message] ?? '操作未完成，请稍后重试。'); }
function node(tag, text) {
  const el = document.createElement(tag);
  el.textContent = text;
  return el;
}
function showRecords() {
  $('result').hidden = true;
  $('findings').replaceChildren();
  const example = cases.find(c => c.id === $('case').value);
  $('records').replaceChildren(...example.records.map(record =>
    node('p', `${record.id} · ${record.source}　${record.text}`)));
}
async function showReview() {
  const data = await request('/api/cases');
  cases = data.cases;
  $('case').replaceChildren(...cases.map(c => new Option(c.title, c.id)));
  $('mode').textContent = modes[data.mode];
  $('analyze').disabled = data.mode === 'disabled';
  $('review-pane').hidden = false;
  $('login-pane').hidden = true;
  showRecords();
}
$('login').addEventListener('submit', async event => {
  event.preventDefault();
  if (processing) return;
  processing = true;
  const password = $('password').value;
  $('password').value = '';
  notice('正在登录…');
  try {
    await request('/api/login', { username: $('username').value, password });
    await showReview();
    notice('');
  } catch (error) { showError(error); }
  finally { processing = false; }
});
$('case').addEventListener('change', showRecords);
$('logout').addEventListener('click', async () => {
  try {
    await request('/api/logout', {});
    view++;
    $('review-pane').hidden = true;
    $('login-pane').hidden = false;
    $('findings').replaceChildren();
    notice('已退出登录。');
  } catch (error) { showError(error); }
});
$('analyze').addEventListener('click', async () => {
  const caseId = $('case').value;
  const currentView = view;
  $('analyze').disabled = true;
  $('case').disabled = true;
  $('result').hidden = true;
  $('findings').replaceChildren();
  notice('正在分析…');
  try {
    const { mode, model, result } = await request('/api/analyze', { caseId });
    if (currentView !== view) return;
    $('result-label').textContent = mode === 'live'
      ? `在线模型请求结果 · ${model} · 完全合成资料` : '受控测试替身结果 · 完全合成资料';
    for (const [key, label] of [['commitments','候选承诺'], ['risks','候选风险']]) {
      $('findings').append(node('h3', label));
      if (!result[key].length) $('findings').append(node('p', '本次响应未列出条目。'));
      for (const item of result[key]) {
        const article = node('article', '');
        article.append(node('strong', item.summary), ...item.evidence.map(r =>
          node('p', `${r.id} · ${r.source}　${r.text}`)));
        $('findings').append(article);
      }
    }
    $('result').hidden = false;
    notice('');
  } catch (error) {
    if (currentView === view) showError(error);
  } finally {
    $('analyze').disabled = false;
    $('case').disabled = false;
  }
});
showReview().catch(error => { if (error.message !== 'LOGIN_REQUIRED') showError(error); });
