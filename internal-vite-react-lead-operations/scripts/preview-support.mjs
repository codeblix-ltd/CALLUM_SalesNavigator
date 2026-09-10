// Local-only UI review: real extension HTML/CSS/JS, fake Chrome identity/API.
// Never included in the extension ZIP. No requests reach production.
import http from "node:http";
import { readFile } from "node:fs/promises";
const root = new URL("../chrome-extension/", import.meta.url);
const shim = `globalThis.chrome={runtime:{getManifest:()=>({version:'0.10.31'})},storage:{local:{get:async()=>({autoLeadRunState:{status:'paused',message:'Checking whether you are already connected',currentLead:{fullName:'Example lead'}}})}},tabs:{get:async()=>({url:'https://www.linkedin.com/in/example'})}};
globalThis.ScoutApi={getAuth:async()=>({token:'preview-only'}),authenticatedAction:async()=>{await new Promise(r=>setTimeout(r,400));return 'LOCAL-PREVIEW-NOT-SENT';}};`;
http.createServer(async (req, res) => {
  const name = new URL(req.url, "http://localhost").pathname.slice(1) || "report.html";
  if (name === "preview.js") { res.setHeader("Content-Type", "application/javascript"); return res.end(shim); }
  if (!["report.html", "report.js", "report.css"].includes(name)) { res.writeHead(404); return res.end(); }
  let data = await readFile(new URL(name, root), "utf8");
  if (name.endsWith("html")) data = data.replace('<script src="config.js"></script><script src="convex-client.js"></script>', '<script src="preview.js"></script>').replace("Private report to your admin", "LOCAL PREVIEW — nothing is sent");
  res.setHeader("Content-Type", name.endsWith("html") ? "text/html" : name.endsWith("css") ? "text/css" : "application/javascript"); res.end(data);
}).listen(4187, "127.0.0.1", () => console.log("Support UI preview: http://127.0.0.1:4187/report.html"));
