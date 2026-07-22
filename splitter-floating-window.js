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

  startBtn.onclick = () => {
    const ceiling = parseInt(document.getElementById('splitCeilingInput').value, 10);
    window.TotleadsUrlSplitter.start(window.location.href, ceiling);
    
    startBtn.style.display = 'none';
    stopBtn.style.display = 'block';
    statusEl.style.display = 'block';
    statusEl.textContent = "Engine running... Watch URL bar navigating dynamically.";
  };

  stopBtn.onclick = () => {
    window.TotleadsUrlSplitter.stop();
    floatingWindow.remove();
  };

  // Listen for Export Completion from the Engine
  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    if (e.data.type === 'LINKEDIN_SPLITTER' && e.data.action === 'EXPORT_COMPLETE') {
      startBtn.style.display = 'block';
      stopBtn.style.display = 'none';
      statusEl.textContent = "Split Complete. CSV Downloaded!";
      statusEl.style.color = "#00a86b";
    }
  });
}

// Global Listener to pop the window
window.addEventListener('message', (event) => {
  if (event.data.type === 'LINKEDIN_SPLITTER' && event.data.action === 'SHOW_WINDOW') {
    createSplitterFloatingWindow();
  }
});