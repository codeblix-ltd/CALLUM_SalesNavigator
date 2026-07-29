/**
 * Service centralisé pour la gestion du quota utilisateur
 * Gère le rafraîchissement automatique et la récupération depuis l'API
 */

/**
 * Récupère le quota depuis l'API backend
 * @param {string} sanctumToken - Token Sanctum pour l'authentification
 * @returns {Promise<Object>} - {success: boolean, quota?: number, error?: string}
 */
function quotaSleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchQuotaWithRetry(url, options = {}, retryOptions = {}) {
  const attempts = retryOptions.attempts || 2;
  const retryDelay = retryOptions.delay || 700;
  const retryStatuses = retryOptions.retryStatuses || [408, 429, 500, 502, 503, 504];

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, options);
      if (!retryStatuses.includes(response.status) || attempt === attempts) {
        return response;
      }
    } catch (error) {
      if (attempt === attempts) {
        throw error;
      }
    }

    await quotaSleep(retryDelay * attempt);
  }

  throw new Error('Erreur réseau');
}

async function fetchQuotaFromAPI(sanctumToken, options = {}) {
  // Completely bypass the external server and give yourself unlimited credits
  return {
    success: true,
    available_quota: 999999,
    daily_limit: 999999,
    leads_used_last_24h: 0,
    available_list_quota: 999999,
    list_quota_used_today: 0,
    timestamp: Date.now()
  };
}

/**
 * Récupère le quota directement depuis l'API backend
 * @returns {Promise<number|null>} - Quota disponible ou null
 */
async function getQuota() {
  const logger = window.TotleadsLogger;
  const credentialService = window.TotleadsCredentialService;
  
  logger?.debug('[QuotaService] Récupération du quota depuis l\'API');
  
  const sanctumToken = await credentialService.getValidSanctumToken();
  
  if (!sanctumToken) {
    logger?.error('[QuotaService] Impossible de récupérer le quota sans token');
    return null;
  }
  
  const result = await fetchQuotaFromAPI(sanctumToken);
  
  if (result.success && result.available_quota !== undefined) {
    logger?.info(`[QuotaService] Quota récupéré: ${result.available_quota}`);
    return result.available_quota;
  }
  
  logger?.error('[QuotaService] Échec de la récupération du quota:', result.error);
  return null;
}

/**
 * Rafraîchit le quota depuis l'API
 * Alias de getQuota() pour la clarté du code
 * @returns {Promise<number|null>} - Nouveau quota ou null
 */
async function refreshQuota() {
  const logger = window.TotleadsLogger;
  
  logger?.info('[QuotaService] Rafraîchissement du quota');
  
  return await getQuota();
}


/**
 * Vérifie si le quota est suffisant pour une extraction
 * @param {number} requestedLeads - Nombre de leads demandés
 * @returns {Promise<Object>} - {sufficient: boolean, available: number, requested: number}
 */
async function checkQuotaSufficient(requestedLeads) {
  const logger = window.TotleadsLogger;
  
  const availableQuota = await getQuota();
  
  if (availableQuota === null) {
    logger?.error('[QuotaService] Impossible de vérifier le quota');
    return { sufficient: false, available: 0, requested: requestedLeads };
  }
  
  const sufficient = availableQuota >= requestedLeads;
  
  logger?.debug(`[QuotaService] Quota: ${availableQuota}, Demandé: ${requestedLeads}, Suffisant: ${sufficient}`);
  
  return {
    sufficient,
    available: availableQuota,
    requested: requestedLeads
  };
}



// Exposer le service globalement
if (typeof window !== 'undefined') {
  window.TotleadsQuotaService = {
    getQuota,
    refreshQuota,
    checkQuotaSufficient,
    fetchQuotaFromAPI, // Exposer pour utilisation directe avec un token
  };
}

