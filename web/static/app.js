// 아주 가벼운 SPA: state → render(). 세 화면: list → prep → result.

const app = document.getElementById('app');
const state = {
  screen: 'list',          // 'list' | 'prep' | 'result' | 'friends'
  aramOnly: true,
  matches: [],             // from /api/matches
  selectedIds: new Set(),  // 선택한 gameId
  lastClickedId: null,     // shift+click 구간 선택용
  prep: [],                // [{gameId, team: [...], friendFlags: {puuid: bool}}]
  result: null,            // /api/settle 응답
  friends: [],             // 친구 풀 (friend management 화면용)
  prevScreen: 'list',      // 친구 화면에서 돌아갈 때
  error: null,
  loading: false,
};

async function api(path, opts = {}) {
  const resp = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`${resp.status}: ${text}`);
  }
  return resp.json();
}

function setState(patch) {
  Object.assign(state, patch);
  render();
}

function fmt(n) { return (n || 0).toLocaleString('ko-KR'); }

function dateLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ---------------- list screen ----------------

async function loadMatches() {
  setState({ loading: true, error: null });
  try {
    const { matches } = await api(`/api/matches?limit=50&aram_only=${state.aramOnly}`);
    setState({ matches, loading: false });
  } catch (e) {
    setState({ error: String(e.message), loading: false });
  }
}

function dmgBar(damage, maxDamage, rank, total) {
  const pct = maxDamage > 0 ? Math.max(2, (damage / maxDamage) * 100) : 0;
  const cls = rank === 1 ? 'first' : rank === total ? 'last' : '';
  return `
    <div class="dmg-cell">
      <div class="dmg-num">${fmt(damage)}</div>
      <div class="dmg-bar"><div class="dmg-fill ${cls}" style="width:${pct.toFixed(1)}%"></div></div>
    </div>
  `;
}

function renderList() {
  const selCount = state.selectedIds.size;
  const visibleCount = state.matches.length;
  const allSelected = visibleCount > 0 && state.matches.every((m) => state.selectedIds.has(m.gameId));
  const maxMyDmg = Math.max(...state.matches.map((m) => m.myDamage), 1);
  return `
    <div class="toolbar">
      <label class="toggle">
        <input type="checkbox" ${state.aramOnly ? 'checked' : ''} id="aram-toggle">
        칼바람만 보기
      </label>
      <span class="muted">최근 ${visibleCount}개</span>
      <button class="ghost" id="select-all">${allSelected ? '모두 해제' : '모두 선택'}</button>
      <button class="ghost" id="select-yesterday">어제</button>
      <button class="ghost" id="select-today">오늘</button>
      <span style="flex:1"></span>
      <button class="ghost" id="manage-friends">친구 관리</button>
      <button class="ghost" id="refresh">새로고침</button>
      <button id="next" ${selCount < 1 ? 'disabled' : ''}>선택한 ${selCount}판 정산 준비</button>
    </div>
    <div class="muted" style="margin: -8px 0 12px; font-size: 12px;">팁: Shift+클릭으로 구간 선택</div>
    <div class="match-list">
      ${state.matches.map((m) => renderMatchRow(m, maxMyDmg)).join('')}
    </div>
  `;
}

