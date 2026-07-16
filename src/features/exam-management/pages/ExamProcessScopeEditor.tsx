import { useEffect, useState } from "react";
import { supabase, isSupabaseAvailable } from "../../../services/supabaseService";
import { listExamRefOptions } from "../services/examMasterService";
import {
  getUserProcessScopes, saveUserProcessScopes, setUserExamRole,
  type ExamRole, type ExamProcessScope,
} from "../services/examPermissionService";

// 시스템 > 계정 등록/수정 모달에 삽입하는 "시험관리 공정 권한" 편집기(자체 저장·감사로그).
//  - 실제 접근 제어는 Supabase RLS 가 강제. 여기서는 관리자가 exam_role/공정 스코프를 지정한다.
//  - 내부 process_id 는 노출하지 않고 공정 라벨만 보여준다.
type Perm = "can_view" | "can_create" | "can_update" | "can_approve" | "can_export";
const PERMS: { key: Perm; label: string }[] = [
  { key: "can_view", label: "조회" }, { key: "can_create", label: "등록" },
  { key: "can_update", label: "수정" }, { key: "can_approve", label: "승인" },
  { key: "can_export", label: "내보내기" },
];
const ROLE_OPTIONS: { value: ExamRole; label: string }[] = [
  { value: null, label: "권한 없음" },
  { value: "admin", label: "시험 관리자" },
  { value: "process_owner", label: "공정 담당자" },
  { value: "viewer", label: "시험 조회자" },
];

