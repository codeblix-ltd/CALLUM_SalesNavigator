/**
 * Client API pour la communication avec le backend
 * Gère la validation des credentials et autres appels API
 */

/**
 * Valide les credentials utilisateur via l'API backend et obtient un token Sanctum
 * @param {string} secretKey - Secret Key de l'utilisateur
 * @param {string} member - Member URN LinkedIn (optionnel)
 * @returns {Promise<Object>} - Résultat de la validation avec token Sanctum
 */
async function validateCredentials(secretKey, member = null) {
  // Déléguer au service centralisé
  if (typeof window !== 'undefined' && window.TotleadsCredentialService) {
    return await window.TotleadsCredentialService.validate(secretKey, member);
  }
  
  // Fallback pour background.js (service worker)
  // Essayer de récupérer l'URL depuis le contexte global (self pour service worker, window pour content script)
  let apiUrl = 'https://app.totleads.com'; // Fallback par défaut vers prod
  
  if (typeof window !== 'undefined' && window.TotleadsConfig) {
    apiUrl = window.TotleadsConfig.API_BASE_URL;
  } else if (typeof self !== 'undefined') {
    // Pour le service worker (background.js), chercher TotleadsConfig en priorité
    if (self.TotleadsConfig && self.TotleadsConfig.API_BASE_URL) {
      apiUrl = self.TotleadsConfig.API_BASE_URL;
    } else if (self.CONFIG && self.CONFIG.API_BASE_URL) {
      apiUrl = self.CONFIG.API_BASE_URL;
    }
  }
  
  try {
    const requestBody = {
      secretKey: secretKey
    };
    
    // Ajouter le member URN si disponible
    if (member) {
      requestBody.member = member;
    }
    
    const response = await fetch(`${apiUrl}/api/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    if (response.ok) {
      const result = await response.json();
      
      if (result.status === 'ok' && result.token) {
        return { 
          valid: true, 
          token: result.token,
          message: result.message,
          data: result 
        };
      } else {
        return { 
          valid: false, 
          error: 'Réponse API invalide' 
        };
      }
    } else {
      const errorData = await response.json().catch(() => ({ message: 'Invalid token' }));
      return { 
        valid: false, 
        error: errorData.message || `Secret key invalide (${response.status})` 
      };
    }
  } catch (error) {
    // Retourner un message d'erreur plus détaillé
    const errorMessage = error.message || 'Erreur de connexion à l\'API';
    return { 
      valid: false, 
      error: errorMessage,
      details: error.toString(),
      type: error.name,
      url: `${apiUrl}/api/login`
    };
  }
}

/**
 * Récupère le quota disponible depuis l'API backend
 * @param {string} token - Token Sanctum pour l'authentification
 * @returns {Promise<number|null>} - Quota disponible (nombre) ou null
 */
async function getQuota(token) {
  // Déléguer au service centralisé si disponible
  if (typeof window !== 'undefined' && window.TotleadsQuotaService) {
    const quota = await window.TotleadsQuotaService.getQuota();
    return quota;
  }
  
  // Fallback pour background.js (service worker)
  const apiUrl = typeof window !== 'undefined' && window.TotleadsConfig 
    ? window.TotleadsConfig.API_BASE_URL 
    : 'https://app.totleads.com';
  
  try {
    const response = await fetch(`${apiUrl}/api/quota`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      }
    });

    if (response.ok) {
      const result = await response.json();
      
      return result.available_quota;
    } else {
      const errorData = await response.json().catch(() => ({ message: 'Erreur lors de la récupération du quota' }));
      return null;
    }
  } catch (error) {
    return null;
  }
}

// Exposer pour utilisation dans background script (service worker)
if (typeof self !== 'undefined' && self.importScripts) {
  self.validateCredentialsAPI = validateCredentials;
}

// Exposer pour utilisation dans les pages web
if (typeof window !== 'undefined') {
  window.TotleadsAPIClient = {
    validateCredentials,
    getQuota,
    // Méthodes déléguées aux services pour compatibilité
    saveCredentials: function(...args) {
      return window.TotleadsCredentialService?.saveCredentials(...args);
    },
    getCredentials: function() {
      return window.TotleadsCredentialService?.getCredentials();
    },
    getValidSanctumToken: function() {
      return window.TotleadsCredentialService?.getValidSanctumToken();
    }
  };
}

