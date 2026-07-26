# 직원별 인증 Preview / 엔진 실동작 검증 절차

> 조회 전용 검증. 운영 데이터 변경 금지. 아래 절차는 **테스트 tenant**에서만 수행합니다.
> 대조 SQL은 [`preview-validation.sql`](./preview-validation.sql) 참조(모두 SELECT).

## 0. 사전 조건 — migration 적용 확인
`preview-validation.sql`의 **[2]** 블록을 실행해 아래가 모두 존재하는지 확인:
- `exam_levels`: `tier / parent_level_id / requires_approval / auto_promote / rank_order`
- SINGLE/M1~M4 seed row (테스트 tenant)
- 테이블 `exam_equipment_stage_rules`, `exam_equipment_certifications`
- `exam_equipment_stage_rules`의 exclusion constraint(`contype='x'`) + `btree_gist` 확장
- `exam_equipment_certifications`의 partial unique(승인 1건 / 열린 후보 1건)
- 두 테이블의 RLS 정책

**하나라도 없으면** 기능 테스트를 중단하고 "migration 미적용"으로 판단합니다.

## 1. 테스트 데이터(테스트 tenant 전용, 예시)
> ⚠ 반드시 `tenant_id='test'` 등 **테스트 tenant**에서만. 운영 tenant 금지.

| 직원 | 설계 | 확인 포인트 |
|---|---|---|
| A | hire_date 有 · 공정 1개 배정 · 승인 설비 0 | 취득률 분모/분자, 빈 취득 상태 |
| B | 승인 설비 일부 · Single 충족 · M1 미충족 | 단계 순차 판정 |
| C | M1 충족 · M2 미충족 | 선행단계 반영 |
| D | 필수 설비 + 주력설비 + 취득률 조건 | 복합 criteria |
| E | 설비 `metadata.needs_reeval=true` | 재평가 배지 |

각 설비 취득 row 필수 연결값: `tenant_id / personnel_id / process_id / equipment_id / level_id / line_id / acquired_date / status / deleted_at`.
`pm_certifications`로 현재 확정 단계·경과개월(acquired_date)을 구성.

## 2. 브라우저 테스트 체크리스트 ([15])
인증 기준관리 → **직원별 인증 Preview** 탭에서:
1. 탭 진입 / 2. 직원 검색 / 3. 선택 / 4. 공정 필터 / 5. 공정 전체 /
6. 승인설비 0 직원(A) / 7. 일부 취득(B) / 8. Single 충족 / 9. M1 충족(C) /
10. M2 미충족 / 11. AND / 12. OR / 13. 필수설비 / 14. 주력설비 / 15. 취득률 /
16. 근속개월 / 17. 경과개월 데이터 없음("단계 취득일 정보 없음") / 18. 재평가 배지(E) /
19. 재계산 / 20. 직원 변경 시 이전 결과 초기화 / 21. 로딩 / 22. 빈 상태 /
23. DB 오류 한글 안내(테이블 drop 상태로 진입) / 24. UUID·내부코드 비노출 / 25. 좁은 화면(1열).

각 화면값을 `preview-validation.sql` 결과와 대조하여 일치 여부를 기록.

