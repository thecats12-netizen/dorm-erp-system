# 복구 절차 가이드

원칙: **원인 파악 → 영향 범위 확인 → 백업/rollback 검토 → 복구 → 검증 → 기록.**
DB 복구·rollback SQL은 **자동 실행하지 않고 영향 분석 후 수동** 실행한다. 원인 확인 전 반복 재배포 금지.

---

## 1. DB 손상 / 데이터 이상
1. 영향 범위 확인(어느 테이블/기간)
2. Supabase PITR 또는 최근 백업 시점 확인
3. **스테이징에 먼저 복원**해 검증
4. 운영 복원(가능하면 저트래픽 시간대)
5. 로그인·권한 조회·감사로그 동작 확인
6. 원인·조치 기록

## 2. 잘못된 Migration 적용
1. 어떤 Migration이 문제인지 식별
2. 해당 **rollback SQL** 확인: `supabase/rollback/` (예: `20260723..._rollback.sql`, `20260724..._rollback.sql`, `20260725..._rollback.sql`)
3. rollback SQL **내용 검토**(대상 객체만 제거, 기존 데이터 보존 확인)
4. 스테이징 검증 후 운영 수동 실행
5. `notify pgrst, 'reload schema'` 반영 확인
6. 프론트 동작(권한관리 화면) 확인
> ⚠️ rollback은 신규 객체만 제거하도록 작성돼 있으나, 데이터가 쌓인 뒤에는 해당 테이블 데이터가 함께 사라질 수 있으므로 **백업 후** 진행.

## 3. Custom Role 삭제(실수)
- Soft Delete면 **권한관리 > 삭제됨 필터 > 복구**로 되살린다.
- 복구 후 메뉴·기능·데이터 범위 재확인.
- 완전 삭제/DB에서 사라진 경우: 백업에서 `custom_roles` + `custom_role_permissions` + `custom_role_scopes` 해당 행 복원.

## 4. 사용자 권한 배정(user_custom_roles) 삭제
- 해제는 Soft Delete(is_active=false)이므로 **다시 배정**(사용자관리 > 추가 권한 재선택)으로 복구.
- 백업에서 복원 시 `user_custom_roles` 해당 행 복원.

## 5. Scope(데이터 범위) 삭제
- 권한관리 > 해당 권한 > 데이터 범위 재설정으로 복구.
- 대량 손실 시 백업에서 `custom_role_scopes` 복원.

## 6. 운영자 실수(대량 변경)
1. 변경자·시각을 **감사로그**(custom_role_audit_logs / security_audit_logs)로 확인
2. 변경 전 값(before_data)을 참고해 원복
3. 필요 시 백업 시점 복원
4. 재발 방지: 다수 배정 권한 수정은 승인·저트래픽 진행

## 7. Vercel 장애 / 배포 문제
1. Vercel 상태·배포 로그 확인
2. **이전 정상 배포로 Rollback**(Vercel > Deployments > 이전 배포 Promote)
3. 화면 blank/500 반복 시 원인 분석(빌드 로그·환경변수)
4. 원인 수정 전 반복 재배포 금지

## 8. Supabase 장애
1. Supabase 상태 페이지 확인
2. 일시적 장애면 대기 + 사용자 공지
3. 장기화 시 읽기 전용 안내·업무 대체 절차
4. 복구 후 로그인·권한·데이터 정상 확인

---

## 복구 후 공통 검증
- [ ] admin 로그인·권한관리 접근 정상
- [ ] maintenance_reporter = 청소·하자 2메뉴 유지
- [ ] restrictive/범위 계정 정상
- [ ] 감사로그 기록 지속
- [ ] Console/Network 오류 없음
- [ ] 복구 내용·시각·담당자 기록
