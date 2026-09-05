# 군대관리 v2 RLS 검증 패키지 (LOCAL / STAGING 전용)

> ⚠ **Production DB 에서 실행 금지.** 아래 SQL/러너는 로컬 `supabase start` DB 또는 별도 staging 프로젝트에서만 실행합니다.
> Production 정책 교체는 로컬 검증 PASS + 별도 승인 후, 백업·트랜잭션·rollback 대비 하에 진행합니다.

## 목적
`military_module_data` 의 **과도하게 넓은 기존 RLS 정책**(`military_module_data_admin_all` 이 role 무검사 → 모든 authenticated write 허용)을
**admin/viewer 권한 모델**로 안전하게 교체하는 SQL/러너를 검증합니다.

## 목표 권한
| role | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| admin | O | O | O | X |
| viewer | O | X | X | X |
| dorm_manager / maintenance_reporter / anon / inactive | X | X | X | X |

## 파일
- `supabase-military-rls-local-setup.sql` — 로컬에 구조+기존 정책+가짜 데이터 재현
- `supabase-military-rls-policy-v2.sql` — 정책 교체(helper 2 + safety guard + 정책 3 + 기존 2 drop)
- `supabase-military-rls-probe.sql` — 역할별 SELECT/UPDATE/INSERT/DELETE 결과(트랜잭션 ROLLBACK → 데이터 무변경)
- `supabase-military-rls-rollback.sql` — 정책 교체 되돌리기(RLS 는 ON 유지)
- `supabase-military-rls-postcheck.sql` — 조회 전용 상태 검증
- `../src/features/military/dev/militaryRlsSecurityTest.ts` — 로그인 세션 direct-API 우회 러너(DEV 전용, 자동 import 아님)

## 실행 순서
1. **Docker 준비**: Docker Desktop 설치 후 `docker info` 정상. (관리자 권한 필요)
2. **로컬 Supabase**: 프로젝트 루트에서 `supabase start` → `supabase status`(URL/키 확인, 키 공유 금지).
3. **Local Studio 접속**: status 의 Studio URL. 주소가 localhost 계열인지 확인(Production 아님).
4. **테스트 계정 생성**: Studio → Authentication → Users 에서 6개(admin/viewer/dorm/maint active + admin/viewer inactive), `*.test.local` 이메일.
5. **profiles 연결**: 각 `auth.users.id` 로 `local-setup.sql` 하단 안내대로 `profiles`(role·is_active) insert.
6. **local-setup 실행**: `supabase-military-rls-local-setup.sql`.
7. **기존 취약성 재현**: `probe.sql`(UUID 채움) 실행 → **viewer/dorm 의 UPD/INSdef 가 OK** 로 나오면 현 Production 취약성 재현 성공.
8. **정책 교체**: `supabase-military-rls-policy-v2.sql` 실행 → `postcheck.sql`(B) 로 정책이 정확히 `military_module_select/insert/update` **3개**, 기존 2개 없음 확인.
9. **역할별 재검**: `probe.sql` 다시 실행 → 아래 **PASS 표**와 대조.
10. **direct-API 우회**: 각 역할로 **로컬 앱 로그인** 후 콘솔 `__militaryRlsTest()`(위 러너 임시 import) 실행 → viewer/dorm/maint/anon write 전부 blocked, admin update/insert 허용·other/delete blocked.
11. **Realtime**: 브라우저 2개(A=admin, B=viewer) → admin 수정 시 viewer 수신 / dorm·maint·anon 미수신. **SQL probe 만으로 realtime PASS 판정하지 말 것.**
12. **saveMilitaryModule**: admin 로그인 → load→수정→저장→reload 정상. row 없는 상태에서 admin 최초 저장 INSERT 정상. viewer 는 auto-save 미실행.
13. **앱 회귀**: admin/viewer 로 8개 군대 메뉴(군인대시보드/인사관리/훈련기록/조치대상/공지사항/일정관리/보고서/군대설정) + Excel 4종 정상, viewer 마스킹 유지.
14. **미로그인 load**: 로그아웃 접속 → crash 없음·remote military 미노출·로그인 후 정상 로드.
15. **rollback 검증**: `rollback.sql` → `probe.sql` 로 viewer UPD 가 다시 OK(기존 상태 복귀) 확인 → 다시 `policy-v2.sql` 적용(최종 상태로 복원).
16. **safety guard 검증**: 기존 정책 1개 임시 `drop` 후 `policy-v2.sql` → `RAISE EXCEPTION`·전체 롤백(부분 적용 없음) 확인 → 정상 상태 복원.
17. **종료**: `supabase stop`.

## PASS 표 (9단계, 정책 교체 후)
| role | SELECT | UPD | INSdef | INSoth | DEL |
|---|---|---|---|---|---|
| admin | =1 | OK | OK | BLOCK | BLOCK |
| viewer | =1 | BLOCK | BLOCK | BLOCK | BLOCK |
| dorm_manager | =0 | BLOCK | BLOCK | BLOCK | BLOCK |
| maintenance_reporter | =0 | BLOCK | BLOCK | BLOCK | BLOCK |
| inactive_admin | =0 | BLOCK | BLOCK | BLOCK | BLOCK |
| inactive_viewer | =0 | BLOCK | BLOCK | BLOCK | BLOCK |
| anon | =0 / BLOCK | BLOCK | BLOCK | BLOCK | BLOCK |

**하나라도 불일치 시 Production 적용 금지.**

## 후속 보안 이슈(이번 범위 밖)
- **HIGH — localStorage 평문 PII**: `MILITARY_PERSONNEL_KEY` 등에 이름/전화/생년월일/군번/계좌/이메일 원문 저장(RLS 무관). → **2E 별도 트랙**(세션스토리지 전환/암호화/logout purge).
- MEDIUM — `tenant_id` UNIQUE 부재(복수 default 행 가능) → **2D 데이터 안정성**.
- MEDIUM — anon/authenticated 의 TRUNCATE/DELETE GRANT(REST 불가·latent) → **별도 GRANT hardening**.
