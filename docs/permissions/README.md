# 권한 운영 문서 (기숙사 관리 ERP)

이 폴더는 **관리자·운영 담당자(비개발자 포함)** 가 권한 시스템을 안전하게 운영하기 위한 문서 모음입니다.
개발 지식 없이도 화면을 따라 할 수 있도록 작성되었습니다.

## 문서 목록
| 문서 | 대상 | 용도 |
|---|---|---|
| [permission-operation-policy.md](permission-operation-policy.md) | 전 관리자 | 권한 운영 정책서(기본 원칙·역할 정책) |
| [role-reference-and-modes.md](role-reference-and-modes.md) | 관리자 | 역할별 기준표 · 적용 방식(추가/선택) · 데이터 범위 가이드 |
| [admin-user-guide.md](admin-user-guide.md) | 관리자 | 권한 생성·수정·복제·사용중지·삭제·복구·배정 절차 |
| [permission-request-approval.md](permission-request-approval.md) | 신청자·승인자 | 권한 신청·승인·회수 절차, 신청서 양식 |
| [onboarding-transfer-offboarding.md](onboarding-transfer-offboarding.md) | 인사·총무 | 입사·부서이동·퇴사 처리 절차 |
| [permission-incident-response.md](permission-incident-response.md) | 보안·관리자 | 권한 사고 대응 · 장애 확인 순서 |
| [monthly-access-review-checklist.md](monthly-access-review-checklist.md) | 관리자 | 월간 권한 점검 체크리스트 |
| [quarterly-security-review-checklist.md](quarterly-security-review-checklist.md) | 보안·감사 | 분기별 보안 점검 체크리스트 |
| [audit-response-guide.md](audit-response-guide.md) | 보안·감사 | 감사 대응 자료 추출 절차 |
| [admin-training-guide.md](admin-training-guide.md) | 신규 관리자 | 60분 교육 커리큘럼 + 실습 시나리오 |
| [permission-faq.md](permission-faq.md) | 전 관리자 | 자주 묻는 질문 20+ |

## 30초 요약
- **기본 역할(시스템 값 admin/viewer/dorm_manager/maintenance_reporter)** 은 시스템 고정값입니다. 수정·삭제하지 않습니다.
- 업무별 추가 권한이 필요하면 **사용자 정의 권한(Custom Role)** 을 만들어 배정합니다.
- 적용 방식 2가지: **기존 권한에 추가(시스템 값: additive)** / **선택한 메뉴만 허용(시스템 값: restrictive)**.
- **하자접수 담당자(maintenance_reporter)** 는 항상 **운영관리 > 청소관리·하자접수** 만 보입니다. 절대 변경하지 않습니다.
- 권한 변경은 **다음 로그인 또는 새로고침 후** 적용됩니다.

## 최소 권한 원칙(가장 중요)
> 사용자에게는 **업무에 필요한 최소한의 메뉴·기능·데이터 범위만** 부여합니다. 애매하면 좁게 주고, 필요 시 추가합니다.
