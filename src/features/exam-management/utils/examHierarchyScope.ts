// 시험관리 custom-role 데이터 범위: 허용 Process(id) 집합에서 상위 Group/제품군(Category) 및 Equipment 범위를 파생.
//  - allowed === null → 제한 없음(admin/무범위). 소비처는 null 일 때 전체 유지(무회귀).
//  - 규칙: 허용 process 가 속한 group/category 만 허용. process.group_id 우선, 없으면 category.group_id 역추적(legacy 호환).
//  - 자체 group/category scope row 는 없으므로(process 기준 모델) 반드시 process→상위 파생으로 계산한다.

type MRow = { id?: unknown; group_id?: unknown; category_id?: unknown; process_id?: unknown };

export type ExamHierScope = {
  processIds: Set<string>;
  groupIds: Set<string>;
  categoryIds: Set<string>;
};

export function deriveExamHierarchyScope(
  allowed: Set<string> | null,
  processes: MRow[],
  categories: MRow[] = []
): ExamHierScope | null {
  if (!allowed) return null;
  const catGroupById = new Map<string, string>();
  for (const c of categories) {
    if (c.group_id != null) catGroupById.set(String(c.id), String(c.group_id));
  }
  const processIds = new Set<string>();
  const groupIds = new Set<string>();
  const categoryIds = new Set<string>();
  for (const p of processes) {
    const pid = String(p.id);
    if (!allowed.has(pid)) continue;
    processIds.add(pid);
    const cid = p.category_id != null ? String(p.category_id) : "";
    let gid = p.group_id != null ? String(p.group_id) : "";
    if (!gid && cid) gid = catGroupById.get(cid) ?? "";
    if (cid) categoryIds.add(cid);
    if (gid) groupIds.add(gid);
  }
  return { processIds, groupIds, categoryIds };
}

// 허용 process 에 연결된 equipment id 집합. allowed === null → null(전체 유지).
export function deriveAllowedEquipmentIds(allowed: Set<string> | null, equipment: MRow[]): Set<string> | null {
  if (!allowed) return null;
  const ids = new Set<string>();
  for (const e of equipment) {
    if (e.process_id != null && allowed.has(String(e.process_id))) ids.add(String(e.id));
  }
  return ids;
}
