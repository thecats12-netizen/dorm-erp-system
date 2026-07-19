-- ============================================================================
-- 실기 평가 최종 확정 — 원자적 쓰기 RPC(신규 함수 · 신규 테이블 없음)
--
-- [목적]
--   실기 평가 최종 확정 시 여러 UPDATE(exam_results 확정정보 + exam_applications 합격일/상태)가
--   부분 성공으로 남지 않도록 "하나의 함수 = 하나의 트랜잭션"으로 처리한다.
--   판정(합격/불합격) 계산은 클라이언트의 순수 엔진(computePracticalResult)이 재조회·재계산해 verdict 를
--   확정한 뒤 이 RPC 에 전달한다(SQL 에서 엔진을 중복 구현하지 않음). RPC 는 verdict 를 신뢰하되
--   권한/tenant/멱등만 서버에서 방어한다.
--
-- [원칙]
--   · SECURITY DEFINER — RLS 우회하므로 내부에서 권한(approve/admin) + tenant 를 반드시 검증.
--   · 신규 컬럼(20260733) 미적용이면 update 가 컬럼오류를 내므로, 적용 확인 후에만 호출한다(클라이언트 방어).
--   · 전체 합격일 때만 practical_pass_date/status 갱신. 불합격/부분은 practical_pass_date 미변경(덮어쓰기 금지).
--   · 멱등: 이미 practical_pass_date 존재(합격 확정)면 재확정 skip.
--   · 기존 status 체계 값 '실기 합격'(STATUS_OPTIONS) 사용 — 신규 상태 문자열 생성 없음.
--
-- ※ 자동 실행 금지. 승인 후 1회 수동 실행. 선행: 20260716(is_exam_admin), 20260722/23(crp_user_has_permission), 20260733(exam_results 컬럼).
--    롤백: 20260734000000_finalize_practical_evaluation_rpc_rollback.sql
-- ============================================================================

create or replace function public.finalize_practical_evaluation(
  p_tenant text, p_application_id uuid, p_overall_pass boolean, p_completed_date date, p_eval_status text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_app record;
begin
  -- 1) 권한: 관리자 또는 examApplications.approve 보유(버튼 숨김만이 아닌 서버 최종 방어).
  if not (public.is_exam_admin() or public.crp_user_has_permission('examApplications.approve')) then
    return jsonb_build_object('ok', false, 'error', 'permission');
  end if;

  -- 2) 대상 응시(tenant 격리 · 미삭제).
  select id, tenant_id, practical_pass_date, status into v_app
  from public.exam_applications
  where id = p_application_id and tenant_id = p_tenant and deleted_at is null;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;

  -- 3) 멱등: 이미 실기 합격일이 있고 이번도 합격이면 중복 확정 방지(안전 반환).
  if p_overall_pass and v_app.practical_pass_date is not null then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  -- 4) exam_results(해당 application 의 practical 행) 확정정보 갱신.
  update public.exam_results
     set finalized_at = now(), finalized_by = auth.uid(), eval_status = p_eval_status,
         updated_by = auth.uid(), updated_at = now()
   where tenant_id = p_tenant and application_id = p_application_id and result_type = 'practical' and deleted_at is null;

  -- 5) 전체 합격일 때만 응시행 반영(불합격/부분은 practical_pass_date 미변경 = 기존 합격 보존).
  if p_overall_pass then
    update public.exam_applications
       set practical_pass_date = coalesce(p_completed_date, current_date),
           status = '실기 합격', updated_by = auth.uid(), updated_at = now()
     where id = p_application_id and tenant_id = p_tenant;
  end if;

  return jsonb_build_object('ok', true, 'overall_pass', p_overall_pass);
end $$;

revoke all on function public.finalize_practical_evaluation(text, uuid, boolean, date, text) from public, anon;
grant execute on function public.finalize_practical_evaluation(text, uuid, boolean, date, text) to authenticated;
