# 출처 계보 검토 — 2026-10-30

이 검토는 수집된 원자료 84행(중복 URL 3쌍을 정리하면 81문서)의 계보를 점검한 것이다. 최근 1년의 모든 공개자료가 누락 없이 수집됐다는 의미가 아니다. 문서와 주장은 보존하며, `origin_key`는 보수적인 **출처군** 식별자다. 출처군 수는 독립적으로 재현된 사실의 수, 성공 확률, 상용화 실적이 아니다. 최종 출처군 수는 별도 병합 작업에서 재계산한다.

## 단위와 필드

- 문서: 정규화한 URL의 원문. 같은 URL에서 추출한 여러 주장을 삭제하지 않는다.
- `lineage_review.document_origin_url`: 기사·논문·전재물의 실제 원작 URL. 회사 행사 출처군으로 묶여도 기자의 원문과 추가 취재를 지우지 않는다.
- `event_key`: 공유 행사·프로그램. 행사 일치만으로 문서 복제나 동일 발화를 판정하지 않는다.
- `origin_key`: 확인된 원작·회사 발표·공동 공개 행사별 보수적인 증거 출처군. 별도 매체가 같은 당사자 발언을 전달하면 독립 사업 검증으로 추가 계산하지 않는다.
- `utterance_key`: 기술 세션, 기자 Q&A, 회사 답변, 시연 등 구체적 발화 위치. 같은 출처군 안의 추가 주장을 유지한다.
- `lineage_review`: 검토일·담당·판정·근거·관련 행 ID·실제 참조 URL·예외 사유. `shared_origin`은 동일 문서뿐 아니라 검토된 공동 발표군을 포함하며, `distinct_origin`은 별도 원작 유지이고 `unresolved`는 계보 미확인이다.
- `review_method`: 이번 수정에서 본문을 재열람한 `source_text_review`, 기존 수집 근거·원문 위치·요약을 대조한 `inventory_evidence_review`, 본문 접근 없이 URL·색인만 검토한 `metadata_only`를 구분한다. 모든 81문서를 이번 수정에서 새로 수집·보관했다는 뜻은 아니다.

## 검토 규칙과 lint

1. 동일 정규화 URL은 문서 중복 후보이며 모든 원래 주장 ID를 보존한다. 날짜 충돌은 임의로 더 구체적인 값을 고르지 않고 `merge_date_resolutions`에 검토 이유를 남긴다.
2. 동일 게시일·기관·겹치는 엔터티·유사 제목은 **검토 후보**다. 특히 같은 날 엔터티가 겹치는 공식자료/언론 보도 쌍은 검토된 공유 출처군과 상대 ID, 또는 `exceptions[{with_record_id, reason}]`가 필요하다. 이 조건만으로 자동 병합하지 않는다.
3. 공유 출처군은 동일 발표·공식 전재·번역·행사 발언을 본문으로 식별해야 한다. 기자의 현장 Q&A가 추가되면 문서·주장·발화 지점은 유지하되 같은 당사자의 계획을 여러 독립 실적 증명으로 세지 않는다.
4. 예외는 다른 기관의 별도 행사·서로 다른 계약·구체적 추가 인터뷰·별도 논문/공시/연구 명세의 근거를 적는다. 한 기록이 다른 기록들과 출처군을 공유해도 제3의 기록에 대한 명시적 분리 예외를 가질 수 있다.
5. arXiv·DOI·특허의 다른 식별자만으로 독립성이나 중복을 확정하지 않는다. 같은 논문의 블로그·번역은 원작에 연결하고, 다른 연구 질문과 원문은 유지한다. 특허 패밀리의 추가 국가별 공개본 발견 시 우선권·패밀리 식별자를 대조해야 한다.
6. 행사 프로그램이나 차단 페이지의 날짜를 정확한 최초 공개일·취재일로 승격하지 않는다. 미확인 계보는 미확인으로 남기며 검증 근거로 가산하지 않는다.

## 주요 공유 출처군

- REAL Summit 2026: `media-001`, `media-002`, `media-003`, `sds-004`, `mi-001`, `sds-010`, `sds-012`, `sds-014`. 공식 발표, 배순민 기술세션, 임원 기자 Q&A, 미라콤 RX Zone, Walden 시연은 동일 SDS 주도 RX 공개 행사군으로 보수 집계한다. 서로 다른 기자가 기사를 복사했다고 주장하는 것은 아니다. 9월12일 서울경제의 추가 파트너 설명은 문서로 보존하지만 익명 업계 출처만으로 기존 Team REX 발표와 독립적인 검증이 증명되지 않는다.
- Samsung AI Forum 2026 Physical AI: `se-014`, `se-015`, `tech-013`. 공식 프로그램의 Hauser·Hospedales 세션과 공식 요약·강연 보도를 대조했다. 원 강연 전체 영상·발언록의 검증은 미완료이며 성공률 목표를 실측값으로 바꾸지 않는다.
- 삼성·NVIDIA AI 공장 공동 발표: `se-001`, `se-002`. 각 배포일은 유지하며 한 공동 발표군으로 센다.
- MWC 제조 AI 공개: `se-004`, `se-005`. 전날 전략 발표가 예고한 전시를 다음날 자료가 소개한다. 현재 선택된 제조 주장 범위의 묶음이며 MWC 모바일 제품 발표 전체가 동일 주장은 아니다.
- 국내 투자계획: `se-008`, `se-009`. 세부 지역 발표는 보존하되 같은 투자계획을 이중 계산하지 않는다.
- DAM-VLA: `tech-006`, `se-006`. 논문이 원작, 블로그가 소개다. H-VLA는 별도 논문이다.
- SDS Q2: `sds-002`, `tech-014`, `sds-006`. SDS Q3: `sds-005`, `sds-007`, `sds-013`, `sds-018`. 같은 실적발표의 보도자료·스크립트·슬라이드·언론 전달을 묶는다.
- 레인보우 반기보고서: `tech-017`, `se-011`. 미국법인 손익의 원천은 같은 반기 공시이며, 기사에 추가된 회사의 RB-Y1 설명은 별도 발화 키로 남긴다. 반기보고서의 KAI 계약 주장과 미국법인 손익 주장을 같은 내용으로 합치지 않는다.
- AW 웨비나: `mi-011`, `mi-012`. 행사 운영 프로그램과 예고 보도를 묶는다.
- 동일 녹색경제 기사: `mi-020`, `media-005`. www 별칭이며 본문은 차단 상태다. 검색 색인의 2026-10-07 게시일 후보만 남기고 event_date는 null로 정정했다.

