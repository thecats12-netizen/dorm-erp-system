# 시험관리 보안 통합 검수 (10단계)

> 검수만 수행 · 배포 없음. 실제 RLS/권한 구조를 코드·마이그레이션 기준으로 확인한 결과.
> 검증 SQL: `supabase/diagnostics/exam_security_audit.sql` (비파괴 조회).

## 1. 인증·권한 구조 (실제)
- **인증**: Supabase Auth `signInWithPassword` (`services/authService.ts`). 클라이언트는 **anon key만** 사용(`.env` = `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`). `service_role_key` 클라이언트/번들 **미노출**(사용자 생성은 Edge Function).
- **역할 정본(서버)**: `profiles.role`(admin/viewer/dorm_manager/maintenance_reporter) + `profiles.exam_role`(super/admin/process_owner/viewer) + `custom_roles`/`user_custom_roles`. **localStorage 역할값은 권한 판정에 미사용**(검색 결과 0건).
- **권한 서비스**: `examPermissionService.loadMyExamPermissions(tenantId)` — 서버 `profiles` 조회 기반. 프론트는 UI 제어(canEdit)만.

## 2. RLS 모델 (핵심 — `20260716_fix_exam_all_tables_rls`)
JWT 커스텀 클레임 훅이 **비활성**이라, RLS는 JWT가 아니라 **DB `profiles`** 로 판정한다:
- `is_exam_admin()` = `profiles.role='admin' AND is_active` — SECURITY DEFINER, `search_path=public` 고정, anon EXECUTE revoke.
- `can_read_exam_master()` = 활성 로그인 사용자.
- **SELECT** = 활성 authenticated 전체 / **INSERT·UPDATE** = admin 전용(+ `tenant_id NOT NULL`) / **DELETE 정책 없음 → 물리삭제 차단(soft delete만)**.
- 적용 범위: 시험 18개 테이블 + `pm/dm_certifications` + `employee_license_plan`(admin/viewer) + `exam_user_process_scopes` + `custom_*`.

**결론**: 프론트 변조·localStorage·JWT 조작으로 **권한 상승 불가**(DB `profiles.role`가 정본). 물리삭제 불가.

## 3. 확인된 강점 (필수 완료 조건 충족)
| 항목 | 상태 |
|---|---|
| service_role_key 클라이언트 미노출 | ✅ |
| localStorage 변조로 권한 상승 | ✅ 불가(서버 profiles 판정) |
| RLS 없는 핵심 시험 테이블 | ✅ 없음(18+테이블 전수 활성) |
| INSERT/UPDATE 서버 검증(WITH CHECK) | ✅ admin 전용 |
| 물리삭제 차단 | ✅ DELETE 정책 없음 |
| anon 접근 | ✅ 차단(정책·EXECUTE revoke) |
| SECURITY DEFINER search_path 고정 | ✅ 보안 함수 고정 |
| 환경변수(VITE_) | ✅ URL+ANON만 |

## 4. 잔여 위험 / 미구현 (정직한 기록)
| # | 항목 | 현재 | 위험도 | 조치(제안) |
|---|---|---|---|---|
| R1 | **멀티테넌트 격리** | RLS는 `tenant_id NOT NULL`만 강제(단일 테넌트 'default') | 중(멀티테넌트化 시) | 멤버십 기반 `tenant_id = 내 tenant` 조건 추가(별도 마이그레이션, 설계 변경) |
| R2 | **행단위 담당범위(공정/그룹)** | SELECT는 활성 사용자 전체 허용, 범위 필터는 대부분 프론트 | 중 | `exam_user_process_scopes` RESTRICTIVE 정책으로 서버 강제(별도 단계) |
| R3 | **비관리자 쓰기** | INSERT/UPDATE는 admin 전용(process_owner 등 서버 쓰기 불가) | 저(정책상 일관) | 필요 시 스코프 기반 쓰기 정책 추가 |
| R4 | **개인정보 마스킹(역할별)** | 미구현(활성 사용자 전체가 성명/사번 조회) | 중 | `utils/dataMasking.ts` + 뷰/컬럼 최소 select |
| R5 | **다운로드/Excel/PDF 감사로그** | 미기록 | 저~중 | 다운로드 시 `writeExamAudit` 호출 추가 |
| R6 | **Rate Limit / idempotency_key** | 미구현(유니크 제약·중복클릭 방지만) | 저 | Edge Function/게이트웨이 도입 시 |
| R7 | **파일 다운로드 signed URL 만료/재사용** | 스토리지 정책 하드닝 있음(`20260722010000`), 앱 다운로드 경로 별도 점검 필요 | 중 | signed URL + tenant 경로 검증 재확인 |

## 5. 배포 전 필수 조치 (운영)
1. **`exam_security_audit.sql` 실행** → 모든 RLS `true`, DELETE 정책 0, anon 권한 0, 보안함수 search_path 고정 확인.
2. `profiles.role` 정합성 확인(활성 admin 최소 1명, 오남용 계정 없음).
3. 스토리지 버킷이 **비공개**이고 다운로드가 signed URL 경유인지 재확인(공개 버킷 금지).
4. `.env`/Vercel에 `service_role`·비밀키 부재 재확인, Git 이력에 키 미포함 확인.
5. (멀티테넌트 계획 시) R1 격리 정책을 별도 마이그레이션으로 설계·검증 후 적용.

> 이번 단계는 RLS를 **재작성하지 않았다**(현 단일테넌트·profiles 기반 정책이 정상 동작 중이며, 변경은 회귀 위험). 위 잔여 항목은 추가(additive) 작업으로 별도 진행 권장.
