/**
 * Service centralisé pour les appels webhook
 * Gère l'authentification et les appels API pour les événements de l'extension
 */

/**
 * Envoie un webhook d'ouverture de Sales Navigator
 * @param {string} apiBaseUrl - URL de base de l'API
 * @param {string} member - Member URN LinkedIn
 * @param {string} slug - Slug LinkedIn de l'utilisateur
 * @param {string} secretKey - Token du client (identification fiable côté backend)
 * @returns {Promise<{ ok: boolean, status: number }>} - statut HTTP + succès
 */
async function sendOpenedSalesNavWebhookService(apiBaseUrl, member, slug, secretKey) {
  try {
    // Récupérer la config depuis window (content script) ou self (service worker)
    const config = typeof window !== 'undefined' ? window.TotleadsConfig :
      (typeof self !== 'undefined' && self.TotleadsConfig) ? self.TotleadsConfig : undefined;
    let webhookEndpoint = config?.webhooks?.OPENED_SALES_NAV || '/api/webhooks/extension/opened-sales-nav';
    // Normaliser l'endpoint pour éviter les URLs relatives ("api/..." au lieu de "/api/...")
    if (typeof webhookEndpoint === 'string' && webhookEndpoint.length > 0 && !webhookEndpoint.startsWith('/')) {
      webhookEndpoint = `/${webhookEndpoint}`;
    }

    // Important: éviter toute URL relative (sinon résolution sur chrome-extension://...)
    let resolvedBaseUrl = apiBaseUrl || config?.API_BASE_URL || 'https://app.totleads.com';
    if (typeof resolvedBaseUrl !== 'string' || !/^https?:\/\//i.test(resolvedBaseUrl)) {
      resolvedBaseUrl = 'https://app.totleads.com';
    }

    const url = new URL(webhookEndpoint, resolvedBaseUrl).toString();

    // Toujours inclure member et slug (null si undefined, sinon JSON les omet)
    const payload = {
      timestamp: Date.now(),
      member: member ?? null,
      slug: slug ?? null,
      secretKey: secretKey ?? null
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(payload)
    });

    return { ok: response.ok, status: response.status };
  } catch (error) {
    // Erreur silencieuse - ne pas perturber l'UX
    return { ok: false, status: 0 };
  }
}

// Exposer le service globalement
if (typeof window !== 'undefined') {
  window.TotleadsWebhookService = {
    sendOpenedSalesNavWebhookService,
  };
}

// Exposer pour le service worker (background.js)
if (typeof self !== 'undefined' && self.importScripts) {
  self.TotleadsWebhookService = {
    sendOpenedSalesNavWebhookService,
  };
}

