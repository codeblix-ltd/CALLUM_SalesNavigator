function createSplitterFloatingWindow() {
  if (document.getElementById('linkedin-splitter-window')) return;

  const floatingWindow = document.createElement('div');
  floatingWindow.id = 'linkedin-splitter-window';
  floatingWindow.innerHTML = `
    <div class="header" style="display:flex; justify-content:space-between; border-bottom:1px solid #eee; padding-bottom:10px;">
      <h1 style="font-size:20px; color:#0A0D14; margin:0;">Sales Nav URL Splitter</h1>
      <button id="closeSplitterBtn" style="background:none; border:none; font-size:18px; cursor:pointer;">X</button>
    </div>
    
    <div style="margin-top:20px;">
      <p style="font-size:14px; color:#6c757d;">Recursively partition oversized searches (>2500) into safe, mutually exclusive child URLs.</p>
      
      <div style="margin: 20px 0;">
        <label style="display:block; font-size:14px; font-weight:bold; margin-bottom:8px;">Target Ceiling</label>
        <input type="number" id="splitCeilingInput" value="2500" style="width:100%; padding:10px; border-radius:8px; border:1px solid #ccc;">
      </div>

      <div id="splitterStatus" style="padding:15px; background:#f8f9fa; border-radius:8px; display:none; margin-bottom:15px; font-weight:bold; color:#d97706;"></div>

      <button id="startSplitBtn" class="button" style="width:100%; padding:12px; background:#079669; color:white; border:none; border-radius:8px; cursor:pointer; font-weight:bold;">Start Adaptive Split</button>
      
      <div id="resumeSection" style="margin-top:15px; border-top:1px dashed #e5e7eb; padding-top:15px;">
        <label style="display:block; font-size:13px; font-weight:bold; color:#4b5563; margin-bottom:6px;">Or Resume from CSV</label>
        <div id="splitterDropZone" style="border:2px dashed #079669; border-radius:8px; padding:14px; text-align:center; background:#f0fdf4; cursor:pointer; transition: background 0.2s;">
          <p style="margin:0; font-size:12px; color:#166534; font-weight:bold;">📁 Drop CSV file here or click to select</p>
          <input type="file" id="splitterCsvInput" accept=".csv" style="display:none;">
        </div>
      </div>

      <button id="stopSplitBtn" class="button" style="width:100%; padding:12px; background:#dc3545; color:white; border:none; border-radius:8px; cursor:pointer; font-weight:bold; margin-top:10px; display:none;">Stop & Export Progress</button>
    </div>
  `;

  // Attach CSS logic mirroring the original floating window
  floatingWindow.style.cssText = `
    position: fixed; top: 20px; left: 20px; width: 400px;
    background: white; border-radius: 16px; padding: 24px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.15); z-index: 10001;
  `;
  
  document.body.appendChild(floatingWindow);

  // Bind Events
  document.getElementById('closeSplitterBtn').onclick = () => floatingWindow.remove();
  
  const startBtn = document.getElementById('startSplitBtn');
  const stopBtn = document.getElementById('stopSplitBtn');
  const statusEl = document.getElementById('splitterStatus');
  const resumeSection = document.getElementById('resumeSection');
  const dropZone = document.getElementById('splitterDropZone');
  const csvInput = document.getElementById('splitterCsvInput');

  startBtn.onclick = () => {
    const ceiling = parseInt(document.getElementById('splitCeilingInput').value, 10);
    window.TotleadsUrlSplitter.start(window.location.href, ceiling);
    
    startBtn.style.display = 'none';
    if (resumeSection) resumeSection.style.display = 'none';
    stopBtn.style.display = 'block';
    statusEl.style.display = 'block';
    statusEl.textContent = "Engine running... Fetching API silently.";
    statusEl.style.color = "#d97706";
  };

  stopBtn.onclick = () => {
    window.TotleadsUrlSplitter.stop();
    floatingWindow.remove();
  };

  const handleCsvFile = (file) => {
    if (!file || !file.name.endsWith('.csv')) {
      alert("Please select a valid CSV file.");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const ceiling = parseInt(document.getElementById('splitCeilingInput').value, 10);
        window.TotleadsUrlSplitter.resumeFromCSV(e.target.result, ceiling);
        
        startBtn.style.display = 'none';
        if (resumeSection) resumeSection.style.display = 'none';
        stopBtn.style.display = 'block';
        statusEl.style.display = 'block';
        statusEl.textContent = "Resuming split from CSV... Engine running.";
        statusEl.style.color = "#d97706";
      } catch (err) {
        alert("Failed to resume from CSV: " + err.message);
      }
    };
    reader.readAsText(file);
  };

  if (dropZone && csvInput) {
    dropZone.onclick = () => csvInput.click();
    csvInput.onchange = (e) => {
      if (e.target.files && e.target.files[0]) {
        handleCsvFile(e.target.files[0]);
      }
    };

    dropZone.ondragover = (e) => {
      e.preventDefault();
      dropZone.style.background = "#dcfce7";
    };
    dropZone.ondragleave = (e) => {
      e.preventDefault();
      dropZone.style.background = "#f0fdf4";
    };
    dropZone.ondrop = (e) => {
      e.preventDefault();
      dropZone.style.background = "#f0fdf4";
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleCsvFile(e.dataTransfer.files[0]);
      }
    };
  }

  // Listen for Export Completion from the Engine
  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    if (e.data.type === 'LINKEDIN_SPLITTER' && e.data.action === 'EXPORT_COMPLETE') {
      startBtn.style.display = 'block';
      if (resumeSection) resumeSection.style.display = 'block';
      stopBtn.style.display = 'none';
      statusEl.style.display = 'block';
      statusEl.style.background = "#f0fdf4";
      statusEl.style.border = "1px solid #bbf7d0";
      statusEl.innerHTML = `
        <div style="font-size:13px; font-weight:bold; color:#00a86b; text-align:center;">
          🎉 Split Complete! CSV Exported.
        </div>
      `;
    }
    if (e.data.type === 'LINKEDIN_SPLITTER' && e.data.action === 'SPLITTER_PROGRESS_URL') {
      const d = e.data.data;
      const remaining = d.remaining !== undefined ? d.remaining : '?';
      const accepted = d.accepted !== undefined ? d.accepted : 0;
      const totalLeads = d.totalAcceptedLeads !== undefined ? d.totalAcceptedLeads.toLocaleString() : 0;
      const unresolved = d.unresolved || 0;
      let urlSearch = '';
      try {
        if (d.url) urlSearch = new URL(d.url).search.slice(0, 40) + '...';
      } catch (err) {}

      statusEl.style.display = 'block';
      statusEl.style.color = "#1f2937";
      statusEl.style.background = "#f0fdf4";
      statusEl.style.border = "1px solid #bbf7d0";
      
      statusEl.innerHTML = `
        <div style="font-size:13px; line-height:1.6;">
          <div style="display:flex; justify-content:space-between; font-weight:bold; color:#15803d; margin-bottom:4px;">
            <span>⏳ Queue Remaining: <span style="font-size:15px; color:#047857;">${remaining}</span></span>
            <span>✅ Safe URLs: <span style="font-size:15px; color:#047857;">${accepted}</span></span>
          </div>
          <div style="display:flex; justify-content:space-between; color:#374151; font-size:12px; margin-bottom:4px;">
            <span>👥 Leads Covered: <strong>${totalLeads}</strong></span>
            ${unresolved > 0 ? `<span style="color:#dc3545; font-weight:bold;">⚠️ Unresolved: ${unresolved}</span>` : ''}
          </div>
          ${d.url ? `
          <div style="font-size:11px; color:#6b7280; border-top:1px solid #dcfce7; padding-top:4px; margin-top:4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
            🔍 Processing: <strong>${d.count || 0} leads</strong> ${urlSearch}
          </div>` : ''}
        </div>
      `;
    }
    if (e.data.type === 'LINKEDIN_SPLITTER' && e.data.action === 'SPLITTER_RATE_LIMIT') {
      statusEl.style.display = 'block';
      statusEl.style.background = "#fef2f2";
      statusEl.style.border = "1px solid #fecaca";
      statusEl.innerHTML = `
        <div style="font-size:13px; font-weight:bold; color:#991b1b;">
          🛑 Rate limited (HTTP 429)
        </div>
        <div style="font-size:12px; margin-top:2px; color:#b91c1c;">
          Pausing & retrying automatically in <strong>${e.data.data.delay}s</strong>...
        </div>
      `;
    }
  });
}

// Global Listener to pop the window
window.addEventListener('message', (event) => {
  if (event.data.type === 'LINKEDIN_SPLITTER' && event.data.action === 'SHOW_WINDOW') {
    createSplitterFloatingWindow();
  }
});