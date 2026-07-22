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
    this.queue = [{
      url: rootUrl,
      depth: 0,
      parent_id: null,
      partition_id: crypto.randomUUID(),
      used_dimensions: []
    }];
    this.accepted = [];
    this.unresolved = [];
    this.isRunning = true;
    
    window.TotleadsLogger?.info('[Splitter] Démarrage du partitionnement adaptatif');
    this.processNext();
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
    
    // 1. Send command to navigate active tab to node.url
    window.postMessage({
      type: 'LINKEDIN_SPLITTER',
      action: 'NAVIGATE_AND_COUNT',
      data: { url: node.url }
    }, '*');

    // Wait for the tab to load and send back the live count via TotLeads API interceptor
    const observation = await this.waitForLiveCount();

    if (observation === null || observation.is_error) {
       // Retry or mark unresolved
       node.status = 'unresolved';
       node.validation_error = observation?.error || 'Timeout';
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

    // Process next item in queue
    setTimeout(() => this.processNext(), 2000); // 2 second human-like delay
  }

  chooseNextDimension(usedDimensions) {
    const order = window.TotleadsFacets.DIMENSION_ORDER;
    return order.find(dim => !usedDimensions.includes(dim)) || null;
  }

  generateChildren(parentNode, dimension, parentCount) {
    const facets = window.TotleadsFacets[dimension];
    
    facets.forEach(facetId => {
      const childUrl = window.TotleadsUrlCodec.injectFacetIntoUrl(parentNode.url, dimension, facetId);
      this.queue.push({
        url: childUrl,
        depth: parentNode.depth + 1,
        parent_id: parentNode.partition_id,
        partition_id: crypto.randomUUID(),
        used_dimensions: [...parentNode.used_dimensions, dimension],
        dimension_added: dimension,
        facet_id: facetId
      });
    });
    
    window.TotleadsLogger?.info(`[Splitter] Noeud fragmenté par ${dimension} (${facets.length} enfants ajoutés)`);
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

  exportToCSV() {
     // Format output according to Section 11 CSV Output Contract
     const rows = [...this.accepted, ...this.unresolved];
     if(rows.length === 0) return;

     let csv = 'partition_id,parent_id,depth,status,dimension,facet_id,reported_count,checked_at,url,validation_error\n';
     
     rows.forEach(r => {
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