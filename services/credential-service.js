/**
 * Service centralisé pour la gestion des credentials et tokens
 * Unifie la validation, le stockage et la gestion du token Sanctum
 */

let sanctumRefreshPromise = null;

/**
 * Valide les credentials via l'API backend et obtient un token Sanctum
 * @param {string} secretKey - Secret Key de l'utilisateur
 * @param {string} member - Member URN LinkedIn (optionnel)
 * @returns {Promise<Object>} - {valid: boolean, token?: string, error?: string}
 */
async function validate(secretKey, member = null) {
  const config = typeof window !== 'undefined' ? window.TotleadsConfig : undefined;
  const logger = window.TotleadsLogger;
  const storage = window.TotleadsStorageService;
  const apiBaseUrl = config?.API_BASE_URL || 'https://app.totleads.com';

  if (!secretKey || secretKey.trim() === '') {
    return { valid: false, error: 'Secret key requise' };
  }

  try {
    // Préférer le passage par le background script (évite le mixed content http depuis https)
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage && typeof window !== 'undefined') {
      logger?.debug('[CredentialService] Validation via background script');

      const response = await new Promise((resolve, reject) => {
        try {
          chrome.runtime.sendMessage(
            {
              action: 'validateCredentials',
              secretKey: secretKey,
              member: member
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

      if (response?.valid && response?.token) {
        logger?.info('[CredentialService] Login réussi via background, token Sanctum obtenu');
        storage.saveCredentials(secretKey, response.token);
        return response;
      }

      if (response) {
        logger?.warn('[CredentialService] Validation via background échouée:', response.error);
        return response;
      }

      logger?.warn('[CredentialService] Validation via background sans réponse, fallback fetch direct');
    }

    logger?.debug('[CredentialService] Validation de la secret key via fetch direct');

    const requestBody = {
      secretKey: secretKey
    };

    // Ajouter le member URN si disponible
    if (member) {
      requestBody.member = member;
      logger?.debug('[CredentialService] Member URN ajouté à la requête:', member);
    }

    const response = await fetch(`${apiBaseUrl}/api/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    if (response.ok) {
      const result = await response.json();

      if (result.status === 'ok' && result.token) {
        logger?.info('[CredentialService] Login réussi, token Sanctum obtenu');

        // Sauvegarder immédiatement le token dans le storage
        storage.saveCredentials(secretKey, result.token);

        return {
          valid: true,
          token: result.token,
          message: result.message,
          data: result
        };
      } else {
        logger?.error('[CredentialService] Réponse invalide:', result);
        return {
          valid: false,
          error: 'Réponse API invalide'
        };
      }
    } else {
      const errorData = await response.json().catch(() => ({ message: 'Invalid token' }));
      logger?.error('[CredentialService] Erreur API:', response.status, errorData);
      return {
        valid: false,
        error: errorData.message || `Secret key invalide (${response.status})`
      };
    }
  } catch (error) {
    // Logger via le logger configuré si disponible
    logger?.error('[CredentialService] Erreur lors de la validation:', error);
    logger?.error('[CredentialService] Type d\'erreur:', error.name);
    logger?.error('[CredentialService] Message d\'erreur:', error.message);
    logger?.error('[CredentialService] Stack trace:', error.stack);

    // Logger les détails supplémentaires si disponibles
    if (error.cause) {
      logger?.error('[CredentialService] Cause de l\'erreur:', error.cause);
    }

    // Retourner un message d'erreur plus détaillé
    const errorMessage = error.message || 'Erreur de connexion à l\'API';
    return {
      valid: false,
      error: errorMessage,
      details: error.toString(),
      type: error.name
    };
  }
}

/**
 * Récupère les credentials stockés
 * @returns {Object|null} - Credentials ou null
 */
function getCredentials() {
  const storage = window.TotleadsStorageService;
  return storage.getCredentials();
}

/**
 * Sauvegarde les credentials
 * @param {string} secretKey - Secret key
 * @param {string} sanctumToken - Token Sanctum (optionnel)
 * @param {number} maxLeads - Quota (optionnel)
 * @returns {boolean} - Succès
 */
function saveCredentials(secretKey, sanctumToken = null, maxLeads = null) {
  const storage = window.TotleadsStorageService;
  return storage.saveCredentials(secretKey, sanctumToken, maxLeads);
}

/**
 * Met à jour les credentials existants
 * @param {Object} updates - Mises à jour
 * @returns {boolean} - Succès
 */
function updateCredentials(updates) {
  const storage = window.TotleadsStorageService;
  return storage.updateCredentials(updates);
}

/**
 * Supprime les credentials
 * @returns {boolean} - Succès
 */
function clearCredentials() {
  const storage = window.TotleadsStorageService;
  return storage.clearCredentials();
}

/**
 * Vérifie si les credentials sont valides
 * @returns {boolean} - true si valides
 */
function hasValidCredentials() {
  const storage = window.TotleadsStorageService;
  return storage.hasValidCredentials();
}

/**
 * Obtient un token Sanctum valide
 * Effectue un login si nécessaire ou si le token est expiré
 * @param {boolean} forceRefresh - Force le renouvellement même si le token semble valide
 * @returns {Promise<string|null>} - Token Sanctum ou null
 */
async function getValidSanctumToken(forceRefresh = false) {
  const logger = window.TotleadsLogger;
  const storage = window.TotleadsStorageService;

  try {
    const credentials = storage.getCredentials();

    if (!credentials || !credentials.secretKey) {
      logger?.error('[CredentialService] Aucune secret key trouvée');
      return null;
    }

    // Si on force le renouvellement, ne pas vérifier l'âge du token
    if (!forceRefresh && credentials.sanctumToken && credentials.sanctumTokenCreatedAt) {
      const tokenAge = Date.now() - credentials.sanctumTokenCreatedAt;
      // Réduire le délai de validité à 50 minutes (au lieu de 60)
      // pour renouveler proactivement avant l'expiration réelle côté serveur
      const maxTokenAge = 50 * 60 * 1000; // 50 minutes

      if (tokenAge < maxTokenAge) {
        return credentials.sanctumToken;
      }
    }

    if (sanctumRefreshPromise) {
      return await sanctumRefreshPromise;
    }

    // Renouveler le token
    logger?.info('[CredentialService] Renouvellement du token Sanctum');
    sanctumRefreshPromise = validate(credentials.secretKey)
      .then(loginResult => {
        if (loginResult.valid && loginResult.token) {
          return loginResult.token;
        }

        logger?.error('[CredentialService] Échec du renouvellement:', loginResult.error);
        return null;
      })
      .finally(() => {
        sanctumRefreshPromise = null;
      });

    return await sanctumRefreshPromise;
  } catch (error) {
    logger?.error('[CredentialService] Erreur lors de la récupération du token Sanctum:', error);
    return null;
  }
}

/**
 * Effectue un login avec la secret key pour obtenir un token Sanctum
 * Alias de validate() pour compatibilité
 * @param {string} secretKey - Secret key
 * @returns {Promise<Object>} - Résultat du login
 */
async function login(secretKey) {
  return await validate(secretKey);
}

/**
 * Vérifie si un token Sanctum existe et est valide
 * @returns {boolean} - true si token valide
 */
function hasSanctumToken() {
  const storage = window.TotleadsStorageService;
  const token = storage.getSanctumToken();

  if (!token) {
    return false;
  }

  // Vérifier l'âge du token (max 1 heure)
  const credentials = storage.getCredentials();
  if (!credentials || !credentials.sanctumTokenCreatedAt) {
    return false;
  }

  const tokenAge = Date.now() - credentials.sanctumTokenCreatedAt;
  const oneHour = 60 * 60 * 1000;

  return tokenAge < oneHour;
}

/**
 * Force le renouvellement du token Sanctum
 * @returns {Promise<string|null>} - Nouveau token ou null
 */
async function refreshSanctumToken() {
  const logger = window.TotleadsLogger;
  const storage = window.TotleadsStorageService;

  const credentials = storage.getCredentials();

  if (!credentials || !credentials.secretKey) {
    logger?.error('[CredentialService] Impossible de renouveler sans secret key');
    return null;
  }

  if (sanctumRefreshPromise) {
    return await sanctumRefreshPromise;
  }

  logger?.info('[CredentialService] Renouvellement forcé du token Sanctum');
  sanctumRefreshPromise = validate(credentials.secretKey)
    .then(loginResult => loginResult.valid ? loginResult.token : null)
    .finally(() => {
      sanctumRefreshPromise = null;
    });

  return await sanctumRefreshPromise;
}

/**
 * Détecte si un message d'erreur indique une erreur d'authentification / session expirée
 * @param {string} message - Message d'erreur
 * @returns {boolean} - true si erreur auth (token expiré, reconnecter, 401, etc.)
 */
function isAuthError(message) {
  if (!message || typeof message !== 'string') return false;
  const lower = message.toLowerCase();
  return (
    lower.includes('token expiré') ||
    lower.includes('reconnecter') ||
    lower.includes('authentification') ||
    lower.includes('401') ||
    lower.includes('unauthenticated') ||
    lower.includes('veuillez vous connecter') ||
    lower.includes('connecter d\'abord')
  );
}

// Exposer le service globalement
if (typeof window !== 'undefined') {
  window.TotleadsCredentialService = {
    validate,
    login,
    getCredentials,
    saveCredentials,
    updateCredentials,
    clearCredentials,
    hasValidCredentials,
    getValidSanctumToken,
    hasSanctumToken,
    refreshSanctumToken,
    isAuthError,
  };
}

