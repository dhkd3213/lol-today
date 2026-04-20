# lol-today — 칼바람 딜량 내기 정산기

롤 LCU API로 최근 칼바람 전적을 불러와, 친구 3~5명이서 건 딜량 내기를 자동 정산하는 데스크탑 앱.

- 최근 매치 리스트 → 정산할 판 체크 → 매치별 친구 확인 → 원클릭 정산
- **친구별 순손익, 지급 매트릭스, 복붙용 텍스트 요약** 자동 생성
- 롤 클라이언트 친구 목록에서 친구 풀 **자동 import**
- 게임 종료 감지 → **매치 히스토리 자동 갱신**
- 정산 금액 **커스터마이징** (기본 3000/1000원)
- 정산 기록 **자동 저장**, 과거 기록 조회/삭제

## 정산 룰 (기본값, 설정에서 변경 가능)
- 3인: 꼴등 → 1등 3,000원
- 4인: 꼴등 → 1등 3,000원 / 3등 → 2등 1,000원
- 5인: 꼴등 → 1등 3,000원 / 4등 → 2등 1,000원

---

## A. 친구에게 전달 — 인스톨러 배포 (권장)

### 개발자: 빌드하기 (Windows)
```powershell
# 1) Node 18+ 와 Python 3.11+ 설치되어 있어야 함
pip install -r requirements.txt pyinstaller
npm install

# 2) 파이썬 백엔드 → 단일 exe
npm run build:py        # dist-py/lol-today-server.exe (~40MB) 생성

# 3) Electron 앱 + NSIS 인스톨러
npm run build:electron  # dist-app/lol-today-1.0.0-x64.exe 생성

# 한 번에:
npm run dist
```

빌드 산출물:
- `dist-app/lol-today-1.0.0-x64.exe` — NSIS 인스톨러 (친구에게 이걸 전달)
- `dist-app/lol-today-1.0.0-x64.zip` — 설치 없이 압축 풀어 실행

### 친구: 설치하기
1. `lol-today-Setup.exe` 다운로드 → 더블클릭
2. Windows SmartScreen 경고 뜨면 "추가 정보 → 실행" (코드 서명 안 된 앱이라 뜸 — 내가 만든거니까 안전)
3. 시작 메뉴 또는 바탕화면 아이콘으로 실행
4. 롤 클라이언트 켜놓고 앱 실행하면 자동으로 매치 불러옴

---

## B. 개발자 모드 (Python 직접 실행)

```bash
pip install -r requirements.txt
python -m cli
```
브라우저가 자동으로 `http://127.0.0.1:8765/` 열림.

### Electron 개발 모드 (Python 살아있는 상태로 쉘만 Electron)
```bash
npm install
npm run dev
```

### 설치 경로 커스텀
기본 경로에 롤이 안 깔려있으면 환경변수:
```powershell
$env:LCU_INSTALL_PATH = "D:\Games\League of Legends"
```

---

## 사용 흐름
1. 메인 화면에서 정산할 칼바람 판 체크 (Shift+클릭 구간선택, "오늘/어제" 배치선택 가능)
2. "선택한 N판 정산 준비" → 매치별 친구 체크박스 조정
3. "정산 실행" → 결과 화면에서:
   - **최종 정산** (누가 누구한테 얼마)
   - 친구별 순손익
   - 매치별 상세
   - 꼴등 횟수 리더보드
   - 복붙용 텍스트 요약

## 친구 풀
`config/friends.json`에 저장. 포맷:
```json
{
  "friends": [
    {"game_name": "미르", "tag_line": "KR1", "puuid": "..."}
  ]
}
```
3가지 등록 방법:
- 친구 관리 → **롤 친구에서 가져오기** (가장 편함)
- 매치 정산 화면에서 **+ 친구풀** 버튼
- 친구 관리 → 직접 추가

## 정산 기록 저장 위치
`config/history/YYYYMMDD-HHMMSS.json` — 정산 실행 시 자동 저장. 앱 내 "정산 기록" 메뉴에서 조회/삭제.

---

## 프로젝트 구조
```
lol-today/
├─ cli.py                 # 파이썬 엔트리 (uvicorn 기동)
├─ web/server.py          # FastAPI 라우트
├─ web/static/            # SPA 프론트 (index.html, app.js)
├─ lcu/                   # LCU lockfile + 엔드포인트
├─ settlement/            # 룰/정산 로직
├─ data/ddragon.py        # 챔피언 아이콘 캐시
├─ electron/
│  ├─ main.js             # Electron 메인 — 백엔드 spawn + BrowserWindow
│  └─ splash.html         # 부팅 스플래시
├─ assets/                # 아이콘 (png/ico/svg)
├─ package.json           # electron-builder + npm 스크립트
└─ lol-today.spec         # PyInstaller 번들 spec
```

## 주의
- LCU는 로컬에서만 접근 (127.0.0.1 바인딩) — 외부 노출 금지
- `verify=False` 사용 — 리옹 self-signed cert이라 불가피
- 이 도구는 조회만 하며 어떠한 자동화/매크로 행위도 하지 않음
