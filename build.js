const babel = require('@babel/core');
const fs = require('fs');

const jsx = fs.readFileSync('app_v97.jsx', 'utf8');
const result = babel.transformSync(jsx, { presets: ['@babel/preset-react'] });

const now = new Date();
const est = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const buildTs = `v97 | Built ${months[est.getMonth()]} ${est.getDate()}, ${est.getFullYear()} ${est.getHours()%12||12}:${String(est.getMinutes()).padStart(2,'0')} ${est.getHours()>=12?'PM':'AM'} EST`;

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>Alpha Quant Analytics</title>
<script src="https://unpkg.com/react@18.2.0/umd/react.production.min.js"><\/script>
<script src="https://unpkg.com/react-dom@18.2.0/umd/react-dom.production.min.js"><\/script>
<script src="https://unpkg.com/recharts@2.12.7/umd/Recharts.js"><\/script>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'JetBrains Mono',monospace;overflow-x:hidden}
input[type="date"]::-webkit-calendar-picker-indicator{filter:invert(0.7)}
::-webkit-scrollbar{width:4px;height:4px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:#1a2d5a;border-radius:2px}
</style>
</head>
<body>
<div id="root"></div>
<script>
var BUILD_TS="${buildTs}";
${result.code}
ReactDOM.render(React.createElement(App), document.getElementById('root'));
<\/script>
</body>
</html>`;

fs.writeFileSync('index.html', html);
console.log('Build complete:', buildTs);
console.log('HTML size:', (html.length / 1024).toFixed(0) + 'KB');
