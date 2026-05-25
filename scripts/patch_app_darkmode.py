from pathlib import Path

path = Path('src/App.tsx')
text = path.read_text(encoding='utf-8')
replacements = [
    ('className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200"', 'className={`rounded-3xl p-5 shadow-sm ring-1 ${theme.darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`}'),
    ('className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-200"', 'className={`rounded-3xl p-4 shadow-sm ring-1 ${theme.darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`}'),
    ('className="rounded-3xl border border-slate-200 bg-white p-4"', 'className={`rounded-3xl border p-4 ${theme.darkMode ? "border-slate-700 bg-slate-950 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}'),
    ('className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm ring-1"', 'className={`rounded-3xl border p-5 shadow-sm ring-1 ${theme.darkMode ? "border-slate-700 bg-slate-950 text-slate-100" : "border-slate-200 bg-white"}`}'),
    ('className="overflow-x-auto rounded-2xl border border-slate-200 bg-white"', 'className={`overflow-x-auto rounded-2xl border ${theme.darkMode ? "border-slate-700 bg-slate-950 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}'),
    ('className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"', 'className={`rounded-2xl border px-3 py-2 text-sm outline-none focus:border-slate-400 ${theme.darkMode ? "border-slate-700 bg-slate-900 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}'),
    ('className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus:border-slate-400"', 'className={`rounded-2xl border px-3 py-3 text-sm outline-none focus:border-slate-400 ${theme.darkMode ? "border-slate-700 bg-slate-900 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}'),
    ('className="rounded-2xl border border-dashed border-slate-300 bg-white p-4 text-center text-slate-400 text-xs"', 'className={`rounded-2xl border border-dashed p-4 text-center text-xs ${theme.darkMode ? "border-slate-700 bg-slate-950 text-slate-300" : "border-slate-300 bg-white text-slate-400"}`}'),
    ('className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-400"', 'className={`rounded-2xl border px-4 py-2 text-sm font-medium ${theme.darkMode ? "border-slate-700 bg-slate-900 text-slate-200 hover:border-slate-500" : "border-slate-300 bg-white text-slate-700 hover:border-slate-400"}`}'),
    ('className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"', 'className={`rounded-2xl border px-4 py-2 text-sm font-medium ${theme.darkMode ? "border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"}`}'),
    ('className="rounded-2xl border border-slate-300 bg-white px-2 py-1 text-sm text-slate-700"', 'className={`rounded-2xl border px-2 py-1 text-sm ${theme.darkMode ? "border-slate-700 bg-slate-900 text-slate-200" : "border-slate-300 bg-white text-slate-700"}`}'),
    ('className="rounded-2xl border border-slate-300 bg-white px-3 py-3 outline-none focus:border-slate-400"', 'className={`rounded-2xl border px-3 py-3 outline-none focus:border-slate-400 ${theme.darkMode ? "border-slate-700 bg-slate-900 text-slate-100" : "border-slate-300 bg-white text-slate-900"}`}'),
    ('className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-200"', 'className={`rounded-3xl p-4 shadow-sm ring-1 ${theme.darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`}'),
]
for old, new in replacements:
    count = text.count(old)
    if count:
        print(f'Replacing {count} occurrence(s) of: {old}')
        text = text.replace(old, new)
path.write_text(text, encoding='utf-8')
