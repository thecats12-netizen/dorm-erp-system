// ============================================================================
// RestoreWizard V2 선택 모델 — datasetRegistry 기반 트리 + 선택 상태 계산(순수 함수, 테스트 가능).
//  · UI 렌더/토글이 하드코딩 목록 대신 이 모델만 바라본다.
//  · 출력 selection 은 기존 planRestore/executor 가 쓰는 Selection(RestoreTargetKey→bool) 과 100% 동일한 형태.
//    → executor/planRestore 변경 없음(기존 복원 안전장치 보존).
// ============================================================================
import {
  MODULE_ORDER, MODULE_LABELS, MILITARY_KEYS, MILITARY_KEY_LABELS,
  MODULE_CHILD_LABELS, OPERATIONAL_RESTORE_UNSUPPORTED_CHILDREN, RESTORE_DATASETS,
} from "../../services/datasetRegistry";
import {
  DORM_DATASET_KEYS, DORM_DATASET_LABELS, OPERATIONAL_RESTORE_DATASET_KEYS, OPERATIONAL_DATASET_LABELS,
  type CanonicalModules, type Selection, type RestoreTargetKey,
} from "../../services/backupService";

export type NodeStatus =
  | "selectable"   // 선택 복원 가능(체크박스 활성)
  | "preparing"    // 백업 포함 · 선택 복원 준비 중(executor 미배선 → 비활성)
  | "missing";     // 백업에 없음(비활성)

export type DatasetNode = {
  label: string;
  count: number | null;       // 백업 건수(모르면 null)
  status: NodeStatus;
  selKey?: RestoreTargetKey;   // 이 하위 항목이 독립 선택 단위면(군대 8키) 그 키
};

export type ModuleNode = {
  module: string;
  label: string;
  present: boolean;                 // 백업에 이 모듈 데이터가 있는가
  moduleSelectKey?: RestoreTargetKey; // 모듈 단위 선택 키(dorm/operational). 군대/미지원 모듈은 없음
  granularKeys: RestoreTargetKey[]; // 개별 선택 단위(군대 8키). 모듈단위면 빈 배열
  children: DatasetNode[];
  anySelectable: boolean;           // 이 모듈에서 선택 가능한 항목이 하나라도 있는가
  note?: string;
};

const moduleHasData = (modules: CanonicalModules, module: string): boolean =>
  !!(modules as Record<string, unknown>)[module === "exam" ? "__none__" : module];

// 백업의 recordCounts(라벨→건수)에서 라벨 건수 조회(없으면 null).
const countOf = (recordCounts: Record<string, number>, label: string): number | null =>
  Object.prototype.hasOwnProperty.call(recordCounts, label) ? recordCounts[label] : null;

