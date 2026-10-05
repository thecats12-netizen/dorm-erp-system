import { useEffect, useState } from "react";

// 파일/첨부파일 재해복구(Storage DR) 패널 — 관리자 전용.
//  · 사진/증빙/계약 첨부파일의 "실제 파일"을 DB 백업과 별도 트랙으로 보호한다(거대 JSON 에 넣지 않음).
//  · 실제 아카이브 실행은 서버측 관리자 작업(service_role 서버 전용)에 연결된다 — 핸들러 미주입 시
//    읽기 전용 안내로 동작(fail-closed). 내부 bucket/table key 는 사용자에게 노출하지 않는다.
export type StorageDrStatus = {
  totalFiles: number;
  totalBytes: number;
  lastBackupAt?: string | null;
  failedFiles?: number;
  categories?: { label: string; files: number }[]; // 업무 한글 라벨만(내부 key 금지)
};

type Props = {
  darkMode: boolean;
  isAdmin: boolean;
  // 파일 백업 저장소(provider) 설정 여부. false/미지정이면 실행 버튼 fail-closed.
  //  · 신뢰 원칙: 가능하면 probeStatus(서버 조회)로 덮어쓴다 — 클라이언트 상수만 믿지 않는다.
  providerConfigured?: boolean;
  // 서버(Edge Function)에 인증 상태로 provider 설정 여부를 질의. 반환값으로 버튼 활성/비활성 결정.
  probeStatus?: () => Promise<{ providerConfigured: boolean }>;
  // base64 로만 저장돼 파일 백업이 불가능한 항목 경고(백업 전 silent loss 방지).
  inlineOnly?: { count: number; approxBytesTotal: number } | null;
  // 아래 핸들러가 주입되면 실제 동작, 미주입이면 "준비 중"(비활성) 안내.
  getStatus?: () => Promise<StorageDrStatus>;
  onStartBackup?: () => Promise<void>;
  onRetryFailed?: () => Promise<void>;
  onPreRestoreCheck?: () => Promise<string>;   // 사람이 읽을 요약 문자열 반환
  onMissingCheck?: () => Promise<string>;       // 누락/위험 요약 문자열 반환
  onToast?: (msg: string) => void;
};

const fmtBytes = (n: number): string => {
  if (!n || n < 0) return "0 B";
  const u = ["B", "KB", "MB", "GB"]; let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
};

