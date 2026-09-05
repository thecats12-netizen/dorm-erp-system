# 시험 브리지 staging 테스트 계정 역할표

> ⚠ STAGING 전용. 실제 이메일/비밀번호는 이 문서에 적지 않는다.
> staging Supabase → Authentication → Users 에서 아래 7개를 직접 생성하고, 각 UUID를 복사해
> `exam-bridge-staging-seed.sql` 의 `__T_*_UUID__` 자리표시자에 치환한다.
> (계정 이메일은 예: `t_admin@example.invalid` 처럼 non-routable 도메인 권장.)

## 계정 역할표

| 계정 | seed placeholder | profiles.role | profiles.exam_role | custom role | direct scope | 기대 접근 process | 기대 허용 action | 기대 차단 |
|---|---|---|---|---|---|---|---|---|
| t_admin | `__T_ADMIN_UUID__` | admin | (super 자동) | 없음 | 없음 | 전체(CMP/CVD/ETCH+미래) | 전체(view/create/update/approve/export) | 없음 |
| t_viewer | `__T_VIEWER_UUID__` | viewer | null | 없음 | 없음 | 전체 읽기 | view 전체 | create/update/approve/export |
| t_direct | `__T_DIRECT_UUID__` | viewer | process_owner | 없음 | CMP(view+create+update) | CMP만 | CMP view/create/update | CVD/ETCH 전부, CMP approve/export |
| t_custom | `__T_CUSTOM_UUID__` | viewer | null | t_cvd_read(restrictive) | 없음 | CVD만(read) | CVD view | CVD create/update, CMP/ETCH 전부 |
| t_custom_all | `__T_CUSTOM_ALL_UUID__` | viewer | null | t_all_read | 없음 | 전체(read, 미래 포함) | 전체 view | 전체 create/update/approve/export |
| t_custom_write | `__T_CUSTOM_WRITE_UUID__` | viewer | null | t_cvd_write | 없음 | CVD | CVD view/create/update | CVD approve/export, CMP/ETCH 전부 |
| t_coarse | `__T_COARSE_UUID__` | viewer | null | t_coarse(examApplications.update + CVD write) | 없음 | CVD | apps(CVD) update | **certs(CVD) update = 차단이어야 정상(FAIL 시 HIGH)** |

## 비고
- exam_role 게이트: admin→super(전권), viewer→전체 읽기, custom role 사용자는 브리지 적용 후 process_owner 상당으로 인정(단 메뉴권한 AND process scope 필요).
- t_no_menu(custom_roles `t_no_menu`)는 계정 미배정 상태로 seed 됨 — 필요 시 t_custom UUID에 재배정해 "메뉴권한 없음+scope=차단"(CASE J)을 별도 확인.
- 모든 값은 가짜. 실제 인사/시험 데이터·PII 없음.