## 3. 계산 규칙(현재 구현 기준)
- **승인 설비**: `status='approved' AND deleted_at is null`, 동일 설비 중복 승인은 `Set`으로 1건.
- **대상 설비(분모)**: 공정의 활성 설비. **분모 0 → "대상 설비 기준 없음"** 표시(0% 임의 판정·자동 충족 안 함).
- **주력설비**: `exam_equipment_stage_rules.is_core_equipment=true` + 현재 유효기간(effective_from/to) + 승인 취득분.
- **criteria 선택**: `rule_type` 공백 무시 매칭(`달성 기준`/`달성기준`), 공정·레벨·활성·유효기간 필터 후 **priority↓ → effective_from↓** 우선순위 상위 1건. 동일 레벨 복수 유효 시 **중복 기준 경고** 표시.
- **단계 판정**: `calculateProcessStageEligibility` — rank_order 순, 선행 미충족 시 상위 미통과, 기준 없는 단계는 자동 통과 안 함(`기준 규칙 미정의`).
- **현재 확정 단계**: `pm_certifications`(공정 스코프, `is_active`·`deleted_at`·만료(expiry) 필터), `level_id` 우선 → `pm_level` 텍스트 fallback → 최고 rank.
- **근속개월**: `hire_date` 완전 개월(로컬 tz 변환 없이 Y/M/D 정수 비교), 미래·누락 시 null → "입사일 정보 없음".
- **경과개월**: 확정 단계 취득일(`pm_certifications.acquired_date`) 기준 — 단계간=최고 rank 확정일→오늘, 누적=최저 rank 확정일→오늘. **신뢰 가능한 단계 확정일이 없으면 null 유지("단계 취득일 정보 없음"), 조건 미충족, 자동 확정 없음.**

## 3.5 실행 런북 (테스트 DB 보유자용)
> 이 리포지토리 환경에는 **docker/psql/DB 비밀번호/브라우저가 없어** 아래를 자동 실행할 수 없습니다.
> 테스트 프로젝트 자격이 있는 담당자가 아래를 실행하세요. **운영 프로젝트에는 적용 금지.**

### (a) migration 4종 적용
```bash
# 옵션 1) 로컬 일회용 테스트 DB (docker 필요)
supabase start
supabase db reset            # supabase/migrations/* 전체 적용(테스트 전용)

# 옵션 2) 원격 "테스트" 프로젝트 (운영 아님을 반드시 확인)
supabase link --project-ref <TEST_PROJECT_REF>
supabase db push             # 미적용 migration만 반영
```
적용 후 `preview-validation.sql` **[2]** 블록으로 컬럼/seed/테이블/constraint/RLS 존재를 확인.

### (b) 테스트 직원 A~E 준비 (테스트 tenant 전용)
`tenant_id='test'` 등에서 `exam_personnel`(hire_date/process_id), `exam_equipment_certifications`(status/acquired_date), `pm_certifications`(**approval_status='승인'**, acquired_date), `exam_equipment_stage_rules`(is_core_equipment/effective 범위), `exam_rules`(rule_type='달성 기준', criteria) row를 §1 표대로 구성.
> ⚠ 확정 단계는 반드시 `approval_status='승인' AND is_active=true AND deleted_at is null AND (expiry_date is null OR expiry_date>=오늘)` 이어야 Preview에 "현재 확정 단계"로 반영됩니다(대기/반려/승인취소(대기)는 제외).

### (c) 대조 & 기록
`preview-validation.sql`의 각 블록 실행값과 Preview 화면값을 §2 체크리스트·본 완료보고 [5]~[29] 항목으로 1:1 대조하여 일치/불일치를 기록.

## 4. 데이터 구조 한계 / 다음 단계 migration 제안 ([12][35])
현재 경과개월은 `pm_certifications.acquired_date`(단계 확정일)에 의존한다. PM 확정 이력이 없는 직원은 elapsed/cumulative를 산출할 수 없어 해당 조건은 미충족 처리된다(설비 취득일로 임의 대체하지 않음).

정밀 계산이 필요하면 **다음 단계에서** 아래를 제안(이번 단계는 migration 생성 금지):
- `pm_certifications`에 단계 전이 이력 신뢰성 보강(또는 별도 `exam_stage_transitions(personnel_id, process_id, level_id, confirmed_at)` 테이블) — 단계별 확정일을 명시적으로 기록.
- 재평가 근거를 위한 `criteria_version` / `last_evaluated_at` 스냅샷 컬럼(현재는 `metadata.needs_reeval`만 활용, 규칙 변경 자동 감지는 미구현 → 추측하지 않음).