function isSameLocalDay(ts, ref) {
  const a = new Date(ts), b = new Date(ref);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function renderMatchRow(m, maxMyDmg) {
  const checked = state.selectedIds.has(m.gameId) ? 'checked' : '';
  const resultClass = m.win ? 'win' : 'lose';
  const resultText = m.win ? 'VICTORY' : 'DEFEAT';
  const queueLabel = m.isAram ? 'ARAM' : `Q${m.queueId}`;
  const icon = m.myChampion.icon
    ? `<img src="${m.myChampion.icon}" width="26" height="26" style="border:1px solid var(--gold-dim); vertical-align:middle;"> `
    : '';
  return `
    <label class="match ${m.isAram ? 'aram' : ''}">
      <input type="checkbox" data-game="${m.gameId}" ${checked}>
      <span class="time">${dateLabel(m.gameCreationISO)}</span>
      <span class="champ-label">${icon}${m.myChampion.name}</span>
      <span class="chip">${queueLabel}</span>
      <span class="${resultClass}">${resultText}</span>
      ${dmgBar(m.myDamage, maxMyDmg, 0, 0)}
    </label>
  `;
}

function bindList() {
  document.getElementById('aram-toggle')?.addEventListener('change', (e) => {
    state.aramOnly = e.target.checked;
    loadMatches();
  });
  document.getElementById('refresh')?.addEventListener('click', loadMatches);
  document.getElementById('next')?.addEventListener('click', goToPrep);
  document.getElementById('manage-friends')?.addEventListener('click', goToFriends);

  document.getElementById('select-all')?.addEventListener('click', () => {
    const allSelected = state.matches.every((m) => state.selectedIds.has(m.gameId));
    if (allSelected) state.selectedIds.clear();
    else state.matches.forEach((m) => state.selectedIds.add(m.gameId));
    render();
  });
  document.getElementById('select-today')?.addEventListener('click', () => {
    selectByDay(0);
  });
  document.getElementById('select-yesterday')?.addEventListener('click', () => {
    selectByDay(-1);
  });

  document.querySelectorAll('input[data-game]').forEach((el) => {
    el.addEventListener('click', (e) => {
      const id = Number(e.target.dataset.game);
      if (e.shiftKey && state.lastClickedId !== null) {
        const ids = state.matches.map((m) => m.gameId);
        const a = ids.indexOf(state.lastClickedId);
        const b = ids.indexOf(id);
        if (a !== -1 && b !== -1) {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          const targetState = e.target.checked;  // 현재 상태로 구간 전체 통일
          for (let i = lo; i <= hi; i++) {
            if (targetState) state.selectedIds.add(ids[i]);
            else state.selectedIds.delete(ids[i]);
          }
          render();
          return;
        }
      }
      if (e.target.checked) state.selectedIds.add(id);
      else state.selectedIds.delete(id);
      state.lastClickedId = id;
      document.getElementById('next').textContent = `선택한 ${state.selectedIds.size}판 정산 준비`;
      document.getElementById('next').disabled = state.selectedIds.size < 1;
    });
  });
}

function selectByDay(offsetDays) {
  const ref = new Date();
  ref.setDate(ref.getDate() + offsetDays);
  state.matches.forEach((m) => {
    if (isSameLocalDay(m.gameCreation, ref)) state.selectedIds.add(m.gameId);
  });
  render();
}

// ---------------- prep screen ----------------

async function goToPrep() {
  setState({ loading: true, error: null });
  try {
    const ids = [...state.selectedIds];
    const details = await Promise.all(ids.map((id) => api(`/api/match/${id}`)));
    const prep = details.map((d) => ({
      gameId: d.gameId,
      gameCreation: d.gameCreation,
      team: d.team,
      friendFlags: Object.fromEntries(d.team.map((t) => [t.puuid || t.gameName, t.isFriend])),
    }));
    setState({ prep, screen: 'prep', loading: false });
  } catch (e) {
    setState({ error: String(e.message), loading: false });
  }
}

function renderPrep() {
  return `
    <div class="toolbar">
      <button class="ghost" id="back-list">← 매치 다시 고르기</button>
      <span class="muted">매치별로 친구를 체크하세요 (나는 기본 포함)</span>
      <span style="flex:1"></span>
      <button id="settle">정산 실행</button>
    </div>
    ${state.prep.map(renderPrepMatch).join('')}
  `;
}

function renderPrepMatch(p, idx) {
  const friendCount = Object.values(p.friendFlags).filter(Boolean).length;
  const maxDmg = Math.max(...p.team.map((t) => t.damage), 1);
  return `
    <div class="section-title">Match ${String(idx + 1).padStart(2, '0')} <span class="kr">· ${dateLabel(new Date(p.gameCreation).toISOString())} · 친구 ${friendCount}명</span></div>
    <table class="team-table">
      <thead>
        <tr><th style="width:60px">친구</th><th>챔프</th><th>닉</th><th style="width:180px">딜량</th><th style="width:120px">풀에 추가</th></tr>
      </thead>
      <tbody>
        ${p.team.map((t, i) => renderTeamRow(p.gameId, t, i + 1, p.team.length, maxDmg)).join('')}
      </tbody>
    </table>
  `;
}

function renderTeamRow(gameId, t, rank, total, maxDmg) {
  const key = t.puuid || t.gameName;
  const checked = state.prep.find((p) => p.gameId === gameId).friendFlags[key];
  const champImg = t.champion.icon ? `<img src="${t.champion.icon}">` : '';
  return `
    <tr class="${t.isMe ? 'me' : ''}">
      <td><input type="checkbox" data-game="${gameId}" data-key="${key}" ${checked ? 'checked' : ''} ${t.isMe ? 'disabled' : ''}></td>
      <td><div class="champ">${champImg}<span class="champ-name">${t.champion.name}</span></div></td>
      <td>${t.gameName}${t.tagLine ? '#' + t.tagLine : ''}${t.isMe ? ' <span class="chip">나</span>' : ''}</td>
      <td>${dmgBar(t.damage, maxDmg, rank, total)}</td>
      <td>${t.isMe || t.isFriend ? '' : `<button class="ghost" data-add-friend data-name="${t.gameName}" data-tag="${t.tagLine}" data-puuid="${t.puuid}">+ 친구풀</button>`}</td>
    </tr>
  `;
}

function bindPrep() {
  document.getElementById('back-list')?.addEventListener('click', () => setState({ screen: 'list' }));
  document.getElementById('settle')?.addEventListener('click', runSettle);
  document.querySelectorAll('input[data-key]').forEach((el) => {
    el.addEventListener('change', (e) => {
      const gameId = Number(e.target.dataset.game);
      const key = e.target.dataset.key;
      const p = state.prep.find((x) => x.gameId === gameId);
      p.friendFlags[key] = e.target.checked;
      render();
    });
  });
  document.querySelectorAll('button[data-add-friend]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const { name, tag, puuid } = btn.dataset;
      try {
        await api('/api/friends', {
          method: 'POST',
          body: JSON.stringify({ gameName: name, tagLine: tag, puuid }),
        });
        // 현재 화면의 해당 행 친구 체크 on
        state.prep.forEach((p) => {
          const row = p.team.find((t) => (t.puuid || t.gameName) === (puuid || name));
          if (row) {
            row.isFriend = true;
            p.friendFlags[row.puuid || row.gameName] = true;
          }
        });
        render();
      } catch (e) {
        setState({ error: String(e.message) });
      }
    });
  });
}