## 분리 유지 및 보류

9월30일 SFA MOU는 AI Forum과 다르다. 같은10월29일 삼성SDI 배터리 컨콜과 삼성SDS RX 컨콜도 다르다. 같은10월31일 웨비나 예고와 삼성·NVIDIA 발표는 무관하다. 같은3월3일 START 주제1.1과1.2는 개별 연구 명세이며 공모 프로그램만 공유한다. 8월14일 삼성전자·레인보우 공시는 발행 법인이 다르고 SDS 기고는 저작 목적부터 다르다. 스마트투데이의 고객정보 비공개 답변은 반기보고서 배경 수치와 분리된 직접 취재로 유지한다. AI FESTA 차단 기사와 공식 안내, 날짜 미상 Walden PoC와 행사 시연은 같다고 확인할 수 없어 추가 독립 검증으로 해석하지 않는다.

## 감사 가능성

원문 URL, 짧은 인용, 수동 열람 보고는 남아 있지만 법적으로 보관·재현할 수 있는 본문 보관본과 해시는 확보되지 않았다. 따라서 종전 `primary_read`는 `previous_verification`에 남기고 현재 `verification`을 `manual_report`, `audit_status`를 `unarchived`로 낮췄다. 차단 자료는 `access_blocked`/`blocked`를 유지한다. 모든 `archive_url`과 `content_sha256`는 null이다. 원문 링크나 도구 내부 결과 ID를 아카이브로 가장하지 않는다. 향후 실제 보관본·64자리 SHA-256과 적법한 이용 메타데이터를 검증한 뒤에만 재현 가능한 검증 등급을 부여할 수 있다.

## 전 행 검토 대장

아래는 84개 원수집 행 전체다. `media-001`/`sds-012`, `sds-002`/`tech-014`, `mi-020`/`media-005`가 동일 문서 쌍이므로 정규 문서는81개다. 각 원자료의 `lineage_review.source_urls`에는 묶음과 예외 판단에 참조한 다른 원문도 함께 기록했다.

