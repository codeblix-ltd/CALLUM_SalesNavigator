/**
 * Moteur de partitionnement adaptatif des URLs (URL Splitter)
 * Exécute la logique de file d'attente (Section 8.1 - Core Loop)
 */
class UrlSplitterEngine {
  constructor() {
    this.queue = [];
    this.accepted = [];
    this.unresolved = [];
    this.isRunning = false;
    this.targetCeiling = 2500;
  }

start(rootUrl, targetCeiling = 2500) {
      this.targetCeiling = targetCeiling;
      
      const isAccount = rootUrl.includes('/sales/search/company');
      const apiManager = window.TotleadsAPIDataManager;
      const lastApiData = isAccount ? apiManager?.getFreshAccountApiData(0) : apiManager?.getFreshApiData(0);
      
      // FIX: Detect dimensions already applied in the user's search
      const decodedUrl = decodeURIComponent(rootUrl);
      const existingDimensions = Array.from(decodedUrl.matchAll(/\btype:([A-Z0-9_]+)\b/g)).map(m => m[1]);
      
      // Keep only the dimensions that the splitter actually uses
      const order = window.TotleadsFacets?.DIMENSION_ORDER || [];
      const used_dimensions = existingDimensions.filter(dim => order.includes(dim));
      
      this.queue = [{
        url: rootUrl,
        apiUrl: lastApiData?.url || null,
        depth: 0,
        parent_id: null,
        partition_id: crypto.randomUUID(),
        // <--- Now it knows if INDUSTRY or FUNCTION are already used!
        used_dimensions: used_dimensions 
      }];
      this.accepted = [];
      this.unresolved = [];
      this.isRunning = true;
      
      window.TotleadsLogger?.info('[Splitter] Démarrage du partitionnement adaptatif');
      this.notifyProgress(rootUrl, 0);
      this.processNext();
  }

  notifyProgress(currentUrl = '', currentCount = 0) {
    window.postMessage({
      type: 'LINKEDIN_SPLITTER',
      action: 'SPLITTER_PROGRESS_URL',
      data: {
        url: currentUrl,
        count: currentCount,
        remaining: this.queue.length,
        accepted: this.accepted.length,
        unresolved: this.unresolved.length,
        ceiling: this.targetCeiling,
        totalAcceptedLeads: this.accepted.reduce((sum, n) => sum + (n.reported_count || 0), 0)
      }
    }, '*');
  }

  stop() {
    this.isRunning = false;
    window.TotleadsLogger?.info('[Splitter] Partitionnement arrêté');
    this.exportToCSV(); // Auto-export partial progress
  }

  async processNext() {
    if (!this.isRunning || this.queue.length === 0) {
      this.isRunning = false;
      this.exportToCSV();
      return;
    }

    const node = this.queue.shift();
    let observation = null;

    if (node.depth === 0 && window.__totleads_lead_search_total !== undefined) {
      // For the root node, if we already have the count from the page, avoid fetching
      observation = { count: window.__totleads_lead_search_total, is_error: false };
    } else {
      try {
        const count = await this.fetchCountDirectly(node);
        observation = { count: count, is_error: false };
      } catch (err) {
        window.TotleadsLogger?.error(`[Splitter] Failed direct fetch for ${node.url}`, err);
        observation = { is_error: true, error: err.message };
      }
    }

    if (observation === null || observation.is_error) {
       // Retry or mark unresolved
       node.status = 'unresolved';
       node.validation_error = observation?.error || 'Fetch Error';
       this.unresolved.push(node);
    } 
    else if (observation.count === 0) {
       // Discard empty paths
       window.TotleadsLogger?.info(`[Splitter] Empty branch discarded: ${node.url}`);
    } 
    else if (observation.count <= this.targetCeiling) {
       // Leaf is verified safe
       node.status = 'accepted';
       node.reported_count = observation.count;
       node.checked_at = new Date().toISOString();
       this.accepted.push(node);
    } 
    else {
       // Over ceiling -> Recurse!
       const nextDimension = this.chooseNextDimension(node.used_dimensions);
       if (!nextDimension) {
           node.status = 'unresolved';
           node.validation_error = 'All dimensions exhausted';
           node.reported_count = observation.count;
           this.unresolved.push(node);
       } else {
           this.generateChildren(node, nextDimension, observation.count);
       }
    }

    // Notify UI of updated progress and remaining queue size
    this.notifyProgress(node.url, observation.count || 0);

    // Process next item in queue
    setTimeout(() => this.processNext(), 1500); // 1.5 second human-like delay
  }

