/* No background capture, recordings, tokens or full browser/storage dumps. */
const $ = id => document.getElementById(id);
const pictures = [];
const clientId = crypto.randomUUID();
let context;
let sending = false;
let imageBusy = false;
let stream;
const tell = text => { $("status").textContent = text; };
const short = value => typeof value === "string" ? value.slice(0, 1000) : "";
const version = chrome.runtime.getManifest().version;
function lockImages(busy) {
  imageBusy = busy;
  for (const id of ["capture", "attach", "files", "send", "download"]) $(id).disabled = busy || sending;
}
$("version").textContent = `v${version}`;
$("occurred").value = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);

function stopCapture() { stream?.getTracks().forEach(track => track.stop()); stream = null; }
// Capture the stream itself, not a compositor callback. The report tab commonly
// becomes backgrounded when Chrome focuses the tab selected in its picker.
async function captureFrame(mediaStream) {
  const track = mediaStream.getVideoTracks()[0];
  if (!track || track.readyState === "ended") throw new Error("Screen sharing stopped. Choose the screen again.");
  if (typeof ImageCapture === "function") {
    let expired = false;
    let timer;
    try {
      const pending = new ImageCapture(track).grabFrame().then(bitmap => {
        if (expired) { bitmap.close(); throw new Error("Frame arrived after capture ended."); }
        return bitmap;
      });
      const bitmap = await Promise.race([pending, new Promise((_, reject) => {
        timer = setTimeout(() => { expired = true; reject(new Error("Direct frame capture timed out.")); }, 4000);
      })]);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // Some Chrome/platform combinations do not support grabFrame on display
      // tracks. Fall back to decoded video data, without requestVideoFrameCallback.
    } finally { clearTimeout(timer); }
  }
  return captureVideoFrame(mediaStream, track);
}

function captureVideoFrame(mediaStream, track) {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.muted = true; video.playsInline = true; video.autoplay = true;
    video.setAttribute("aria-hidden", "true");
    video.style.cssText = "position:fixed;bottom:0;right:0;width:1px;height:1px;opacity:0.01;pointer-events:none";
    let done = false;
    let timer;
    let poll;
    const cleanup = () => {
      clearTimeout(timer); clearInterval(poll);
      video.removeEventListener("loadeddata", check);
      video.removeEventListener("canplay", check);
      video.removeEventListener("error", failed);
      track.removeEventListener("ended", ended);
      video.pause(); video.srcObject = null; video.remove();
    };
    const fail = message => { if (!done) { done = true; cleanup(); reject(new Error(message)); } };
    const ended = () => fail("Screen sharing stopped. Choose the screen again.");
    const failed = () => fail("Chrome could not read this screen. Try attaching a screenshot instead.");
    function check() {
      if (done) return;
      if (track.readyState === "ended") return ended();
      if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
      try {
        // Copy before releasing the video/track. A decoded first frame is enough;
        // static screens need not produce a second frame or a paint callback.
        const canvas = document.createElement("canvas");
        const scale = Math.min(1, 1920 / Math.max(video.videoWidth, video.videoHeight));
        canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
        canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
        done = true; cleanup();
        resolve({ source: canvas, width: canvas.width, height: canvas.height, close() {} });
      } catch { failed(); }
    }
    video.addEventListener("loadeddata", check);
    video.addEventListener("canplay", check);
    video.addEventListener("error", failed);
    track.addEventListener("ended", ended);
    timer = setTimeout(() => fail("Chrome did not provide an image. Sharing has stopped. Try again or use Attach image."), 8000);
    poll = setInterval(check, 100);
    document.body.append(video);
    video.srcObject = mediaStream;
    // Do not await play(): it can remain pending in a background tab even when
    // current frame data is already available.
    video.play().catch(failed);
    check();
  });
}
window.addEventListener("pagehide", stopCapture);
window.addEventListener("beforeunload", event => {
  if (pictures.length || $("description").value) { event.preventDefault(); event.returnValue = ""; }
});