async function runSettle() {
  setState({ loading: true, error: null });
  try {
    const payload = {
      matches: state.prep.map((p) => ({
        gameId: p.gameId,
        friends: p.team
          .filter((t) => p.friendFlags[t.puuid || t.gameName])
          .map((t) => ({
            puuid: t.puuid,
            gameName: t.gameName,
            tagLine: t.tagLine,
            displayName: t.gameName || '(이름없음)',
            championId: t.championId,
            damage: t.damage,
          })),
      })),
    };
    const result = await api('/api/settle', { method: 'POST', body: JSON.stringify(payload) });
    setState({ result, screen: 'result', loading: false });
  } catch (e) {
    setState({ error: String(e.message), loading: false });
  }
}

// ---------------- result screen ----------------

function renderResult() {
  const r = state.result;
  return `
    <div class="toolbar">
      <button class="ghost" id="back-prep">← 친구 다시 체크</button>
      <button class="ghost" id="back-list2">처음으로</button>
      <span style="flex:1"></span>
      <button id="copy">요약 복사</button>
    </div>
    ${r.matches.map((m, i) => renderResultMatch(m, i)).join('')}
    <div class="section-title">Final Settlement <span class="kr">· 세션 최종 정산 (보낼 사람 기준)</span></div>
    <div class="result-card">
      ${r.net.length === 0
        ? '<div class="big-zero">0원<small>정산할 친구 쌍이 없어요</small></div>'
        : renderNetGrouped(r.net)
      }
    </div>
    <div class="section-title">Personal Balance <span class="kr">· 친구별 순손익</span></div>
    <div class="result-card">
      ${(r.perFriend || []).map((f) => {
        const cls = f.net > 0 ? 'balance-pos' : f.net < 0 ? 'balance-neg' : 'balance-zero';
        const sign = f.net > 0 ? '+' : '';
        const label = f.net > 0 ? ' 받음' : f.net < 0 ? ' 보냄' : '';
        return `
          <div class="balance-row">
            <span>${f.name}</span>
            <span class="${cls}">${sign}${fmt(f.net)}원${label}</span>
          </div>
        `;
      }).join('')}
    </div>
    <div class="section-title">Bottom Tally <span class="kr">· 꼴등 누적</span></div>
    <div class="result-card">
      ${r.losers.map((l) => `
        <div class="net-row" style="grid-template-columns: 1fr 120px 120px">
          <span>${l.name}</span>
          <span>꼴등 ${l.bottomCount}회</span>
          <span>돈낸 ${l.totalPayCount}회</span>
        </div>
      `).join('')}
    </div>
    <div class="section-title">Plain Summary <span class="kr">· 복붙용 요약</span></div>
    <pre class="summary" id="summary">${escapeHtml(r.summary)}</pre>
  `;
}

