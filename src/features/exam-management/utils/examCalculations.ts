// 시험관리 자동화 공통 계산 타입/헬퍼(공통 구조만 — 실제 PM/D.M/실적 계산 로직은 아직 구현하지 않음).
// 자동계산값(auto)과 관리자 수동 확정값(manual)을 명확히 구분한다. 수동 확정값은 자동계산이 덮어쓰지 않는다.

// 계산 모드: 자동계산 결과(auto) vs 관리자 수동 확정(manual).
export type CalculationMode = "auto" | "manual";

// 자동화 계산 공통 반환 구조.
//  - value: 계산/확정 값
//  - mode: 이 값이 자동계산인지 수동 확정인지
//  - reasons: 값이 그렇게 계산/확정된 근거(예: 적용된 규칙)
//  - warnings: 데이터 부족·모호함 등 주의 사항
//  - calculatedAt: 계산 시각(ISO)
export type CalculationResult<T> = {
  value: T;
  mode: CalculationMode;
  reasons: string[];
  warnings: string[];
  calculatedAt: string;
};

const nowIso = () => new Date().toISOString();

// 공통 결과 생성기(옵션으로 근거/경고/모드/시각 지정).
export function createCalculationResult<T>(
  value: T,
  opts?: { mode?: CalculationMode; reasons?: string[]; warnings?: string[]; calculatedAt?: string }
): CalculationResult<T> {
  return {
    value,
    mode: opts?.mode ?? "auto",
    reasons: opts?.reasons ? [...opts.reasons] : [],
    warnings: opts?.warnings ? [...opts.warnings] : [],
    calculatedAt: opts?.calculatedAt ?? nowIso(),
  };
}

// 빈 자동계산 결과(값만 지정). 미구현 계산의 기본 반환에 사용.
export function emptyResult<T>(value: T): CalculationResult<T> {
  return createCalculationResult(value, { mode: "auto" });
}

// 자동계산 결과.
export function autoResult<T>(value: T, reasons: string[] = [], warnings: string[] = []): CalculationResult<T> {
  return createCalculationResult(value, { mode: "auto", reasons, warnings });
}

// 관리자 수동 확정 결과.
export function manualResult<T>(value: T, reasons: string[] = [], warnings: string[] = []): CalculationResult<T> {
  return createCalculationResult(value, { mode: "manual", reasons, warnings });
}

export const isAuto = <T>(r: CalculationResult<T>): boolean => r.mode === "auto";
export const isManual = <T>(r: CalculationResult<T>): boolean => r.mode === "manual";

// 근거/경고 추가(불변 — 새 객체 반환).
export function withReason<T>(result: CalculationResult<T>, ...reasons: string[]): CalculationResult<T> {
  return { ...result, reasons: [...result.reasons, ...reasons] };
}
export function withWarning<T>(result: CalculationResult<T>, ...warnings: string[]): CalculationResult<T> {
  return { ...result, warnings: [...result.warnings, ...warnings] };
}

// 수동 확정값 우선 원칙: 관리자가 확정한 값(manual)이 있으면 그 값을 유지하고,
// 없을 때만 자동계산 결과를 사용한다. (자동계산이 수동 확정값을 덮어쓰지 않도록 하는 공통 진입점)
export function resolveCalculation<T>(
  auto: CalculationResult<T>,
  manual?: { value: T; reasons?: string[] } | null
): CalculationResult<T> {
  if (manual !== undefined && manual !== null) {
    return manualResult(manual.value, manual.reasons ?? ["관리자 수동 확정값"]);
  }
  return auto;
}
