"""친구 풀 관리: Riot ID + puuid 로드/저장/매칭."""
from __future__ import annotations

import json
import os
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable


def _config_dir() -> Path:
    if getattr(sys, "frozen", False):
        base = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA") or str(Path.home())
        return Path(base) / "lol-today" / "config"
    return Path(__file__).resolve().parent.parent / "config"


DEFAULT_FRIENDS_PATH = _config_dir() / "friends.json"


@dataclass
class Friend:
    game_name: str
    tag_line: str
    puuid: str = ""

    @property
    def riot_id(self) -> str:
        return f"{self.game_name}#{self.tag_line}" if self.tag_line else self.game_name

    @property
    def key(self) -> str:
        return self.puuid or self.riot_id.lower()


def load_friends(path: Path | None = None) -> list[Friend]:
    p = path or DEFAULT_FRIENDS_PATH
    if not p.exists():
        return []
    data = json.loads(p.read_text(encoding="utf-8"))
    return [Friend(**f) for f in data.get("friends", [])]


def save_friends(friends: Iterable[Friend], path: Path | None = None) -> None:
    p = path or DEFAULT_FRIENDS_PATH
    p.parent.mkdir(parents=True, exist_ok=True)
    payload = {"friends": [asdict(f) for f in friends]}
    p.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def match_friend(pool: list[Friend], *, puuid: str = "", game_name: str = "", tag_line: str = "") -> Friend | None:
    """puuid → Riot ID → gameName 순으로 매칭."""
    if puuid:
        for f in pool:
            if f.puuid and f.puuid == puuid:
                return f
    if game_name and tag_line:
        for f in pool:
            if f.game_name.lower() == game_name.lower() and f.tag_line.lower() == tag_line.lower():
                return f
    if game_name:
        for f in pool:
            if f.game_name.lower() == game_name.lower():
                return f
    return None


def upsert_friend(pool: list[Friend], friend: Friend) -> list[Friend]:
    """기존 항목에 puuid 없으면 채워주고, 없으면 추가."""
    for i, f in enumerate(pool):
        if friend.puuid and f.puuid == friend.puuid:
            pool[i] = Friend(
                game_name=friend.game_name or f.game_name,
                tag_line=friend.tag_line or f.tag_line,
                puuid=friend.puuid,
            )
            return pool
        if (
            f.game_name.lower() == friend.game_name.lower()
            and f.tag_line.lower() == friend.tag_line.lower()
        ):
            if friend.puuid and not f.puuid:
                pool[i] = Friend(game_name=f.game_name, tag_line=f.tag_line, puuid=friend.puuid)
            return pool
    pool.append(friend)
    return pool
