"""LCU lockfile discovery + authenticated HTTP wrapper."""
from __future__ import annotations

import base64
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import requests
import urllib3

from .errors import ClientNotRunning, LCURequestError, LockfileNotFound

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)


DEFAULT_LOCKFILE_CANDIDATES = [
    r"C:\Riot Games\League of Legends\lockfile",
    r"D:\Riot Games\League of Legends\lockfile",
    r"C:\Program Files\Riot Games\League of Legends\lockfile",
    r"C:\Program Files (x86)\Riot Games\League of Legends\lockfile",
]


@dataclass(frozen=True)
class Lockfile:
    process_name: str
    pid: int
    port: int
    password: str
    protocol: str

    @property
    def base_url(self) -> str:
        return f"{self.protocol}://127.0.0.1:{self.port}"

    @property
    def auth_header(self) -> str:
        token = base64.b64encode(f"riot:{self.password}".encode()).decode()
        return f"Basic {token}"


def _candidate_paths() -> list[Path]:
    env = os.environ.get("LCU_INSTALL_PATH")
    paths: list[Path] = []
    if env:
        p = Path(env)
        paths.append(p if p.name == "lockfile" else p / "lockfile")
    paths.extend(Path(p) for p in DEFAULT_LOCKFILE_CANDIDATES)
    return paths


def find_lockfile() -> Path:
    for path in _candidate_paths():
        if path.is_file():
            return path
    raise LockfileNotFound(
        "lockfile을 찾지 못함. 롤 클라이언트가 켜져 있는지 확인하거나 "
        "LCU_INSTALL_PATH 환경변수로 설치 폴더를 지정하세요."
    )


def read_lockfile(path: Path | None = None) -> Lockfile:
    path = path or find_lockfile()
    try:
        raw = path.read_text(encoding="utf-8").strip()
    except FileNotFoundError as e:
        raise LockfileNotFound(str(e)) from e
    parts = raw.split(":")
    if len(parts) < 5:
        raise LockfileNotFound(f"lockfile 형식이 잘못됨: {raw!r}")
    return Lockfile(
        process_name=parts[0],
        pid=int(parts[1]),
        port=int(parts[2]),
        password=parts[3],
        protocol=parts[4],
    )


class LCUClient:
    """Thin wrapper: re-reads lockfile on each request so client restarts don't break us."""

    def __init__(self, timeout: float = 5.0):
        self.timeout = timeout
        self._session = requests.Session()
        self._session.verify = False

    def _lockfile(self) -> Lockfile:
        try:
            return read_lockfile()
        except LockfileNotFound as e:
            raise ClientNotRunning(str(e)) from e

    def get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        lf = self._lockfile()
        url = lf.base_url + path
        resp = self._session.get(
            url,
            params=params,
            headers={"Authorization": lf.auth_header, "Accept": "application/json"},
            timeout=self.timeout,
        )
        if resp.status_code >= 400:
            raise LCURequestError(resp.status_code, path, resp.text)
        return resp.json()
