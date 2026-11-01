# 공식 출처 조사와 등록 정책

v2.6은 기존 근거 DB에 공식 뉴스룸·IR·제품·연구·행사 자료를 추가하고, 검토되지 않은 발견 URL을 별도 조사 대장으로 공개한다. 조사 기간은 2025-10-30~2026-10-31이다. 날짜 미확인 제품 설명과 기간 밖 배경 문서는 기간 내 자료 수와 분리한다.

## 세 가지 수치

1. **발견 URL**: 공식 목록, 피드, 검색·수동 목록 조사에서 발견한 주소의 canonical URL 합집합. 오래된 자료, 일반 기업 소식, 관련성 판정 전 자료와 접근 실패도 포함된다. 최근 1년 RX 관련 자료 수가 아니다.
2. **근거 DB 연결 URL**: 수동으로 검토하여 `Sources`에 등록한 URL. `manual_report`, `search_only`, `access_blocked` 등 개별 상태를 유지한다. 자료 등록은 독립 사실 검증이 아니다.
3. **본문 응답 수집**: 일회성 수집기가 실제 응답 바이트를 받은 URL. HTML의 탐색 메뉴가 키워드에 걸릴 수도 있다. 이 수치가 원문 독해·주장 검증·보관 아카이브 확보를 의미하지 않는다.

조사 기록은 실행별 관측이므로 목록 수·기관 수와 같지 않다. 같은 URL의 실행별 관측은 `observations`와 `run_ids`에 남긴다. 문서 출처군은 언어판·재인용·동일 발표의 계보를 검토한 별도 단위다.

## 조사 경로

- 삼성전자 한국·글로벌 뉴스룸의 로봇·제조·기술 목록, Samsung Research 논문·연구실·START/GRO 과제, 공식 실적 발표와 콜 자료
- 삼성SDS 한국·영문 뉴스 현황판, 인사이트 현황판, 제조 솔루션·MES·AMHS 모듈, 분기 IR, 행사·VOD
- 미라콤 뉴스·인사이트·M-FOCUS·제품·라이브러리 및 이전 공지 목록
- 삼성SDI·삼성전기·삼성중공업·삼성디스플레이·삼성E&A·SEMES 공식 뉴스와 제품
- 레인보우로보틱스 공식 제품·SDK·PR·IR, NVIDIA 및 삼성 RX 관계를 명시한 파트너 공식 원문

`research/discovery-*.json`은 순회 시드, `research/expansion-*.json`은 실제 검토 결과, `research/survey/*.json`은 자동 실행 결과다. `research/survey-data.json`과 공개 `data/rx-survey.json`은 이들을 합친 조사 대장이다.

## 검토와 그래프

발견 URL은 `DiscoveryInventory`에만 들어간다. 자동 키워드 일치로 `Sources`, `Claims`, 그래프 관계를 생성하지 않는다. 실제 등록은 최소 단위 주장, 원문 위치, 날짜 근거, 짧은 발췌, 한계, 검증 등급과 계보 검토를 요구한다.

동일 canonical URL은 한 문서로 합치되 주장·엔티티 태그를 보존한다. 게시일·사건일 충돌은 명시적 검토 없이 합치지 않는다. 같은 날 공식 발표와 언론 보도가 겹치면 공유 원천 또는 분리 근거를 요구한다. 기존 출처군을 바꿀 때는 `origin_history`를 기록한다.

자료의 관련 범위는 `direct_rx`, `manufacturing_adjacent`, `component_ecosystem`으로 표시한다. 미분류 기존 문서를 자동으로 RX 직접 자료로 승격하지 않는다. 범용 IT·소비자 AI 소식은 RX와의 구체적 연결이 없는 한 근거를 늘리는 용도로 등록하지 않는다.

관계는 실제 주장을 인용하여 개발·지원·구성·적용·협력을 구분한다. 같은 문서에 등장했다는 이유만으로 기술 의존성·계약·조직 지휘 관계를 만들지 않는다. `mentions`와 `about`은 명칭·주장 연결이며, 실행 의존성은 아니다. 모든 출처 귀속 사업 관계는 `claim_id`로 원문에 도달한다.

## 수집 실행의 한계

수집기는 공개 URL과 robots 정책을 확인하고 요청·시간·페이지 한도를 기록한다. 로그인·개인정보 제출·접근 제한을 우회하지 않는다. JavaScript 더보기, 막힌 공시 원문, 날짜 없는 제품 페이지, 본문을 추출하지 못한 문서와 행사 자료는 미확보 범위로 남긴다. 목록의 제목·날짜를 조사한 것과 모든 본문을 읽은 것은 구분한다.

응답 SHA-256은 해당 실행에서 받은 바이트의 식별자다. 공개 재현 가능한 원문 보관 주소가 없으면 `primary_read`로 승격하지 않는다. 기사·보고서 전문을 조사 대장에 재배포하지 않는다.

워크플로 `rx-source-survey.yml`은 수동 또는 지정 조사 브랜치에서 실행되는 일회성 목록 수집이다. 자동 주장 추출·승인·08:00 게시 파이프라인은 연결되지 않았다. `completed_with_limits`는 정해진 실행이 끝났다는 뜻이며 웹 전체 전수조사 완료가 아니다. 누락률을 측정할 모집단은 아직 확정되지 않았다.

## 재생성

```bash
python3 scripts/collect-official-inventory.py --plan research/collection-plan.json --output research/survey/new-run.json
python3 scripts/import-expansion.py --dry-run
python3 scripts/import-expansion.py
python3 scripts/build-db.py
npm test
npm run build
npm run test:browser
```

검토가 끝난 확장 입력만 importer에 제공한다. importer는 출처·주장·날짜·계보·그래프 참조·조사 기록을 검증한 후 스냅샷을 쓴다. SQLite에는 기존 증거 테이블 외에 `CoverageCollections`, `DiscoveryInventory`, `CrawlRuns`가 있으며 원본 JSON과 실행·출처 참조를 보존한다.
