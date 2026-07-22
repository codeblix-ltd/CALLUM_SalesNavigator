/**
 * Configuration centralisée pour l'extension Totleads LK
 * Gère les environnements dev/prod et toutes les constantes
 */

// Détection de l'environnement
// const ENV = 'development';
const ENV = 'production';

/**
 * Configuration par environnement
 */
const CONFIG = {
  development: {
    API_BASE_URL: 'http://localhost:8000',
    ENABLE_LOGGING: true,
    LOG_LEVEL: 'debug', // debug, info, warn, error
  },
  production: {
    API_BASE_URL: 'https://app.totleads.com',
    ENABLE_LOGGING: false,
    LOG_LEVEL: 'error',
  }
};

/**
 * Configuration commune à tous les environnements
 */
const COMMON_CONFIG = {
  // Mode design: forcer l'affichage en état "extraction en cours" permanent pour affiner le design
  // Mettre à true pour voir la barre de progression, le bouton Stop, le temps restant, etc.
  FORCE_EXTRACTION_UI: false,

  // Mode design: forcer l'affichage en état "extraction terminée" (succès avec lien téléchargement)
  // Mettre à true pour voir le message de succès, le lien "Télécharger le CSV", etc.
  FORCE_EXTRACTION_COMPLETED_UI: false,

  // Mode design (fenêtre list): forcer l'affichage "extraction en cours" (bouton Arrêter + statut processing)
  FORCE_LIST_EXTRACTION_UI: false,

  // Mode design (fenêtre list): forcer l'affichage "extraction terminée" (succès + lien Voir les batches)
  FORCE_LIST_EXTRACTION_COMPLETED_UI: false,

  // Codes d'arrêt d'extraction (stop_reason) envoyés au backend pour diagnostic.
  // Convention : "complete_*" = fin normale/attendue ; "cut_*" = arrêt anormal à investiguer.
  // Chaque code correspond à UNE seule origine (pas de conflation) pour un diagnostic sans ambiguïté.
  STOP_REASONS: {
    COMPLETE_MAX_REACHED: 'complete_max_reached',             // max demandé par l'utilisateur atteint (complet)
    COMPLETE_ALL_RESULTS: 'complete_all_results',             // toutes les pages dispo épuisées (dernière page LinkedIn), < max mais complet
    CUT_NO_RESULTS_FIRST_PAGE: 'cut_no_results_first_page',   // page 1 sans donnée API : recherche vide OU interception cassée
    CUT_API_TIMEOUT: 'cut_api_timeout',                       // page > 1 : navigation OK mais pas de réponse API fraîche à temps
    CUT_NEXT_BUTTON_MISSING: 'cut_next_button_missing',       // bouton "Suivant" introuvable (ni actif ni désactivé) : DOM/sélecteur cassé
    CUT_TAB_CLOSED: 'cut_tab_closed',                         // onglet fermé pendant l'extraction
    CUT_USER_STOPPED: 'cut_user_stopped',                     // arrêt manuel par l'utilisateur
    CUT_ERROR: 'cut_error',                                   // exception inattendue
  },

  // Limites d'extraction
  MAX_LEADS_TO_PROCESS: 50,
  MAX_API_DATA_ENTRIES: 1000,
  SALES_NAV_MAX_RESULTS: 2500,  // Limite réelle de Sales Navigator par recherche
  LEADS_PER_PAGE: 25,           // Nombre de leads par page Sales Navigator
  
  // Délais (en millisecondes)
  delays: {
    BUTTON_INJECTION: 3000,
    PAGE_LOAD_WAIT: 4000,
    NAVIGATION_WAIT: 3000,
    BUTTON_RETRY: 2000,
    API_DATA_POLL: 500,
    API_DATA_MAX_ATTEMPTS: 60, // Nombre de tentatives d'attente de données API fraîches
    API_DATA_MAX_WAIT: 30000, // API_DATA_MAX_ATTEMPTS * API_DATA_POLL (60 * 500ms)
    LIST_AUTOMATION_STEP: 1000, // Délai entre chaque action de l'automation
  },
  
  // Timeouts
  timeouts: {
    ELEMENT_WAIT: 10000,
    BUTTON_NEXT_WAIT: 5000,
    BACKGROUND_PROCESS: 300000, // 5 minutes
  },
  
  // Sélecteurs CSS LinkedIn
  selectors: {
    PAGINATION_NEXT: '.artdeco-pagination__button--next:not([disabled])',
    PAGINATION_NEXT_DISABLED: '.artdeco-pagination__button--next[disabled]',
    SAVED_SEARCHES: '[data-x--link--saved-searches]',
    FLEX_CONTAINER: '.flex',
    EXPORT_BUTTON_ID: 'linkedin-lead-exporter-btn',
    
    // Sélecteurs pour la fonctionnalité "Add to list" (company search)
    ADD_TO_LIST_BUTTON_ID: 'linkedin-add-to-list-btn',
    MULTI_SELECT_CHECKBOX: 'input.small-input[type="checkbox"]',
    SAVE_TO_LIST_BUTTON: 'button[data-x--save-menu-trigger]',
    LIST_DROPDOWN_MENU: 'ul._menu-content_aii1oi[role="menu"]',
    LIST_ITEM_BUTTON: 'button._item_1xnv7i._list-item_aii1oi',
    LIST_NAME_SPAN: 'span._list-name_aii1oi',
    COMPANY_PAGE_CONTAINER: '.flex.p4',
  },
  
  // Patterns et regex
  patterns: {
    SALES_NAVIGATOR_URL: 'linkedin.com/sales',
    SALES_SEARCH_PEOPLE_URL: '/sales/search/people',
    SALES_SEARCH_COMPANY_URL: '/sales/search/company',
    SALES_LISTS_PEOPLE_URL: '/sales/lists/people',
    API_SEARCH_ENDPOINT: 'salesApiLeadSearch',
    API_ACCOUNT_SEARCH_ENDPOINT: 'salesApiAccountSearch',
    
    // Regex pour nettoyage
    HTML_TAGS: /<[^>]*>/g,
    EMOJI_REGEX: /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu,
    NEWLINES_TABS: /[\r\n\t]+/g,
    MULTIPLE_SPACES: /\s+/g,
    LEADING_TRAILING_HYPHENS: /^-|-$/g,
    
    // URN patterns
    URN_MEMBER: 'member:',
    URN_FS_SALES_PROFILE: 'fs_salesProfile:',
    URN_FS_SALES_COMPANY: 'fs_salesCompany:',
    
    // Image URL patterns
    LINKEDIN_IMAGE_BASE: 'media.licdn.com/dms/image/v2/',
  },
  
  // Endpoints webhook
  webhooks: {
    OPENED_SALES_NAV: '/api/webhooks/extension/opened-sales-nav',
    EXTENSION_UNINSTALLED: '/extension/uninstalled',
  },
  
  // Endpoints API
  endpoints: {
    UPLOAD_CSV: '/api/upload-csv',
    UPLOAD_ACCOUNT_CSV: '/api/upload-account-csv',
  },
  
  // Headers CSV
  CSV_HEADERS: [
    'Full Name',
    'First Name',
    'Last Name',
    'Object URN',
    'Entity URN',
    'Summary',
    'Geographic Region',
    'Premium',
    'Open Link',
    'Connection Degree',
    'Profile Image URL',
    'Company Name',
    'Current Title',
    'Started On',
    'Company Description',
    'Company URN',
    'Company Location',
    'Company Industry',
    'Company Logo',
    'Current Positions'
  ],
  
  // Headers CSV pour les accounts (companies)
  ACCOUNT_CSV_HEADERS: [
    'Company Name',
    'Company Picture URL',
    'Description',
    'Employee Count Range',
    'Employee Display Count',
    'Entity URN',
    'Industry',
    'List Count',
    'Saved'
  ],
  
  // Messages de l'extension
  messages: {
    LINKEDIN_API_CAPTURED: 'LINKEDIN_API_CAPTURED',
    LINKEDIN_ACCOUNTS_API_CAPTURED: 'LINKEDIN_ACCOUNTS_API_CAPTURED',
    LINKEDIN_LISTS_CAPTURED: 'LINKEDIN_LISTS_CAPTURED',
    LINKEDIN_LIST_CREATED: 'LINKEDIN_LIST_CREATED',
    LINKEDIN_LISTS_UPDATED: 'LINKEDIN_LISTS_UPDATED',
    LINKEDIN_EXTRACTOR: 'LINKEDIN_EXTRACTOR',
    LINKEDIN_EXTRACTOR_RESPONSE: 'LINKEDIN_EXTRACTOR_RESPONSE',
    LINKEDIN_LIST_AUTOMATION: 'LINKEDIN_LIST_AUTOMATION',
    LINKEDIN_LIST_AUTOMATION_RESPONSE: 'LINKEDIN_LIST_AUTOMATION_RESPONSE',
  },
  
  // Actions
  actions: {
    EXTRACT_AND_UPLOAD: 'extractAndUpload', // Anciennement DOWNLOAD_CSV
    OPEN_FLOATING_WINDOW: 'openFloatingWindow',
    SHOW_FLOATING_WINDOW: 'showFloatingWindow',
    COLLECT_CURRENT_PAGE: 'collectCurrentPage',
    GO_TO_NEXT_PAGE: 'goToNextPage',
    GENERATE_AND_UPLOAD_CSV: 'generateAndUploadCSV',
    SHOW_WINDOW: 'showWindow',
    API_DATA_CAPTURED: 'apiDataCaptured',
    GET_API_DATA: 'getApiData',
    CLEAR_API_DATA: 'clearApiData',
    LISTS_DATA_CAPTURED: 'listsDataCaptured',
    GET_LISTS_DATA: 'getListsData',
    CLEAR_LISTS_DATA: 'clearListsData',
    START_BACKGROUND_PAGINATION: 'startBackgroundPagination',
    STOP_BACKGROUND_PAGINATION: 'stopBackgroundPagination',
    GET_BACKGROUND_PROCESS_STATE: 'getBackgroundProcessState',
    VALIDATE_CREDENTIALS: 'validateCredentials',
    
    // Actions pour la fonctionnalité "Add to list"
    OPEN_LIST_WINDOW: 'openListWindow',
    SHOW_LIST_WINDOW: 'showListWindow',
    START_LIST_AUTOMATION: 'startListAutomation',
    STOP_LIST_AUTOMATION: 'stopListAutomation',
    GET_LIST_AUTOMATION_STATE: 'getListAutomationState',
    ADD_CURRENT_PAGE_TO_LIST: 'addCurrentPageToList',
    LIST_CREATED: 'listCreated',
  },
  
  // Styles du bouton d'export
  button: {
    text: 'Exporter vos leads maintenant',
    colors: {
      primary: '#00a86b',
      primaryHover: '#008f5a',
      secondary: '#00c274',
    },
  },
  
  // Styles du bouton "Add to list"
  listButton: {
    text: 'Add to list',
    colors: {
      primary: '#00a86b',
      primaryHover: '#008f5a',
      secondary: '#00c274',
    },
  },
  
  // Entités HTML à décoder
  HTML_ENTITIES: {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&nbsp;': ' ',
    '&copy;': '©',
    '&reg;': '®',
    '&trade;': '™',
  },
  
  // Limites LinkedIn
  linkedin: {
    MIN_ID_LENGTH: 10,
  },
};

