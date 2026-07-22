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
  const config = typeof window !== 'undefined' ? window.TotleadsConfig : undefined;
  const logger = window.TotleadsLogger;
  const apiBaseUrl = config?.API_BASE_URL || 'https://app.totleads.com';
  const credentialService = window.TotleadsCredentialService;
  const { skipRefresh = false } = options;
  
  if (!sanctumToken) {
    return { success: false, error: 'Token Sanctum requis' };
  }
  
  try {
    // Préférer un passage par le background script (évite le mixed content en dev)
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage && typeof window !== 'undefined') {
      logger?.debug('[QuotaService] Récupération du quota via background script');
      
      const backgroundResponse = await new Promise((resolve, reject) => {
        try {
          chrome.runtime.sendMessage(
            {
              action: 'getQuota',
              token: sanctumToken,
              apiBaseUrl: apiBaseUrl,
            },
            (result) => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
              }
              resolve(result);
            }
          );
        } catch (error) {
          reject(error);
        }
      });
      
      if (backgroundResponse?.success) {
        logger?.info('[QuotaService] Quota récupéré via background script:', backgroundResponse.available_quota);
        return {
          success: true,
          available_quota: backgroundResponse.available_quota,
          daily_limit: backgroundResponse.daily_limit,
          leads_used_last_24h: backgroundResponse.leads_used_last_24h,
          available_list_quota: backgroundResponse.data?.available_list_quota,
          list_quota_used_today: backgroundResponse.data?.list_quota_used_today,
          timestamp: backgroundResponse.timestamp,
        };
      }
      
      if (backgroundResponse) {
        const errorMessage = backgroundResponse.error || 'Erreur lors de la récupération du quota';
        logger?.warn('[QuotaService] Échec récupération quota via background:', errorMessage);
        
        if (!skipRefresh && /unauthenticated|token/i.test(errorMessage) && credentialService?.refreshSanctumToken) {
          logger?.info('[QuotaService] Tentative de renouvellement du token Sanctum (background)');
          const newToken = await credentialService.refreshSanctumToken();
          
          if (newToken) {
            return await fetchQuotaFromAPI(newToken, { skipRefresh: true });
          }
        }
        
        return {
          success: false,
          error: errorMessage,
        };
      }
      
      logger?.warn('[QuotaService] Réponse vide du background, fallback fetch direct');
    }
    
    logger?.debug('[QuotaService] Récupération du quota via fetch direct');
    
    const response = await fetchQuotaWithRetry(`${apiBaseUrl}/api/quota`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${sanctumToken}`,
        'Content-Type': 'application/json',
      }
    });

    if (response.ok) {
      const result = await response.json();
      
      logger?.info('[QuotaService] Quota récupéré avec succès:', result.available_quota);
      
      return { 
        success: true, 
        available_quota: result.available_quota,
        daily_limit: result.daily_limit,
        leads_used_last_24h: result.leads_used_last_24h,
        timestamp: result.timestamp,
      };
    } else {
      const errorData = await response.json().catch(() => ({ message: 'Erreur lors de la récupération du quota' }));
      logger?.error('[QuotaService] Erreur API:', response.status, errorData);

      if (!skipRefresh && response.status === 401 && credentialService?.refreshSanctumToken) {
        logger?.info('[QuotaService] 401 reçu, tentative de renouvellement du token Sanctum (fetch direct)');
        const newToken = await credentialService.refreshSanctumToken();
        
        if (newToken) {
          return await fetchQuotaFromAPI(newToken, { skipRefresh: true });
        }
      }

      return { 
        success: false, 
        error: errorData.message || `Erreur lors de la récupération du quota (${response.status})` 
      };
    }
  } catch (error) {
    logger?.error('[QuotaService] Erreur lors de la récupération du quota:', error);
    return { 
      success: false, 
      error: 'Erreur de connexion à l\'API' 
    };
  }
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

