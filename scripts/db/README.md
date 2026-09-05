# Database Script Safety Policy

이 디렉터리(`scripts/db/**`)는 HTS 운영관리 v4의 Supabase(Postgres) 관련 SQL을
**보관·감사 목적**으로 정리한 곳입니다. 아래 원칙을 반드시 지켜 주세요.

## 실행 안전 원칙

- **Production SQL은 승인 없이 실행 금지.** 모든 실행은 사전 승인 + 백업 + precheck 이후에만.
- **`applied/` 파일은 재실행 금지.** 이미 Production에 반영된 최종본입니다. 재실행은 정책 중복/충돌을 유발할 수 있습니다.
- **`rollback/` 파일은 장애 복구 승인 없이 실행 금지.** 실행 시 배포된 보안 강제(RLS/RPC/GRANT)를 되돌립니다.
- **`staging/` 파일은 Production 실행 절대 금지.** staging/local 전용입니다.
- **`archive/` 파일은 현재 운영용으로 사용 금지.** 대체된 설계이거나 적용 여부가 확인되지 않은 변형본입니다.
- **`verification/`은 원칙적으로 read-only 검증용**(precheck/postcheck/probe/audit)입니다. 그래도 실행 전 내용을 확인하세요.
- SQL 실행 전 **백업 + precheck 필수.**
- **Supabase Dashboard에서 임의 실행 금지.** 반드시 검토·승인 절차를 거칩니다.
- **service_role 관련 변경은 별도 승인 필수.**
- **파일이 존재한다 = 실행이 필요하다는 의미가 아닙니다.** 대부분은 이미 적용됐거나 보관용입니다.

## 폴더 구조

```
scripts/db/
  exam/        # 시험관리 custom-role 서버 강제(RLS/helper/bridge)
    applied/       # Production 적용 최종본 (재실행 금지)
    verification/  # precheck/postcheck/audit (read-only 검증)
    rollback/      # 되돌림 전용 (승인 없이 실행 금지)
    archive/       # 대체된 설계·적용 불명 (사용 금지)
    staging/       # staging/local 전용 (Production 금지)
  military/     # 군대관리 부서 scope·RLS·GRANT
    applied/ / verification/ / rollback/ / archive/ / staging/
```

각 모듈의 파일별 상태는 `exam/README.md`, `military/README.md`의 상태 표를 참고하세요.
관련 테스트 매트릭스·runbook은 `docs/db/exam/`, `docs/db/military/`에 있습니다.

## 상태 라벨

| 라벨 | 의미 |
|---|---|
| `APPLIED_DO_NOT_RERUN` | Production 적용 완료 — 재실행 금지 |
| `SAFE_READ_ONLY` | 조회·검증용 — 상대적으로 안전 |
| `ROLLBACK_DO_NOT_RUN` | 되돌림 전용 — 승인 없이 실행 금지 |
| `STAGING_ONLY` | staging/local 전용 — Production 금지 |
| `ARCHIVED_DO_NOT_USE` | 대체된 구버전 — 사용 금지 |
| `UNKNOWN_STATUS` | 적용 여부 불명 — 확인 전 사용 금지 |