/**
 * Fusionner la config commune avec la config de l'environnement actuel
 */
const config = {
  ...COMMON_CONFIG,
  ...CONFIG[ENV],
  ENV,
};

/**
 * Logger avec niveaux selon la configuration
 */
const Logger = {
  _shouldLog(level) {
    if (!config.ENABLE_LOGGING) return false;
    const levels = { debug: 0, info: 1, warn: 2, error: 3 };
    return levels[level] >= levels[config.LOG_LEVEL];
  },
  
  debug(...args) {
    if (this._shouldLog('debug')) console.log('[DEBUG]', ...args);
  },
  
  info(...args) {
    if (this._shouldLog('info')) console.log('[INFO]', ...args);
  },
  
  warn(...args) {
    if (this._shouldLog('warn')) console.warn('[WARN]', ...args);
  },
  
  error(...args) {
    if (this._shouldLog('error')) console.error('[ERROR]', ...args);
  },
};

// Exposer la configuration globalement pour les content scripts
if (typeof window !== 'undefined') {
  window.TotleadsConfig = config;
  window.TotleadsLogger = Logger;
}

// Exposer aussi pour les service workers (background.js)
if (typeof self !== 'undefined' && self.importScripts) {
  self.TotleadsConfig = config;
  self.TotleadsLogger = Logger;
}

