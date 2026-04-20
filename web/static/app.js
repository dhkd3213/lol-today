// 아주 가벼운 SPA: state → render(). 화면: list | prep | result | friends | rules | history.

const DEFAULT_RULES = {
  3: [{ loserRank: 3, winnerRank: 1, amount: 3000 }],
  4: [{ loserRank: 4, winnerRank: 1, amount: 3000 }, { loserRank: 3, winnerRank: 2, amount: 1000 }],
  5: [{ loserRank: 5, winnerRank: 1, amount: 3000 }, { loserRank: 4, winnerRank: 2, amount: 1000 }],
};

function loadRules() {
  try {
    const raw = localStorage.getItem('lol-today.rules');
    if (!raw) return structuredClone(DEFAULT_RULES);
    const parsed = JSON.parse(raw);
    // 최소 validation
    for (const n of [3, 4, 5]) if (!Array.isArray(parsed[n])) return structuredClone(DEFAULT_RULES);
    return parsed;
  } catch (_) { return structuredClone(DEFAULT_RULES); }
}

function saveRules(rules) {
  localStorage.setItem('lol-today.rules', JSON.stringify(rules));
}

function flattenRules(rules) {
  const out = [];
  for (const count of [3, 4, 5]) {
    for (const r of rules[count] || []) out.push({ count, loserRank: r.loserRank, winnerRank: r.winnerRank, amount: Number(r.amount) || 0 });
  }
  return out;
}

const app = document.getElementById('app');
const state = {
  screen: 'list',          // 'list' | 'prep' | 'result' | 'friends' | 'rules' | 'history'
  aramOnly: true,
  rules: loadRules(),      // 정산 금액 커스터마이징
  history: [],             // 저장된 정산 세션 목록
  matches: [],             // from /api/matches
  selectedIds: new Set(),  // 선택한 gameId
  lastClickedId: null,     // shift+click 구간 선택용
  prep: [],                // [{gameId, team: [...], friendFlags: {puuid: bool}}]
  result: null,            // /api/settle 응답
  friends: [],             // 친구 풀 (friend management 화면용)
  prevScreen: 'list',      // 친구 화면에서 돌아갈 때
  lcuImport: null,         // null | { candidates: [...], picked: Set<string> }
  gamePhase: null,         // 'None' | 'Lobby' | 'InProgress' | 'EndOfGame' ...
  lastPhase: null,         // 직전 페이즈 — EndOfGame 전환 감지용
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
    setState({ matches, loading: false, clientDown: false });
  } catch (e) {
    const msg = String(e.message);
    const down = msg.includes('503') || msg.includes('꺼져') || msg.includes('lockfile');
    setState({ error: down ? null : msg, clientDown: down, loading: false, matches: [] });
  }
}

