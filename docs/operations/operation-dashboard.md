# 운영 대시보드 (KPI 정의)

목적: 관리자가 주기적으로 확인할 핵심 지표를 정의한다.
데이터 소스: 권한 지표 = [operations_health_check.sql](../../supabase/diagnostics/operations_health_check.sql)(읽기 전용), 트래픽/오류 = Vercel·Supabase 로그.

---

## KPI 정의표
| KPI | 정의 | 소스 | 정상 기준(예시) | 주기 |
|---|---|---|---|---|
| 총 사용자 | profiles 전체 | health_check §12 | 조직 규모와 일치 | 주 |
| 활성 사용자 | is_active=true | health_check §12 | 퇴사자 제외 정상 | 주 |
| 관리자 수 | role='admin' 활성 | health_check §1 | 2~3명 | 주 |
| 권한 변경 건수 | custom_role_audit_logs insert 수 | 감사로그 | 급증 시 조사 | 주 |
| 권한 거부 건수 | 서버 42501/PGRST 거부 | Supabase Logs | 정상 403과 구분 | 일 |
| 로그인 실패 | Auth 실패 이벤트 | Supabase Auth Logs | 반복 실패 없음 | 일 |
| 다운로드 건수 | Excel/PDF/CSV 다운로드 | (앱 로그 부재 → 네트워크/서버 로그) | 비정상 대량 없음 | 주 |
| Excel 사용량 | Excel 다운로드 수 | 상동 | — | 주 |
| PDF 사용량 | PDF 다운로드 수 | 상동 | — | 주 |
| 감사로그 증가량 | audit 로그 일/주 증가 | 감사로그 count | 급증/급감 조사 | 주 |
| Storage 사용량 | 버킷 용량 | Supabase Storage | 임계 이하 | 주 |

## 권한 상태 지표(자동 점검)
health_check SQL의 아래 결과가 **0행/정상**이어야 한다.
- 삭제/비활성 Role의 활성 배정(§6) = 0
- 중복 배정(§7) = 0
- 잘못된 Scope / all+조건 동시(§8) = 0
- restrictive 권한 없음 오류(§9) = 0
- 보호 계정(maintenance_reporter/dorm_manager) 추가 권한 배정(§10) = 0
- 다운로드 권한 보유자(§11) = 정책 대상과 일치

## 표시 방법(권장)
- 별도 대시보드 UI를 새로 만들지 않는다(신규 기능 금지). 대신:
  - 주1회 health_check SQL 실행 → 결과를 운영 회의/시트에 기록.
  - Supabase Logs/Reports + Vercel Analytics를 즐겨찾기.
- 임계 초과·0행 위반 시 [operation-alerts.md](operation-alerts.md) 기준으로 조치.

## 한계(정직)
- 앱 내 전용 "다운로드 로그" 테이블이 없어 다운로드 건수는 네트워크/서버 로그로 근사한다. 정밀 집계가 필요하면 별도 로깅 도입을 정책으로 결정(신규 기능 → 별도 승인).