export default function StorageDrPanel({ darkMode, isAdmin, providerConfigured, probeStatus, inlineOnly, getStatus, onStartBackup, onRetryFailed, onPreRestoreCheck, onMissingCheck, onToast }: Props) {
  const [status, setStatus] = useState<StorageDrStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [report, setReport] = useState<string | null>(null);
  // 서버 질의 결과(null=확인중). probeStatus 가 있으면 이 값이 provider 설정 여부의 정본.
  const [serverProvider, setServerProvider] = useState<boolean | null>(null);
  // archive 는 실수 방지를 위해 확인 모달을 거친 뒤에만 실행.
  const [confirmArchive, setConfirmArchive] = useState(false);

  useEffect(() => {
    if (!probeStatus || !isAdmin) return;
    let alive = true;
    void (async () => { try { const r = await probeStatus(); if (alive) setServerProvider(!!r.providerConfigured); } catch { if (alive) setServerProvider(false); } })();
    return () => { alive = false; };
  }, [probeStatus, isAdmin]);

  const card = darkMode ? "border-slate-700 bg-slate-950" : "border-slate-200 bg-slate-50";
  const btn = `inline-flex items-center gap-2 rounded-2xl border px-4 py-2 text-sm font-semibold disabled:opacity-50 ${darkMode ? "border-slate-600 bg-slate-900 text-slate-100 hover:bg-slate-800" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"}`;
  // provider 설정 여부: probeStatus 가 있으면 서버 응답을 정본으로, 없으면 prop(기본 fail-closed).
  const effectiveProvider = probeStatus ? serverProvider === true : providerConfigured === true;
  const ready = effectiveProvider && !!onStartBackup;

  const run = async (name: string, fn?: () => Promise<unknown>) => {
    if (!fn) return;
    setBusy(name); setReport(null);
    try {
      const r = await fn();
      if (typeof r === "string") setReport(r);
      if (name === "status" && r && typeof r === "object") setStatus(r as StorageDrStatus);
      else if (getStatus && name !== "status") { try { setStatus(await getStatus()); } catch { /* ignore */ } }
      onToast?.(name === "backup" ? "파일 백업 작업을 요청했습니다." : name === "retry" ? "실패한 파일을 다시 시도했습니다." : "검사를 완료했습니다.");
    } catch {
      onToast?.("작업 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
    } finally { setBusy(null); }
  };

  return (
    <section className={`mt-5 rounded-3xl border p-5 ${card}`}>
      <h3 className={`mb-1 text-base font-semibold ${darkMode ? "text-slate-100" : "text-slate-900"}`}>파일·첨부파일 재해복구</h3>
      <p className="mb-4 text-sm text-slate-500">
        청소 <b>사진</b>, 비품 <b>증빙</b>, 계약 <b>첨부파일</b>의 실제 파일을 별도로 백업·복원합니다.
        (문서·표 데이터 백업과 분리되어 안전하게 보관됩니다.)
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-200/60 p-3 dark:border-slate-700/60">
          <div className="text-xs text-slate-400">총 파일 수</div>
          <div className="text-lg font-semibold">{status ? status.totalFiles.toLocaleString() : "—"}</div>
        </div>
        <div className="rounded-2xl border border-slate-200/60 p-3 dark:border-slate-700/60">
          <div className="text-xs text-slate-400">총 용량</div>
          <div className="text-lg font-semibold">{status ? fmtBytes(status.totalBytes) : "—"}</div>
        </div>
        <div className="rounded-2xl border border-slate-200/60 p-3 dark:border-slate-700/60">
          <div className="text-xs text-slate-400">마지막 백업</div>
          <div className="text-sm font-semibold">{status?.lastBackupAt ? new Date(status.lastBackupAt).toLocaleString() : "기록 없음"}</div>
        </div>
        <div className="rounded-2xl border border-slate-200/60 p-3 dark:border-slate-700/60">
          <div className="text-xs text-slate-400">실패 파일</div>
          <div className={`text-lg font-semibold ${status?.failedFiles ? "text-rose-500" : ""}`}>{status ? (status.failedFiles ?? 0).toLocaleString() : "—"}</div>
        </div>
      </div>

      {status?.categories && status.categories.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {status.categories.map((c) => (
            <span key={c.label} className={`rounded-full px-2 py-0.5 text-[0.7rem] ${darkMode ? "bg-slate-800 text-slate-300" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}>{c.label} {c.files.toLocaleString()}</span>
          ))}
        </div>
      )}

      {inlineOnly && inlineOnly.count > 0 && (
        <div className="mt-3 rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300">
          ⚠ <b>{inlineOnly.count.toLocaleString()}건</b>의 사진/증빙이 파일 저장소가 아닌 <b>데이터 안에 직접(base64)</b> 들어 있어
          파일 백업으로 보호되지 않습니다. 해당 항목을 다시 저장하면 파일 저장소로 전환되어 보호됩니다. (문서 백업에서는 제외될 수 있습니다.)
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {/* archive 는 확인 모달을 거쳐 실행(클릭 즉시 실행 금지). */}
        <button type="button" className={btn} disabled={!isAdmin || !ready || !!busy} onClick={() => setConfirmArchive(true)}>{busy === "backup" ? "백업 중…" : "파일 백업 시작"}</button>
        <button type="button" className={btn} disabled={!isAdmin || !ready || !onRetryFailed || !!busy} onClick={() => void run("retry", onRetryFailed)}>실패 파일 다시 시도</button>
        {/* 복원 전 검사: READ-ONLY 상태 요약만(실제 복원 미실행). */}
        <button type="button" className={btn} disabled={!isAdmin || !ready || !onPreRestoreCheck || !!busy} onClick={() => void run("preRestore", onPreRestoreCheck)}>복원 전 검사(읽기 전용)</button>
        <button type="button" className={btn} disabled={!isAdmin || !ready || !onMissingCheck || !!busy} onClick={() => void run("missing", onMissingCheck)}>누락 파일 검사</button>
        {getStatus && <button type="button" className={btn} disabled={!!busy} onClick={() => void run("status", getStatus)}>상태 새로고침</button>}
      </div>

      <p className="mt-2 text-[0.7rem] text-slate-400">파일 복원 기능은 관리자 승인 절차를 거쳐 별도로 실행합니다. (이 화면에서는 백업과 읽기 전용 검사만 제공합니다.)</p>

      {confirmArchive && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" onClick={() => setConfirmArchive(false)}>
          <div className={`w-full max-w-md rounded-3xl p-6 shadow-xl ${darkMode ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900"}`} onClick={(e) => e.stopPropagation()}>
            <h4 className="mb-2 text-lg font-semibold">파일 재해복구 백업 시작</h4>
            <p className="mb-5 text-sm text-slate-500">현재 Storage 파일을 재해복구 보관소에 백업합니다. 기존 업무 파일을 삭제하거나 변경하지 않습니다. 파일 수에 따라 시간이 걸릴 수 있습니다.</p>
            <div className="flex justify-end gap-2">
              <button type="button" className={btn} disabled={!!busy} onClick={() => setConfirmArchive(false)}>취소</button>
              <button type="button" className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900" disabled={!!busy} onClick={() => { setConfirmArchive(false); void run("backup", onStartBackup); }}>{busy === "backup" ? "백업 중…" : "백업 시작"}</button>
            </div>
          </div>
        </div>
      )}

      {report && (
        <pre className={`mt-3 max-h-60 overflow-auto whitespace-pre-wrap rounded-2xl border p-3 text-xs ${darkMode ? "border-slate-700 bg-slate-900 text-slate-200" : "border-slate-200 bg-white text-slate-700"}`}>{report}</pre>
      )}

      {!isAdmin && <p className="mt-3 text-xs text-slate-400">관리자만 사용할 수 있습니다.</p>}
      {isAdmin && !ready && (
        <p className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          {probeStatus && serverProvider === null
            ? <>파일 백업 저장소 설정 상태를 <b>확인하고 있습니다…</b></>
            : effectiveProvider === false
              ? <>파일 백업 저장소가 <b>설정되지 않았습니다</b>. 저장소를 설정하면 파일 백업을 사용할 수 있습니다. (설정 전까지 실행 버튼은 비활성화됩니다.)</>
              : <>파일 백업 실행은 <b>서버 보관소 연결</b>이 준비되면 활성화됩니다. 연결 전에도 백업 범위·경고는 위와 같이 확인할 수 있습니다.</>}
          {" "}계약 첨부파일은 비공개로 유지되며 안전한 보관소에만 암호화 보관됩니다.
        </p>
      )}
      <div className="mt-3 rounded-xl border border-slate-200/60 p-3 text-[0.7rem] text-slate-400 dark:border-slate-700/60">
        <div className="mb-1 font-semibold text-slate-500 dark:text-slate-300">문서 백업 vs 파일 백업</div>
        <div><b>문서 백업</b>(위): 입주자·계약·시험 등 표/문서 데이터(글자·숫자). <b>파일 백업</b>(여기): 사진·증빙·계약서 같은 실제 파일.</div>
        <div className="mt-1">생성 PDF(임시 내보내기 파일)는 일시 산출물이라 영구 백업 대상에서 제외됩니다.</div>
      </div>
    </section>
  );
}
