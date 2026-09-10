// Local-only UI review: real extension HTML/CSS/JS, fake Chrome identity/API.
// Never included in the extension ZIP. No requests reach production.
import http from "node:http";
import { readFile } from "node:fs/promises";
const root = new URL("../chrome-extension/", import.meta.url);
const shim = `globalThis.chrome={runtime:{getManifest:()=>({version:'0.10.31'})},storage:{local:{get:async()=>({autoLeadRunState:{status:'paused',message:'Checking whether you are already connected',currentLead:{fullName:'Example lead'}}})}},tabs:{get:async()=>({url:'https://www.linkedin.com/in/example'})}};
globalThis.ScoutApi={getAuth:async()=>({token:'preview-only'}),authenticatedAction:async()=>{await new Promise(r=>setTimeout(r,400));return 'LOCAL-PREVIEW-NOT-SENT';}};`;
http.createServer(async (req, res) => {
  const name = new URL(req.url, "http://localhost").pathname.slice(1) || "report.html";
  if (name === "capture-test.html") {
    const report = await readFile(new URL("report.js", root), "utf8");
    const helpers = report.slice(report.indexOf("async function captureFrame("), report.indexOf('window.addEventListener("pagehide"'));
    res.setHeader("Content-Type", "text/html");
    return res.end(`<!doctype html><meta charset="utf-8"><title>Capture engine regression test</title><h1>Local capture engine test</h1><p>No screen sharing or production upload. Tests use a generated canvas stream.</p><button id="run">Run browser capture tests</button><pre id="result">Not run</pre><canvas id="source" width="320" height="180"></canvas><script>${helpers}
document.getElementById('run').onclick=async()=>{
 const result=document.getElementById('result');result.textContent='Running…';
 const canvas=document.getElementById('source'),ctx=canvas.getContext('2d');
 const paint=()=>{ctx.fillStyle='#6844cc';ctx.fillRect(0,0,320,180);ctx.fillStyle='white';ctx.fillRect(20,20,60,60)};paint();
 const stream=canvas.captureStream(10);const ticking=setInterval(paint,100);
 try {
  for(const [name,capture] of [['Direct ImageCapture',captureFrame],['Decoded video fallback',s=>captureVideoFrame(s,s.getVideoTracks()[0])]]){
   const frame=await capture(stream);const sample=document.createElement('canvas');sample.width=frame.width;sample.height=frame.height;
   const pixels=sample.getContext('2d');pixels.drawImage(frame.source,0,0);const rgba=pixels.getImageData(1,1,1,1).data;
   if(frame.width!==320||frame.height!==180||rgba[0]!==104||rgba[1]!==68||rgba[2]!==204)throw Error(name+' produced incorrect pixels');
   frame.close();result.textContent+='\\nPASS '+name+': 320×180, expected pixels';
  }
  result.textContent+='\\nPASS all browser capture checks';
 }catch(e){result.textContent+='\\nFAIL '+e.message}finally{clearInterval(ticking);stream.getTracks().forEach(t=>t.stop());result.textContent+='\\nTest stream stopped';}
};</script>`);
  }
  if (name === "preview.js") { res.setHeader("Content-Type", "application/javascript"); return res.end(shim); }
  if (!["report.html", "report.js", "report.css"].includes(name)) { res.writeHead(404); return res.end(); }
  let data = await readFile(new URL(name, root), "utf8");
  if (name.endsWith("html")) data = data.replace('<script src="config.js"></script><script src="convex-client.js"></script>', '<script src="preview.js"></script>').replace("Private report to your admin", "LOCAL PREVIEW — nothing is sent");
  res.setHeader("Content-Type", name.endsWith("html") ? "text/html" : name.endsWith("css") ? "text/css" : "application/javascript"); res.end(data);
}).listen(4187, "127.0.0.1", () => console.log("Support UI preview: http://127.0.0.1:4187/report.html"));
