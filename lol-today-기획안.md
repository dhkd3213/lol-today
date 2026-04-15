# LoL 칼바람 딜량 내기 정산기 기획안

## 1. 프로젝트 개요
롤 클라이언트의 LCU(League Client Update) API로 **최근 칼바람 전적을 불러와, 친구 3~5명이서 건 "딜량 내기"를 자동 정산**하는 로컬 웹 도구.
공식 Riot API와 달리 API 키 없이 클라이언트만 켜져 있으면 즉시 조회 가능.

## 2. 목표
내기 룰:
- 3인: 꼴등 → 1등 3000원
- 4인: 꼴등 → 1등 3000원, 3등 → 2등 1000원
- 5인: 꼴등 → 1등 3000원, 4등 → 2등 1000원

사용 시나리오: 게임 끝나고 브라우저 열어 → 최근 매치 체크 → 친구 확인 → "정산" → 누가 누구에게 얼마 내야 하는지 한눈에.

## 3. 핵심 기능 (MVP)
| 기능 | 설명 | 우선순위 |
|---|---|---|
| lockfile 자동 탐색 | 설치 경로 후보 + 환경변수 오버라이드 | ★★★ |
| 최근 매치 목록 | ARAM 기본 필터, 다중 선택 체크박스 | ★★★ |
| 팀원 딜량 테이블 | 내 팀 5명 챔프/닉/딜량/친구여부 | ★★★ |
| 친구 풀 관리 | Riot ID/puuid 저장, 매치별 체크 오버라이드 | ★★★ |
| 룰 기반 정산 | 3/4/5인 룰 적용, 매치별 Transfer 리스트 | ★★★ |
| 세션 합산 | 여러 매치 묶어 최종 지급 매트릭스 | ★★★ |
| 챔프 ID → 이름/아이콘 | Data Dragon 캐싱 | ★★ |
| 스크린샷용 텍스트 요약 | 복붙 가능한 plain text | ★★ |

## 4. 확장 아이디어 (V2+)
- 세션 자동 감지 (연속된 칼바람 그룹핑)
- 꼴등 누적 통계, 주간/월간 정산 로그 저장
- Discord Webhook으로 정산 결과 자동 전송
- 라이브 게임 중 팀원 최근 딜량 프리뷰

## 5. 기술 스택
- **언어**: Python 3.11+
- **HTTP**: `requests` (LCU는 self-signed cert라 `verify=False`)
- **웹 서버**: FastAPI + uvicorn (로컬 `127.0.0.1` 바인딩만)
- **프론트**: vanilla HTML/CSS/JS (빌드 단계 없음)
- **정적 데이터**: Data Dragon CDN

## 6. 아키텍처
```
lol-today/
├── lcu/
│   ├── client.py        # lockfile 파싱 + 인증 HTTP 래퍼
│   ├── endpoints.py     # 엔드포인트 헬퍼 함수
│   └── errors.py        # 클라이언트 꺼짐/lockfile 없음 등
├── settlement/
│   ├── rules.py         # 3/4/5인 정산 룰 테이블 (순수 함수)
│   ├── friends.py       # 친구 풀 로드/저장, 팀원 매칭
│   └── aggregate.py     # 여러 매치 합산 → 지급 매트릭스
├── data/
│   └── ddragon.py       # 챔프 id→이름/아이콘 (버전별 캐시)
├── web/
│   ├── server.py        # FastAPI 앱
│   └── static/
│       ├── index.html
│       └── app.js
├── config/
│   └── friends.json     # 사용자 친구 풀 (Riot ID/puuid)
├── cli.py               # uvicorn 기동 + 브라우저 오픈
└── README.md
```

## 7. 주요 LCU 엔드포인트
| Path | 용도 |
|---|---|
| `/lol-summoner/v1/current-summoner` | 내 puuid / Riot ID (자기 제외용) |
| `/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=50` | 최근 매치 목록 |
| `/lol-match-history/v1/games/{gameId}` | 매치 상세 — `participants[].stats.totalDamageDealtToChampions` + `riotIdGameName`/`riotIdTagline` |

## 8. 정산 룰 (코드로 표현)
```python
RULES = {
    3: [(3, 1, 3000)],
    4: [(4, 1, 3000), (3, 2, 1000)],
    5: [(5, 1, 3000), (4, 2, 1000)],
}
```
- 친구 <3명 매치는 "정산 불가" 표기 후 스킵
- 친구 >5명은 한 팀 상한(5명) 초과 — 가드만

## 9. 웹 UI 플로우
1. **매치 리스트 화면** — 최근 20~50개, ARAM 토글(기본 on), 체크박스 다중 선택
2. **정산 준비 화면** — 선택한 매치마다 내 팀 5명 표시 + "친구" 토글 (친구 풀 기반 기본값)
3. **결과 화면** — 매치별 순위/금액 + 세션 전체 지급 매트릭스 + 복붙용 텍스트 요약

## 10. 친구 관리
- `config/friends.json`에 Riot ID + puuid 저장
- 매칭 우선순위: puuid → Riot ID(gameName+tagLine, 대소문자 무시) → gameName 단독(최후)
- "친구 풀에 추가" 버튼으로 매치 상세에서 즉시 등록
- **매치별 체크박스가 최종 권위** — 풀은 기본값, 한 판 예외 처리 가능

## 11. 개발 로드맵
- **D+0**: lcu/ 모듈 (lockfile + 인증 HTTP + 소환사/매치 호출)
- **D+1**: settlement/ 모듈 (rules + friends + aggregate, 유닛 테스트)
- **D+2**: FastAPI 라우트 + 정적 프론트엔드
- **D+3**: Data Dragon 연동 (챔프 아이콘), UX 다듬기
- **D+4~**: 세션 자동 그룹핑, 통계, Webhook 등 확장

## 12. 리스크 & 고려사항
- **라이엇 약관**: 개인 조회 범위 내 허용. 자동화/매크로 금지 — 본 도구는 조회만 수행
- **self-signed 인증서**: `urllib3.disable_warnings(InsecureRequestWarning)` + `requests`의 `verify=False`
- **lockfile 경로**: 기본 경로 후보 + `LCU_INSTALL_PATH` 환경변수 오버라이드
- **LCU 포트/토큰 재할당**: 클라이언트 재시작 시 lockfile 재로드
- **서버 바인딩**: 반드시 `127.0.0.1` — 외부 노출 금지 (LCU 토큰 프록시 악용 방지)
- **Riot ID 필드명**: 한국 서버 LCU 빌드에서 실제 응답 키 최초 1회 수동 검증

## 13. 완료 기준 (MVP)
- [ ] 롤 클라이언트 실행 중이면 브라우저가 열리고 최근 매치 목록이 뜸
- [ ] ARAM 매치 다중 선택 → 매치별 팀원 5명의 딜량 표가 표시됨
- [ ] 친구 3/4/5명 조합에 대해 룰대로 지급 금액이 계산됨
- [ ] 여러 매치 합산 시 세션 전체 지급 매트릭스가 정확함
- [ ] 결과를 그대로 복사해 카톡에 붙여넣을 수 있는 텍스트 요약 제공