async function initialize() {
  const saved = await chrome.storage.local.get("autoLeadRunState");
  const run = saved.autoLeadRunState || {};
  let pageUrl = "";
  try {
    const tab = await chrome.tabs.get(Number(new URLSearchParams(location.search).get("tab")));
    const url = new URL(tab.url);
    if (url.protocol === "https:" || url.protocol === "http:") pageUrl = url.origin + url.pathname;
  } catch { /* The originating tab may already be closed. */ }
  context = { version, browser: short(navigator.userAgent), timezone: short(Intl.DateTimeFormat().resolvedOptions().timeZone), pageUrl: short(pageUrl), runStatus: short(run.status), runStep: short(run.message || run.phase), lead: short(run.currentLead?.fullName) };
  $("context").textContent = JSON.stringify(context, null, 2);
  await showIdentity();
}
async function showIdentity() {
  const auth = await ScoutApi.getAuth();
  $("login").hidden = Boolean(auth?.token);
  $("identity").textContent = auth?.token ? "Sent privately under your signed-in scout account." : "Sign in below, or save a copy for your manager.";
}
function render() {
  $("previews").replaceChildren();
  pictures.forEach((data, index) => {
    const figure = document.createElement("figure");
    const img = document.createElement("img"); img.src = `data:image/jpeg;base64,${data}`; img.alt = `Screenshot ${index + 1}`;
    const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "Remove";
    remove.disabled = sending;
    remove.onclick = () => { pictures.splice(index, 1); render(); };
    figure.append(img, remove); $("previews").append(figure);
  });
}
function addImage(source, width, height) {
  if (pictures.length >= 3) throw new Error("You can attach up to 3 screenshots. Remove one to replace it.");
  if (!width || !height) throw new Error("The screen was not ready. Please capture it again.");
  const scale = Math.min(1, 1920 / Math.max(width, height));
  const canvas = document.createElement("canvas"); canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d"); ctx.fillStyle = "white"; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  let data = canvas.toDataURL("image/jpeg", .85).split(",")[1];
  if (data.length > 1300000) data = canvas.toDataURL("image/jpeg", .6).split(",")[1];
  if (data.length > 1300000) throw new Error("This screenshot is too large. Try a smaller window.");
  pictures.push(data); render();
}
$("capture").onclick = async () => {
  if (imageBusy || sending) return;
  if (pictures.length >= 3) return tell("Remove an image before adding another.");
  lockImages(true);
  let frame;
  try {
    tell("Choose the tab or window showing the problem, then click Share.");
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    frame = await captureFrame(stream);
    stopCapture();
    addImage(frame.source, frame.width, frame.height);
    tell("Screenshot captured. Sharing has stopped. Check the preview, then describe the issue below.");
  } catch (error) { tell(error.name === "NotAllowedError" ? "Capture cancelled. Try again, attach an image, or send without a screenshot." : error.message); }
  finally { frame?.close(); stopCapture(); lockImages(false); }
};
async function attach(files) {
  if (imageBusy || sending) return;
  lockImages(true);
  try {
  for (const file of files) {
    if (sending) return;
    try {
      if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 10000000) throw new Error("Choose a PNG, JPG or WebP image smaller than 10 MB.");
      const image = await createImageBitmap(file);
      try { addImage(image, image.width, image.height); } finally { image.close(); }
    } catch (error) { tell(error.message); }
  }
  } finally { lockImages(false); }
}
$("files").onchange = async event => { await attach(event.target.files); event.target.value = ""; };
$("attach").onclick = () => $("files").click();
document.addEventListener("paste", event => { if (event.clipboardData.files.length) { event.preventDefault(); void attach(event.clipboardData.files); } });
$("sign-in").onclick = async () => {
  $("sign-in").disabled = true;
  try { await ScoutApi.signIn($("username").value.trim(), $("password").value); $("password").value = ""; await showIdentity(); tell("Signed in. You can now send your report."); }
  catch (error) { tell(error.message); } finally { $("sign-in").disabled = false; }
};
$("download").onclick = () => {
  const copy = { description: $("description").value, occurredAt: $("occurred").value, context, screenshots: pictures.map(data => `data:image/jpeg;base64,${data}`) };
  const url = URL.createObjectURL(new Blob([JSON.stringify(copy, null, 2)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = "callum-scout-bug-report.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  tell("Report copy saved. It includes your selected screenshots; share it only with your manager.");
};
$("report-form").onsubmit = async event => {
  event.preventDefault(); if (sending || imageBusy || !context) return;
  sending = true;
  $("report-form").querySelectorAll("button,input,textarea").forEach(el => { el.disabled = true; });
  tell("Sending your report securely…");
  try {
    const id = await ScoutApi.authenticatedAction("bugReportActions:submit", { clientId, description: $("description").value, occurredAt: new Date($("occurred").value).getTime(), context, screenshots: [...pictures] });
    pictures.length = 0; $("description").value = ""; $("report-form").hidden = true;
    tell(`Report received. Your admin can now see it, including your screenshots. Reference: ${id}. You can close this tab.`);
  } catch (error) { tell(`${error.message} Your report is still here. You can retry or save a copy.`); await showIdentity(); }
  finally { sending = false; $("report-form").querySelectorAll("button,input,textarea").forEach(el => { el.disabled = false; }); }
};
initialize().catch(error => tell(`Unable to load report details: ${error.message}. Reopen Report bug to retry.`));
