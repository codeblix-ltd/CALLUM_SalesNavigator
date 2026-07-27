function sendBulkRuntimeMessage(message, callback) {
  try {
    if (
      typeof chrome === 'undefined' ||
      !chrome.runtime ||
      !chrome.runtime.id
    ) {
      throw new Error('Extension context invalidated. Refresh the LinkedIn tab.');
    }

    chrome.runtime.sendMessage(message, response => {
      let runtimeError = null;
      try {
        runtimeError = chrome.runtime.lastError;
      } catch (error) {
        runtimeError = error;
      }

      if (runtimeError) {
        callback(null, new Error(runtimeError.message || String(runtimeError)));
        return;
      }

      callback(response, null);
    });
  } catch (error) {
    callback(null, error);
  }
}

function createBulkFloatingWindow() {
  if (document.getElementById('linkedin-bulk-window')) return;

  const floatingWindow = document.createElement('div');
  floatingWindow.id = 'linkedin-bulk-window';
  floatingWindow.innerHTML = `
    <div class="header" style="display:flex; justify-content:space-between; border-bottom:1px solid #eee; padding-bottom:10px;">
      <h1 style="font-size:20px; color:#0A0D14; margin:0; display:flex; align-items:center; gap:8px;">
        <span style="background: linear-gradient(135deg, #11AF7B 0%, #08835F 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">T</span>
        <span style="color:#0A0D14;">otleads Bulk</span>
      </h1>
      <button id="closeBulkBtn" style="background:none; border:none; font-size:18px; cursor:pointer;">X</button>
    </div>
    
    <div style="margin-top:20px;">
      <p style="font-size:14px; color:#6c757d; margin-bottom:15px;">Paste multiple Sales Navigator URLs (one per line) to scrape them sequentially.</p>
      
      <div style="margin: 15px 0;">
        <label style="display:block; font-size:14px; font-weight:bold; margin-bottom:8px;">Sales Navigator URLs</label>
        <textarea id="bulkUrlsInput" rows="6" style="width:100%; padding:10px; border-radius:8px; border:1px solid #ccc; font-size:12px; font-family:monospace; resize:vertical;" placeholder="https://www.linkedin.com/sales/search/..."></textarea>
        <div style="font-size:12px; color:#6c757d; text-align:right; margin-top:4px;" id="bulkUrlsCount">0 URLs detected</div>
      </div>

      <div style="margin: 15px 0;">
        <label style="display:block; font-size:14px; font-weight:bold; margin-bottom:8px;">Max Leads per URL</label>
        <input type="number" id="bulkMaxLeadsInput" value="50" style="width:100%; padding:10px; border-radius:8px; border:1px solid #ccc;">
      </div>

      <div id="bulkStatus" style="padding:15px; background:#f8f9fa; border-radius:8px; display:none; margin-bottom:15px; font-weight:bold; color:#00a86b; font-size:13px; line-height:1.5;"></div>

      <button id="startBulkBtn" class="button" style="width:100%; padding:12px; background:linear-gradient(135deg, #11AF7B 0%, #08835F 100%); color:white; border:none; border-radius:8px; cursor:pointer; font-weight:bold; margin-bottom:10px;">Start Bulk Scrape</button>
      <button id="stopBulkBtn" class="button" style="width:100%; padding:12px; background:linear-gradient(135deg, #dc3545 0%, #c82333 100%); color:white; border:none; border-radius:8px; cursor:pointer; font-weight:bold; display:none;">Stop Bulk Scrape</button>
      <button id="skipBulkBtn" class="button" style="width:100%; padding:12px; background:linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color:white; border:none; border-radius:8px; cursor:pointer; font-weight:bold; display:none; margin-top:10px;">Skip This URL &amp; Continue</button>
      <button id="resetBulkBtn" class="button" style="width:100%; padding:12px; background:#6c757d; color:white; border:none; border-radius:8px; cursor:pointer; font-weight:bold; display:none; margin-top:10px;">Reset Progress</button>
    </div>
  `;

  floatingWindow.style.cssText = `
    position: fixed; top: 20px; left: 20px; width: 420px;
    background: white; border-radius: 16px; padding: 24px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.15); z-index: 10001;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  `;
  
  document.body.appendChild(floatingWindow);

  const urlsInput = document.getElementById('bulkUrlsInput');
  const countLabel = document.getElementById('bulkUrlsCount');
  const startBtn = document.getElementById('startBulkBtn');
  const stopBtn = document.getElementById('stopBulkBtn');
  const skipBtn = document.getElementById('skipBulkBtn');
  const resetBtn = document.getElementById('resetBulkBtn');
  const statusEl = document.getElementById('bulkStatus');
  const maxLeadsInput = document.getElementById('bulkMaxLeadsInput');
  let syncInterval = null;
  let contextInvalidated = false;

  const handleRuntimeError = error => {
    const message = error?.message || String(error || '');
    const isInvalidated = /extension context invalidated|context invalidated/i.test(message) ||
      typeof chrome === 'undefined' ||
      !chrome.runtime?.id;

    if (!isInvalidated) {
      statusEl.style.display = 'block';
      statusEl.style.background = '#fef2f2';
      statusEl.style.color = '#b91c1c';
      statusEl.style.border = '1px solid #fecaca';
      statusEl.textContent = `Could not contact the extension: ${message}`;
      skipBtn.disabled = false;
      skipBtn.textContent = 'Skip This URL & Continue';
      return;
    }

    contextInvalidated = true;
    if (syncInterval) {
      clearInterval(syncInterval);
      syncInterval = null;
    }

    statusEl.style.display = 'block';
    statusEl.style.background = '#fef2f2';
    statusEl.style.color = '#b91c1c';
    statusEl.style.border = '1px solid #fecaca';
    statusEl.textContent = 'The extension was reloaded. Refresh this LinkedIn tab to reconnect it.';
    [startBtn, stopBtn, skipBtn, resetBtn, urlsInput, maxLeadsInput].forEach(element => {
      element.disabled = true;
    });
  };

  const sendMessage = (message, onSuccess) => {
    if (contextInvalidated) return;
    sendBulkRuntimeMessage(message, (response, error) => {
      if (error) {
        handleRuntimeError(error);
        return;
      }
      onSuccess?.(response);
    });
  };

  document.getElementById('closeBulkBtn').onclick = () => {
    if (syncInterval) clearInterval(syncInterval);
    floatingWindow.remove();
  };

  const updateCount = () => {
    const urls = urlsInput.value.split('\n').map(u => u.trim()).filter(u => u.length > 0);
    countLabel.textContent = `${urls.length} URLs detected`;
  };
  urlsInput.addEventListener('input', updateCount);

  // Sync state with background
  function syncState() {
    sendMessage({ action: 'GET_BULK_SCRAPE_STATE' }, state => {
      if (state && state.urls && state.urls.length > 0) {
        if (!urlsInput.value) {
          urlsInput.value = state.urls.join('\n');
          updateCount();
        }
        
        statusEl.style.display = 'block';
        if (state.isActive) {
          statusEl.style.background = '#f0fdf4';
          statusEl.style.color = '#15803d';
          statusEl.style.border = '1px solid #bbf7d0';
          statusEl.innerHTML = `Processing URL ${state.currentIndex + 1} of ${state.urls.length}...<br><span style="font-size:11px; color:#6b7280; word-break:break-all;">${state.urls[state.currentIndex]}</span>`;
          
          startBtn.style.display = 'none';
          stopBtn.style.display = 'block';
          skipBtn.style.display = 'none';
          resetBtn.style.display = 'none';
          urlsInput.disabled = true;
        } else {
          statusEl.style.background = '#f8f9fa';
          statusEl.style.color = '#4b5563';
          statusEl.style.border = '1px solid #e5e7eb';
          
          if (state.currentIndex >= state.urls.length) {
            statusEl.innerHTML = `🎉 Bulk Scrape Complete! (${state.urls.length} URLs processed)`;
            skipBtn.style.display = 'none';
            resetBtn.style.display = 'block';
          } else if (state.lastError) {
            const partialMessage = state.lastError.partialExported
              ? ` Partial CSV saved with ${state.lastError.collectedCount || 0} rows.`
              : '';
            const errorMessage = state.lastError.message || state.lastError.reason;
            const punctuation = /[.!?]$/.test(errorMessage) ? '' : '.';
            statusEl.style.background = '#fff7ed';
            statusEl.style.color = '#9a3412';
            statusEl.style.border = '1px solid #fed7aa';
            statusEl.textContent = `Paused at URL ${state.currentIndex + 1} of ${state.urls.length}: ${errorMessage}${punctuation}${partialMessage}`;
            skipBtn.style.display = 'block';
          } else {
            statusEl.innerHTML = `Stopped at URL ${state.currentIndex + 1} of ${state.urls.length}.`;
            skipBtn.style.display = 'block';
          }
          
          startBtn.style.display = 'block';
          if (state.currentIndex < state.urls.length) {
            startBtn.textContent = 'Resume Bulk Scrape';
          } else {
            startBtn.style.display = 'none';
          }
          stopBtn.style.display = 'none';
          urlsInput.disabled = false;
        }
      }
    });
  }

  startBtn.onclick = () => {
    const urls = urlsInput.value.split('\n').map(u => u.trim()).filter(u => u.length > 0);
    if (urls.length === 0) {
      alert("Please enter at least one URL.");
      return;
    }
    const maxLeads = parseInt(maxLeadsInput.value, 10) || 50;
    
    // Determine dataType from the first URL
    const dataType = urls[0].includes('/sales/search/company') ? 'account' : 'lead';

    sendMessage({ action: 'GET_BULK_SCRAPE_STATE' }, state => {
      let startIndex = 0;
      if (state && state.urls && state.urls.join('\n') === urlsInput.value && state.currentIndex < state.urls.length) {
        startIndex = state.currentIndex;
      }

      sendMessage({
        action: 'START_BULK_SCRAPE', 
        urls: urls,
        maxLeads: maxLeads,
        dataType: dataType,
        startIndex: startIndex
      }, res => {
        if (!res?.success) {
          alert(res?.error || 'Bulk scrape could not be started.');
          return;
        }
        syncState();
      });
    });
  };

  stopBtn.onclick = () => {
    sendMessage({ action: 'STOP_BULK_SCRAPE' }, () => {
      syncState();
    });
  };

  skipBtn.onclick = () => {
    skipBtn.disabled = true;
    skipBtn.textContent = 'Skipping...';
    sendMessage({ action: 'SKIP_BULK_URL' }, res => {
      skipBtn.disabled = false;
      skipBtn.textContent = 'Skip This URL & Continue';
      if (!res?.success) {
        alert(res?.error || 'This URL could not be skipped.');
        return;
      }
      syncState();
    });
  };

  resetBtn.onclick = () => {
    sendMessage({ action: 'RESET_BULK_SCRAPE' }, () => {
      urlsInput.value = '';
      updateCount();
      statusEl.style.display = 'none';
      startBtn.style.display = 'block';
      startBtn.textContent = 'Start Bulk Scrape';
      skipBtn.style.display = 'none';
      resetBtn.style.display = 'none';
      urlsInput.disabled = false;
    });
  };

  syncState();
  
  // Refresh state periodically
  syncInterval = setInterval(() => {
    if (document.getElementById('linkedin-bulk-window')) {
      syncState();
    } else {
      clearInterval(syncInterval);
      syncInterval = null;
    }
  }, 2000);
}

window.addEventListener('message', (event) => {
  if (event.data?.type === 'LINKEDIN_BULK' && event.data.action === 'SHOW_WINDOW') {
    createBulkFloatingWindow();
  }
});
