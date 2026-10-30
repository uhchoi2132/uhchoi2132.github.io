# SAMSUNG RX Intelligence Universe

설계서 v2.2 기반 공개 인터랙티브 웹앱입니다. 배포 대상은 `https://uhchoi2132.github.io/rx-universe/`이며, GitHub Actions가 빌드·브라우저 검증을 통과한 결과만 게시합니다.

## 기능

- Command Center, 3D Universe, Time Machine, Evidence Vault, Hypothesis War Room, Factory Twin, Briefing Studio
- 3D 회전·확대, 2D 및 WebGL 장애 폴백, 노드·연결 선택, 검색·필터, 키보드 탐색
- 공개 시점과 사건 시점을 분리한 필터, 과거 스냅샷, 원출처 계보 기반 중복 제거
- 관측 목록의 브라우저 저장, JSON 내보내기, 브리핑 인쇄/PDF
- 모바일 메뉴, reduced-motion, 모달 포커스 관리

## 데이터 상태

검증된 Claim/Evidence는 0건입니다. 18개 노드와 연결, 경쟁 가설 3개, 관측 기준 6개는 설계 seed입니다. 실제 조직 권한·고객·계약·상용화 실적을 의미하지 않습니다. 원문 수집·AI 추론·서버 데이터 저장·08:00 자동 갱신은 미연결이며 `last_successful_update`는 `null`입니다. Copilot은 근거 상태를 안내하는 로컬 가이드입니다.

## 개발 및 검증

Node.js 22 이상:

```bash
npm install
npm test
npm run build
npx playwright install --with-deps chromium
npm run test:browser
npm run dev
```

로컬 경로: `http://localhost:5173/rx-universe/`

- `src/data.test.ts`: 이중 시간, 정정 이력, 재인용 10건의 독립 근거 1건 집계, 빈 스냅샷, 잘못된 입력 검증
- `scripts/browser-check.mjs`: 생산 빌드의 데스크톱·모바일·그래프·시점·내보내기 검증과 스크린샷
- `.github/workflows/rx-universe.yml`: 의존성 설치 → 테스트 → 타입 검사/빌드 → Chromium 검증 → 공개 배포 → 비인증 HTTP 확인

GitHub Pages 저장소에서는 앱 소스가 `apps/rx-universe/`, 산출물이 `/rx-universe/`에 위치합니다. 기존 홈페이지 `index.html`은 그대로 유지됩니다. 소스와 빌드는 공개 데이터 및 설계 가설만 포함하며 키나 비공개 기업 정보가 없습니다.

## 운영 시스템으로 확장할 범위

이 앱은 React/TypeScript/Vite 정적 웹서비스입니다. Next.js/FastAPI/PostgreSQL 운영 API, OIDC·리뷰 권한, append-only 감사 로그, 원문 수집 및 AI 검증은 별도 백엔드 구현이 필요합니다. UI 게시와 실제 데이터 자동 갱신을 구분합니다.
