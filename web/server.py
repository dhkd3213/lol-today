"""FastAPI 서버: 매치 리스트, 매치 상세(친구 후보), 정산 실행."""
from __future__ import annotations

from datetime import datetime, timezone
from itertools import combinations
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from data.ddragon import icon_url, load_champions
from lcu import ClientNotRunning, LCUClient, LCURequestError
from lcu.endpoints import (
    current_summoner,
    gameflow_phase,
    is_aram,
    lcu_friends,
    match_detail,
    participant_puuid,
    participant_riot_id,
    recent_matches,
)
from settlement import (
    Friend,
    aggregate,
    load_friends,
    loser_counts,
    match_friend,
    rank_friends,
    save_friends,
    settle_match,
    upsert_friend,
)

import sys
BASE_DIR = Path(__file__).resolve().parent
# PyInstaller 번들 환경에서는 임시 폴더(_MEIPASS) 아래에 web/static이 위치
_BUNDLE_DIR = Path(getattr(sys, "_MEIPASS", "")) if hasattr(sys, "_MEIPASS") else None
if _BUNDLE_DIR and (_BUNDLE_DIR / "web" / "static").exists():
    STATIC_DIR = _BUNDLE_DIR / "web" / "static"
else:
    STATIC_DIR = BASE_DIR / "static"

app = FastAPI(title="lol-today — 칼바람 딜량 내기 정산기")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

_client = LCUClient()
_champ_cache: tuple[str, dict[int, dict[str, str]]] | None = None


def _champions() -> tuple[str, dict[int, dict[str, str]]]:
    global _champ_cache
    if _champ_cache is None:
        _champ_cache = load_champions()
    return _champ_cache


def _champ_info(champ_id: int) -> dict[str, str]:
    version, champs = _champions()
    info = champs.get(champ_id, {"name": f"#{champ_id}", "key": ""})
    return {
        "name": info["name"],
        "icon": icon_url(version, info["key"]) if info["key"] else "",
    }


def _format_game(game: dict[str, Any], my_puuid: str) -> dict[str, Any]:
    participants = game.get("participants", [])
    identities = game.get("participantIdentities", [])
    id_map = {p["participantId"]: p for p in identities}

    me = None
    for p in participants:
        pid = p["participantId"]
        ident = id_map.get(pid, {})
        if participant_puuid(ident) == my_puuid:
            me = p
            break

    my_champ = me["championId"] if me else 0
    stats = (me or {}).get("stats", {})
    win = bool(stats.get("win", False))
    my_damage = int(stats.get("totalDamageDealtToChampions", 0))

    return {
        "gameId": game.get("gameId"),
        "queueId": game.get("queueId"),
        "mapId": game.get("mapId"),
        "isAram": is_aram(game),
        "gameCreation": game.get("gameCreation"),
        "gameCreationISO": datetime.fromtimestamp(
            game.get("gameCreation", 0) / 1000, tz=timezone.utc
        ).astimezone().isoformat(timespec="minutes"),
        "gameDuration": game.get("gameDuration"),
        "win": win,
        "myChampion": _champ_info(my_champ),
        "myDamage": my_damage,
    }


def _lcu_call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except ClientNotRunning as e:
        raise HTTPException(status_code=503, detail=f"롤 클라이언트가 꺼져있음: {e}")
    except LCURequestError as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/me")
def me() -> dict[str, Any]:
    summ = _lcu_call(current_summoner, _client)
    return {
        "puuid": summ.get("puuid"),
        "gameName": summ.get("gameName") or summ.get("displayName"),
        "tagLine": summ.get("tagLine"),
    }


@app.get("/api/matches")
def matches(limit: int = 50, aram_only: bool = True) -> dict[str, Any]:
    summ = _lcu_call(current_summoner, _client)
    my_puuid = summ.get("puuid", "")
    games = _lcu_call(recent_matches, _client, limit=limit)
    formatted = [_format_game(g, my_puuid) for g in games]
    if aram_only:
        formatted = [g for g in formatted if g["isAram"]]
    return {"matches": formatted}


