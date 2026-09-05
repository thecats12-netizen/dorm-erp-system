# 군대 custom-role 부서 범위 서버 강제 — 테스트 매트릭스

> 적용: `scripts/db/military/applied/supabase-military-dept-scope-apply.sql` (helper 2 + RPC 최소 확장).
> 경계: 서버 RPC `get_military_module_for_current_user()`. 프론트 필터 아님.
> canonical: unit → btrim → 맨앞 `D-`/`F-` prefix만 제거 → scope_value case-insensitive exact.
> ⚠ 실제 적용은 precheck [M1~M8] 확정 + postcheck 통과 후에만.

## 매칭 규칙 요약
| actual unit | canonical | CMP scope | CVD scope |
|---|---|---|---|
| D-CMP / F-CMP | CMP | ✓ | ✗ |
| D-CVD / F-CVD | CVD | ✗ | ✓ |
| D-Metal / D-IMP / D-DIFF … | Metal/IMP/DIFF | ✗ | ✗ |
| (빈/NULL) | — | ✗ | ✗ |

## 매트릭스
| # | 시나리오 | 기대 |
|---|---|---|
| A | admin | **raw 전체**(부서 필터 미적용, PII 포함) |
| B | viewer, custom military scope 없음 | `military_allowed_units()`=NULL → **기존 sanitized 전체**(회귀 0) |
| C | viewer + CMP | personnel = **D-CMP16+F-CMP17=33명**, 그 외 부서 제외 |
| D | viewer + CVD | personnel = **D-CVD3+F-CVD5=8명** |
| E | viewer + CMP+CVD | personnel = **41명** |
| F | viewer + CMP+CVD | D-Metal/D-IMP/D-DIFF 등 **제외**(canonical 불일치) |
| G | trainingRecords | `personnelId ∈ 허용 personnel(v_pids)` 만 |
| H | notices(특정 대상) | `personnelIds ∩ v_pids ≠ ∅` 일 때만 |
| I | notices(전사공지: personnelIds 빈/없음) | **유지**(부서 무관) |
| J | reports | personnel 참조 필드 없음 → **기존 sanitized 유지**(부서로 제거 안 함) |
| K | actionItems/calendar = NULL | 오류 없이 기존 semantics(현재 RPC projection 미포함 → 미반환) |
| L | 향후 actionItems/calendar array 도입 | apply 주석 위치에 `v_pids` 필터 추가하면 personnel 참조형 필터 가능 |
| M | scope 제거(soft delete) | `military_allowed_units()`=NULL → **즉시 기존 sanitized 전체 복귀** |
| N | custom role 만료/비활성 | valid_until/ is_active 가드 → scope 미적용(=NULL) → 기존 전체 |
| O | raw table 직접 SELECT | military_module_data RLS/GRANT 불변 → **raw 접근 확대 없음**(viewer raw 직접 조회 불가) |

## PII/마스킹
- C~E 모두 personnel의 phone/birthDate는 기존 마스킹 유지(REMOVE 필드: serviceNumber/account/bank/emergency/workPhone/email/notes/serviceBranch).
- 부서 필터는 마스킹 위에 **추가** 적용(마스킹 약화 없음).

## 검증 절차
1. precheck [M1~M8] 실행·확정(RPC 원문·참조 key·unit 표기 일치·RLS/GRANT).
2. apply 실행(트랜잭션).
3. postcheck: N1~N6(객체/ACL/RLS/GRANT 불변) · **N7 데이터 md5 불변** · **N8 CMP=33/CVD=8/CMP+CVD=41/빈unit=0** · N9 부서별 매칭 표본.
4. 테스트 계정(viewer+CMP+CVD)으로 실제 RPC 호출 → personnel 41명, training/notices 필터 확인.
5. 이상 시 rollback(RPC 를 M1 원문으로 복원 + helper DROP).
