/**
 * Système d'internationalisation (i18n)
 * Gère le chargement et l'utilisation des traductions
 */

// Langues supportées
const SUPPORTED_LANGUAGES = ['fr', 'en', 'es', 'it', 'de', 'ar'];
const DEFAULT_LANGUAGE = 'en';

// Langues RTL (Right-To-Left)
const RTL_LANGUAGES = ['ar'];

// Cache des traductions chargées
let translations = {};
let currentLanguage = DEFAULT_LANGUAGE;

/**
 * Détecte la langue du navigateur
 * @returns {string} - Code langue (fr, en, etc.)
 */
function detectBrowserLanguage() {
  const logger = window.TotleadsLogger;
  
  // Récupérer la langue du navigateur
  const browserLang = navigator.language || navigator.userLanguage;
  const langCode = browserLang.split('-')[0]; // 'fr-FR' -> 'fr'
  
  // Vérifier si supportée
  if (SUPPORTED_LANGUAGES.includes(langCode)) {
    logger?.debug(`[i18n] Langue détectée: ${langCode}`);
    return langCode;
  }
  
  logger?.debug(`[i18n] Langue non supportée (${langCode}), utilisation de ${DEFAULT_LANGUAGE}`);
  return DEFAULT_LANGUAGE;
}

/**
 * Charge les traductions pour une langue
 * @param {string} lang - Code langue
 * @returns {Promise<Object>} - Objet de traductions
 */
async function loadTranslations(lang) {
  const logger = window.TotleadsLogger;
  
  try {
    logger?.debug(`[i18n] Chargement des traductions: ${lang}`);
    
    const url = chrome.runtime.getURL(`locales/${lang}.json`);
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Failed to load ${lang}.json`);
    }
    
    const data = await response.json();
    logger?.info(`[i18n] Traductions ${lang} chargées`);
    return data;
  } catch (error) {
    logger?.error(`[i18n] Erreur chargement ${lang}:`, error);
    
    // Fallback vers la langue par défaut
    if (lang !== DEFAULT_LANGUAGE) {
      logger?.warn(`[i18n] Fallback vers ${DEFAULT_LANGUAGE}`);
      return loadTranslations(DEFAULT_LANGUAGE);
    }
    
    return {};
  }
}

/**
 * Initialise le système i18n
 * @param {string} lang - Langue à utiliser (optionnel, auto-détection sinon)
 * @returns {Promise<void>}
 */
async function init(lang = null) {
  const logger = window.TotleadsLogger;
  
  // Déterminer la langue à utiliser
  currentLanguage = lang || detectBrowserLanguage();
  
  logger?.info(`[i18n] Initialisation avec la langue: ${currentLanguage}`);
  
  // Charger les traductions
  translations = await loadTranslations(currentLanguage);
  
  // Appliquer la direction du texte (RTL pour arabe)
  applyTextDirection();
}

/**
 * Récupère une traduction par sa clé
 * @param {string} key - Clé de traduction (ex: "config.title")
 * @param {Object} params - Paramètres pour interpolation (optionnel)
 * @returns {string} - Texte traduit
 */
function t(key, params = {}) {
  const logger = window.TotleadsLogger;
  
  // Naviguer dans l'objet de traductions
  const keys = key.split('.');
  let value = translations;
  
  for (const k of keys) {
    if (value && typeof value === 'object' && k in value) {
      value = value[k];
    } else {
      logger?.warn(`[i18n] Clé manquante: ${key}`);
      return key; // Retourner la clé si traduction manquante
    }
  }
  
  // Si c'est une string, faire l'interpolation des paramètres
  if (typeof value === 'string') {
    return interpolate(value, params);
  }
  
  return value;
}

/**
 * Interpole les paramètres dans une string
 * @param {string} str - String avec placeholders {param}
 * @param {Object} params - Paramètres à interpoler
 * @returns {string} - String interpolée
 */
function interpolate(str, params) {
  let result = str;
  
  for (const [key, value] of Object.entries(params)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }
  
  return result;
}

/**
 * Change la langue actuelle
 * @param {string} lang - Nouvelle langue
 * @returns {Promise<void>}
 */
async function setLanguage(lang) {
  const logger = window.TotleadsLogger;
  
  if (!SUPPORTED_LANGUAGES.includes(lang)) {
    logger?.warn(`[i18n] Langue non supportée: ${lang}`);
    return;
  }
  
  logger?.info(`[i18n] Changement de langue: ${currentLanguage} -> ${lang}`);
  currentLanguage = lang;
  translations = await loadTranslations(lang);
  
  // Appliquer la direction du texte (RTL pour arabe)
  applyTextDirection();
  
  // Émettre un événement pour que les composants se mettent à jour
  window.dispatchEvent(new CustomEvent('languageChanged', { detail: { lang, isRTL: isRTL() } }));
}

/**
 * Récupère la langue actuelle
 * @returns {string}
 */
function getCurrentLanguage() {
  return currentLanguage;
}

/**
 * Récupère les langues supportées
 * @returns {Array<string>}
 */
function getSupportedLanguages() {
  return SUPPORTED_LANGUAGES;
}

/**
 * Vérifie si la langue actuelle est RTL (Right-To-Left)
 * @returns {boolean}
 */
function isRTL() {
  return RTL_LANGUAGES.includes(currentLanguage);
}

/**
 * Applique la direction du texte (RTL/LTR) au document
 */
function applyTextDirection() {
  const direction = isRTL() ? 'rtl' : 'ltr';
  document.documentElement.setAttribute('dir', direction);
  document.documentElement.setAttribute('lang', currentLanguage);
}

/**
 * Traduit tous les éléments HTML avec attribut data-i18n
 * @param {Element} container - Conteneur à traduire (défaut: document)
 */
function translateDOM(container = document) {
  const elements = container.querySelectorAll('[data-i18n]');
  
  elements.forEach(element => {
    const key = element.getAttribute('data-i18n');
    const text = t(key);
    
    // Traduire le contenu ou l'attribut spécifié
    const attr = element.getAttribute('data-i18n-attr');
    if (attr) {
      element.setAttribute(attr, text);
    } else {
      element.textContent = text;
    }
  });
}

// Exposer les fonctions globalement
if (typeof window !== 'undefined') {
  window.TotleadsI18n = {
    init,
    t,
    setLanguage,
    getCurrentLanguage,
    getSupportedLanguages,
    translateDOM,
    detectBrowserLanguage,
    isRTL,
    applyTextDirection,
  };
}

