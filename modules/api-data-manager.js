/**
 * Gestionnaire des données API capturées depuis LinkedIn
 * Gère le cache mémoire minimal (dernière réponse uniquement)
 */

// Cache mémoire de la dernière réponse API (leads)
let lastApiResponse = null;

// Cache mémoire de la dernière réponse API (accounts)
let lastAccountApiResponse = null;

// File d'attente de promesses en attente de nouvelles données (leads)
// Chaque entrée contient { resolve, afterTimestamp, interval }
const pendingPromises = [];

// File d'attente de promesses en attente de nouvelles données (accounts)
const pendingAccountPromises = [];

/**
 * Met à jour le cache avec la dernière réponse API
 * @param {Object} data - Données API à mettre en cache
 */
function setLastApiResponse(data) {
  if (!data || (!Array.isArray(data.elements) && !data.error)) {
    return;
  }
  
  // S'assurer que le timestamp existe
  const timestamp = data.timestamp || Date.now();
  
  lastApiResponse = {
    url: data.url,
    method: data.method || 'GET',
    elements: Array.isArray(data.elements) ? data.elements : [],
    elementsCount: data.elementsCount ?? (Array.isArray(data.elements) ? data.elements.length : 0),
    statusCode: data.statusCode ?? 0,
    headers: data.headers || {},
    metadata: data.metadata,
    error: data.error || null,
    timestamp: timestamp
  };
  
  // Résoudre toutes les promesses en attente
  const promisesToCheck = pendingPromises.splice(0);
  promisesToCheck.forEach(({ resolve, afterTimestamp, interval }) => {
    // Vérifier si cette réponse correspond au critère
    // Utiliser >= pour gérer le cas où timestamp est exactement égal
    if (afterTimestamp === 0 || lastApiResponse.timestamp >= afterTimestamp) {
      if (interval) {
        clearInterval(interval);
      }
      resolve(lastApiResponse);
    } else {
      // Conserver la promesse et son timeout si cette réponse est trop ancienne.
      pendingPromises.push({ resolve, afterTimestamp, interval });
    }
  });
}


/**
 * Met à jour le cache avec la dernière réponse API (accounts)
 * @param {Object} data - Données API à mettre en cache
 */
function setLastAccountApiResponse(data) {
  if (!data || (!Array.isArray(data.elements) && !data.error)) {
    return;
  }
  
  // S'assurer que le timestamp existe
  const timestamp = data.timestamp || Date.now();
  
  lastAccountApiResponse = {
    url: data.url,
    method: data.method || 'GET',
    elements: Array.isArray(data.elements) ? data.elements : [],
    elementsCount: data.elementsCount ?? (Array.isArray(data.elements) ? data.elements.length : 0),
    statusCode: data.statusCode ?? 0,
    headers: data.headers || {},
    metadata: data.metadata,
    error: data.error || null,
    timestamp: timestamp
  };
  
  // Résoudre toutes les promesses en attente (accounts)
  const promisesToCheck = pendingAccountPromises.splice(0);
  promisesToCheck.forEach(({ resolve, afterTimestamp, interval }) => {
    // Vérifier si cette réponse correspond au critère
    if (afterTimestamp === 0 || lastAccountApiResponse.timestamp >= afterTimestamp) {
      if (interval) {
        clearInterval(interval);
      }
      resolve(lastAccountApiResponse);
    } else {
      pendingAccountPromises.push({ resolve, afterTimestamp, interval });
    }
  });
}

/**
 * Nettoie toutes les promesses en attente (utilisé lors de l'annulation)
 */
function clearPendingPromises() {
  // Nettoyer tous les intervals et résoudre les promesses avec null (leads)
  while (pendingPromises.length > 0) {
    const { resolve, interval } = pendingPromises.shift();
    if (interval) {
      clearInterval(interval);
    }
    // Résoudre avec null pour indiquer qu'il n'y a pas de données
    resolve(null);
  }
  
  // Nettoyer tous les intervals et résoudre les promesses avec null (accounts)
  while (pendingAccountPromises.length > 0) {
    const { resolve, interval } = pendingAccountPromises.shift();
    if (interval) {
      clearInterval(interval);
    }
    resolve(null);
  }
}

/**
 * Récupère les données fraîches depuis le cache mémoire (leads)
 * @param {number} afterTimestamp - Timestamp de référence
 * @returns {Object|null} - Données fraîches ou null
 */
function getFreshApiData(afterTimestamp = 0) {
  if (!lastApiResponse) {
    return null;
  }
  
  // Pour afterTimestamp = 0 (première page), retourner la dernière réponse si elle existe
  if (afterTimestamp === 0) {
    return lastApiResponse;
  }
  
  // Pour les pages suivantes, retourner seulement si le timestamp est >= (gère le cas d'égalité)
  if (lastApiResponse.timestamp >= afterTimestamp) {
    return lastApiResponse;
  }
  
  return null;
}

/**
 * Récupère les données fraîches depuis le cache mémoire (accounts)
 * @param {number} afterTimestamp - Timestamp de référence
 * @returns {Object|null} - Données fraîches ou null
 */
function getFreshAccountApiData(afterTimestamp = 0) {
  if (!lastAccountApiResponse) {
    return null;
  }
  
  // Pour afterTimestamp = 0 (première page), retourner la dernière réponse si elle existe
  if (afterTimestamp === 0) {
    return lastAccountApiResponse;
  }
  
  // Pour les pages suivantes, retourner seulement si le timestamp est >=
  if (lastAccountApiResponse.timestamp >= afterTimestamp) {
    return lastAccountApiResponse;
  }
  
  return null;
}