function renderResultMatch(m, idx) {
  if (m.skip) {
    return `<div class="result-card"><div class="section-title" style="margin-top:0">Match ${String(idx + 1).padStart(2, '0')}</div><div class="muted">${m.skip}</div></div>`;
  }
  const n = m.ranked.length;
  const maxDmg = Math.max(...m.ranked.map((r) => r.damage), 1);
  return `
    <div class="result-card">
      <div class="section-title" style="margin-top:0">Match ${String(idx + 1).padStart(2, '0')} <span class="kr">· 친구 ${n}명</span></div>
      ${m.ranked.map((r) => `
        <div class="rank-row">
          <span class="rank-num ${r.rank === 1 ? 'r1' : ''} ${r.rank === n ? 'last' : ''}">${r.rank}등</span>
          <span>${r.champion.icon ? `<img src="${r.champion.icon}" width="22" height="22" style="border:1px solid var(--gold-dim)">` : ''}</span>
          <span class="champ-name">${r.displayName}</span>
          ${dmgBar(r.damage, maxDmg, r.rank, n)}
        </div>
      `).join('')}
      <div style="margin-top:10px">
        ${m.transfers.map((t) => `<div class="transfer">→ ${t.payer} → ${t.payee}: ${fmt(t.amount)}원 <span class="muted">(${t.reason})</span></div>`).join('')}
      </div>
    </div>
  `;
}

function renderNetGrouped(net) {
  // payer 기준 그룹핑. 그룹 내 amount 내림차순 (0원은 맨 뒤).
  // 각 그룹의 표시 순서는 그룹 총액 내림차순 (가장 많이 보내는 사람이 먼저).
  const groups = new Map();
  for (const n of net) {
    if (!groups.has(n.payer)) groups.set(n.payer, []);
    groups.get(n.payer).push(n);
  }
  const sortedGroups = [...groups.entries()]
    .map(([payer, rows]) => {
      rows.sort((a, b) => (a.amount === 0) - (b.amount === 0) || b.amount - a.amount);
      const total = rows.reduce((s, r) => s + r.amount, 0);
      return { payer, rows, total };
    })
    .sort((a, b) => b.total - a.total || a.payer.localeCompare(b.payer));

  return sortedGroups.map((g) => `
    <div class="net-group">
      <div class="net-group-head">
        <span>${g.payer} <span class="net-group-sub">→</span></span>
        <span class="net-group-sub">총 ${fmt(g.total)}원</span>
      </div>
      ${g.rows.map((n) => `
        <div class="net-row in-group ${n.amount === 0 ? 'zero' : ''}">
          <span>→</span>
          <span>${n.payee}</span>
          <span class="amount">${fmt(n.amount)}원</span>
        </div>
      `).join('')}
    </div>
  `).join('');
}

// ---------------- friends screen ----------------

async function goToFriends() {
  setState({ loading: true, error: null, prevScreen: state.screen });
  try {
    const { friends } = await api('/api/friends');
    setState({ friends, screen: 'friends', loading: false });
  } catch (e) {
    setState({ error: String(e.message), loading: false });
  }
}

