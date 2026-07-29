/**
 * Service centralisé pour la gestion du localStorage
 * Abstraction avec validation et gestion d'erreurs
 */

const STORAGE_KEYS = {
  CREDENTIALS: 'linkedin_extractor_credentials',
  API_DATA: 'apiData',
};

/**
 * Récupère les credentials depuis localStorage
 * @returns {Object|null} - Credentials ou null si non trouvés/expirés
 */
function getCredentials() {
  const logger = window.TotleadsLogger;

  try {
    const storedData = localStorage.getItem(STORAGE_KEYS.CREDENTIALS);
    if (!storedData) {
      logger?.debug('[StorageService] Aucun credential trouvé');
      return null;
    }

    const credentials = JSON.parse(storedData);
    let credentialsChanged = normalizeCredentials(credentials);
    const now = Date.now();

    // Vérifier expiration (1 an par défaut)
    if (credentials.expiresAt && now >= credentials.expiresAt) {
      logger?.warn('[StorageService] Credentials expirés');
      localStorage.removeItem(STORAGE_KEYS.CREDENTIALS);
      return null;
    }

    logger?.debug('[StorageService] Credentials récupérés avec succès');

    if (credentialsChanged) {
      localStorage.setItem(STORAGE_KEYS.CREDENTIALS, JSON.stringify(credentials));
      logger?.debug('[StorageService] Credentials normalisés et sauvegardés');
    }

    return credentials;
  } catch (error) {
    logger?.error('[StorageService] Erreur lors de la récupération des credentials:', error);
    return null;
  }
}

/**
 * Sauvegarde les credentials dans localStorage
 * @param {string} secretKey - Secret key de l'utilisateur
 * @param {string} sanctumToken - Token Sanctum (optionnel)
 * @param {number} maxLeads - Quota disponible (optionnel)
 * @returns {boolean} - Succès de la sauvegarde
 */
function saveCredentials(secretKey, sanctumToken = null, maxLeads = null) {
  const logger = window.TotleadsLogger;

  try {
    if (!secretKey) {
      logger?.error('[StorageService] Secret key requise pour sauvegarder');
      return false;
    }

    const now = Date.now();
    const expiresAt = now + (365 * 24 * 60 * 60 * 1000); // 1 an

    const existingCredentials = getCredentials() || {};

    const credentials = {
      ...existingCredentials,
      secretKey: secretKey,
      expiresAt: expiresAt,
      savedAt: now,
    };

    // Ajouter / mettre à jour le token Sanctum si fourni
    if (sanctumToken) {
      credentials.sanctumToken = sanctumToken;
      credentials.sanctumTokenCreatedAt = now;
    }

    // Ajouter / mettre à jour le quota si fourni
    if (maxLeads !== null && maxLeads !== undefined) {
      credentials.maxLeads = maxLeads;
      credentials.quotaUpdatedAt = now;
    }

    normalizeCredentials(credentials);

    localStorage.setItem(STORAGE_KEYS.CREDENTIALS, JSON.stringify(credentials));
    logger?.info('[StorageService] Credentials sauvegardés avec succès');
    return true;
  } catch (error) {
    logger?.error('[StorageService] Erreur lors de la sauvegarde des credentials:', error);
    return false;
  }
}

/**
 * Met à jour partiellement les credentials (merge)
 * @param {Object} updates - Mises à jour à appliquer
 * @returns {boolean} - Succès de la mise à jour
 */
function updateCredentials(updates) {
  const logger = window.TotleadsLogger;

  try {
    const existingCredentials = getCredentials();

    if (!existingCredentials) {
      logger?.warn('[StorageService] Aucun credential existant à mettre à jour');
      return false;
    }

    // Merger les updates avec les credentials existants
    const updatedCredentials = {
      ...existingCredentials,
      ...updates,
    };

    // Mettre à jour le timestamp de modification
    if (updates.sanctumToken) {
      updatedCredentials.sanctumTokenCreatedAt = Date.now();
    }

    if (updates.maxLeads !== undefined) {
      updatedCredentials.quotaUpdatedAt = Date.now();
    }

    normalizeCredentials(updatedCredentials);

    localStorage.setItem(STORAGE_KEYS.CREDENTIALS, JSON.stringify(updatedCredentials));
    logger?.debug('[StorageService] Credentials mis à jour avec succès');
    return true;
  } catch (error) {
    logger?.error('[StorageService] Erreur lors de la mise à jour des credentials:', error);
    return false;
  }
}

/**
 * Supprime les credentials du localStorage
 * @returns {boolean} - Succès de la suppression
 */