  async fetchCountDirectly(node, retryCount = 0) {
    if (!node.apiUrl) {
      const isAccount = node.url && node.url.includes('/sales/search/company');
      const apiManager = window.TotleadsAPIDataManager;
      const lastApiData = isAccount ? apiManager?.getFreshAccountApiData(0) : apiManager?.getFreshApiData(0);
      if (lastApiData?.url) {
        try {
          const uObj = new URL(node.url);
          const queryParam = uObj.searchParams.get('query');
          if (queryParam) {
            const apiObj = new URL(lastApiData.url);
            apiObj.searchParams.set('query', queryParam);
            node.apiUrl = apiObj.toString();
          }
        } catch (e) {
          node.apiUrl = lastApiData.url;
        }
      }
    }

    if (!node.apiUrl) {
      throw new Error("No previous API call captured. Perform a search on Sales Nav first.");
    }

    // Construct the API URL using the tracked apiUrl directly
    const apiUrlObj = new URL(node.apiUrl, window.location.origin);
    
    // Always fetch page 1 count (remove pagination params)
    apiUrlObj.searchParams.delete('start');
    apiUrlObj.searchParams.delete('count');

    let finalQueryStr = "";
    for (const [key, val] of apiUrlObj.searchParams.entries()) {
      let encodedVal = encodeURIComponent(val)
        .replace(/%28/g, '(')
        .replace(/%29/g, ')')
        .replace(/%2C/g, ',')
        .replace(/%3A/g, ':');
      finalQueryStr += (finalQueryStr ? '&' : '?') + key + '=' + encodedVal;
    }
    const finalUrl = apiUrlObj.origin + apiUrlObj.pathname + finalQueryStr;

    // Extract CSRF token
    const csrfMatch = document.cookie.match(/JSESSIONID="?([^";]+)"?/);
    const csrfToken = csrfMatch ? csrfMatch[1] : '';

    const response = await fetch(finalUrl, {
      method: 'GET',
      credentials: 'same-origin',
      headers: {
        'csrf-token': csrfToken,
        'accept': 'application/vnd.linkedin.normalized+json+2.1, application/json',
        'x-restli-protocol-version': '2.0.0'
      }
    });

    if (response.status === 429) {
      if (retryCount < 3) {
        // Base delay of 10s, 20s, 40s + random jitter
        const backoffTime = Math.pow(2, retryCount) * 10000 + Math.random() * 2000;
        window.TotleadsLogger?.warn(`[Splitter] Rate limited (429). Retrying in ${Math.round(backoffTime/1000)}s...`);
        
        // Notify UI about rate limiting
        window.postMessage({
          type: 'LINKEDIN_SPLITTER',
          action: 'SPLITTER_RATE_LIMIT',
          data: { delay: Math.round(backoffTime/1000), url: node.url }
        }, '*');

        await new Promise(resolve => setTimeout(resolve, backoffTime));
        return this.fetchCountDirectly(node, retryCount + 1);
      } else {
        throw new Error("API HTTP 429: Too Many Requests (Retries Exhausted)");
      }
    }

    if (!response.ok) {
      throw new Error(`API HTTP ${response.status}`);
    }

