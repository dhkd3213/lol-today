"""여러 매치의 Transfer 목록을 합산해 지급 매트릭스로 변환."""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass

from .rules import Transfer


@dataclass(frozen=True)
class NetTransfer:
    payer: str
    payer_name: str
    payee: str
    payee_name: str
    amount: int


def aggregate(transfers: list[Transfer]) -> list[NetTransfer]:
    """같은 (payer, payee) 쌍은 합산. 반대 방향끼리 상계(netting)."""
    pair_total: dict[tuple[str, str], int] = defaultdict(int)
    names: dict[str, str] = {}

    for t in transfers:
        pair_total[(t.payer, t.payee)] += t.amount
        names[t.payer] = t.payer_name
        names[t.payee] = t.payee_name

    visited: set[tuple[str, str]] = set()
    result: list[NetTransfer] = []
    for (a, b), amount_ab in pair_total.items():
        if (a, b) in visited or (b, a) in visited:
            continue
        amount_ba = pair_total.get((b, a), 0)
        net = amount_ab - amount_ba
        visited.add((a, b))
        visited.add((b, a))
        if net > 0:
            result.append(NetTransfer(a, names[a], b, names[b], net))
        elif net < 0:
            result.append(NetTransfer(b, names[b], a, names[a], -net))
    return sorted(result, key=lambda r: -r.amount)


def loser_counts(transfers: list[Transfer]) -> dict[str, tuple[str, int, int]]:
    """친구별: (display_name, 꼴등 횟수, 돈 낸 총 횟수).

    꼴등 = 룰에서 최대 금액(3000원)을 낸 사람 = 인원수별 최하위 등수."""
    names: dict[str, str] = {}
    bottom: dict[str, int] = defaultdict(int)
    total: dict[str, int] = defaultdict(int)
    for t in transfers:
        names[t.payer] = t.payer_name
        total[t.payer] += 1
        if t.amount >= 3000:
            bottom[t.payer] += 1
    return {k: (names[k], bottom.get(k, 0), total[k]) for k in names}