function renderClientDown() {
  return `
    <div class="empty-state">
      <div class="icon">⚔</div>
      <h3>LEAGUE CLIENT OFFLINE</h3>
      <p>롤 클라이언트가 감지되지 않아요.<br>클라이언트를 켜면 자동으로 매치가 뜹니다.</p>
      <ol class="steps">
        <li>League of Legends 클라이언트를 실행하세요.</li>
        <li>로그인까지 완료되면 우측 상단 게임 상태 배지가 뜹니다.</li>
        <li>아래 "다시 확인" 버튼을 누르거나 10초 정도 기다리면 자동으로 연결돼요.</li>
      </ol>
      <div style="margin-top: 28px;">
        <button id="retry-connect">다시 확인</button>
      </div>
    </div>
  `;
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
      ${renderLiveBadge()}
      <button class="ghost" id="open-rules">룰 설정</button>
      <button class="ghost" id="open-history">정산 기록</button>
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

function renderLiveBadge() {
  const phase = state.gamePhase;
  if (!phase || phase === 'None' || phase === 'Lobby') return '';
  let cls = '', label = phase;
  if (phase === 'InProgress') { cls = 'ingame'; label = '인게임'; }
  else if (phase === 'EndOfGame' || phase === 'WaitingForStats' || phase === 'PreEndOfGame') { cls = 'ready'; label = '게임 종료'; }
  else if (phase === 'ChampSelect') { cls = 'ingame'; label = '챔프 선택'; }
  else return '';
  return `<span class="live-badge"><span class="live-dot ${cls}"></span>${label}</span>`;
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
  document.getElementById('open-rules')?.addEventListener('click', () => setState({ screen: 'rules', prevScreen: 'list' }));
  document.getElementById('open-history')?.addEventListener('click', goToHistory);

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
      rules: flattenRules(state.rules),
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
    <div class="section-title hero">Final Settlement <span class="kr">· 세션 최종 정산</span></div>
    <div class="result-card final">
      ${r.net.length === 0
        ? '<div class="big-zero">0원<small>정산할 친구 쌍이 없어요</small></div>'
        : renderNetGrouped(r.net)
      }
      <div class="final-corners" aria-hidden="true"></div>
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
    <div class="section-title">Per-match Breakdown <span class="kr">· 매치별 상세</span></div>
    ${r.matches.map((m, i) => renderResultMatch(m, i)).join('')}
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
      <span style="flex:1"></span>
      <button id="import-lcu">롤 친구에서 가져오기</button>
    </div>
    ${renderImportModal()}
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

function renderImportModal() {
  if (!state.lcuImport) return '';
  const { candidates, picked } = state.lcuImport;
  const available = candidates.filter((c) => !c.alreadyAdded);
  const added = candidates.filter((c) => c.alreadyAdded);
  const canSubmit = picked.size > 0;
  const row = (c) => {
    const isPicked = picked.has(c.key);
    const disabled = c.alreadyAdded ? 'disabled' : '';
    return `
      <div class="lcu-friend-row ${disabled}" data-lcu-key="${escapeHtml(c.key)}">
        <input type="checkbox" ${isPicked ? 'checked' : ''} ${c.alreadyAdded ? 'disabled' : ''}>
        <div>
          <span class="name">${escapeHtml(c.gameName)}</span>
          <span class="tag">${c.tagLine ? '#' + escapeHtml(c.tagLine) : ''}</span>
        </div>
        <span class="status">${c.alreadyAdded ? '이미 추가됨' : (c.availability || '')}</span>
      </div>
    `;
  };
  return `
    <div class="modal-backdrop" id="import-backdrop">
      <div class="modal" onclick="event.stopPropagation()">
        <div class="modal-head">
          <h3>롤 클라이언트 친구</h3>
          <span class="muted" style="font-size: 12px;">${available.length}명 신규 · ${added.length}명 이미 추가됨</span>
        </div>
        <div class="modal-body">
          ${candidates.length === 0
            ? '<div class="muted" style="padding: 28px; text-align:center;">롤 친구 목록이 비어있거나 불러올 수 없습니다.</div>'
            : available.map(row).join('') + added.map(row).join('')
          }
        </div>
        <div class="modal-foot">
          <button class="ghost" id="import-cancel">취소</button>
          <button id="import-submit" ${canSubmit ? '' : 'disabled'}>${picked.size}명 추가</button>
        </div>
      </div>
    </div>
  `;
}

async function openImportModal() {
  setState({ loading: true, error: null });
  try {
    const { candidates } = await api('/api/friends/lcu');
    setState({ lcuImport: { candidates, picked: new Set() }, loading: false });
  } catch (e) {
    setState({ error: String(e.message), loading: false });
  }
}

function bindImportModal() {
  if (!state.lcuImport) return;
  document.getElementById('import-backdrop')?.addEventListener('click', (e) => {
    if (e.target.id === 'import-backdrop') setState({ lcuImport: null });
  });
  document.getElementById('import-cancel')?.addEventListener('click', () => {
    setState({ lcuImport: null });
  });
  document.querySelectorAll('[data-lcu-key]').forEach((row) => {
    row.addEventListener('click', (e) => {
      const key = row.dataset.lcuKey;
      const cand = state.lcuImport.candidates.find((c) => c.key === key);
      if (!cand || cand.alreadyAdded) return;
      const picked = new Set(state.lcuImport.picked);
      if (picked.has(key)) picked.delete(key);
      else picked.add(key);
      setState({ lcuImport: { ...state.lcuImport, picked } });
    });
  });
  document.getElementById('import-submit')?.addEventListener('click', async () => {
    const { candidates, picked } = state.lcuImport;
    const toAdd = candidates
      .filter((c) => picked.has(c.key) && !c.alreadyAdded)
      .map((c) => ({ puuid: c.puuid, gameName: c.gameName, tagLine: c.tagLine }));
    try {
      await api('/api/friends/import', {
        method: 'POST',
        body: JSON.stringify({ friends: toAdd }),
      });
      const { friends } = await api('/api/friends');
      setState({ friends, lcuImport: null, error: null });
    } catch (e) {
      setState({ error: String(e.message) });
    }
  });
}

function bindFriends() {
  document.getElementById('friends-back')?.addEventListener('click', () => {
    setState({ screen: state.prevScreen || 'list' });
  });
  document.getElementById('import-lcu')?.addEventListener('click', openImportModal);
  bindImportModal();
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

  if (state.screen === 'list' && state.clientDown) body = renderClientDown();
  else if (state.screen === 'list') body = body + renderList();
  else if (state.screen === 'prep') body = body + renderPrep();
  else if (state.screen === 'result') body = body + renderResult();
  else if (state.screen === 'friends') body = body + renderFriends();
  else if (state.screen === 'rules') body = body + renderRules();
  else if (state.screen === 'history') body = body + renderHistory();

  app.innerHTML = body;

  if (state.screen === 'list' && state.clientDown) document.getElementById('retry-connect')?.addEventListener('click', loadMatches);
  else if (state.screen === 'list') bindList();
  else if (state.screen === 'prep') bindPrep();
  else if (state.screen === 'result') bindResult();
  else if (state.screen === 'friends') bindFriends();
  else if (state.screen === 'rules') bindRules();
  else if (state.screen === 'history') bindHistory();
}

// ---------------- rules screen ----------------

function renderRules() {
  const card = (count) => {
    const rows = state.rules[count] || [];
    return `
      <div class="rule-card">
        <h4>${count}인 룰</h4>
        ${rows.map((r, i) => `
          <div class="rule-row">
            <span>${r.loserRank}등 → ${r.winnerRank}등</span>
            <input type="number" min="0" step="500" data-count="${count}" data-idx="${i}" value="${r.amount}"> 원
          </div>
        `).join('')}
      </div>
    `;
  };
  return `
    <div class="toolbar">
      <button class="ghost" id="rules-back">← 돌아가기</button>
      <span class="muted">정산 금액 설정</span>
      <span style="flex:1"></span>
      <button class="ghost" id="rules-reset">기본값으로</button>
    </div>
    <div class="result-card" style="padding: 0;">
      <div class="rules-grid">
        ${card(3)}
        ${card(4)}
        ${card(5)}
      </div>
      <div class="muted" style="padding: 0 18px 16px; font-size: 12px;">
        값은 자동 저장됨. 이 브라우저에만 저장되니 친구한테 앱 전달 시 각자 본인 룰로 쓸 수 있음.
      </div>
    </div>
  `;
}

function bindRules() {
  document.getElementById('rules-back')?.addEventListener('click', () => setState({ screen: state.prevScreen || 'list' }));
  document.getElementById('rules-reset')?.addEventListener('click', () => {
    if (!confirm('기본값(3000/1000원)으로 되돌릴까요?')) return;
    const fresh = structuredClone(DEFAULT_RULES);
    saveRules(fresh);
    setState({ rules: fresh });
  });
  document.querySelectorAll('input[data-count]').forEach((inp) => {
    inp.addEventListener('change', () => {
      const count = Number(inp.dataset.count);
      const idx = Number(inp.dataset.idx);
      const v = Math.max(0, parseInt(inp.value, 10) || 0);
      const rules = structuredClone(state.rules);
      rules[count][idx].amount = v;
      saveRules(rules);
      setState({ rules });
    });
  });
}

// ---------------- history screen ----------------

async function goToHistory() {
  setState({ loading: true, error: null, prevScreen: state.screen });
  try {
    const { sessions } = await api('/api/history');
    setState({ history: sessions, screen: 'history', loading: false });
  } catch (e) {
    setState({ error: String(e.message), loading: false });
  }
}

function renderHistory() {
  return `
    <div class="toolbar">
      <button class="ghost" id="history-back">← 돌아가기</button>
      <span class="muted">정산 기록 (${state.history.length}건)</span>
    </div>
    <div class="result-card" style="padding: 0;">
      ${state.history.length === 0
        ? '<div class="muted" style="padding: 48px; text-align:center;">아직 저장된 정산 기록이 없어요. 정산을 한 번 실행하면 여기에 자동 저장됩니다.</div>'
        : state.history.map(renderHistoryRow).join('')
      }
    </div>
  `;
}

function renderHistoryRow(s) {
  const when = s.savedAt ? s.savedAt.replace('T', ' ').slice(0, 16) : '';
  const topPayer = (s.perFriend || []).filter((f) => f.net < 0).sort((a, b) => a.net - b.net)[0];
  const tag = topPayer ? `· ${escapeHtml(topPayer.name)}가 ${fmt(-topPayer.net)}원 지출` : '';
  return `
    <div class="history-row" data-history-id="${escapeHtml(s.id)}">
      <div>
        <div class="label">${escapeHtml(s.label || '정산')}</div>
        <div class="meta">${when} ${tag}</div>
      </div>
      <div class="count">${s.matchCount}판</div>
      <div class="count">${s.friendCount}명</div>
      <button class="danger" data-del-history="${escapeHtml(s.id)}">삭제</button>
    </div>
  `;
}

function bindHistory() {
  document.getElementById('history-back')?.addEventListener('click', () => setState({ screen: state.prevScreen || 'list' }));
  document.querySelectorAll('button[data-del-history]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('이 정산 기록을 삭제할까요?')) return;
      try {
        await api('/api/history/delete', { method: 'POST', body: JSON.stringify({ id: btn.dataset.delHistory }) });
        const { sessions } = await api('/api/history');
        setState({ history: sessions });
      } catch (err) { setState({ error: String(err.message) }); }
    });
  });
}

