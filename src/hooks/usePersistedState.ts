import { useEffect, useState } from "react";
import { loadJson, saveJson } from "../services/storageService";

export function usePersistedState<T>(key: string, defaultValue: T, tenantId = "default") {
  const [value, setValue] = useState<T>(() => loadJson(key, defaultValue, tenantId));

  useEffect(() => {
    saveJson(key, value, tenantId);
  }, [key, value, tenantId]);

  return [value, setValue] as const;
}
