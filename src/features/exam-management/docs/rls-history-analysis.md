# 인증 이력(exam_certification_history) RLS 권한 분석

> [6][11][20] 요구에 따른 **정책 기준** 분석. "서비스 내부 전용"은 프론트엔드 서비스 함수만으로 보장되지 않으므로, 실제 DB 정책으로 판단한다. **이 문서는 분석·제안이며, 코드/migration을 적용하지 않는다.**

## 1. 현재 정책 (20260750000000)
```sql
create policy "certhist_select" on public.exam_certification_history
  for select to authenticated using (public.can_read_exam_master());
create policy "certhist_insert" on public.exam_certification_history
  for insert to authenticated
  with check ((public.is_exam_admin() or public.can_read_exam_master()) and tenant_id is not null);
-- UPDATE/DELETE 정책 없음 = 불변(append-only)
```

## 2. 헬퍼 의미 (리포지토리 확인 결과)
- `is_exam_admin()` = `profiles.role = 'admin'` (시스템 관리자 전용).
- `can_read_exam_master()` = **viewer 이상**(조회 가능한 모든 시험관리 사용자 · 커스텀 viewer 포함).
- 마스터 테이블 쓰기(20260730) = `is_exam_admin() OR crp_user_has_permission('<tabkey>.create')` — 즉 **관리자 또는 해당 탭 `create` 권한 보유자만**. (pm_certifications = `examPmCertifications.create`)

## 3. 판정 → **권한 과다 (viewer append 가능)**
현재 INSERT `with check`가 `can_read_exam_master()`를 포함하므로, **조회 권한만 있는 viewer 계정도 PostgREST로 직접 이력 row를 INSERT**할 수 있다. 프론트엔드는 PM 승인(관리자/매니저) 시점에만 append하지만, RLS는 이를 강제하지 않는다 → "쓰기: 서비스 내부만"이라는 의도와 불일치.

**영향 범위(블라스트 반경) — 낮음~중간**
- UPDATE/DELETE 정책이 없어 **기존 이력 위·변조·삭제 불가**(불변 유지).
- `tenant_id is not null` + 함수가 자기 tenant로 제한 → **타 tenant 오염 불가**.
- 가능한 악용: 자기 tenant에 **가짜 append-only 이력 row 삽입**(데이터 신뢰도/노이즈). 경과개월·Preview는 이력을 아직 **계산에 사용하지 않으므로** 현재 판정에는 영향 없음. 단, 향후 이력 기반 경과개월/자동화가 도입되면 **신뢰성 훼손 위험**으로 승격됨.

**참고(설계 일관성)**: 이 정책은 `exam_audit_logs`의 INSERT 정책(`is_exam_admin() OR can_read_exam_master()`)을 그대로 따른 것이다. 프로젝트는 "append-only + tenant 고정 로그는 조회 가능 사용자가 INSERT해도 과도하지 않다"고 간주(20260730 주석). 따라서 **감사로그와 동일 등급의 허용 위험**이며 신규 취약점은 아니다. 그러나 이력은 감사로그보다 **업무 신뢰 데이터**에 가깝고 향후 계산 근거가 되므로, 더 엄격히 잠그는 것을 권장한다.

## 4. 권장 조치 (택1 · 미적용 제안)

### 옵션 A (최소 · 권장) — 마스터 쓰기 권한과 정렬
history append의 실제 트리거는 **PM 승인**이므로, PM 쓰기 권한 보유자만 append하도록 정렬한다. 새 additive migration(예: `20260751000000_certhist_tighten_insert.sql`)로 정책만 교체:
```sql
-- 제안(미적용). 기존 20260750 파일은 수정하지 않고 신규 migration 으로 정책 교체.
begin;
drop policy if exists "certhist_insert" on public.exam_certification_history;
create policy "certhist_insert" on public.exam_certification_history
  for insert to authenticated
  with check (
    (public.is_exam_admin()
      or public.crp_user_has_permission('examPmCertifications.create'))
    and tenant_id is not null
  );
commit;
-- rollback: drop 후 20260750 의 원 정책(can_read_exam_master 포함)으로 재생성.
```
→ viewer append 차단, PM 승인자(관리자/매니저)는 정상 append. **코드 변경 불필요.**

### 옵션 B (강함) — SECURITY DEFINER RPC로 "서비스 내부 전용" 강제
직접 INSERT 정책을 제거하고, 승인 검증을 수행하는 `security definer` 함수로만 append:
```sql
-- 제안(미적용).
-- 1) certhist_insert 정책 제거(직접 INSERT 불가)
-- 2) create function public.exam_append_cert_history(...) returns uuid
--      language plpgsql security definer set search_path=public as $$
--      begin
--        if not (public.is_exam_admin() or public.crp_user_has_permission('examPmCertifications.create'))
--          then raise exception 'insufficient permission'; end if;
--        insert into public.exam_certification_history(...) values (...) returning id; ...
--      end $$;
--    revoke all on function ... from public; grant execute to authenticated;
```
→ 서비스는 `supabase.rpc('exam_append_cert_history', {...})`로 호출(현 `appendCertificationHistory` 내부만 교체). **이 경우 시험관리 내부 코드 1곳 수정 필요** → 실제 검증 단계에서 결함으로 확정되면 최소 diff로 적용.

## 5. 결론
- **현재도 불변성·tenant 격리는 확보**되어 즉시 위험(데이터 파괴/유출)은 없음.
- 다만 **viewer append 가능은 의도(서비스 내부 전용) 대비 권한 과다** → **옵션 A(최소 정책 정렬)** 를 다음 단계 적용 권장. 이력을 계산/자동화에 사용하기 **이전에** 반드시 조치.
- 본 단계에서는 **미적용**(문서 제안). 적용은 별도 additive migration으로 진행.
