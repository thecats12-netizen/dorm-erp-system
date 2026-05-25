const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, '..', 'src', 'App.tsx');
let text = fs.readFileSync(filePath, 'utf8');
let count = 0;
text = text.replace(/className="([^"]*?)"/g, (match, orig) => {
  if (!/(bg-white|bg-slate-50|bg-slate-100|hover:bg-slate-50|hover:bg-slate-100|border-slate-200|border-slate-300|border-slate-100|text-slate-900|text-slate-700|text-slate-600)/.test(orig)) {
    return match;
  }
  const dark = orig
    .replace(/\bbg-white\b/g, 'bg-slate-950')
    .replace(/\bbg-slate-50\b/g, 'bg-slate-950')
    .replace(/\bbg-slate-100\b/g, 'bg-slate-900')
    .replace(/\bhover:bg-slate-50\b/g, 'hover:bg-slate-700')
    .replace(/\bhover:bg-slate-100\b/g, 'hover:bg-slate-700')
    .replace(/\bborder-slate-200\b/g, 'border-slate-700')
    .replace(/\bborder-slate-300\b/g, 'border-slate-600')
    .replace(/\bborder-slate-100\b/g, 'border-slate-700')
    .replace(/\btext-slate-900\b/g, 'text-slate-100')
    .replace(/\btext-slate-700\b/g, 'text-slate-300')
    .replace(/\btext-slate-600\b/g, 'text-slate-300');
  count += 1;
  return `className={\`\${theme.darkMode ? "${dark}" : "${orig}"}\`}`;
});
console.log('Converted', count, 'className attributes to theme-aware variables.');
fs.writeFileSync(filePath, text, 'utf8');
