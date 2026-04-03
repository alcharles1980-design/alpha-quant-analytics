const babel = require('@babel/core');
const fs = require('fs');
const path = require('path');

const files = fs.readdirSync(__dirname).filter(f => f.match(/^app_v\d+\.jsx$/));
if (!files.length) { console.error('No app_v*.jsx found!'); process.exit(1); }
files.sort((a, b) => parseInt(b.match(/\d+/)[0]) - parseInt(a.match(/\d+/)[0]));
const srcFile = files[0];
console.log('Compiling:', srcFile);

const jsx = fs.readFileSync(path.join(__dirname, srcFile), 'utf8');
const result = babel.transformSync(jsx, { presets: ['@babel/preset-react'] });
try { new Function(result.code); } catch (e) { console.error('SYNTAX ERROR:', e.message); process.exit(1); }

// Inject build timestamp
const now = new Date();
const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const est = new Date(now.getTime() - 5 * 60 * 60 * 1000);
const estH = est.getUTCHours();
const ampm = estH >= 12 ? 'PM' : 'AM';
const h12 = estH % 12 || 12;
const mm = String(est.getUTCMinutes()).padStart(2, '0');
const buildTS = months[est.getUTCMonth()] + ' ' + est.getUTCDate() + ', ' + est.getUTCFullYear() + ' ' + 
  h12 + ':' + mm + ' ' + ampm + ' EST';
const finalCode = 'var BUILD_TS="v93 | Built: ' + buildTS + '";\n' + result.code;

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta name="apple-mobile-web-app-capable" content="yes">
<title>Alpha Quant Analytics</title>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{transition:background 0.3s;overflow-x:hidden}
input[type="date"]::-webkit-calendar-picker-indicator{filter:invert(0.5)}
input:focus{border-color:#1e3050 !important}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}
::-webkit-scrollbar{width:4px;height:4px}::-webkit-scrollbar-track{background:#0c1219}
::-webkit-scrollbar-thumb{background:#1a2236;border-radius:4px}
@media(min-width:700px){body{padding:0 20px}}
</style>
<script crossorigin src="https://cdn.jsdelivr.net/npm/react@18.2.0/umd/react.production.min.js"></script>
<script crossorigin src="https://cdn.jsdelivr.net/npm/react-dom@18.2.0/umd/react-dom.production.min.js"></script>
</head>
<body>
<div id="root"></div>
<script>
var rs=document.createElement("script");rs.src="https://cdn.jsdelivr.net/npm/recharts@2.12.7/umd/Recharts.js";rs.crossOrigin="anonymous";
rs.onload=function(){go();};rs.onerror=function(){var s2=document.createElement("script");s2.src="https://unpkg.com/recharts@2.7.3/umd/Recharts.js";s2.crossOrigin="anonymous";s2.onload=function(){go();};s2.onerror=function(){go();};document.head.appendChild(s2);};
document.head.appendChild(rs);
function go(){try{
${finalCode}
}catch(e){document.getElementById("root").style.cssText="color:#ff5c3a;padding:20px;font-family:monospace";document.getElementById("root").textContent="Error: "+e.message;}}
</script>
</body>
</html>`;

const distDir = path.join(__dirname, 'dist');
if (!fs.existsSync(distDir)) fs.mkdirSync(distDir);
fs.writeFileSync(path.join(distDir, 'index.html'), html);
console.log('Build complete:', srcFile, '→ dist/index.html (' + html.length + ' bytes)');