    const data = await response.json();
    return data?.paging?.total !== undefined ? data.paging.total : (data?.elements?.length || 0);
  }

  chooseNextDimension(usedDimensions) {
    const order = window.TotleadsFacets.DIMENSION_ORDER;
    return order.find(dim => !usedDimensions.includes(dim)) || null;
  }

  generateChildren(parentNode, dimension, parentCount) {
    const facets = window.TotleadsFacets[dimension];
    
    facets.forEach(facetId => {
      const childUrl = window.TotleadsUrlCodec.injectFacetIntoUrl(parentNode.url, dimension, facetId);
      const childApiUrl = parentNode.apiUrl ? window.TotleadsUrlCodec.injectFacetIntoUrl(parentNode.apiUrl, dimension, facetId) : null;

      if (!this.queue.some(n => n.url === childUrl) && !this.accepted.some(n => n.url === childUrl) && !this.unresolved.some(n => n.url === childUrl)) {
        this.queue.push({
          url: childUrl,
          apiUrl: childApiUrl,
          depth: parentNode.depth + 1,
          parent_id: parentNode.partition_id,
          partition_id: crypto.randomUUID(),
          used_dimensions: [...parentNode.used_dimensions, dimension],
          dimension_added: dimension,
          facet_id: facetId
        });
      }
    });
    
    window.TotleadsLogger?.info(`[Splitter] Noeud fragmenté par ${dimension} (${facets.length} enfants traités)`);
  }

  waitForLiveCount() {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(null), 15000); // 15s timeout
      
      const listener = (event) => {
        if (event.source !== window) return;
        if (event.data.type === 'LINKEDIN_API_CAPTURED') {
          clearTimeout(timeout);
          window.removeEventListener('message', listener);
          const total = event.data.data?.fullResponse?.paging?.total;
          resolve({ count: total || 0, is_error: total === undefined });
        }
      };
      
      window.addEventListener('message', listener);
    });
  }

  parseCSV(text) {
    const lines = [];
    let currentLine = [];
    let currentVal = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const nextChar = text[i + 1];
      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          currentVal += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        currentLine.push(currentVal.trim());
        currentVal = '';
      } else if ((char === '\r' || char === '\n') && !inQuotes) {
        if (char === '\r' && nextChar === '\n') { i++; }
        currentLine.push(currentVal.trim());
        if (currentLine.some(cell => cell.length > 0)) {
          lines.push(currentLine);
        }
        currentLine = [];
        currentVal = '';
      } else {
        currentVal += char;
      }
    }
    if (currentVal || currentLine.length > 0) {
      currentLine.push(currentVal.trim());
      if (currentLine.some(cell => cell.length > 0)) {
        lines.push(currentLine);
      }
    }
    return lines;
  }

  resumeFromCSV(csvText, targetCeiling = 2500) {
    this.targetCeiling = targetCeiling;
    const parsedLines = this.parseCSV(csvText);
    if (parsedLines.length < 2) {
      throw new Error("Invalid or empty CSV file");
    }

    const header = parsedLines[0].map(h => h.toLowerCase().trim().replace(/^"|"$/g, ''));
    const getIdx = (name) => header.indexOf(name);

    const partitionIdIdx = getIdx('partition_id');
    const parentIdIdx = getIdx('parent_id');
    const depthIdx = getIdx('depth');
    const statusIdx = getIdx('status');
    const dimensionIdx = getIdx('dimension');
    const facetIdIdx = getIdx('facet_id');
    const reportedCountIdx = getIdx('reported_count');
    const checkedAtIdx = getIdx('checked_at');
    const urlIdx = getIdx('url');
    const validationErrorIdx = getIdx('validation_error');

    if (urlIdx === -1 || statusIdx === -1) {
      throw new Error("CSV is missing required 'url' or 'status' columns");
    }

    const isAccount = window.location.href.includes('/sales/search/company');
    const apiManager = window.TotleadsAPIDataManager;
    const lastApiData = isAccount ? apiManager?.getFreshAccountApiData(0) : apiManager?.getFreshApiData(0);
    const baseApiUrl = lastApiData?.url || null;

    this.accepted = [];
    this.unresolved = [];
    this.queue = [];

    for (let i = 1; i < parsedLines.length; i++) {
      const row = parsedLines[i];
      if (row.length <= urlIdx) continue;

      const url = row[urlIdx] ? row[urlIdx].replace(/^"|"$/g, '') : '';
      if (!url || !url.startsWith('http')) continue;

      const status = row[statusIdx] ? row[statusIdx].replace(/^"|"$/g, '') : '';
      const partition_id = (partitionIdIdx !== -1 && row[partitionIdIdx]) ? row[partitionIdIdx].replace(/^"|"$/g, '') : crypto.randomUUID();
      const parent_id = (parentIdIdx !== -1 && row[parentIdIdx]) ? row[parentIdIdx].replace(/^"|"$/g, '') : null;
      const depth = depthIdx !== -1 ? (parseInt(row[depthIdx], 10) || 0) : 0;
      const dimension_added = (dimensionIdx !== -1 && row[dimensionIdx]) ? row[dimensionIdx].replace(/^"|"$/g, '') : '';
      const facet_id = (facetIdIdx !== -1 && row[facetIdIdx]) ? row[facetIdIdx].replace(/^"|"$/g, '') : '';
      const reported_count = (reportedCountIdx !== -1 && row[reportedCountIdx]) ? parseInt(row[reportedCountIdx], 10) : null;
      const checked_at = (checkedAtIdx !== -1 && row[checkedAtIdx]) ? row[checkedAtIdx].replace(/^"|"$/g, '') : '';
      const validation_error = (validationErrorIdx !== -1 && row[validationErrorIdx]) ? row[validationErrorIdx].replace(/^"|"$/g, '') : '';

      const used_dimensions = Array.from(url.matchAll(/\btype:([A_Z0-9_]+)\b/g)).map(m => m[1]);

      let apiUrl = null;
      if (baseApiUrl) {
        try {
          const uObj = new URL(url);
          const queryParam = uObj.searchParams.get('query');
          if (queryParam) {
            const apiObj = new URL(baseApiUrl);
            apiObj.searchParams.set('query', queryParam);
            apiObj.searchParams.delete('start');
            apiObj.searchParams.delete('count');
            apiUrl = apiObj.toString();
          }
        } catch (e) {
          apiUrl = baseApiUrl;
        }
      }

      const node = {
        partition_id,
        parent_id,
        depth,
        status,
        dimension_added,
        facet_id,
        reported_count,
        checked_at,
        url,
        apiUrl,
        validation_error,
        used_dimensions
      };

      if (status === 'accepted') {
        if (!this.accepted.some(n => n.url === url)) {
          this.accepted.push(node);
        }
      } else if (status === 'pending' || status === 'queued') {
        if (!this.queue.some(n => n.url === url)) {
          this.queue.push(node);
        }
      } else if (status === 'unresolved') {
        if (validation_error && validation_error.includes('exhausted')) {
          if (!this.unresolved.some(n => n.url === url)) {
            this.unresolved.push(node);
          }
        } else {
          // Re-queue for retry
          if (!this.queue.some(n => n.url === url) && !this.accepted.some(n => n.url === url)) {
            this.queue.push(node);
          }
        }
      }
    }

    window.TotleadsLogger?.info(`[Splitter] Resumed from CSV: ${this.accepted.length} accepted, ${this.queue.length} queued`);

    if (this.queue.length === 0 && this.accepted.length === 0 && this.unresolved.length === 0) {
      throw new Error("No valid nodes found in CSV to resume");
    }

    this.isRunning = true;
    this.notifyProgress('', 0);
    this.processNext();
  }

  exportToCSV() {
     const pendingNodes = this.queue.map(n => ({
       ...n,
       status: 'pending'
     }));
     const rows = [...this.accepted, ...this.unresolved, ...pendingNodes];
     if(rows.length === 0) return;

     // Deduplicate by URL
     const seenUrls = new Set();
     const uniqueRows = [];
     for (const r of rows) {
       if (!seenUrls.has(r.url)) {
         seenUrls.add(r.url);
         uniqueRows.push(r);
       }
     }

     let csv = 'partition_id,parent_id,depth,status,dimension,facet_id,reported_count,checked_at,url,validation_error\n';
     
     uniqueRows.forEach(r => {
        csv += `"${r.partition_id}","${r.parent_id || ''}",${r.depth},"${r.status}","${r.dimension_added || ''}","${r.facet_id || ''}",${r.reported_count || ''},"${r.checked_at || ''}","${r.url}","${r.validation_error || ''}"\n`;
     });

     const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csv], { type: 'text/csv;charset=utf-8;' });
     const link = document.createElement("a");
     link.href = URL.createObjectURL(blob);
     link.download = `url_partitions_${new Date().getTime()}.csv`;
     document.body.appendChild(link);
     link.click();
     document.body.removeChild(link);
     
     window.postMessage({ type: 'LINKEDIN_SPLITTER', action: 'EXPORT_COMPLETE' }, '*');
  }
}

if (typeof window !== 'undefined') {
  window.TotleadsUrlSplitter = new UrlSplitterEngine();
}