/**
 * Attend que de nouvelles données API soient disponibles
 * Utilise un système de promesses pour attendre les nouveaux messages au lieu de poller
 * @param {number} afterTimestamp - Timestamp de référence
 * @param {number} maxAttempts - Nombre maximum de tentatives (fallback polling)
 * @param {number} pollInterval - Intervalle de polling en ms (fallback)
 * @returns {Promise<Object|null>} - Données trouvées ou null
 */
async function waitForFreshApiData(
  afterTimestamp = 0,
  maxAttempts = 60,
  pollInterval = null
) {
  const config = window.TotleadsConfig;
  const interval = pollInterval || config.delays.API_DATA_POLL;
  
  // Pour la première collecte (afterTimestamp = 0), vérifier immédiatement si des données existent
  if (afterTimestamp === 0) {
    const immediateData = getFreshApiData(afterTimestamp);
    if (immediateData) {
      return immediateData;
    }
  } else {
    // Pour les pages suivantes, vérifier aussi immédiatement
    const immediateData = getFreshApiData(afterTimestamp);
    if (immediateData) {
      return immediateData;
    }
  }
  
  // Créer une promesse qui sera résolue quand de nouvelles données arrivent
  return new Promise((resolve) => {
    // Fallback : polling si aucune donnée n'arrive après un certain temps
    let attempts = 0;
    let checkInterval = null;
    
    const promiseEntry = { resolve, afterTimestamp, interval: null };
    
    // Fonction pour nettoyer et retirer la promesse
    const cleanup = () => {
      if (checkInterval) {
        clearInterval(checkInterval);
        checkInterval = null;
      }
      const index = pendingPromises.findIndex(p => p.resolve === resolve);
      if (index !== -1) {
        pendingPromises.splice(index, 1);
      }
    };
    
    // Ajouter la promesse à la file d'attente
    pendingPromises.push(promiseEntry);
    
    // Démarrer le polling
    checkInterval = setInterval(() => {
      attempts++;
      
      const freshData = getFreshApiData(afterTimestamp);
      if (freshData) {
        cleanup();
        resolve(freshData);
        return;
      }
      
      // Si on a atteint le max d'essais, résoudre avec null
      if (attempts >= maxAttempts) {
        cleanup();
        resolve(null);
      }
    }, interval);
    
    // Mettre à jour l'interval dans l'entrée pour qu'il puisse être nettoyé par setLastApiResponse
    promiseEntry.interval = checkInterval;
  });
}

/**
 * Attend que de nouvelles données API soient disponibles (accounts)
 * @param {number} afterTimestamp - Timestamp de référence
 * @param {number} maxAttempts - Nombre maximum de tentatives (fallback polling)
 * @param {number} pollInterval - Intervalle de polling en ms (fallback)
 * @returns {Promise<Object|null>} - Données trouvées ou null
 */
async function waitForFreshAccountApiData(
  afterTimestamp = 0,
  maxAttempts = 60,
  pollInterval = null
) {
  const config = window.TotleadsConfig;
  const interval = pollInterval || config.delays.API_DATA_POLL;
  
  // Pour la première collecte (afterTimestamp = 0), vérifier immédiatement si des données existent
  if (afterTimestamp === 0) {
    const immediateData = getFreshAccountApiData(afterTimestamp);
    if (immediateData) {
      return immediateData;
    }
  } else {
    // Pour les pages suivantes, vérifier aussi immédiatement
    const immediateData = getFreshAccountApiData(afterTimestamp);
    if (immediateData) {
      return immediateData;
    }
  }
  
  // Créer une promesse qui sera résolue quand de nouvelles données arrivent
  return new Promise((resolve) => {
    // Fallback : polling si aucune donnée n'arrive après un certain temps
    let attempts = 0;
    let checkInterval = null;
    
    const promiseEntry = { resolve, afterTimestamp, interval: null };
    
    // Fonction pour nettoyer et retirer la promesse
    const cleanup = () => {
      if (checkInterval) {
        clearInterval(checkInterval);
        checkInterval = null;
      }
      const index = pendingAccountPromises.findIndex(p => p.resolve === resolve);
      if (index !== -1) {
        pendingAccountPromises.splice(index, 1);
      }
    };
    
    // Ajouter la promesse à la file d'attente
    pendingAccountPromises.push(promiseEntry);
    
    // Démarrer le polling
    checkInterval = setInterval(() => {
      attempts++;
      
      const freshData = getFreshAccountApiData(afterTimestamp);
      if (freshData) {
        cleanup();
        resolve(freshData);
        return;
      }
      
      // Si on a atteint le max d'essais, résoudre avec null
      if (attempts >= maxAttempts) {
        cleanup();
        resolve(null);
      }
    }, interval);
    
    // Mettre à jour l'interval dans l'entrée pour qu'il puisse être nettoyé par setLastAccountApiResponse
    promiseEntry.interval = checkInterval;
  });
}

// Exposer les fonctions globalement
if (typeof window !== 'undefined') {
  window.TotleadsAPIDataManager = {
    getFreshApiData,
    waitForFreshApiData,
    setLastApiResponse,
    getFreshAccountApiData,
    waitForFreshAccountApiData,
    setLastAccountApiResponse,
    clearPendingPromises,
  };
}
