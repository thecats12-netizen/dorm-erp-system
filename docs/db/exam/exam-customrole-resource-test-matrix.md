# 시험관리 custom-role resource-aware 강제 — 테스트 매트릭스 (v2 · 게이트 SELECT)

> 적용 대상: `scripts/db/exam/applied/supabase-exam-customrole-resource-apply.sql` (RESTRICTIVE + SELECT 게이트).
> 원칙: **메뉴/기능 권한 AND process scope** 동시 충족해야 custom role 허용. admin/viewer/direct scope 무회귀.
> **v2 핵심**: `can_read_exam_master()`=활성 profile 전체 broad READ. 이를 보존하려고 SELECT restrictive 에
> 게이트 `not exam_has_any_custom_perm()` 를 둔다 → **custom 시험권한이 없는 사용자는 기존 broad read 그대로**,
> custom 시험권한자만 resource 권한+scope 로 좁힌다. WRITE 은 게이트 없이 admin|direct|(custom 권한+scope).
> ⚠ 아래는 설계 예상 결과. 실제 적용은 저위험 검증(§검증절차) 후에만.

## 전제 매핑
| 테이블 | resource_tab | process 근거 |
|---|---|---|
| exam_personnel | examPersonnel | process_id |
| exam_applications | examApplications | process_id (NULL 행=admin/viewer 만) |
| pm_certifications | examPmCertifications | process_id |
| dm_certifications | examDmCertifications | process_id |
| exam_annual_targets | examAnnualTargets | process_id |
| exam_monthly_results | examMonthlyResults | process_id |
| exam_results | examApplications | personnel_id → exam_personnel.process_id |

## action 매핑
- view ← `<tab>.list` 또는 `<tab>.detail` (⚠ `menu_view`는 데이터 읽기 근거 아님)
- create ← `<tab>.create` / update ← `<tab>.update` / approve ← `<tab>.approve` / status_change ← `<tab>.status_change`
- export ← `<tab>.excel_download|pdf_download|csv_download|print|file_download` (RLS는 SELECT까지만 강제, 실제 다운로드 버튼은 앱에서 추가 강제)
- action_scope: read=view / write=view·create·update·status_change / all=+approve·export
- scope_value='all' = view(read) 전용(미래 공정 자동 포함). create/update/approve/export는 특정 process_id 필요.

## 매트릭스

| # | 시나리오 | 대상 | 예상 |
|---|---|---|---|
| A0 | **활성 일반 사용자 + custom 시험권한 없음** | 전 테이블 | **기존 READ 유지**(게이트 `not exam_has_any_custom_perm()`=true → broad read 보존, 회귀 0). 쓰기는 원래대로 불가 |
| A | admin(role='admin') 조회/등록/수정 | 전 테이블 | **ALLOW** (is_exam_admin/exam_is_admin 분기) |
| B | viewer(role='viewer') 조회 / 쓰기 | 전 테이블 | **조회 ALLOW / 쓰기 DENY** (게이트 or viewer 분기로 select 통과; insert/update 미통과) |
| C | custom: `examPersonnel.list` + process(METAL/DRAM, read) | exam_personnel | 게이트 false → 해당 공정 **조회 ALLOW**, 타 공정 DENY |
| D | custom: `examPersonnel.list`+`.update` + process(METAL/FLASH, write) | exam_personnel | 해당 공정 **조회+수정 ALLOW**, approve/export DENY, 타 공정 DENY |
| E | scope 없는 공정 행 직접 접근(URL/필터 우회) | 임의 | **DENY** (custom 사용자: 게이트 false → 해당 공정 scope 없어 restrictive 차단) |
| F | scope만 있고 메뉴 권한 없음 | 임의 | custom 사용자면 게이트 true?→ **주의**: 그 사용자가 *다른* exam 권한이 있으면 게이트 true→scope 필요→DENY; exam 권한이 전혀 없으면 게이트 false→broad(하지만 그 경우 custom 시험사용자가 아님). 결론: 메뉴권한 없이 데이터 권한 부여 안 됨 |
| G | 메뉴 권한만 있고 scope 없음(SELECT/WRITE) | 임의 | **DENY** ← ⭐우회 차단 핵심. WRITE: exam_master permissive 통과하나 restrictive가 scope 요구→DENY. SELECT: 게이트 true→resource 권한 있으나 scope 없어 DENY |
| H | export 권한 없는 사용자의 다운로드 | 임의 | 행 SELECT는 scope 내 ALLOW, **다운로드는 앱 강제**(`<tab>.*_download` 없음→버튼 비노출). RLS는 export를 SELECT와 구분 못 함 → 앱 계층 병행 필수 |
| I | approve/status_change 권한 없이 승인/상태변경 | approval 테이블 | **DENY** (menu_ok(approve/status_change)=false → update restrictive custom 분기 false) |
| J | custom_role `is_active=false` | 전 테이블 | **게이트 false**(r.is_active=false) → 일반 사용자처럼 broad read, 쓰기는 crp=false라 불가. (custom 강제 해제 = 기존 동작 복귀) |
| K | user_custom_roles 해제 | 전 테이블 | **게이트 false** → 동일(기존 동작) |
| L | scope soft delete(deleted_at) | 해당 공정 | 게이트 true(권한 남음)면 해당 공정 **DENY**, 나머지 scope 유지 |
| M | 기존 direct `exam_user_process_scopes` 사용자 | 전 테이블 | **기존과 동일 ALLOW** (direct 절 무변경 + restrictive direct 분기 통과. 보통 custom 권한 없어 게이트 false로 broad read도 유지) |
| N | `examDashboard.list`만 보유 → exam_personnel SELECT | exam_personnel | **DENY** ← 게이트 true(exam 권한 보유) + examPersonnel 권한 없음 → cross-tab 차단 |
| O | `examReports.excel_download`만 보유 → personnel export | exam_personnel | **DENY** ← 게이트 true + examPersonnel 권한 없음. examReports 권한 전이 없음 |
| P | exam_results 간접 scope | exam_results | 연결 personnel.process_id가 scope 내면 **ALLOW**, 아니면 DENY. personnel.process_id NULL이면 admin/viewer/게이트-off만 |

## cross-tab 회귀 집중 검증(N/O)
기존 bridge 초안의 HIGH 위험(`split_part(key,'.',1) like 'exam%'`)은 **완전 제거**:
- `exam_custom_menu_ok(p_resource, p_perm)`는 정책이 넘긴 **리터럴 resource_tab의 permission_key만** 검사.
- 따라서 examDashboard/examReports 등 다른 탭 권한은 examPersonnel 등 다른 테이블 접근에 절대 전이되지 않음.

## legacy orphan(scope_value='assigned') 처리
- 현재 활성 1건이나 유효 user_custom_roles 0 → 실사용 영향 없음.
- `exam_custom_process_ok`: 'assigned'는 'all'도 아니고 어떤 process_id::text와도 매칭 실패 → **자동 DENY**.
- 데이터 삭제/수정 없음. 별도 cleanup 후보로만 기록(이번 apply 범위 밖).

## 검증 절차(별도 staging 미생성 방침)
1. precheck 전량 PASS(선행 helper 존재·drift 0·정책명 미충돌·유효 custom 사용자 0).
2. apply 실행 → postcheck(신규 helper/정책/ACL·기존 정책 불변·행수 불변).
3. 저위험 단위검증: 테스트용 custom role/scope를 **테스트 계정**에 부여 후 각 케이스 A~P 실제 SELECT/INSERT/UPDATE 시도 → 예상표 대조.
4. 이상 시 즉시 rollback.