// 트리 노드 구성. backupModules/recordCounts 는 adaptToCanonical 결과에서 전달.
export function buildModuleNodes(backupModules: CanonicalModules, recordCounts: Record<string, number>): ModuleNode[] {
  const nodes: ModuleNode[] = [];
  for (const module of MODULE_ORDER) {
    const present = moduleHasData(backupModules, module);
    const desc = RESTORE_DATASETS.filter((d) => d.module === module);
    const moduleLevel = desc.find((d) => d.key === module); // dorm/operational/asset/system/audit
    const isMilitary = module === "military";

    const children: DatasetNode[] = [];
    const granularKeys: RestoreTargetKey[] = [];
    let moduleSelectKey: RestoreTargetKey | undefined;

    if (isMilitary) {
      // 군대: 8키 개별 선택(기존 동작 유지)
      for (const mk of MILITARY_KEYS) {
        const status: NodeStatus = present ? "selectable" : "missing";
        children.push({ label: MILITARY_KEY_LABELS[mk], count: countOf(recordCounts, MILITARY_KEY_LABELS[mk]), status, selKey: present ? mk : undefined });
        if (present) granularKeys.push(mk);
      }
    } else if (module === "dorm") {
      // 기숙사: 세부 dataset 개별 선택(dorm.*)
      for (const ds of DORM_DATASET_KEYS) {
        const label = DORM_DATASET_LABELS[ds]; const selKey = `dorm.${ds}` as RestoreTargetKey;
        const status: NodeStatus = present ? "selectable" : "missing";
        children.push({ label, count: countOf(recordCounts, label), status, selKey: present ? selKey : undefined });
        if (present) granularKeys.push(selKey);
      }
    } else if (module === "operational") {
      // 운영: 세부 dataset 개별 선택(operational.*) + 입주전점검(백업만·준비 중)
      for (const ds of OPERATIONAL_RESTORE_DATASET_KEYS) {
        const label = OPERATIONAL_DATASET_LABELS[ds]; const selKey = `operational.${ds}` as RestoreTargetKey;
        const status: NodeStatus = present ? "selectable" : "missing";
        children.push({ label, count: countOf(recordCounts, label), status, selKey: present ? selKey : undefined });
        if (present) granularKeys.push(selKey);
      }
      for (const label of OPERATIONAL_RESTORE_UNSUPPORTED_CHILDREN) { // 입주전점검
        const count = countOf(recordCounts, label);
        children.push({ label, count, status: !present ? "missing" : (count === null ? "missing" : "preparing") });
      }
    } else {
      // 모듈 단위: 하위 항목은 "표시(건수)" — dorm/operational 은 모듈 체크박스가 실제 선택 단위.
      const childLabels = MODULE_CHILD_LABELS[module] || [];
      const moduleRestoreSupported = !!moduleLevel?.restoreSupported;
      if (moduleRestoreSupported && present) moduleSelectKey = module as RestoreTargetKey;
      // system/audit 하위는 건수 집계가 없다(무카운트) → 모듈 존재 여부로만 판정(present면 '준비 중').
      const countBearingModule = module === "dorm" || module === "operational" || module === "asset";
      for (const label of childLabels) {
        const count = countOf(recordCounts, label);
        let status: NodeStatus;
        if (!present) status = "missing";
        else if (countBearingModule && count === null) status = "missing"; // 이 백업에 해당 하위 dataset 자체가 없음(예: v1 의 입주전점검)
        else if (!moduleRestoreSupported) status = "preparing"; // asset/system/audit: 백업 포함·복구 준비 중
        else if (module === "operational" && OPERATIONAL_RESTORE_UNSUPPORTED_CHILDREN.includes(label)) status = "preparing"; // 입주전점검: 백업만
        else status = "selectable"; // 모듈 단위로 복원(체크는 모듈에서)
        children.push({ label, count, status });
      }
    }

    const anySelectable = granularKeys.length > 0 || !!moduleSelectKey;
    nodes.push({
      module, label: MODULE_LABELS[module] || module, present, moduleSelectKey, granularKeys, children, anySelectable,
      note: moduleLevel?.note,
    });
  }
  return nodes;
}

// 군대 부모 tri-state
export type Tri = "all" | "some" | "none";
export function moduleTriState(node: ModuleNode, selection: Selection): Tri {
  const keys: RestoreTargetKey[] = node.granularKeys.length ? node.granularKeys : (node.moduleSelectKey ? [node.moduleSelectKey] : []);
  if (keys.length === 0) return "none";
  const on = keys.filter((k) => !!selection[k]).length;
  if (on === 0) return "none";
  if (on === keys.length) return "all";
  return "some";
}

// 모듈 전체 토글(선택 가능한 키만). on=true → 전체 선택, false → 전체 해제.
export function toggleModule(node: ModuleNode, selection: Selection, on: boolean): Selection {
  const keys: RestoreTargetKey[] = node.granularKeys.length ? node.granularKeys : (node.moduleSelectKey ? [node.moduleSelectKey] : []);
  const next: Selection = { ...selection };
  for (const k of keys) next[k] = on;
  return next;
}

// 개별 키 토글(군대 8키 / 모듈 단위 키).
export function toggleKey(selection: Selection, key: RestoreTargetKey): Selection {
  return { ...selection, [key]: !selection[key] };
}

// 선택된 "실제 복원 대상" 키만(selectable 아닌 키는 무시).
export function selectedRestorableKeys(nodes: ModuleNode[], selection: Selection): RestoreTargetKey[] {
  const allKeys: RestoreTargetKey[] = [];
  for (const n of nodes) {
    if (n.moduleSelectKey) allKeys.push(n.moduleSelectKey);
    allKeys.push(...n.granularKeys);
  }
  return allKeys.filter((k) => !!selection[k]);
}
