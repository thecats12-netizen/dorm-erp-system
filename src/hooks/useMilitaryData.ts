import { useMemo } from "react";
import type { MilitaryPersonnel, TrainingRecord, MilitaryNotice, MilitaryReport } from "\.\./types";

export function useMilitaryPersonnel(personnel: MilitaryPersonnel[], search: string) {
  return useMemo(() => personnel.filter((item) => item.name.toLowerCase().includes(search.toLowerCase())), [personnel, search]);
}

export function useTrainingRecords(records: TrainingRecord[], search: string) {
  return useMemo(() => records.filter((item) => item.subject.toLowerCase().includes(search.toLowerCase())), [records, search]);
}

export function useMilitaryNotices(notices: MilitaryNotice[], search: string) {
  return useMemo(() => notices.filter((item) => item.title.toLowerCase().includes(search.toLowerCase())), [notices, search]);
}

export function useMilitaryReports(reports: MilitaryReport[], search: string) {
  return useMemo(() => reports.filter((item) => item.title.toLowerCase().includes(search.toLowerCase())), [reports, search]);
}
