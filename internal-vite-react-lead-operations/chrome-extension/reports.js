(() => {
  const root = document.getElementById("my-reports");
  const $ = id => root.querySelector(`#reports-${id}`);
  const labels = { open: "Open", investigating: "Investigating", resolved: "Resolved" };
  let cursor = null, busy = false;
  const drafts = new Map();
  const version = document.getElementById("version");
  if (version && !version.textContent) version.textContent = `v${chrome.runtime.getManifest().version}`;
  function element(tag, value) { const node = document.createElement(tag); if (value) node.textContent = value; return node; }
  function imageButton(title, getUrls, alt) {
    const wrapper = element("div"), button = element("button", title), container = element("div");
    button.className = "secondary";
    button.onclick = async () => {
      button.disabled = true;
      try {
        const urls = await getUrls(); container.replaceChildren();
        for (const url of urls.filter(Boolean)) {
          const link = element("a"), image = element("img");
          link.href = url; link.target = "_blank"; link.rel = "noreferrer";
          image.src = url; image.alt = alt; image.style.maxWidth = "100%";
          link.append(image); container.append(link);
        }
      } catch (error) { container.textContent = error.message; }
      finally { button.disabled = false; }
    };
    wrapper.append(button, container); return wrapper;
  }
  async function encodeImage(file) {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 10000000) throw new Error("Choose a PNG, JPG or WebP image smaller than 10 MB.");
    const bitmap = await createImageBitmap(file);
    try {
      const scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas"); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
      const ctx = canvas.getContext("2d"); ctx.fillStyle = "white"; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      let data = canvas.toDataURL("image/jpeg", .85).split(",")[1];
      if (data.length > 1300000) data = canvas.toDataURL("image/jpeg", .6).split(",")[1];
      if (data.length > 1300000) throw new Error("This screenshot is too large. Try a smaller window.");
      return data;
    } finally { bitmap.close(); }
  }
  async function load(append = false) {
    if (busy) return;
    busy = true; $("refresh").disabled = true; $("more").disabled = true;
    try {
      const auth = await ScoutApi.getAuth(); $("login").hidden = Boolean(auth);
      if (!auth) { $("list").replaceChildren(); $("more").hidden = true; return; }
      const result = await ScoutApi.authenticatedQuery("bugReports:mine", { paginationOpts: { numItems: 10, cursor: append ? cursor : null } });
      if (!append) $("list").replaceChildren();
      for (const report of result.page) {
        const section = element("section");
        section.append(element("h3", labels[report.status]), element("p", report.description));
        if (report.screenshotCount) section.append(imageButton("View screenshots", () => ScoutApi.authenticatedQuery("bugReports:images", { id: report._id }), "Your reported screenshot"));
        for (const message of report.messages) {
          const row = element("article");
          row.append(element("strong", `${message.author === "support" ? "Callum support" : "You"} · ${new Date(message.sentAt).toLocaleString()}`), element("p", message.text));
          if (message.screenshots?.length) row.append(imageButton("View reply screenshots", () => ScoutApi.authenticatedQuery("bugReports:messageImages", { id: report._id, clientId: message.clientId }), "Reply screenshot"));
          section.append(row);
        }
        if (!report.messages.length) section.append(element("p", "Awaiting a reply."));
        const form = element("form"), input = element("textarea"), send = element("button", "Send reply"), feedback = element("p");
        const attach = element("input"), label = element("label", "Screenshots (optional, up to 3)"), previews = element("div");
        const draft = drafts.get(report._id) || { text: "", clientId: crypto.randomUUID(), screenshots: [] };
        drafts.set(report._id, draft);
        input.rows = 3; input.maxLength = 2000; input.required = true; input.placeholder = "Reply or tell us if it still happens…"; input.setAttribute("aria-label", "Your reply"); input.value = draft.text;
        input.oninput = () => { draft.text = input.value; draft.clientId = crypto.randomUUID(); };
        attach.type = "file"; attach.accept = "image/png,image/jpeg,image/webp"; attach.multiple = true;
        function renderPreviews() {
          previews.replaceChildren();
          draft.screenshots.forEach((data, index) => {
            const figure = element("figure"), image = element("img"), remove = element("button", "Remove");
            image.src = `data:image/jpeg;base64,${data}`; image.alt = `Screenshot ${index + 1}`;
            remove.type = "button"; remove.onclick = () => { draft.screenshots.splice(index, 1); draft.clientId = crypto.randomUUID(); renderPreviews(); };
            figure.append(image, remove); previews.append(figure);
          });
        }
        previews.className = "previews"; renderPreviews();
        attach.onchange = async () => {
          attach.disabled = true; feedback.textContent = "";
          try {
            for (const file of attach.files) {
              if (draft.screenshots.length >= 3) throw new Error("Attach up to three screenshots.");
              draft.screenshots.push(await encodeImage(file)); draft.clientId = crypto.randomUUID(); renderPreviews();
            }
          } catch (error) { feedback.textContent = error.message; }
          finally { attach.value = ""; attach.disabled = false; }
        };
        label.append(attach); feedback.setAttribute("role", "status"); form.append(input, label, previews, send, feedback);
        form.onsubmit = async event => {
          event.preventDefault(); send.disabled = true; input.disabled = true; attach.disabled = true;
          try {
            await ScoutApi.authenticatedAction("bugReportActions:scoutReply", { id: report._id, clientId: draft.clientId, text: draft.text, screenshots: draft.screenshots });
            drafts.delete(report._id); await load();
          } catch (error) { feedback.textContent = error.message; }
          finally { send.disabled = false; input.disabled = false; attach.disabled = false; }
        };
        section.append(form); $("list").append(section);
      }
      cursor = result.continueCursor; $("more").hidden = result.isDone;
      $("status").textContent = !append && !result.page.length ? "No reports yet." : "";
    } catch (error) { $("status").textContent = error.message; $("login").hidden = Boolean(await ScoutApi.getAuth()); }
    finally { busy = false; $("refresh").disabled = false; $("more").disabled = false; }
  }
  $("refresh").onclick = () => load(); $("more").onclick = () => load(true);
  window.addEventListener("scout-report-sent", () => load());
  $("login-form").onsubmit = async event => { event.preventDefault(); try { await ScoutApi.signIn($("username").value, $("password").value); $("password").value = ""; await load(); } catch (error) { $("status").textContent = error.message; } };
  void load();
})();
