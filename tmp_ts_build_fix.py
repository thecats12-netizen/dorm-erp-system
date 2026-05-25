from pathlib import Path
import re

root = Path('src')
removals = []
converted = []
modified = []

for path in sorted(root.rglob('*.tsx')):
    text = path.read_text(encoding='utf-8')
    original = text
    text = re.sub(r'^import React from "react";\r?\n', '', text, flags=re.MULTILINE)
    if text != original:
        path.write_text(text, encoding='utf-8')
        removals.append(str(path))
        modified.append(str(path))

for path in sorted(root.rglob('*.tsx')):
    text = path.read_text(encoding='utf-8')
    new_text = re.sub(r'^import \{ PageProps \} from "\.\/DashboardPage";\r?\n', 'import type { PageProps } from "./DashboardPage";\n', text, flags=re.MULTILINE)
    if new_text != text:
        path.write_text(new_text, encoding='utf-8')
        converted.append(str(path))
        if str(path) not in modified:
            modified.append(str(path))

sys_path = root / 'constants' / 'systemSettings.ts'
if sys_path.exists():
    text = sys_path.read_text(encoding='utf-8')
    new_text = re.sub(r'^import type \{ SystemSettings, MenuItem, FieldConfig, PermissionConfig, CodeValue, ScreenSettings \} from "\.\./types";\r?\n',
                      'import type { SystemSettings, MenuItem } from "../types";\n', text, flags=re.MULTILINE)
    if new_text != text:
        sys_path.write_text(new_text, encoding='utf-8')
        modified.append(str(sys_path))

hook_fixes = {
    'hooks/useCleaningReports.ts': (
        r'return cleaningReports.filter\(\(report\) => report\.dormName\.toLowerCase\(\)\.includes\(lowered\) \|\| report\.reporterName\.toLowerCase\(\)\.includes\(lowered\)\);',
        'return cleaningReports.filter((report) => report.buildingName.toLowerCase().includes(lowered) || report.reporterName.toLowerCase().includes(lowered));'
    ),
    'hooks/useDefects.ts': (
        r'return defects.filter\(\(defect\) => defect\.title\.toLowerCase\(\)\.includes\(lowered\) \|\| defect\.reporterName\.toLowerCase\(\)\.includes\(lowered\)\);',
        'return defects.filter((defect) => defect.requestText.toLowerCase().includes(lowered) || defect.reporterName.toLowerCase().includes(lowered));'
    ),
    'hooks/useDormContracts.ts': (
        r'return dormContracts.filter\(\(contract\) => contract\.addressName\.toLowerCase\(\)\.includes\(lowered\) \|\| contract\.dong\.toLowerCase\(\)\.includes\(lowered\)\);',
        'return dormContracts.filter((contract) => contract.address.toLowerCase().includes(lowered) || contract.buildingName.toLowerCase().includes(lowered) || contract.dong.toLowerCase().includes(lowered));'
    ),
    'hooks/useMilitaryData.ts': (
        r'return useMemo\(\(\) => records\.filter\(\(item\) => item\.title\.toLowerCase\(\)\.includes\(search\.toLowerCase\(\)\)\), \[records, search\]\);',
        'return useMemo(() => records.filter((item) => item.subject.toLowerCase().includes(search.toLowerCase())), [records, search]);'
    )
}
for rel, (pattern, replacement) in hook_fixes.items():
    path = root / rel
    if path.exists():
        text = path.read_text(encoding='utf-8')
        new_text = re.sub(pattern, replacement, text, flags=re.DOTALL)
        if new_text != text:
            path.write_text(new_text, encoding='utf-8')
            modified.append(str(path))

print('removed_imports_count=', len(removals))
print('converted_imports_count=', len(converted))
print('modified_files_count=', len(set(modified)))
print('modified_files=')
for p in sorted(set(modified)):
    print(p)