function renderFriends() {
  return `
    <div class="toolbar">
      <button class="ghost" id="friends-back">← 돌아가기</button>
      <span class="muted">친구 풀 (${state.friends.length}명)</span>
    </div>
    <div class="result-card" style="padding: 0;">
      ${state.friends.length === 0
        ? '<div class="muted" style="padding: 20px; text-align: center;">아직 등록된 친구가 없어요. 매치 정산 화면에서 "+ 친구풀" 버튼으로 추가하거나 아래에서 직접 추가하세요.</div>'
        : `
          <div class="friend-row head">
            <span>닉네임</span><span>태그</span><span>puuid</span><span></span>
          </div>
          ${state.friends.map(renderFriendRow).join('')}
        `
      }
    </div>
    <div class="section-title">Manual Add <span class="kr">· 직접 추가</span></div>
    <div class="result-card">
      <div class="add-friend-form">
        <input id="new-name" placeholder="게임 닉 (예: 미르)" />
        <input id="new-tag" placeholder="태그 (예: KR1)" />
        <button id="new-add">추가</button>
      </div>
      <div class="muted" style="padding: 0 12px 12px; font-size: 12px;">
        puuid는 없어도 등록 가능. 매치에서 처음 매칭될 때 자동으로 채워짐.
      </div>
    </div>
  `;
}

function renderFriendRow(f) {
  const tag = f.tagLine || '<span class="muted">(없음)</span>';
  const puuid = f.puuid ? `<code>${f.puuid.slice(0, 8)}…</code>` : '<span class="muted">미수집</span>';
  return `
    <div class="friend-row">
      <span class="name-kr">${escapeHtml(f.gameName)}</span>
      <span>${tag}</span>
      <span>${puuid}</span>
      <span><button class="danger" data-del-name="${escapeHtml(f.gameName)}" data-del-tag="${escapeHtml(f.tagLine)}" data-del-puuid="${escapeHtml(f.puuid)}">삭제</button></span>
    </div>
  `;
}

function bindFriends() {
  document.getElementById('friends-back')?.addEventListener('click', () => {
    setState({ screen: state.prevScreen || 'list' });
  });
  document.getElementById('new-add')?.addEventListener('click', async () => {
    const name = document.getElementById('new-name').value.trim();
    const tag = document.getElementById('new-tag').value.trim();
    if (!name) {
      setState({ error: '닉네임을 입력하세요.' });
      return;
    }
    try {
      const { friends } = await api('/api/friends', {
        method: 'POST',
        body: JSON.stringify({ gameName: name, tagLine: tag }),
      });
      setState({ friends, error: null });
    } catch (e) {
      setState({ error: String(e.message) });
    }
  });
  document.querySelectorAll('button[data-del-name]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm(`${btn.dataset.delName} 친구 풀에서 삭제할까요?`)) return;
      try {
        const { friends } = await api('/api/friends/delete', {
          method: 'POST',
          body: JSON.stringify({
            gameName: btn.dataset.delName,
            tagLine: btn.dataset.delTag,
            puuid: btn.dataset.delPuuid,
          }),
        });
        setState({ friends, error: null });
      } catch (e) {
        setState({ error: String(e.message) });
      }
    });
  });
}

function bindResult() {
  document.getElementById('back-prep')?.addEventListener('click', () => setState({ screen: 'prep' }));
  document.getElementById('back-list2')?.addEventListener('click', () => setState({ screen: 'list', result: null, prep: [], selectedIds: new Set() }));
  document.getElementById('copy')?.addEventListener('click', async () => {
    await navigator.clipboard.writeText(state.result.summary);
    const btn = document.getElementById('copy');
    const prev = btn.textContent;
    btn.textContent = '복사됨';
    setTimeout(() => (btn.textContent = prev), 1200);
  });
}

// ---------------- render ----------------

function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function render() {
  let body = '';
  if (state.loading) body = '<div class="muted">불러오는 중…</div>';
  else if (state.error) body = `<div class="error">${escapeHtml(state.error)}</div>`;

  if (state.screen === 'list') body = body + renderList();
  else if (state.screen === 'prep') body = body + renderPrep();
  else if (state.screen === 'result') body = body + renderResult();
  else if (state.screen === 'friends') body = body + renderFriends();

  app.innerHTML = body;

  if (state.screen === 'list') bindList();
  else if (state.screen === 'prep') bindPrep();
  else if (state.screen === 'result') bindResult();
  else if (state.screen === 'friends') bindFriends();
}

loadMatches();
