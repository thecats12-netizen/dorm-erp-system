// 권한관리 저장소(custom_roles 등) 미적용 상태를 모듈 단위로 1회만 기록해
// 동일한 404(relation does not exist) 요청이 반복되지 않게 한다.
//  - 어느 로더든 "테이블 없음"을 감지하면 markMissing() → 이후 로더는 네트워크 호출 없이 즉시 미적용 처리.
//  - 사용자가 권한관리 화면에서 "새로고침"(reload) 하거나 페이지를 새로고침하면 reset() 되어 재확인.
//  - Migration 적용 후에는 reload/새로고침 시 실제 조회가 성공하며 안내가 자동으로 사라진다.
let tablesMissing = false;

export const markPermissionTablesMissing = () => { tablesMissing = true; };
export const arePermissionTablesMissing = () => tablesMissing;
export const resetPermissionSchemaState = () => { tablesMissing = false; };
