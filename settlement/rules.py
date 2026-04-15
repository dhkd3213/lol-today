"""정산 룰: 인원수 → (꼴등_rank, 상위_rank, 금액) 리스트."""
from __future__ import annotations

from dataclasses import dataclass

RULES: dict[int, list[tuple[int, int, int]]] = {
    3: [(3, 1, 3000)],
    4: [(4, 1, 3000), (3, 2, 1000)],
    5: [(5, 1, 3000), (4, 2, 1000)],
}

MIN_FRIENDS = 3
MAX_FRIENDS = 5


@dataclass(frozen=True)
class RankedFriend:
    key: str            # 식별자 (puuid 또는 Riot ID 문자열)
    display_name: str   # 표시용 닉
    damage: int
    champion_id: int
    rank: int           # 1 = 1등


@dataclass(frozen=True)
class Transfer:
    payer: str          # key
    payer_name: str
    payee: str          # key
    payee_name: str
    amount: int
    reason: str         # "4인 룰: 꼴등→1등" 등


def rank_friends(friends: list[dict]) -> list[RankedFriend]:
    """friends: [{key, display_name, damage, champion_id}] — 딜량 내림차순으로 rank 부여."""
    sorted_f = sorted(friends, key=lambda f: f["damage"], reverse=True)
    return [
        RankedFriend(
            key=f["key"],
            display_name=f["display_name"],
            damage=f["damage"],
            champion_id=f.get("champion_id", 0),
            rank=i + 1,
        )
        for i, f in enumerate(sorted_f)
    ]


def settle_match(ranked: list[RankedFriend]) -> tuple[list[Transfer], str | None]:
    """ranked: rank_friends()의 결과. returns (transfers, skip_reason)."""
    n = len(ranked)
    if n < MIN_FRIENDS:
        return [], f"친구 {n}명 — 최소 {MIN_FRIENDS}명 필요, 스킵"
    if n > MAX_FRIENDS:
        return [], f"친구 {n}명 — 한 팀 상한 초과, 스킵"

    rule = RULES[n]
    by_rank = {f.rank: f for f in ranked}
    transfers: list[Transfer] = []
    for loser_rank, winner_rank, amount in rule:
        loser = by_rank[loser_rank]
        winner = by_rank[winner_rank]
        transfers.append(
            Transfer(
                payer=loser.key,
                payer_name=loser.display_name,
                payee=winner.key,
                payee_name=winner.display_name,
                amount=amount,
                reason=f"{n}인 룰: {loser_rank}등→{winner_rank}등",
            )
        )
    return transfers, None
