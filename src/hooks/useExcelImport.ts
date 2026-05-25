import { useCallback } from "react";
import * as XLSX from "xlsx";

export function useExcelImport() {
  const importExcel = useCallback(async (file: File | null, onLoad: (data: unknown) => void) => {
    if (!file) return;
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: "array" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    onLoad(data);
  }, []);

  return { importExcel };
}
