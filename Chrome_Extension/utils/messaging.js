/**
 * Utilitaires de messaging pour la communication entre scripts
 * Gère chrome.runtime.sendMessage et window.postMessage
 */

/**
 * Envoie un message au background script
 * @param {string} action - L'action à effectuer
 * @param {Object} data - Données additionnelles
 * @returns {Promise<any>} - Réponse du background script
 */
async function sendToBackground(action, data = {}) {  
  try {
    const response = await chrome.runtime.sendMessage({
      action,
      ...data
    });
    
    return response;
  } catch (error) {
    throw error;
  }
}

/**
 * Poste un message via window.postMessage
 * @param {string} type - Type du message
 * @param {string} action - Action à effectuer
 * @param {Object} data - Données additionnelles
 */
function postToWindow(type, action, data = {}) {  
  try {
    window.postMessage({
      type,
      action,
      ...data
    }, '*');
  } catch (error) {
    throw error;
  }
}

/**
 * Écoute les réponses via window.postMessage
 * @param {string} type - Type de message à écouter
 * @param {Function} callback - Callback appelé lors de la réception
 * @param {number} timeout - Timeout en ms (optionnel)
 * @returns {Function} - Fonction de nettoyage
 */
function listenForResponses(type, callback, timeout = null) {
  let timeoutId = null;
  let isResolved = false;
  
  const handler = (event) => {
    if (event.source !== window) return;
    if (event.data.type !== type) return;
    
    if (!isResolved) {
      isResolved = true;
      if (timeoutId) clearTimeout(timeoutId);
      callback(event.data);
    }
  };
  
  window.addEventListener('message', handler);
  
  // Gérer le timeout si spécifié
  if (timeout) {
    timeoutId = setTimeout(() => {
      if (!isResolved) {
        isResolved = true;
        window.removeEventListener('message', handler);
        callback({ error: 'Timeout', type });
      }
    }, timeout);
  }
  
  // Retourner une fonction de nettoyage
  return () => {
    window.removeEventListener('message', handler);
    if (timeoutId) clearTimeout(timeoutId);
  };
}

/**
 * Envoie un message et attend une réponse via postMessage
 * @param {string} sendType - Type du message à envoyer
 * @param {string} responseType - Type de réponse attendu
 * @param {string} action - Action à effectuer
 * @param {Object} data - Données additionnelles
 * @param {number} timeout - Timeout en ms
 * @returns {Promise<any>} - Réponse reçue
 */
function sendAndWaitResponse(sendType, responseType, action, data = {}, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const cleanup = listenForResponses(responseType, (response) => {
      cleanup();
      
      if (response.error) {
        reject(new Error(response.error));
      } else {
        resolve(response);
      }
    }, timeout);
    
    // Envoyer le message
    postToWindow(sendType, action, data);
  });
}

// Exposer les fonctions globalement
if (typeof window !== 'undefined') {
  window.TotleadsMessaging = {
    sendToBackground,
    postToWindow,
    listenForResponses,
    sendAndWaitResponse,
  };
}