async function loadMe() {
  try {
    const me = await api('/api/me');
    if (!me || !me.gameName) return;
    const el = document.getElementById('brand-user');
    const nameEl = document.getElementById('brand-user-name');
    const tagEl = document.getElementById('brand-user-tag');
    if (el && nameEl && tagEl) {
      nameEl.textContent = me.gameName;
      tagEl.textContent = me.tagLine ? `#${me.tagLine}` : '';
      el.hidden = false;
    }
  } catch (e) {
    // 조용히 실패 — 소환사 정보 못 띄워도 앱은 동작해야 함
  }
}

async function pollGameflow() {
  try {
    const { phase } = await api('/api/gameflow');
    const prev = state.lastPhase;
    const endedNow = prev === 'InProgress' && (phase === 'WaitingForStats' || phase === 'EndOfGame' || phase === 'PreEndOfGame' || phase === 'None');
    setState({ gamePhase: phase, lastPhase: phase });
    if (endedNow && state.screen === 'list') {
      // 게임이 막 끝남 → 잠시 후 매치 히스토리 자동 갱신 (LCU가 기록 반영하는 시간 고려)
      setTimeout(loadMatches, 4000);
    }
  } catch (e) {
    // 클라이언트 꺼져있을 수 있음 — 조용히 무시
  }
}

setInterval(pollGameflow, 8000);
pollGameflow();
loadMe();
loadMatches();
