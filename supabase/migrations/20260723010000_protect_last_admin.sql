-- ============================================================================
-- [별도 · 자동 실행 금지] 마지막 활성 관리자(admin) 보호 트리거
--
-- 이 파일은 profiles 테이블의 UPDATE 동작을 변경한다(BEFORE UPDATE 트리거).
-- 권한관리 신규 테이블 복구(20260723000000)와 분리하여, 실제 admin 구조와 기존 계정 수정
-- 로직을 검증한 뒤에만 적용한다.
--
-- [이 프로젝트의 사실]
--   최상위 role 은 'admin' 뿐이다(super_admin 없음). 따라서 "마지막 super_admin 보호"는
--   "마지막 활성 admin 보호"로 구현한다.
--
-- [동작]
--   유일한 활성 admin 을 admin 이 아닌 role 로 변경하거나 비활성화(is_active=false)하려 하면
--   예외를 던져 차단한다. admin 이 2명 이상이면 정상 동작에 영향 없음.
--
-- [적용 전 반드시 확인]
--   - 현재 활성 admin 계정 수가 2명 이상인지(아니면 본인 계정 수정이 막힐 수 있음).
--       select count(*) from public.profiles where role='admin' and coalesce(is_active,true);
--   - 기존 계정 저장(saveUser) 흐름이 profiles 를 UPDATE 할 때 이 트리거와 충돌하지 않는지.
--
-- [안전] profiles 구조/데이터 무변경. 트리거/함수만 추가. drop table/데이터 변경 없음. 재실행 안전.
--
-- ※ 자동 실행되지 않습니다. 위 확인 후 Supabase SQL Editor 에서 1회 실행하세요.
--    롤백:
--      drop trigger if exists trg_protect_last_admin on public.profiles;
--      drop function if exists public.protect_last_admin();
-- ============================================================================

create or replace function public.protect_last_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if OLD.role = 'admin' and coalesce(OLD.is_active, true) then
    if (NEW.role is distinct from 'admin') or (coalesce(NEW.is_active, true) = false) then
      if (select count(*) from public.profiles
            where role = 'admin' and coalesce(is_active, true) and id <> OLD.id) = 0 then
        raise exception '마지막 관리자 계정은 비활성화하거나 권한을 변경할 수 없습니다.' using errcode = 'P0001';
      end if;
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_protect_last_admin on public.profiles;
create trigger trg_protect_last_admin before update on public.profiles
  for each row execute function public.protect_last_admin();