export default function ExamProcessScopeEditor({
  userId, userLabel, baseRole, tenantId, actingUserId, darkMode, canManage, onToast,
}: {
  userId: string | null;          // 신규 사용자(저장 전)는 null → 안내만 표시
  userLabel: string;
  baseRole: string;               // 대상 사용자의 시스템 role(admin 이면 시험 총관리자 자동)
  tenantId: string;
  actingUserId: string;
  darkMode: boolean;
  canManage: boolean;             // 관리 권한(시험 총관리자=시스템 admin)만 편집 가능
  onToast?: (m: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [examRole, setExamRole] = useState<ExamRole>(null);
  const [processes, setProcesses] = useState<Array<{ id: string; label: string }>>([]);
  const [scopeMap, setScopeMap] = useState<Record<string, ExamProcessScope>>({});
  const [error, setError] = useState<string | null>(null);

  const isSystemAdmin = baseRole === "admin"; // 시스템 admin = 시험 총관리자(전권, 편집 불필요)

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!userId || !isSupabaseAvailable() || !supabase || isSystemAdmin) return;
      setLoading(true); setError(null);
      try {
        const [procs, prof, scopes] = await Promise.all([
          listExamRefOptions("exam_processes", tenantId),
          supabase.from("profiles").select("exam_role").eq("id", userId).maybeSingle(),
          getUserProcessScopes(userId, tenantId),
        ]);
        if (!alive) return;
        setProcesses(procs);
        setExamRole(((prof.data as { exam_role?: ExamRole } | null)?.exam_role) ?? null);
        const m: Record<string, ExamProcessScope> = {};
        for (const s of scopes) if (s.is_active) m[s.process_id] = s;
        setScopeMap(m);
      } catch (e) {
        if (alive) setError((e as { message?: string })?.message || "권한 정보를 불러오지 못했습니다.");
      } finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [userId, tenantId, isSystemAdmin]);

  if (isSystemAdmin) {
    return (
      <div className={`rounded-2xl border p-4 ${darkMode ? "border-slate-700 bg-slate-950" : "border-slate-200 bg-slate-50"}`}>
        <h4 className={`mb-1 text-sm font-semibold ${darkMode ? "text-slate-300" : "text-slate-700"}`}>시험관리 공정 권한</h4>
        <p className="text-xs text-slate-500">시스템 관리자는 시험 총관리자로서 전체 공정에 대한 전권을 가집니다.</p>
      </div>
    );
  }
  if (!userId) {
    return (
      <div className={`rounded-2xl border p-4 ${darkMode ? "border-slate-700 bg-slate-950" : "border-slate-200 bg-slate-50"}`}>
        <h4 className={`mb-1 text-sm font-semibold ${darkMode ? "text-slate-300" : "text-slate-700"}`}>시험관리 공정 권한</h4>
        <p className="text-xs text-slate-500">계정을 먼저 저장한 뒤 공정 권한을 지정할 수 있습니다.</p>
      </div>
    );
  }

  const toggle = (processId: string, perm: Perm) => {
    setScopeMap((prev) => {
      const cur = prev[processId] || { user_id: userId, process_id: processId, can_view: true, can_create: false, can_update: false, can_approve: false, can_export: false, is_active: true };
      return { ...prev, [processId]: { ...cur, [perm]: !cur[perm] } };
    });
  };
  const toggleProcess = (processId: string, on: boolean) => {
    setScopeMap((prev) => {
      const next = { ...prev };
      if (on) next[processId] = prev[processId] || { user_id: userId, process_id: processId, can_view: true, can_create: false, can_update: false, can_approve: false, can_export: false, is_active: true };
      else delete next[processId];
      return next;
    });
  };

  const save = async () => {
    if (saving || !canManage) return;
    setSaving(true); setError(null);
    try {
      await setUserExamRole(userId, examRole, actingUserId, tenantId);
      const scopes = examRole === "process_owner" ? Object.values(scopeMap).map((s) => ({ ...s, is_active: true })) : [];
      await saveUserProcessScopes(userId, tenantId, actingUserId, scopes);
      onToast?.(`${userLabel}님의 시험관리 권한을 저장했습니다.`);
    } catch (e) {
      setError((e as { message?: string })?.message || "권한 저장에 실패했습니다. 관리자 권한을 확인해주세요.");
    } finally { setSaving(false); }
  };

  const cell = darkMode ? "border-slate-700" : "border-slate-200";
  return (
    <div className={`rounded-2xl border p-4 ${darkMode ? "border-slate-700 bg-slate-950" : "border-slate-200 bg-slate-50"}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h4 className={`text-sm font-semibold ${darkMode ? "text-slate-300" : "text-slate-700"}`}>시험관리 공정 권한</h4>
        {canManage && (
          <button type="button" onClick={() => void save()} disabled={saving}
            className={`rounded-xl px-3 py-1.5 text-xs font-semibold text-white ${saving ? "bg-slate-400" : "bg-blue-600 hover:bg-blue-500"}`}>
            {saving ? "저장 중…" : "공정 권한 저장"}</button>
        )}
      </div>

      {!canManage && <p className="mb-2 text-xs text-amber-600">시험 총관리자(시스템 관리자)만 편집할 수 있습니다. (조회 전용)</p>}
      {loading && <p className="text-xs text-slate-500">불러오는 중…</p>}
      {error && <p className="mb-2 rounded-lg bg-rose-50 px-2 py-1 text-xs text-rose-600">{error}</p>}

      <div className="mb-3 max-w-xs">
        <label className="mb-1 block text-xs text-slate-500">시험 역할</label>
        <select value={examRole ?? "none"} disabled={!canManage}
          onChange={(e) => setExamRole(e.target.value === "none" ? null : (e.target.value as ExamRole))}
          className={`w-full rounded-lg border px-2 py-1.5 text-sm outline-none ${darkMode ? "border-slate-600 bg-slate-900" : "border-slate-300 bg-white"}`}>
          {ROLE_OPTIONS.map((o) => <option key={o.label} value={o.value ?? "none"}>{o.label}</option>)}
        </select>
        <p className="mt-1 text-[0.7rem] text-slate-400">시험 관리자=전체 공정 전권 · 공정 담당자=지정 공정만 · 시험 조회자=전체 읽기 전용</p>
      </div>

      {examRole === "process_owner" && (
        <div className="overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
          <table className="w-full text-left text-xs">
            <thead className={darkMode ? "bg-slate-800" : "bg-slate-100"}>
              <tr>
                <th className="px-2 py-1.5">담당</th><th className="px-2 py-1.5">공정</th>
                {PERMS.map((p) => <th key={p.key} className="px-2 py-1.5 text-center">{p.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {processes.length === 0 && <tr><td colSpan={2 + PERMS.length} className="px-2 py-4 text-center text-slate-400">등록된 공정이 없습니다.</td></tr>}
              {processes.map((proc) => {
                const on = !!scopeMap[proc.id];
                const s = scopeMap[proc.id];
                return (
                  <tr key={proc.id} className={`border-t ${cell}`}>
                    <td className="px-2 py-1.5"><input type="checkbox" checked={on} disabled={!canManage} onChange={(e) => toggleProcess(proc.id, e.target.checked)} /></td>
                    <td className="px-2 py-1.5">{proc.label}</td>
                    {PERMS.map((p) => (
                      <td key={p.key} className="px-2 py-1.5 text-center">
                        <input type="checkbox" checked={!!(s && s[p.key])} disabled={!canManage || !on} onChange={() => toggle(proc.id, p.key)} />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
