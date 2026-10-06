import { chromium } from '@playwright/test';
import fs from 'node:fs';
const [a, b, limit] = process.argv.slice(2);
const br = await chromium.launch(); const p = await br.newPage();
const res = await p.evaluate(async ([da, db, lim]) => {
  const load = src => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,' + src; });
  const [ia, ib] = await Promise.all([load(da), load(db)]);
  const get = img => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, img.width, img.height).data; };
  const A = get(ia), B = get(ib); const out = []; let maxd = 0;
  for (let i = 0; i < A.length; i += 4) { const d = Math.max(Math.abs(A[i]-B[i]), Math.abs(A[i+1]-B[i+1]), Math.abs(A[i+2]-B[i+2])); if (d > 0) { const n = i / 4; out.push([n % ia.width, Math.floor(n / ia.width), d, [A[i],A[i+1],A[i+2]].join('/'), [B[i],B[i+1],B[i+2]].join('/')]); maxd = Math.max(maxd, d); } }
  out.sort((x, y) => y[2] - x[2]);
  return { total: out.length, maxd, top: out.slice(0, lim) };
}, [fs.readFileSync(a).toString('base64'), fs.readFileSync(b).toString('base64'), Number(limit)]);
console.log(JSON.stringify({ total: res.total, maxd: res.maxd }));
console.log(res.top.map(r => r.join(' ')).join('\n'));
await br.close();