function clearCredentials() {
  const logger = window.TotleadsLogger;

  try {
    localStorage.removeItem(STORAGE_KEYS.CREDENTIALS);
    logger?.info('[StorageService] Credentials supprimés');
    return true;
  } catch (error) {
    logger?.error('[StorageService] Erreur lors de la suppression des credentials:', error);
    return false;
  }
}

/**
 * Vérifie si les credentials sont valides et non expirés
 * @returns {boolean} - true si credentials valides
 */
function hasValidCredentials() {
  const credentials = getCredentials();
  return credentials !== null && credentials.secretKey;
}

/**
 * Récupère le token Sanctum stocké
 * @returns {string|null} - Token Sanctum ou null
 */
function getSanctumToken() {
  const credentials = getCredentials();
  return credentials?.sanctumToken || null;
}

/**
 * Récupère le quota stocké
 * @returns {number|null} - Quota ou null
 */
function getStoredQuota() {
  const credentials = getCredentials();
  const maxLeads = credentials?.maxLeads;

  // S'assurer que maxLeads est un nombre
  if (typeof maxLeads === 'number') {
    return maxLeads;
  }

  // Si c'est un objet (anciennes versions), extraire available_quota
  if (maxLeads && typeof maxLeads === 'object') {
    const quota = maxLeads.available_quota ?? maxLeads.daily_limit ?? maxLeads.quota ?? null;

    // Mettre à jour dans localStorage avec la valeur normalisée
    if (quota !== null && typeof quota === 'number') {
      updateCredentials({ maxLeads: quota });
      return quota;
    }
  }

  return null;
}

/**
 * Normalise la structure des credentials (compatibilité anciennes versions)
 * @param {Object} credentials - Credentials à normaliser
 * @returns {boolean} - true si des modifications ont été faites
 */
function normalizeCredentials(credentials) {
  let changed = false;

  if (!credentials || typeof credentials !== 'object') {
    return changed;
  }

  if (credentials.maxLeads && typeof credentials.maxLeads === 'object') {
    const quotaValue =
      credentials.maxLeads.available_quota ??
      credentials.maxLeads.daily_limit ??
      credentials.maxLeads.quota ??
      null;

    credentials.maxLeads = quotaValue;
    changed = true;
  }

  return changed;
}

/**
 * Vérifie si le quota est expiré (plus de 24h)
 * @returns {boolean} - true si expiré ou non trouvé
 */
function isQuotaExpired() {
  const credentials = getCredentials();

  if (!credentials || !credentials.quotaUpdatedAt) {
    return true; // Pas de quota = expiré
  }

  const now = Date.now();
  const quotaAge = now - credentials.quotaUpdatedAt;
  const twentyFourHours = 24 * 60 * 60 * 1000;

  return quotaAge > twentyFourHours;
}

/**
 * Sauvegarde les données API capturées (pour background.js)
 * @param {Array} apiData - Données API à sauvegarder
 * @returns {boolean} - Succès de la sauvegarde
 */
function saveApiData(apiData) {
  const logger = window.TotleadsLogger;

  try {
    localStorage.setItem(STORAGE_KEYS.API_DATA, JSON.stringify(apiData));
    logger?.debug(`[StorageService] ${apiData.length} entrées API sauvegardées`);
    return true;
  } catch (error) {
    logger?.error('[StorageService] Erreur lors de la sauvegarde des données API:', error);
    return false;
  }
}

/**
 * Récupère les données API capturées
 * @returns {Array} - Tableau des données API
 */
function getApiData() {
  const logger = window.TotleadsLogger;

  try {
    const data = localStorage.getItem(STORAGE_KEYS.API_DATA);
    if (!data) {
      return [];
    }

    const parsed = JSON.parse(data);
    logger?.debug(`[StorageService] ${parsed.length} entrées API récupérées`);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    logger?.error('[StorageService] Erreur lors de la récupération des données API:', error);
    return [];
  }
}

/**
 * Supprime les données API capturées
 * @returns {boolean} - Succès de la suppression
 */
function clearApiData() {
  const logger = window.TotleadsLogger;

  try {
    localStorage.removeItem(STORAGE_KEYS.API_DATA);
    logger?.debug('[StorageService] Données API supprimées');
    return true;
  } catch (error) {
    logger?.error('[StorageService] Erreur lors de la suppression des données API:', error);
    return false;
  }
}

// Exposer le service globalement
if (typeof window !== 'undefined') {
  window.TotleadsStorageService = {
    // Credentials
    getCredentials,
    saveCredentials,
    updateCredentials,
    clearCredentials,
    hasValidCredentials,
    getSanctumToken,
    getStoredQuota,
    isQuotaExpired,

    // API Data
    saveApiData,
    getApiData,
    clearApiData,

    // Constants
    STORAGE_KEYS,
  };
}

