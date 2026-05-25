const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, '..', 'src', 'App.tsx');
let text = fs.readFileSync(filePath, 'utf8');
const replacements = [
  ['className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"', 'className={`w-full rounded-2xl border px-3 py-2 text-sm outline-none focus:border-slate-400 ${theme.darkMode ? "border-slate-700 bg-slate-900 text-slate-100" : "border-slate-300 bg-white text-slate-900"}`}'],
  ['className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold hover:bg-slate-50"', 'className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${theme.darkMode ? "border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}'],
  ['className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold hover:bg-slate-50"', 'className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${theme.darkMode ? "border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}'],
  ['className="rounded-2xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200"', 'className={`rounded-2xl px-4 py-2 text-sm font-semibold ${theme.darkMode ? "bg-slate-800 text-slate-200 hover:bg-slate-700" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}'],
  ['className="cursor-pointer rounded-2xl border border-slate-200 p-3 bg-white hover:shadow-md transition-shadow"', 'className={`cursor-pointer rounded-2xl border p-3 ${theme.darkMode ? "border-slate-700 bg-slate-900 hover:shadow-md" : "border-slate-200 bg-white hover:shadow-md transition-shadow"}`}'],
  ['className="h-5 w-5 rounded border-slate-300 text-slate-900"', 'className={`h-5 w-5 rounded ${theme.darkMode ? "border-slate-600 text-slate-100" : "border-slate-300 text-slate-900"}`}'],
  ['className={`group rounded-2xl border p-3 text-left text-xs transition ${isSelected ? "border-blue-500 bg-blue-50 ring-1 ring-blue-300" : "border-slate-200 bg-white hover:border-slate-300"}`}', 'className={`group rounded-2xl border p-3 text-left text-xs transition ${isSelected ? "border-blue-500 bg-blue-50 ring-1 ring-blue-300" : theme.darkMode ? "border-slate-700 bg-slate-900 hover:border-slate-600" : "border-slate-200 bg-white hover:border-slate-300"}`}'],
  ['className="rounded-3xl bg-white p-6 shadow-2xl ring-1 ring-slate-200"', 'className={`rounded-3xl bg-white p-6 shadow-2xl ring-1 ${theme.darkMode ? "bg-slate-900 ring-slate-700" : "ring-slate-200"}`}'],
  ['className="rounded-3xl border border-slate-200 p-4"', 'className={`rounded-3xl border p-4 ${theme.darkMode ? "border-slate-700 bg-slate-950 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}'],
  ['className="rounded-2xl border border-slate-200 p-4"', 'className={`rounded-2xl border p-4 ${theme.darkMode ? "border-slate-700 bg-slate-950 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}'],
  ['className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-500"', 'className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${theme.darkMode ? "border-slate-700 bg-slate-950 text-slate-300" : "border-slate-200 bg-slate-50 text-slate-500"}`}'],
  ['className="rounded-3xl bg-white p-6 shadow-2xl ring-1 ring-slate-200"', 'className={`rounded-3xl p-6 shadow-2xl ring-1 ${theme.darkMode ? "bg-slate-900 ring-slate-700 text-slate-100" : "bg-white ring-slate-200"}`}'],
  ['className="rounded-2xl border border-slate-200 p-4"', 'className={`rounded-2xl border p-4 ${theme.darkMode ? "border-slate-700 bg-slate-950 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}'],
  ['className="rounded-3xl bg-white p-6 shadow-2xl ring-1 ring-slate-200"', 'className={`rounded-3xl p-6 shadow-2xl ring-1 ${theme.darkMode ? "bg-slate-900 ring-slate-700 text-slate-100" : "bg-white ring-slate-200"}`}'],
];
replacements.forEach(([oldValue, newValue]) => {
  const count = text.split(oldValue).length - 1;
  if (count > 0) {
    console.log(`Replacing ${count} occurrence(s) of: ${oldValue}`);
    text = text.split(oldValue).join(newValue);
  }
});
fs.writeFileSync(filePath, text, 'utf8');
