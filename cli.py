"""엔트리포인트: 로컬 FastAPI 서버 기동 + 브라우저 자동 오픈."""
from __future__ import annotations

import argparse
import threading
import time
import webbrowser

import uvicorn


def main() -> None:
    parser = argparse.ArgumentParser(description="LoL 칼바람 딜량 내기 정산기")
    parser.add_argument("--host", default="127.0.0.1", help="바인드 주소 (기본 127.0.0.1 — 로컬만)")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true", help="브라우저 자동 오픈 비활성화")
    args = parser.parse_args()

    if args.host not in ("127.0.0.1", "localhost"):
        print(f"경고: {args.host} 에 바인딩. LCU 토큰이 노출될 수 있음.")

    if not args.no_browser:
        url = f"http://{args.host}:{args.port}/"
        threading.Thread(target=lambda: (time.sleep(0.8), webbrowser.open(url)), daemon=True).start()

    uvicorn.run("web.server:app", host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
