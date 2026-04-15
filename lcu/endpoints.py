"""Helper functions for the LCU endpoints we actually use."""
from __future__ import annotations

from typing import Any

from .client import LCUClient

ARAM_QUEUE_ID = 450
HOWLING_ABYSS_MAP_ID = 12  # 칼바람 맵 — 450 외 이벤트 큐(예: 2400)도 여기서 진행됨


def is_aram(game: dict) -> bool:
    return game.get("mapId") == HOWLING_ABYSS_MAP_ID or game.get("queueId") == ARAM_QUEUE_ID


def current_summoner(client: LCUClient) -> dict[str, Any]:
    return client.get("/lol-summoner/v1/current-summoner")


def recent_matches(client: LCUClient, limit: int = 50) -> list[dict[str, Any]]:
    data = client.get(
        "/lol-match-history/v1/products/lol/current-summoner/matches",
        params={"begIndex": 0, "endIndex": max(0, limit - 1)},
    )
    games = data.get("games", {}).get("games", [])
    return games


def match_detail(client: LCUClient, game_id: int) -> dict[str, Any]:
    return client.get(f"/lol-match-history/v1/games/{game_id}")


def participant_riot_id(pid_entry: dict[str, Any]) -> tuple[str, str]:
    """Extract (gameName, tagLine) from a participantIdentities entry, tolerating LCU variants."""
    player = pid_entry.get("player", {})
    game_name = player.get("gameName") or player.get("riotIdGameName") or player.get("summonerName") or ""
    tag_line = player.get("tagLine") or player.get("riotIdTagline") or ""
    return game_name, tag_line


def participant_puuid(pid_entry: dict[str, Any]) -> str:
    return pid_entry.get("player", {}).get("puuid", "")
