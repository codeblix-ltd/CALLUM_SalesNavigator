const $ = id => document.getElementById(id);
const labels = { open: "Open", investigating: "Investigating", resolved: "Resolved" };
let cursor = null, busy = false;
const drafts = new Map();
$("version").textContent = `v${chrome.runtime.getManifest().version}`;
function element(tag, text) { const node = document.createElement(tag); if (text) node.textContent = text; return node; }
async function load(append = false) {
  if (busy) return;
  busy = true; $("refresh").disabled = true; $("more").disabled = true;
  try {
    const auth = await ScoutApi.getAuth(); $("login").hidden = Boolean(auth);
    if (!auth) { $("reports").replaceChildren(); $("more").hidden = true; return; }
    const result = await ScoutApi.authenticatedQuery("bugReports:mine", { paginationOpts: { numItems: 10, cursor: append ? cursor : null } });
    if (!append) $("reports").replaceChildren();
    for (const report of result.page) {
      const section = element("section");
      section.append(element("h2", labels[report.status]), element("p", report.description));
      if (report.screenshotCount) {
        const imagesButton = element("button", "View screenshots"), pictures = element("div"); imagesButton.className = "secondary";
        imagesButton.onclick = async () => { imagesButton.disabled = true; try { const urls = await ScoutApi.authenticatedQuery("bugReports:images", { id: report._id }); pictures.replaceChildren(); for (const url of urls.filter(Boolean)) { const link = element("a"), image = element("img"); link.href = url; link.target = "_blank"; link.rel = "noreferrer"; image.src = url; image.alt = "Your reported screenshot"; image.style.maxWidth = "100%"; link.append(image); pictures.append(link); } } catch(error) { pictures.textContent = error.message; } finally { imagesButton.disabled = false; } };
        section.append(imagesButton, pictures);
      }
      for (const message of report.messages) {
        const row = element("article"); row.append(element("strong", `${message.author === "support" ? "Callum support" : "You"} · ${new Date(message.sentAt).toLocaleString()}`), element("p", message.text)); section.append(row);
      }
      if (!report.messages.length) section.append(element("p", "Awaiting a reply."));
      const form = element("form"), input = element("textarea"), send = element("button", "Send reply"), feedback = element("p");
      input.rows = 3; input.maxLength = 2000; input.required = true; input.placeholder = "Reply or tell us if it still happens…"; input.setAttribute("aria-label", "Your reply"); input.value = drafts.get(report._id)?.text || "";
      input.oninput = () => drafts.set(report._id, { text: input.value, clientId: crypto.randomUUID() });
      feedback.setAttribute("role", "status"); form.append(input, send, feedback);
      form.onsubmit = async event => {
        event.preventDefault(); send.disabled = true; input.disabled = true;
        const draft = drafts.get(report._id) || { text: input.value, clientId: crypto.randomUUID() }; drafts.set(report._id, draft);
        try { await ScoutApi.authenticatedMutation("bugReports:reply", { id: report._id, ...draft }); drafts.delete(report._id); await load(); }
        catch (error) { feedback.textContent = error.message; } finally { send.disabled = false; input.disabled = false; }
      };
      section.append(form); $("reports").append(section);
    }
    cursor = result.continueCursor; $("more").hidden = result.isDone;
    $("status").textContent = !append && !result.page.length ? "No reports yet." : "";
  } catch (error) { $("status").textContent = error.message; $("login").hidden = Boolean(await ScoutApi.getAuth()); }
  finally { busy = false; $("refresh").disabled = false; $("more").disabled = false; }
}
$("refresh").onclick = () => load(); $("more").onclick = () => load(true);
$("login-form").onsubmit = async event => { event.preventDefault(); try { await ScoutApi.signIn($("username").value, $("password").value); $("password").value = ""; await load(); } catch(error) { $("status").textContent = error.message; } };
void load();