@app.get("/api/match/{game_id}")
def match(game_id: int) -> dict[str, Any]:
    summ = _lcu_call(current_summoner, _client)
    my_puuid = summ.get("puuid", "")
    detail = _lcu_call(match_detail, _client, game_id)

    participants = detail.get("participants", [])
    identities = detail.get("participantIdentities", [])
    id_map = {p["participantId"]: p for p in identities}

    my_team_id = None
    for p in participants:
        ident = id_map.get(p["participantId"], {})
        if participant_puuid(ident) == my_puuid:
            my_team_id = p.get("teamId")
            break

    pool = load_friends()
    team_rows = []
    for p in participants:
        if p.get("teamId") != my_team_id:
            continue
        pid = p["participantId"]
        ident = id_map.get(pid, {})
        puuid = participant_puuid(ident)
        game_name, tag_line = participant_riot_id(ident)
        friend = match_friend(pool, puuid=puuid, game_name=game_name, tag_line=tag_line)
        stats = p.get("stats", {})
        team_rows.append({
            "puuid": puuid,
            "gameName": game_name,
            "tagLine": tag_line,
            "isMe": puuid == my_puuid,
            "isFriend": friend is not None or puuid == my_puuid,
            "championId": p["championId"],
            "champion": _champ_info(p["championId"]),
            "damage": int(stats.get("totalDamageDealtToChampions", 0)),
        })
    team_rows.sort(key=lambda r: -r["damage"])
    return {
        "gameId": game_id,
        "gameCreation": detail.get("gameCreation"),
        "team": team_rows,
    }


class FriendMember(BaseModel):
    puuid: str = ""
    gameName: str = ""
    tagLine: str = ""
    displayName: str
    championId: int
    damage: int


class MatchSettlement(BaseModel):
    gameId: int
    friends: list[FriendMember]


class RuleEntry(BaseModel):
    count: int          # 친구 인원수 (3/4/5)
    loserRank: int
    winnerRank: int
    amount: int


class SettleRequest(BaseModel):
    matches: list[MatchSettlement]
    rules: list[RuleEntry] | None = None
    label: str | None = None  # 세션 저장용 라벨 (optional)


@app.post("/api/settle")
def settle(req: SettleRequest) -> dict[str, Any]:
    per_match_results = []
    all_transfers = []
    all_friends: dict[str, str] = {}  # key → display_name (참여한 모든 친구)
    match_friend_sets: list[set[str]] = []  # 매치별 친구 key 집합 (같이 플레이한 쌍 추출용)

    custom_rules: dict[int, list[tuple[int, int, int]]] | None = None
    if req.rules:
        custom_rules = {}
        for r in req.rules:
            custom_rules.setdefault(r.count, []).append((r.loserRank, r.winnerRank, r.amount))

    for m in req.matches:
        friends_payload = []
        match_keys: set[str] = set()
        for f in m.friends:
            key = f.puuid or f"{f.gameName}#{f.tagLine}".lower()
            all_friends[key] = f.displayName
            match_keys.add(key)
            friends_payload.append({
                "key": key,
                "display_name": f.displayName,
                "damage": f.damage,
                "champion_id": f.championId,
            })
        match_friend_sets.append(match_keys)
        ranked = rank_friends(friends_payload)
        transfers, skip = settle_match(ranked, custom_rules=custom_rules)
        all_transfers.extend(transfers)

        per_match_results.append({
            "gameId": m.gameId,
            "skip": skip,
            "ranked": [
                {
                    "rank": r.rank,
                    "displayName": r.display_name,
                    "damage": r.damage,
                    "champion": _champ_info(r.champion_id),
                }
                for r in ranked
            ],
            "transfers": [
                {
                    "payer": t.payer_name,
                    "payee": t.payee_name,
                    "amount": t.amount,
                    "reason": t.reason,
                }
                for t in transfers
            ],
        })

    net = aggregate(all_transfers)
    losers = loser_counts(all_transfers)

    # 친구별 순손익 (net > 0: 받음, net < 0: 보냄, 0: 상계)
    per_friend_net: dict[str, int] = {k: 0 for k in all_friends}
    for t in all_transfers:
        per_friend_net[t.payer] = per_friend_net.get(t.payer, 0) - t.amount
        per_friend_net[t.payee] = per_friend_net.get(t.payee, 0) + t.amount
    per_friend = sorted(
        [{"name": all_friends[k], "net": v} for k, v in per_friend_net.items()],
        key=lambda x: -x["net"],
    )

    # 같이 플레이한 친구 쌍 전부 수집 (0원 쌍도 포함)
    all_pairs: set[tuple[str, str]] = set()
    for ks in match_friend_sets:
        for a, b in combinations(sorted(ks), 2):
            all_pairs.add((a, b))
    existing_by_pair: dict[tuple[str, str], Any] = {}
    for nt in net:
        existing_by_pair[tuple(sorted([nt.payer, nt.payee]))] = nt

    net_rows: list[dict[str, Any]] = []
    for pair in all_pairs:
        nt = existing_by_pair.get(pair)
        if nt:
            net_rows.append({"payer": nt.payer_name, "payee": nt.payee_name, "amount": nt.amount})
        else:
            a, b = pair
            net_rows.append({"payer": all_friends[a], "payee": all_friends[b], "amount": 0})
    # 큰 금액 먼저, 0원은 맨 뒤
    net_rows.sort(key=lambda x: (x["amount"] == 0, -x["amount"], x["payer"]))

    result = {
        "matches": per_match_results,
        "net": net_rows,
        "perFriend": per_friend,
        "losers": [
            {"name": name, "bottomCount": bottom, "totalPayCount": total}
            for _, (name, bottom, total) in sorted(losers.items(), key=lambda kv: -kv[1][1])
        ],
        "summary": _text_summary(per_match_results, net_rows, per_friend, losers),
    }
    _save_session(result, label=req.label)
    return result


