// 시험관리 공통 사원 검색 훅(신규 · 조회 전용).
//  - tenant_id 필터 필수, employee_no/name 부분검색, 최대 20건, 재직자 우선 정렬.
//  - debounce 300ms, 최소 2글자, 최신 요청만 반영(경쟁/중복 방지), 최근 선택 localStorage(민감정보 없음).
//  - service_role_key 미사용. 기존 RLS 로 tenant 격리·권한 강제.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase, isSupabaseAvailable } from "../../../services/supabaseService";
import type { EmployeeLite, RecentEmployee } from "../types/employeeLookup";

const RECENT_KEY = "exam-recent-employees";
const MAX_RESULTS = 20;
const MAX_RECENT = 8;
const MIN_CHARS = 2;
const DEBOUNCE_MS = 300;

export type UseEmployeeLookup = {
  query: string;
  setQuery: (v: string) => void;
  results: EmployeeLite[];
  isLoading: boolean;
  error: string | null;
  recentEmployees: RecentEmployee[];
  selectEmployee: (e: RecentEmployee) => void;
  clearSelection: () => void;
  refresh: () => void;
};

function loadRecent(): RecentEmployee[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((r) => r && r.id).slice(0, MAX_RECENT) : [];
  } catch { return []; }
}

const statusRank = (s: string): number => (/재직/.test(s) ? 0 : /휴직/.test(s) ? 1 : 2);

export function useEmployeeLookup(tenantId: string, opts?: { includeInactive?: boolean }): UseEmployeeLookup {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<EmployeeLite[]>([]);
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recentEmployees, setRecent] = useState<RecentEmployee[]>(() => loadRecent());
  const reqIdRef = useRef(0);
  const includeInactive = opts?.includeInactive ?? false;

  const runSearch = useCallback(async (raw: string) => {
    const term = raw.trim();
    if (term.length < MIN_CHARS) { setResults([]); setError(null); setLoading(false); return; }
    if (!isSupabaseAvailable() || !supabase || !tenantId) { setResults([]); setError("사원 정보를 불러오지 못했습니다."); return; }

    const myReq = ++reqIdRef.current; // 최신 요청 식별(이전 응답 무시)
    setLoading(true); setError(null);
    try {
      const safe = term.replace(/[%,()]/g, " ").trim();
      const { data, error: e } = await supabase
        .from("exam_personnel")
        .select("id, employee_no, name, group_name, product_group, part_name, process_id, position, hire_date, employment_status")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .or(`employee_no.ilike.%${safe}%,name.ilike.%${safe}%`)
        .limit(MAX_RESULTS);

      if (myReq !== reqIdRef.current) return; // 오래된 응답 폐기
      if (e) {
        console.error("[useEmployeeLookup] 검색 실패:", { code: (e as { code?: string }).code, message: e.message, details: (e as { details?: string }).details, hint: (e as { hint?: string }).hint });
        setError("사원 정보를 불러오지 못했습니다."); setResults([]); return;
      }
      let rows = (data as Record<string, unknown>[]) || [];
      if (!includeInactive) rows = rows.filter((r) => !/퇴직|퇴사/.test(String(r.employment_status ?? "")));
      rows.sort((a, b) =>
        statusRank(String(a.employment_status ?? "")) - statusRank(String(b.employment_status ?? "")) ||
        String(a.name ?? "").localeCompare(String(b.name ?? ""))
      );
      const mapped: EmployeeLite[] = rows.slice(0, MAX_RESULTS).map((r) => ({
        id: String(r.id),
        employeeNo: String(r.employee_no ?? ""),
        name: String(r.name ?? ""),
        group: (r.group_name as string) ?? null,
        productFamily: (r.product_group as string) ?? null,
        part: (r.part_name as string) ?? null,
        processId: (r.process_id as string) ?? null,
        position: (r.position as string) ?? null,
        joinDate: r.hire_date ? String(r.hire_date).slice(0, 10) : null,
        employmentStatus: (r.employment_status as string) ?? null,
      }));
      setResults(mapped);
    } catch (err) {
      if (myReq !== reqIdRef.current) return;
      console.error("[useEmployeeLookup] 예외:", err);
      setError("네트워크 연결을 확인해주세요."); setResults([]);
    } finally {
      if (myReq === reqIdRef.current) setLoading(false);
    }
  }, [tenantId, includeInactive]);

  // debounce: 검색어 변경 300ms 후 1회 실행.
  useEffect(() => {
    const t = setTimeout(() => { void runSearch(query); }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query, runSearch]);

  const selectEmployee = useCallback((e: RecentEmployee) => {
    const rec: RecentEmployee = { id: e.id, employeeNo: e.employeeNo, name: e.name };
    setRecent((prev) => {
      const next = [rec, ...prev.filter((p) => p.id !== rec.id)].slice(0, MAX_RECENT);
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* 저장 실패 무시 */ }
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => { setQuery(""); setResults([]); setError(null); }, []);
  const refresh = useCallback(() => { void runSearch(query); }, [runSearch, query]);

  return { query, setQuery, results, isLoading, error, recentEmployees, selectEmployee, clearSelection, refresh };
}
