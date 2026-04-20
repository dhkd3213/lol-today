"""Data Dragon 챔피언 메타데이터 — id→이름/아이콘 URL, 버전별 캐시."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

import requests


def _writable_cache_dir() -> Path:
    """PyInstaller 번들(읽기 전용)일 때는 %LOCALAPPDATA%/lol-today/cache 로, 개발 환경은 프로젝트 내 cache/."""
    if getattr(sys, "frozen", False):
        base = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA") or str(Path.home())
        return Path(base) / "lol-today" / "cache"
    return Path(__file__).resolve().parent / "cache"


CACHE_DIR = _writable_cache_dir()
VERSIONS_URL = "https://ddragon.leagueoflegends.com/api/versions.json"
CHAMPION_URL_TMPL = "https://ddragon.leagueoflegends.com/cdn/{version}/data/ko_KR/champion.json"
ICON_URL_TMPL = "https://ddragon.leagueoflegends.com/cdn/{version}/img/champion/{key}.png"


def _latest_version() -> str:
    resp = requests.get(VERSIONS_URL, timeout=5)
    resp.raise_for_status()
    return resp.json()[0]


def _load_cache(path: Path) -> dict[str, Any] | None:
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return None


def _save_cache(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


def load_champions(version: str | None = None) -> tuple[str, dict[int, dict[str, str]]]:
    """returns (version, {champion_id: {'name': ..., 'key': ...}})."""
    if version is None:
        try:
            version = _latest_version()
        except requests.RequestException:
            for p in CACHE_DIR.glob("champions-*.json"):
                cached = _load_cache(p)
                if cached:
                    return p.stem.removeprefix("champions-"), _parse(cached)
            raise

    cache_path = CACHE_DIR / f"champions-{version}.json"
    data = _load_cache(cache_path)
    if data is None:
        resp = requests.get(CHAMPION_URL_TMPL.format(version=version), timeout=10)
        resp.raise_for_status()
        data = resp.json()
        _save_cache(cache_path, data)

    return version, _parse(data)


def _parse(data: dict[str, Any]) -> dict[int, dict[str, str]]:
    champions = {}
    for entry in data.get("data", {}).values():
        champ_id = int(entry["key"])
        champions[champ_id] = {"name": entry["name"], "key": entry["id"]}
    return champions


def icon_url(version: str, key: str) -> str:
    return ICON_URL_TMPL.format(version=version, key=key)