# ===================== SESSION HISTORY =====================

HISTORY_DIR = BASE_DIR.parent / "config" / "history"


def _save_session(result: dict[str, Any], label: str | None) -> None:
    try:
        HISTORY_DIR.mkdir(parents=True, exist_ok=True)
        ts = datetime.now().astimezone()
        fname = ts.strftime("%Y%m%d-%H%M%S") + ".json"
        payload = {
            "savedAt": ts.isoformat(timespec="seconds"),
            "label": label or ts.strftime("%m/%d %H:%M 정산"),
            "matchCount": len(result.get("matches", [])),
            "friendCount": len(result.get("perFriend", [])),
            "net": result.get("net", []),
            "perFriend": result.get("perFriend", []),
            "losers": result.get("losers", []),
        }
        (HISTORY_DIR / fname).write_text(
            __import__("json").dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except Exception:
        # 저장 실패해도 정산 자체는 성공 — 조용히 무시
        pass


@app.get("/api/history")
def list_history() -> dict[str, Any]:
    import json
    if not HISTORY_DIR.exists():
        return {"sessions": []}
    sessions = []
    for fp in sorted(HISTORY_DIR.glob("*.json"), reverse=True)[:30]:
        try:
            data = json.loads(fp.read_text(encoding="utf-8"))
            data["id"] = fp.stem
            sessions.append(data)
        except Exception:
            continue
    return {"sessions": sessions}


@app.post("/api/history/delete")
def delete_history(payload: dict[str, Any]) -> dict[str, Any]:
    session_id = payload.get("id", "")
    if not session_id:
        raise HTTPException(status_code=400, detail="id 필요")
    fp = HISTORY_DIR / f"{session_id}.json"
    if fp.exists():
        fp.unlink()
    return {"ok": True}


def _text_summary(per_match, net, per_friend, losers) -> str:
    lines = []
    lines.append("=== 칼바람 딜량 내기 정산 ===")
    for i, m in enumerate(per_match, 1):
        lines.append(f"\n[매치 {i}] gameId={m['gameId']}")
        if m["skip"]:
            lines.append(f"  스킵: {m['skip']}")
            continue
        for r in m["ranked"]:
            lines.append(f"  {r['rank']}등 {r['displayName']} — {r['damage']:,} ({r['champion']['name']})")
        for t in m["transfers"]:
            lines.append(f"  → {t['payer']} → {t['payee']}: {t['amount']:,}원")
    lines.append("\n=== 세션 최종 정산 ===")
    if not net:
        lines.append("  (정산할 쌍이 없음)")
    for n in net:
        lines.append(f"  {n['payer']} → {n['payee']}: {n['amount']:,}원")
    lines.append("\n=== 친구별 순손익 ===")
    for f in per_friend:
        sign = "+" if f["net"] > 0 else ""
        tag = " (받음)" if f["net"] > 0 else (" (보냄)" if f["net"] < 0 else "")
        lines.append(f"  {f['name']}: {sign}{f['net']:,}원{tag}")
    lines.append("\n=== 꼴등 횟수 ===")
    for _, (name, bottom, total) in sorted(losers.items(), key=lambda kv: -kv[1][1]):
        lines.append(f"  {name}: 꼴등 {bottom}회 / 돈낸 총 {total}회")
    return "\n".join(lines)


class UpsertFriendRequest(BaseModel):
    puuid: str = ""
    gameName: str
    tagLine: str = ""


class DeleteFriendRequest(BaseModel):
    puuid: str = ""
    gameName: str = ""
    tagLine: str = ""


def _serialize_friends(pool: list[Friend]) -> list[dict[str, str]]:
    return [{"gameName": f.game_name, "tagLine": f.tag_line, "puuid": f.puuid} for f in pool]


@app.post("/api/friends")
def add_friend(req: UpsertFriendRequest) -> dict[str, Any]:
    pool = load_friends()
    pool = upsert_friend(pool, Friend(game_name=req.gameName, tag_line=req.tagLine, puuid=req.puuid))
    save_friends(pool)
    return {"friends": _serialize_friends(pool)}


@app.get("/api/friends")
def list_friends() -> dict[str, Any]:
    return {"friends": _serialize_friends(load_friends())}


@app.get("/api/friends/lcu")
def list_lcu_friends() -> dict[str, Any]:
    """롤 클라이언트 친구 목록 — 풀에 없는 신규 친구만 추려서 반환."""
    raw = _lcu_call(lcu_friends, _client)
    pool = load_friends()
    pool_keys = {f.puuid for f in pool if f.puuid} | {
        f"{f.game_name}#{f.tag_line}".lower() for f in pool if f.game_name
    }
    candidates = []
    for entry in raw or []:
        puuid = entry.get("puuid", "") or ""
        game_name = entry.get("gameName") or entry.get("name") or ""
        tag_line = entry.get("gameTag") or entry.get("tagLine") or ""
        if not game_name:
            continue
        key_id = puuid or f"{game_name}#{tag_line}".lower()
        already = puuid in pool_keys or f"{game_name}#{tag_line}".lower() in pool_keys
        candidates.append({
            "puuid": puuid,
            "gameName": game_name,
            "tagLine": tag_line,
            "availability": entry.get("availability", ""),
            "alreadyAdded": already,
            "key": key_id,
        })
    candidates.sort(key=lambda c: (c["alreadyAdded"], c["gameName"].lower()))
    return {"candidates": candidates}


class BulkImportRequest(BaseModel):
    friends: list[UpsertFriendRequest]


@app.post("/api/friends/import")
def import_friends(req: BulkImportRequest) -> dict[str, Any]:
    pool = load_friends()
    for f in req.friends:
        pool = upsert_friend(pool, Friend(game_name=f.gameName, tag_line=f.tagLine, puuid=f.puuid))
    save_friends(pool)
    return {"friends": _serialize_friends(pool), "added": len(req.friends)}


@app.get("/api/gameflow")
def gameflow() -> dict[str, Any]:
    """현재 게임 페이즈 — 프론트에서 폴링해서 EndOfGame 전환 시 매치 자동 갱신."""
    phase = _lcu_call(gameflow_phase, _client)
    return {"phase": phase if isinstance(phase, str) else str(phase)}


@app.post("/api/friends/delete")
def delete_friend(req: DeleteFriendRequest) -> dict[str, Any]:
    pool = load_friends()

    def matches(f: Friend) -> bool:
        if req.puuid and f.puuid:
            return f.puuid == req.puuid
        if req.gameName:
            same_name = f.game_name.lower() == req.gameName.lower()
            if req.tagLine:
                return same_name and f.tag_line.lower() == req.tagLine.lower()
            return same_name
        return False

    pool = [f for f in pool if not matches(f)]
    save_friends(pool)
    return {"friends": _serialize_friends(pool)}
