// 시험관리 인증 규칙 엔진(공통 구조만 — 실제 PM/D.M/실적 규칙은 아직 등록/구현하지 않음).
// 규칙은 exam_rules 등 기준정보에서 주입받아 평가하는 것을 전제로 하며, 여기서는 골격/타입만 제공한다.
import {
  type CalculationMode,
  type CalculationResult,
  createCalculationResult,
  emptyResult,
} from "../utils/examCalculations";

// 규칙 평가 입력(직원/응시/기준정보 등 계산에 필요한 컨텍스트). 실제 필드는 각 규칙 구현 시 확정.
export type RuleContext = Record<string, unknown>;

// 개별 규칙: 컨텍스트를 받아 부분 결과(값/근거/경고)를 반환하거나, 해당 없음이면 null.
export type Rule<T> = {
  id: string;
  description?: string;
  // 적용 시 값과 근거/경고를 반환. 적용 대상이 아니면 null.
  evaluate: (ctx: RuleContext) => { value: T; reasons?: string[]; warnings?: string[] } | null;
};

export type RuleEngineOptions = {
  // 여러 규칙이 매칭될 때 우선순위 결정(기본: 등록 순서상 마지막 매칭이 우선). 추후 규칙 구현 시 확장.
  mode?: CalculationMode;
};

export type RuleEngine<T> = {
  readonly rules: ReadonlyArray<Rule<T>>;
  register: (rule: Rule<T>) => RuleEngine<T>;
  // 규칙을 순서대로 평가해 공통 CalculationResult 로 집계. 매칭 규칙이 없으면 fallback 값의 빈 결과.
  run: (ctx: RuleContext, fallback: T) => CalculationResult<T>;
};

// 규칙 엔진 생성(골격). 규칙 미등록 시 run 은 항상 빈 자동계산 결과를 반환한다.
export function createRuleEngine<T>(initialRules: Rule<T>[] = [], options: RuleEngineOptions = {}): RuleEngine<T> {
  const rules: Rule<T>[] = [...initialRules];

  const engine: RuleEngine<T> = {
    get rules() {
      return rules;
    },
    register(rule: Rule<T>) {
      rules.push(rule);
      return engine;
    },
    run(ctx: RuleContext, fallback: T): CalculationResult<T> {
      if (rules.length === 0) {
        // 아직 등록된 규칙이 없음 → 미구현 안내만 담아 빈 자동계산 결과 반환.
        return emptyResult(fallback);
      }
      const reasons: string[] = [];
      const warnings: string[] = [];
      let value: T = fallback;
      let matched = false;
      for (const rule of rules) {
        const outcome = rule.evaluate(ctx);
        if (!outcome) continue;
        matched = true;
        value = outcome.value; // 마지막 매칭 우선(추후 우선순위 정책으로 확장)
        if (outcome.reasons) reasons.push(...outcome.reasons.map((r) => `[${rule.id}] ${r}`));
        if (outcome.warnings) warnings.push(...outcome.warnings.map((w) => `[${rule.id}] ${w}`));
      }
      if (!matched) warnings.push("적용 가능한 규칙이 없습니다.");
      return createCalculationResult(value, { mode: options.mode ?? "auto", reasons, warnings });
    },
  };

  return engine;
}