| 수집 ID / 원문 | 판정 | 출처군 또는 관련 발화 | 검토 근거 |
|---|---|---|---|
| [media-001](https://zdnet.co.kr/view/?no=20260908143333) | shared_origin / same_company_event | `real-summit-2026-09-08:sds-bae-robot-platform-session` | 배순민의 REAL Summit 기술 세션과 Walden 공동 시연을 보도했다. 기자의 현장 관찰은 유지하지만 동일 SDS 공개 행사를 별도 독립 검증으로 가산하지 않는다. |
| [media-002](https://www.newspim.com/news/view/20260908000734) | shared_origin / same_company_event | `real-summit-2026-09-08:sds-executive-press-qa-manufacturing` | REAL Summit 기조연설 및 기자 Q&A에서 제시한 기존 제조 기반·플랫폼 계획을 보도했다. 현장 질의응답의 추가 내용은 별도 주장으로 보존하되 SDS 행사 출처군에 포함한다. |
| [media-003](https://zdnet.co.kr/view/?no=20260908122517) | shared_origin / same_company_event | `real-summit-2026-09-08:sds-ceo-press-qa-investment` | REAL Summit 기자간담회의 이준희 대표 투자 답변이 발화 지점이다. 다른 기자의 별도 기사는 보존하지만 같은 회사 간담회를 독립 사업실적 근거로 중복 계산하지 않는다. |
| [media-004](https://www.smarttoday.co.kr/ko-kr/articles/112188) | distinct_origin / distinct_report | `rainbow:smarttoday-nondisclosure-response-2026-10-01` | 선택 주장은 레인보우 관계자의 고객별 제품·현장 정보 비공개 답변이다. 기사 배경에 공시 수치가 있어도 이 직접 답변은 AI Forum 강연이나 반기보고서의 재전재가 아니다. |
| [media-005](https://greened.kr/news/articleView.html?idxno=351622) | shared_origin / same_document | `ai-festa-2026` | mi-020과 기사 식별자 351622가 같은 www 유무 별칭이다. 본문 접근 차단 상태에서 같은 문서임만 판정하며 행사 세부 주장이나 취재일은 확정하지 않는다. |
| [mi-001](https://miracom-inc.com/kr/customer-support/insight-reports/dn6/manufacturing-ax-rx-strategy) | shared_origin / same_company_event | `real-summit-2026-09-08:miracom-manufacturing-session-rx-zone` | 9월8일 REAL Summit 제조 세션·RX Zone·스페셜 스테이지를 미라콤이 9월10일 회고했다. MES 연계 계획은 SDS와 관계사의 공동 행사 발화군에 보수적으로 포함하며 미라콤 발화자를 따로 남긴다. |
| [mi-002](https://miracom-inc.com/kr/customer-support/insight-reports/dn6/manufacturing-ai-success-factors) | distinct_origin / distinct_report | `https://miracom-inc.com/kr/customer-support/insight-reports/dn6/manufacturing-ai-success-factors` | 10월21일 AMXPO에서 제시한 자동차 안전부품 자재 공급 사례의 후속 설명이다. 9월 REAL Summit 계획 반복만이 아니라 사람이 피킹·이송한다는 사례 단계 설명을 보존한다. |
| [mi-003](https://miracom-inc.com/kr/service/smart-factory/manufacturing-robotics) | distinct_origin / distinct_original_work | `https://miracom-inc.com/kr/service/smart-factory/manufacturing-robotics` | 제조 로보틱스 서비스 페이지에서 RCS 기능을 정의한다. MCS·MESplus 제품 문서와 대상 기능이 달라 별도 원문으로 유지하며 게시일 미확인을 행사일로 보완하지 않는다. |
| [mi-004](https://miracom-inc.com/kr/solution/smart-factory/mcs) | distinct_origin / distinct_original_work | `https://miracom-inc.com/kr/solution/smart-factory/mcs` | Nexplant MCS의 소속·기능을 명시한 제품 문서이다. RCS 서비스 페이지나 MESplus API 설명과 동일 문서 또는 동일 제품 기능이라고 간주하지 않는다. |
| [mi-005](https://miracom-inc.com/kr/solution/smart-factory/nexplant-mesplus/mes) | distinct_origin / distinct_original_work | `https://miracom-inc.com/kr/solution/smart-factory/nexplant-mesplus/mes` | MESplus 플랫폼 확장 API를 설명한 개별 제품 문서이다. 로봇 공통 API 발표로 바꾸지 않으며 RCS·MCS 문서와 별도 원문을 유지한다. |
| [mi-006](https://m.bikorea.net/news/articleView.html?idxno=47393) | distinct_origin / republication | `miracom-release:2026-10-02-ax-rx-six-manufacturers` | 6개 제조기업 현장 실증 추진을 다룬 미라콤 회사 발표 보도이다. 매체 자체의 독립 운영 검증으로 취급하지 않고 10월2일 회사 발표를 원출처군으로 둔다. |
| [mi-007](https://www.hankyung.com/article/202607130604P) | distinct_origin / republication | `miracom-release:2026-07-13-greencos-mes` | 그린코스 3공장 MES 착수에 관한 제공 보도자료이다. 다른 고객의 MES 착수 기사와 별도 계약·프로젝트 발표이며 실적 독립 감사는 아니다. |
| [mi-008](https://www.bikorea.net/news/quickViewArticleView.html?idxno=46200) | distinct_origin / republication | `miracom-release:2026-05-26-steel-mes` | 한국철강·환영철강 디지털팩토리 착수에 관한 회사 발표 보도이다. 그린코스 프로젝트와 고객·내용이 달라 별도 발표군으로 유지한다. |
| [mi-009](https://www.hankyung.com/article/202512015286P) | distinct_origin / republication | `miracom-release:2025-12-01-ceo-designate` | 삼성SDS 제공 대표이사 내정 자료를 게재한 기사이다. 2026년 행사 발언이나 인원 규모 자료와 합치지 않고 해당 인사 발표를 원출처군으로 둔다. |
| [mi-010](https://www.elec4.co.kr/contents/article_detail?article_idx=34872) | distinct_origin / republication | `miracom-release:2025-11-28-chemtopia-mou` | 11월25일 체결했다는 켐토피아 MOU를 11월28일 보도한 회사 발표이다. 게시일과 체결일을 구별하며 다른 고객 구축 프로젝트와 별도 출처군으로 둔다. |
| [mi-011](https://www.hellot.net/news/article.html?no=106716) | shared_origin / same_company_event | `aw-webinar-2025-11-21` | 11월21일 AW 웨비나 세션을 예고한 기사로 운영 페이지 mi-012와 같은 행사 프로그램에서 유래한다. 같은 날 공개된 삼성·NVIDIA AI 공장 발표와는 별개다. |
| [mi-012](https://dubiz.co.kr/Event/407) | shared_origin / same_company_event | `aw-webinar-2025-11-21` | mi-011이 예고한 11월21일 AW 웨비나의 운영 프로그램이다. 예고 기사와 한 출처군으로 묶되 이 페이지의 최초 게시일은 미확인 상태를 유지한다. |
| [mi-013](https://www.meconomynews.com/news/articleView.html?idxno=128549) | unresolved / unresolved | `https://www.meconomynews.com/news/articleView.html?idxno=128549` | AW 2026 부스 보도 후보로 미라콤 언론목록에서 존재를 확인했다. 본문 차단으로 다른 행사 기사와의 전재 관계를 판정하지 않고 미해결 계보로 둔다. |
| [mi-014](https://www.industrynews.co.kr/news/articleView.html?idxno=88051) | distinct_origin / republication | `industrynews-interview:2026-10-23-miracom-ax-rx` | 미라콤 사업부장과의 AX·RX 현장 확산 인터뷰이다. FA저널 등 동일 인터뷰 재게재는 한 출처군이며 별도 REAL Summit 회사 발표로 독립성을 부풀리지 않는다. |
| [mi-015](https://www.samsungsdi.co.kr/sdi-now/sdi-news/4781.html) | distinct_origin / distinct_report | `https://www.samsungsdi.co.kr/sdi-now/sdi-news/4781.html` | 삼성SDI가 InterBattery 전시에서 공개할 배터리 샘플을 발표한 자료이다. 10월 실적발표의 고객 평가 상황과는 공개 시점·발화 사건이 다르다. |
| [mi-016](https://ir.edaily.co.kr/News/Read?k=03995046645617840) | distinct_origin / distinct_report | `samsung-sdi:2026-q3-earnings-call` | 삼성SDI 3분기 실적발표 컨퍼런스콜의 배터리 고객 평가 발언을 전달한다. 같은 날 삼성SDS 실적발표와 법인·제품·발화 사건이 다르다. |
| [mi-017](https://news.samsungdisplay.com/34500) | distinct_origin / distinct_report | `https://news.samsungdisplay.com/34500` | 삼성디스플레이 K-디스플레이 전시의 휴머노이드 OLED 설명이다. 삼성전자 디스플레이 쇼룸 사례 및 SDI 배터리 행사와 다른 법인·제품 자료이다. |
| [mi-018](https://v.daum.net/v/20260107083444394) | distinct_origin / republication | `asiae-ces-interview:2026-01-06-samsung-electromechanics` | CES에서 삼성전기 사장이 밝힌 카메라 모듈 계획에 관한 아시아경제 취재의 Daum 유통본이다. 포털 URL을 새 독립 보도로 세지 않고 원 취재군을 유지한다. |
| [mi-019](https://nc-ai.com/ko/newsroom/press/nc-ai-sim2real-k) | unresolved / unresolved | `https://nc-ai.com/ko/newsroom/press/nc-ai-sim2real-k` | NC AI 검색 색인으로 발견한 K-피지컬AI 얼라이언스 발표 후보이다. 원문 차단으로 SDS의 다른 동맹 발표와 동일한 발화인지 판정하지 않는다. |
| [mi-020](https://www.greened.kr/news/articleView.html?idxno=351622) | shared_origin / same_document | `ai-festa-2026` | media-005와 기사 식별자 351622가 같은 문서이다. 10월7일은 검색 색인의 게시일 후보만 보존하며 실제 취재·행사일로 확정하지 않는다. AI FESTA 안내와의 세부 전재 관계는 미확인이다. |
| [mi-021](https://procon.co.kr/bbs/board.php?bo_table=magazine_new&wr_id=3460) | distinct_origin / distinct_report | `https://procon.co.kr/bbs/board.php?bo_table=magazine_new&wr_id=3460` | PROCON에 실린 미라콤 작성 Nexphere AI 구성 설명이다. 회사 기고를 독립 제품 평가로 세지 않으며 과거 제품 공개와 별개인 새 출시로 해석하지 않는다. |
| [mi-022](https://zdnet.co.kr/view/?no=20250630112430) | distinct_origin / republication | `https://zdnet.co.kr/view/?no=20250630112430` | 2025년6월 비츠로이엠 AGV 구축에 대한 회사 발표 보도이다. 최근 1년 범위 밖 배경이며 2026년 로봇 플랫폼 계획·실증 자료와 다른 사례이다. |
| [sds-001](https://www.samsungsds.com/kr/news/kkr-260415.html) | distinct_origin / distinct_report | `https://www.samsungsds.com/kr/news/kkr-260415.html` | KKR와의 협력 및 신사업 추진 방향을 밝힌 4월15일 별도 회사 발표이다. 이후 분기 실적발표·RX 행사와 같은 회사라는 이유로 합치지 않는다. |
| [sds-002](https://www.samsungsds.com/kr/news/ss-260730.html) | shared_origin / same_company_event | `samsung-sds-2026-q2-earnings` | 삼성SDS Q2 실적발표가 원 발화군이다. tech-014는 동일 URL 중복 추출이고 sds-006은 같은 Q2 설명의 공식 스크립트이므로 한 출처군으로 센다. |
| [sds-003](https://www.samsungsds.com/kr/news/sds-260903.html) | distinct_origin / distinct_report | `https://www.samsungsds.com/kr/news/sds-260903.html` | 8월31일~9월1일 미국 RX ART 워크숍 결과를 9월3일 공개한 별도 회사 발표이다. 9월8일 REAL Summit과 참석 프로그램·장소·발화 시점이 다르다. |
| [sds-004](https://www.samsungsds.com/kr/news/sds20260908.html) | shared_origin / same_company_event | `real-summit-2026-09-08:sds-official-rx-roadmap` | 9월8일 REAL Summit에서 회사가 제시한 RX 진출·2027 플랫폼 계획의 공식 요약이다. 같은 행사 현장 기사·관계사 회고·파트너 시연을 출처군으로 묶되 개별 발화 내용을 유지한다. |
| [sds-005](https://www.samsungsds.com/kr/news/ss-261029.html) | shared_origin / same_company_event | `samsung-sds-2026-q3-earnings` | 삼성SDS Q3 실적발표의 관계사 실증 사업 설명이다. 공식 스크립트·발표 슬라이드·같은 컨콜 보도는 동일 회사 발화군이며 삼성SDI 실적발표와 별개다. |
| [sds-006](https://image.samsungsds.com/en/investor/ir_events/ear_rele/__icsFiles/afieldfile/2026/08/03/Samsung_SDS_2Q26_Script_Eng_260730_1.pdf) | shared_origin / same_company_event | `samsung-sds-2026-q2-earnings` | Q2 실적발표의 공식 영문 스크립트로 sds-002와 같은 회사 설명을 담는다. 별도 PDF지만 새 독립 근거로 세지 않으며 PDF 최초 게시일은 추정하지 않는다. |
| [sds-007](https://image.samsungsds.com/en/investor/ir_events/ear_rele/__icsFiles/afieldfile/2026/10/29/Samsung_SDS_3Q26_Script_Eng_261029.pdf) | shared_origin / same_company_event | `samsung-sds-2026-q3-earnings` | Q3 실적발표의 공식 영문 스크립트이다. 같은 발표 보도자료·슬라이드·컨콜 보도와 한 출처군이며 PoC 세부 주장은 각각 보존한다. |
| [sds-008](https://image.samsungsds.com/en/investor/ir_events/ear_rele/__icsFiles/afieldfile/2026/04/23/SDS_1Q2026_Full_ConferenceCall_Script_ENG_2.pdf) | distinct_origin / distinct_report | `https://image.samsungsds.com/en/investor/ir_events/ear_rele/__icsFiles/afieldfile/2026/04/23/SDS_1Q2026_Full_ConferenceCall_Script_ENG_2.pdf` | Q1 실적발표의 공식 스크립트이다. Q2·Q3와는 공개 사건·발언 시점이 다른 원자료이며 계획의 변화는 날짜별로 유지한다. |
| [sds-009](https://www.samsungsds.com/kr/event/ai-festa-2026.html) | distinct_origin / distinct_report | `ai-festa-2026` | SDS의 AI FESTA 행사 안내 원문이다. 같은 행사를 다룬 차단 기사 mi-020의 세부 역할 분담을 확인할 수 없으므로 전재 관계는 단정하지 않고 별도 문서 출처를 유지한다. |
| [sds-010](https://www.linkedin.com/posts/waldenrobotics_at-real-summit-2026-in-seoul-our-head-of-activity-7506720227913584641-QI5b) | shared_origin / same_company_event | `real-summit-2026-09-08:walden-moira-doherty-demo` | Walden 공식 계정이 REAL Summit의 Moira Doherty 발표·공동 시연을 설명한다. media-001이 다룬 같은 시연의 당사자 설명으로 공동 행사 출처군에 포함하며 독립 현장 감사로 세지 않는다. |
| [sds-011](https://www.linkedin.com/posts/waldenrobotics_we-spend-a-lot-of-time-talking-about-robots-activity-7487929613239840769-efJo) | distinct_origin / distinct_report | `https://www.linkedin.com/posts/waldenrobotics_we-spend-a-lot-of-time-talking-about-robots-activity-7487929613239840769-efJo` | Walden 공식 계정의 별도 공동 PoC 설명이다. 정확한 게시일·현장이 없어 REAL Summit 시연과 동일 사건이라고 합칠 수 없고 파트너 당사자 진술로만 유지한다. |
| [sds-012](https://zdnet.co.kr/view/?no=20260908143333) | shared_origin / same_company_event | `real-summit-2026-09-08:sds-bae-robot-platform-session` | media-001과 URL이 완전히 같은 현장 기사에서 인텔리전스·플릿 주장을 별도 추출했다. 기사 하나의 여러 주장을 보존하며 REAL Summit 출처군을 중복 증가시키지 않는다. |
| [sds-013](https://files.newsis.com/view/NISX20261029_0003846643) | shared_origin / same_company_event | `samsung-sds-2026-q3-earnings` | 뉴시스가 삼성SDS Q3 실적발표 컨콜의 다음 단계 설명을 보도했다. 같은 발표의 공식 스크립트·보도자료와 한 회사 발화군으로 묶는다. |
| [sds-014](https://en.sedaily.com/technology/2026/09/12/samsung-sds-builds-10-company-robot-alliance-for-physical-ai) | shared_origin / same_company_event | `team-rex:seoul-economic-followup-2026-09-12` | 영문판은 한국어 서울경제 원보도의 번역이며 9월8일 행사 사진과 이미 공개된 Team REX 구성 내용을 다룬다. 익명 업계 출처만으로 새 독립 검증을 입증할 수 없어 SDS 공개 행사군에 보수적으로 포함한다. |
| [sds-015](https://www.samsungsds.com/kr/insights/limitations-and-challenges-in-physical-ai.html) | distinct_origin / distinct_report | `https://www.samsungsds.com/kr/insights/limitations-and-challenges-in-physical-ai.html` | 김지현 필자의 피지컬 AI 병목 분석 기고이다. 같은 날 공개된 삼성전자·레인보우 반기 공시와 문서 목적·저자·대상 내용이 다르다. |
| [sds-016](https://www.samsungsds.com/kr/insights/ai-humanoid-robot-rise-of-physical-ai.html) | distinct_origin / republication | `https://www.cio.com/article/3829539` | 본문에 IDG 전재와 CIO 원문 링크가 명시돼 있다. 삼성SDS 게시일은 원작 공개일이 아니며 회사 RX 운영 발표나 독립 검증 자료로 세지 않는다. |
| [sds-017](https://www.samsungsds.com/kr/insights/infra-stretegy-for-physical-ai-era.html) | distinct_origin / republication | `https://www.cio.com/article/4125160/preparing-for-physical-ai-5-critical-infrastructure-components.html` | 본문에 IDG 전재와 별도 CIO 인프라 기고 링크가 명시돼 있다. sds-016과 저자·원문 식별자가 다른 글이므로 같은 사이트 전재라는 이유로 합치지 않는다. |
| [sds-018](https://image.samsungsds.com/en/investor/ir_events/ear_rele/__icsFiles/afieldfile/2026/10/29/Samsung%20SDS%203Q26%20Earnings%20Release_1.pdf) | shared_origin / same_company_event | `samsung-sds-2026-q3-earnings` | Q3 공식 IR 슬라이드로 같은 분기발표의 보도자료·스크립트·컨콜 보도와 한 출처군이다. 자료 형태의 수를 독립 사업화 근거 수로 바꾸지 않는다. |
| [sds-019](https://www2.edaily.co.kr/News/Read?mediaCodeNo=257&newsId=04375526645575856) | distinct_origin / distinct_report | `https://www2.edaily.co.kr/News/Read?mediaCodeNo=257&newsId=04375526645575856` | SDS America 및 삼성전자 미국 연구 채용을 다룬 별도 언론 취재이다. 9월1일 RX ART 일정과 날짜가 겹쳐도 채용 공고와 워크숍 발표는 다른 원천이다. |
| [se-001](https://news.samsung.com/global/samsung-teams-with-nvidia-to-lead-the-transformation-of-global-intelligent-manufacturing-through-new-ai-megafactory) | shared_origin / same_company_event | `samsung-nvidia-ai-factory-2025-10` | 삼성과 NVIDIA가 같은 AI 공장 협력을 발표한 회사 자료이다. 양사 배포본과 시차로 다른 게시일은 유지하되 공동 발표를 한 출처군으로 센다. |
| [se-002](https://nvidianews.nvidia.com/news/samsung-ai-factory) | shared_origin / same_company_event | `samsung-nvidia-ai-factory-2025-10` | 삼성 AI 공장 협력에 대한 NVIDIA의 공동 발표 원문이다. 삼성 뉴스룸 배포본 se-001과 같은 협력을 설명하며 파트너 당사자 진술은 독립 현장 검증이 아니다. |
| [se-003](https://news.samsung.com/kr/삼성전자-삼성-테크-콘퍼런스-2025-개최) | distinct_origin / distinct_report | `https://news.samsung.com/kr/삼성전자-삼성-테크-콘퍼런스-2025-개최` | STC2025 개발자 행사 기조연설에서 소개한 기술 방향이다. 다음 해 AI Forum 연구 세션과 시점·행사·발언이 달라 별도 발표군으로 유지한다. |
| [se-004](https://news.samsung.com/kr/삼성전자-2030년까지-ai-자율공장-전환-추진) | shared_origin / same_company_event | `mwc-2026-industrial-ai` | 3월1일 발표한 2030 AI 자율공장 계획에서 MWC 전시·SMBS 공개를 예고했다. 다음날 MWC 자료의 제조 AI 항목과 같은 기업 전략 공개군으로 묶는다. |
| [se-005](https://news.samsung.com/us/samsung-advances-galaxy-ai-connected-ecosystem-mwc-2026/) | shared_origin / same_company_event | `mwc-2026-industrial-ai` | MWC2026 자료의 제조 AI 전시는 전날 se-004가 예고한 전략 공개의 후속 안내이다. 모바일 제품 내용 전체를 동일시하지 않고 현재 선택한 제조 주장만 같은 출처군으로 보수 집계한다. |
| [se-006](https://research.samsung.com/blog/DAM-VLA-A-Dynamic-Action-Model-Based-Vision-Language-Action-Framework-for-Robot-Manipulation) | shared_origin / republication | `https://arxiv.org/abs/2603.00926` | 삼성 연구 블로그의 DAM-VLA 소개는 arXiv 2603.00926 연구를 설명한다. 블로그와 논문을 같은 연구결과의 독립 재현으로 세지 않으며 논문을 원작으로 둔다. |
| [se-007](https://news.samsung.com/global/video-where-robotics-meets-precision-samsung-displays-shape-kukas-immersive-showroom) | distinct_origin / distinct_report | `https://news.samsung.com/global/video-where-robotics-meets-precision-samsung-displays-shape-kukas-immersive-showroom` | KUKA 쇼룸의 삼성 디스플레이 설치를 소개한 영상 기사이다. 제조 로봇 운용·SDS 오케스트레이션 협력과 다른 디스플레이 사례이며 영상 설명 범위를 유지한다. |
| [se-008](https://news.samsung.com/kr/삼성-미래-성장-위해-2655조원-투자) | shared_origin / same_company_event | `samsung-domestic-investment-plan-2026` | 삼성의 국내 투자계획 중 구미 로봇·데이터센터 계획을 담은 최초 발표군이다. se-009의 영남 세부계획은 같은 전체 투자 발표군에 포함한다. |
| [se-009](https://news.samsung.com/kr/삼성-미래-성장-위해-영남에-60조원-투자-계획) | shared_origin / same_company_event | `samsung-domestic-investment-plan-2026` | 6월29일 공개한 국내 투자계획의 영남 배분·실행 방향을 구체화한 회사 자료이다. 후속 문서와 추가 주장은 유지하되 전체 투자계획을 두 개 독립 사업화 증거로 세지 않는다. |
| [se-010](https://www.yna.co.kr/view/AKR20260721046100003) | distinct_origin / republication | `https://www.yna.co.kr/view/AKR20260721046100003` | 삼성전자 RX 조직 신설이라는 7월21일 회사 발표를 전달한 연합뉴스 보도이다. 원 공식 배포문 URL은 확보하지 못했으므로 기자 보도를 원자료로 보존하며 공식문서를 만들어내지 않는다. |
| [se-011](https://zdnet.co.kr/view/?no=20260828150538) | shared_origin / republication | `rainbow-2026-h1-report:zdnet-company-comment-2026-08-28` | 미국법인 상반기 손익은 레인보우 반기보고서를 직접 인용하고 RB-Y1 원인은 회사 관계자 답변을 덧붙였다. 재무 사실의 중복 가산을 막기 위해 반기보고서 출처군에 넣고 후속 답변의 발화 지점은 따로 남긴다. |
| [se-012](https://etechgroup.com/blog/general/e-tech-group-expands-u-s-collaborative-robotics-portfolio-with-rainbow-robotics/) | distinct_origin / distinct_report | `https://etechgroup.com/blog/general/e-tech-group-expands-u-s-collaborative-robotics-portfolio-with-rainbow-robotics/` | E Tech Group이 공인 통합·서비스 파트너 계약을 발표한 원문이다. 레인보우 번역·전재는 같은 발표이며 SFA MOU와는 상대방·계약이 다르다. |
| [se-013](https://news.samsung.com/global/samsung-at-the-forefront-of-koreas-ai-ran-projects-with-kt-and-sk-telecom) | distinct_origin / distinct_report | `https://news.samsung.com/global/samsung-at-the-forefront-of-koreas-ai-ran-projects-with-kt-and-sk-telecom` | KT·SKT AI RAN 사업 계약 및 검증 계획이라는 삼성전자 별도 발표이다. 제조 AI 키워드가 겹쳐도 AI Forum의 연구 강연이나 자율공장 발표와 합치지 않는다. |
| [se-014](https://news.samsung.com/kr/삼성전자-에이전틱-시프트-주제로-삼성-ai-포럼-2026-개최) | shared_origin / same_company_event | `samsung-ai-forum-2026-09-30:physical-ai-company-summary` | 9월30일 AI Forum Physical AI 세션의 월드 모델·RFM 발표를 회사가 요약했다. 공식 일정 tech-013 및 같은 강연 보도 se-015와 한 세션 출처군이다. |
| [se-015](https://www.edaily.co.kr/News/Read?newsId=04618246645585368&mediaCodeNo=257) | shared_origin / same_company_event | `samsung-ai-forum-2026-09-30:hauser-hospedales-talks` | 기사 본문은 AI Forum의 Kris Hauser·Timothy Hospedales 강연과 유튜브 화면을 출처로 제시한다. 세션 요약·프로그램 및 레인보우 재게재와 같은 공개 발화군이며 기자의 별도 검증 성과로 계산하지 않는다. |
| [se-016](https://zdnet.co.kr/view/?no=20260929183802) | distinct_origin / republication | `https://zdnet.co.kr/view/?no=20260929183802` | 9월30일 SFA가 밝힌 아산사업장 MOU를 전달하는 별도 회사 발표 보도이다. 같은 날 삼성 AI Forum과 발화 기관·장소·협약 상대가 다르므로 합치지 않는다. |
| [se-017](https://news.samsung.com/kr/스마트비즈엑스포) | distinct_origin / distinct_report | `https://news.samsung.com/kr/스마트비즈엑스포` | SmartBiz Expo의 기업별 제조 지원·시연을 소개한 현장 기획이다. AI Forum 연구 강연이나 삼성 자체 자율공장 계획과 다른 행사·수혜기업 자료이다. |
| [se-018](https://news.samsung.com/kr/삼성-2026-삼성-명장-선정) | distinct_origin / distinct_report | `https://news.samsung.com/kr/삼성-2026-삼성-명장-선정` | 삼성 명장 선정 자료에 포함된 삼성중공업 RX센터의 경력·활동 설명이다. 선정일은 자동화 장비 도입일이 아니며 그 날짜를 신규 배포 사건으로 세지 않는다. |
| [se-019](https://news.samsung.com/kr/삼성전자-레인보우로보틱스-최대주주-지위-확보) | distinct_origin / distinct_report | `https://news.samsung.com/kr/삼성전자-레인보우로보틱스-최대주주-지위-확보` | 2024년12월31일 지분 확대 및 미래로봇추진단 발표로 기간 밖 배경이다. 2026년 반기 공시는 현재 지분 상태에 대한 별도 법정 보고서이므로 역사적 발표와 문서 계보를 구분한다. |
| [se-020](https://rainbow-robotics.com/고객지원/자료실/docs-github/) | distinct_origin / distinct_original_work | `https://rainbow-robotics.com/고객지원/자료실/docs-github/` | 레인보우 제품별 공식 개발 문서 링크 허브이다. 논문·행사 발표를 다시 쓰는 페이지가 아니며 연결된 SDK별 지원 범위의 독립 검증으로 세지 않는다. |
| [tech-001](https://patents.google.com/patent/WO2026095403A1/en) | distinct_origin / distinct_original_work | `https://patents.google.com/patent/WO2026095403A1/en` | WO2026095403A1의 작업 선택·이기종 로봇 데이터 전달에 관한 공개 명세서이다. 다른 특허의 유사 키워드만으로 동일 발명·출원 계보라고 합치지 않는다. |
| [tech-002](https://patents.google.com/patent/US20260061608A1/en) | distinct_origin / distinct_original_work | `https://patents.google.com/patent/US20260061608A1/en` | US20260061608A1의 오류 대응 기능 수정에 관한 공개 명세서이다. 다른 수록 특허와 청구 기술 내용이 다르며 회사명이 같다는 이유로 병합하지 않는다. |
| [tech-003](https://patents.google.com/patent/WO2026101024A1/en) | distinct_origin / distinct_original_work | `https://patents.google.com/patent/WO2026101024A1/en` | WO2026101024A1의 물품-로봇 매핑·호출에 관한 공개 명세서이다. 같은 날 제출된 레인보우 분기보고서와 문서 유형·발행 기관·기술 내용이 다르다. |
| [tech-004](https://patents.google.com/patent/US20260138269A1/en) | distinct_origin / distinct_original_work | `https://patents.google.com/patent/US20260138269A1/en` | US20260138269A1의 장애물·안전 제약 기반 경유점 산출 공개 명세서이다. 오류 제어·물품 매핑 특허와 별도 발명 문서로 유지한다. |
| [tech-005](https://patents.google.com/patent/EP4764965A1/en) | distinct_origin / distinct_original_work | `https://patents.google.com/patent/EP4764965A1/en` | EP4764965A1의 사용자 경험 지식 그래프 기반 동반 로봇 제어 명세서이다. 회사·로봇 키워드 일치만으로 다른 특허군과 합치지 않는다. |
| [tech-006](https://arxiv.org/abs/2603.00926) | shared_origin / republication | `https://arxiv.org/abs/2603.00926` | arXiv 2603.00926은 DAM-VLA 연구의 원작이다. 삼성 블로그 se-006은 이 결과를 소개하므로 같은 연구 출처군이며 다른 arXiv 식별자의 H-VLA와는 분리한다. |
| [tech-007](https://arxiv.org/abs/2609.22895) | distinct_origin / distinct_original_work | `https://arxiv.org/abs/2609.22895` | arXiv 2609.22895 H-VLA는 키 액션 추론·생성 모델의 별도 원작이다. DAM-VLA와 소속·VLA 용어가 겹쳐도 다른 논문을 같은 연구결과로 합치지 않는다. |
| [tech-008](https://sra.samsung.com/wp-content/uploads/2026/03/1.1_START-CFP-Brief_Unifying-3D-Understanding-memory-and-prediction.pdf) | distinct_origin / distinct_report | `samsung-research-america-start-2026` | START 공모 주제 1.1은 3D 이해·기억·예측 연구를 요구하는 독립 과제 명세다. 같은 날 공개된 주제 1.2와 공모행사는 공유하지만 연구 질문·원문 파일이 달라 별도 원작으로 보존한다. |
| [tech-009](https://sra.samsung.com/wp-content/uploads/2026/03/1.2_START-CFP-Brief_Foundation-models-for-close-human-robot-interaction.pdf) | distinct_origin / distinct_report | `samsung-research-america-start-2026` | START 공모 주제 1.2는 가까운 사람-로봇 상호작용 연구의 독립 과제 명세다. 주제 1.1과 같은 공모행사는 공유하되 단순 번역·전재가 아니므로 별도 원작으로 보존한다. |
| [tech-010](https://news.samsung.com/us/samsung-research-america-expands-academic-collaboration-2026-start-program/) | distinct_origin / distinct_report | `samsung-research-america-start-2026` | 8월 START 협력 진행 발표는 3월 과제 공모 이후의 별도 프로그램 진행 설명이다. 같은 프로그램임은 연결하지만 서로 다른 시점의 공모 원문과 진행 발표를 동일 문서로 간주하지 않는다. |
| [tech-011](https://rainbow-robotics.com/레인보우로보틱스-ai-4족-보행-로봇-시리즈가-올해의-10/) | distinct_origin / distinct_report | `https://rainbow-robotics.com/레인보우로보틱스-ai-4족-보행-로봇-시리즈가-올해의-10/` | 레인보우의 RBQ 수상·기능 설명 회사 발표이다. Automate 전시 계획과 제품군·공개 사건이 다르며 수상이 운용 성능 독립 측정을 뜻하지 않는다. |
| [tech-012](https://rainbow-robotics.com/rainbow-robotics-at-automate-2026/) | distinct_origin / distinct_report | `https://rainbow-robotics.com/rainbow-robotics-at-automate-2026/` | 레인보우의 Automate2026 RB·RBY 전시 예고이다. 수상 기사나 미국 파트너 계약 발표와는 다른 공개 행사이며 실제 전시 이행일을 게시일로 대체하지 않는다. |
| [tech-013](https://research.samsung.com/saif) | shared_origin / same_company_event | `samsung-ai-forum-2026-09-30:physical-ai-programme` | Samsung AI Forum2026 공식 프로그램의 Physical AI 세션에 같은 발표자·강연이 명시돼 있다. se-014와 se-015의 공개 발화군에 포함하며 최초 게시일은 여전히 미확인이다. |
| [tech-014](https://www.samsungsds.com/kr/news/ss-260730.html) | shared_origin / same_company_event | `samsung-sds-2026-q2-earnings` | sds-002와 URL이 완전히 같은 Q2 회사 발표에서 Walden 관련 별도 주장을 추출했다. 문서 하나에 두 주장을 보존하며 출처 수를 늘리지 않는다. |
| [tech-015](https://kind.krx.co.kr/external/2026/03/20/001000/20260320003808/11011.htm) | distinct_origin / distinct_original_work | `https://kind.krx.co.kr/external/2026/03/20/001000/20260320003808/11011.htm` | 레인보우 2025 사업보고서라는 별도 법정 공시이다. 2026 분기·반기 보고서와 발행 시점·대상 기간이 다르며 반복 항목을 독립 실적 확인으로 가산하지 않는다. |
| [tech-016](https://kind.krx.co.kr/external/2026/05/15/002622/20260515005944/11013.htm) | distinct_origin / distinct_original_work | `https://kind.krx.co.kr/external/2026/05/15/002622/20260515005944/11013.htm` | 레인보우 2026 1분기 특수관계자 거래 공시이다. 2025 연간 및 2026 반기와 보고 기간이 다른 원작이며 같은날 삼성전자 특허와도 별개다. |
| [tech-017](https://kind.krx.co.kr/external/2026/08/14/002335/20260814008101/11012.htm) | shared_origin / republication | `rainbow-2026-h1-report` | 레인보우 2026 반기보고서가 원작이다. se-011이 재인용한 미국법인 손익의 원천도 이 보고서이며 KAI 장비대금 주장은 같은 보고서의 다른 절로 보존한다. |
| [tech-018](https://images.samsung.com/kdp/ir/business-report/2026_2Q_Interim_Business_Report_vF_kr.pdf) | distinct_origin / distinct_original_work | `https://images.samsung.com/kdp/ir/business-report/2026_2Q_Interim_Business_Report_vF_kr.pdf` | 삼성전자 2026 반기보고서는 삼성전자 발행 법정 공시이다. 같은 날 레인보우 보고서와 발행 법인·연결 범위가 다른 원작이며 지분 사실의 독립 현장검증 횟수로 해석하지 않는다. |
