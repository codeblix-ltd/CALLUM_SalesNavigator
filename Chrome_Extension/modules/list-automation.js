/**
 * Module d'automatisation pour l'ajout à une liste LinkedIn
 * Gère l'automation complète : sélection, sauvegarde, pagination
 */

/**
 * État global de l'automation
 */
let automationState = {
  isRunning: false,
  targetListName: null,
  currentPage: 0,
  totalItemsProcessed: 0,
  shouldStop: false,
};

/**
 * Démarre le processus d'automatisation
 * @param {string} listName - Nom de la liste cible
 * @returns {Promise<Object>} - Résultat de l'automation
 */
async function startAutomation(listName) {
  const config = window.TotleadsConfig;
  const i18n = window.TotleadsI18n;
  
  if (!listName || listName.trim() === '') {
    throw new Error(i18n.t('errors.listNameRequired'));
  }
  
  if (automationState.isRunning) {
    throw new Error(i18n.t('errors.alreadyRunning'));
  }
  
  // Initialiser l'état
  automationState = {
    isRunning: true,
    targetListName: listName.trim(),
    currentPage: 1,
    totalItemsProcessed: 0,
    shouldStop: false,
  };
  
  
  try {
    // Traiter toutes les pages
    while (automationState.isRunning && !automationState.shouldStop) {
      
      // Traiter la page courante
      await processCurrentPage();
      
      // Vérifier s'il y a une page suivante
      const hasNextPage = await hasNextPageButton();
      
      if (!hasNextPage) {
        break;
      }
      
      // Naviguer vers la page suivante
      await goToNextPage();
      
      // Attendre le chargement de la nouvelle page
      await sleep(config.delays.LIST_AUTOMATION_STEP * 2);
      
      automationState.currentPage++;
    }
    
    // Arrêter l'automation
    const wasStopped = automationState.shouldStop;
    automationState.isRunning = false;
    
    return {
      success: true,
      pagesProcessed: automationState.currentPage,
      totalItemsProcessed: automationState.totalItemsProcessed,
      stopped: wasStopped,
    };
  } catch (error) {
    automationState.isRunning = false;
    throw error;
  }
}

/**
 * Arrête le processus d'automatisation
 * @returns {Object} - État de l'automation
 */
function stopAutomation() {
  automationState.shouldStop = true;
  return {
    success: true,
    ...getAutomationState(),
  };
}

/**
 * Récupère l'état actuel de l'automation
 * @returns {Object} - État de l'automation
 */
function getAutomationState() {
  return {
    isRunning: automationState.isRunning,
    targetListName: automationState.targetListName,
    currentPage: automationState.currentPage,
    totalItemsProcessed: automationState.totalItemsProcessed,
  };
}

/**
 * Ajoute la page courante à une liste (sans pagination).
 * Utilisé pendant l'extraction CSV quand l'option "Ajouter à une liste" est cochée.
 * @param {string} listName - Nom de la liste cible
 * @returns {Promise<void>}
 */
async function addCurrentPageToList(listName) {
  if (!listName || typeof listName !== 'string' || !listName.trim()) {
    throw new Error('listName is required');
  }
  const previousTarget = automationState.targetListName;
  automationState.targetListName = listName.trim();
  try {
    await processCurrentPage();
  } finally {
    automationState.targetListName = previousTarget;
  }
}

/**
 * Traite la page courante : sélectionne tout et sauvegarde dans la liste
 * @returns {Promise<void>}
 */
async function processCurrentPage() {
  const config = window.TotleadsConfig;
  
  // 1. Cliquer sur la checkbox de sélection multiple
  await clickMultiSelectCheckbox();
  await sleep(config.delays.LIST_AUTOMATION_STEP);
  
  // 2. Cliquer sur le bouton "Save to list"
  await clickSaveToListButton();
  await sleep(config.delays.LIST_AUTOMATION_STEP);
  
  // 3. Attendre l'apparition du dropdown
  await waitForDropdownMenu();
  await sleep(config.delays.LIST_AUTOMATION_STEP / 2);
  
  // 4. Trouver et cliquer sur la liste cible
  await clickTargetList(automationState.targetListName);
  await sleep(config.delays.LIST_AUTOMATION_STEP);
  
  // 5. Re-cliquer sur le bouton "Save to list" pour refermer le dropdown
  await clickSaveToListButton();
  await sleep(config.delays.LIST_AUTOMATION_STEP);
  
  // Compter les items traités (nombre sélectionné affiché dans le DOM)
  const itemsCount = getSelectedItemsCount();
  automationState.totalItemsProcessed += itemsCount;
}

/**
 * Clique sur la checkbox de sélection multiple
 * @returns {Promise<void>}
 */
async function clickMultiSelectCheckbox() {
  const config = window.TotleadsConfig;
  const domHelpers = window.TotleadsDOMHelpers;
  
  const checkbox = await domHelpers.waitForElement(
    config.selectors.MULTI_SELECT_CHECKBOX,
    config.timeouts.ELEMENT_WAIT
  );
  
  if (!checkbox) {
    throw new Error('Checkbox de sélection multiple non trouvée');
  }
  
  // Vérifier si déjà coché
  if (!checkbox.checked) {
    checkbox.click();
  }
}

/**
 * Clique sur le bouton "Save to list"
 * @returns {Promise<void>}
 */
async function clickSaveToListButton() {
  const config = window.TotleadsConfig;
  const domHelpers = window.TotleadsDOMHelpers;
  
  let button = await domHelpers.waitForElement(
    config.selectors.SAVE_TO_LIST_BUTTON,
    config.timeouts.ELEMENT_WAIT
  );
  
  if (!button) {
    throw new Error('Bouton "Save to list" non trouvé');
  }

  // Assurer l'activation du bouton: si désactivé, recliquer "Select All" puis réessayer (jusqu'à 10s)
  const deadline = Date.now() + 10000; // 10 secondes max
  let attempt = 0;
  while ((button.disabled || button.getAttribute('aria-disabled') === 'true') && Date.now() < deadline) {
    attempt++;
    await clickMultiSelectCheckbox();
    // Attendre 1 seconde entre les tentatives
    await sleep(1000);
    button = document.querySelector(config.selectors.SAVE_TO_LIST_BUTTON) 
      || await domHelpers.waitForElement(config.selectors.SAVE_TO_LIST_BUTTON, 1000);
  }

  if (button.disabled || button.getAttribute('aria-disabled') === 'true') {
    throw new Error('"Save to list" désactivé après plusieurs tentatives');
  }
  
  button.click();
}

/**
 * Attend que le dropdown menu apparaisse
 * @returns {Promise<Element>}
 */
async function waitForDropdownMenu() {
  const config = window.TotleadsConfig;
  const domHelpers = window.TotleadsDOMHelpers;
  
  const menu = await domHelpers.waitForElement(
    config.selectors.LIST_DROPDOWN_MENU,
    config.timeouts.ELEMENT_WAIT
  );
  
  if (!menu) {
    throw new Error('Menu dropdown non trouvé');
  }
  
  return menu;
}

/**
 * Trouve et clique sur la liste cible dans le dropdown
 * @param {string} listName - Nom de la liste à trouver
 * @returns {Promise<void>}
 */
async function clickTargetList(listName) {
  const config = window.TotleadsConfig;
  const i18n = window.TotleadsI18n;
  
  // Récupérer tous les boutons de liste
  const listButtons = document.querySelectorAll(config.selectors.LIST_ITEM_BUTTON);
  
  if (!listButtons || listButtons.length === 0) {
    throw new Error('Aucune liste trouvée dans le dropdown');
  }
  
  // Chercher la liste par son nom
  let targetButton = null;
  
  for (const button of listButtons) {
    const nameSpan = button.querySelector(config.selectors.LIST_NAME_SPAN);
    
    if (nameSpan) {
      const buttonListName = nameSpan.textContent.trim();
      
      // Comparaison insensible à la casse et aux espaces
      if (buttonListName.toLowerCase() === listName.toLowerCase()) {
        targetButton = button;
        break;
      }
    }
  }
  
  if (!targetButton) {
    throw new Error(i18n.t('errors.listNotFound', { listName }));
  }
  
  // Cliquer sur le bouton
  targetButton.click();
}

/**
 * Récupère le nombre d'items sélectionnés
 * @returns {number}
 */
function getSelectedItemsCount() {
  const config = window.TotleadsConfig;
  
  try {
    // Chercher le label qui affiche "X selected"
    const checkbox = document.querySelector(config.selectors.MULTI_SELECT_CHECKBOX);
    
    if (checkbox) {
      const label = checkbox.nextElementSibling;
      
      if (label) {
        const text = label.textContent.trim();
        // Extraire le nombre depuis le texte (ex: "25 selected")
        const match = text.match(/(\d+)/);
        
        if (match) {
          const count = parseInt(match[1], 10);
          return count;
        }
      }
    }
    
    return 0;
  } catch (error) {
    return 0;
  }
}

/**
 * Vérifie si le bouton "Next" existe et est actif
 * @returns {Promise<boolean>}
 */
async function hasNextPageButton() {
  const config = window.TotleadsConfig;
  const domHelpers = window.TotleadsDOMHelpers;
  
  try {
    // Attendre que le bouton Next apparaisse (ou timeout)
    const nextButton = await domHelpers.waitForElement(
      config.selectors.PAGINATION_NEXT,
      config.timeouts.BUTTON_NEXT_WAIT
    );
    const hasNext = nextButton !== null && !nextButton.disabled;
    
    return hasNext;
  } catch (error) {
    return false;
  }
}

/**
 * Navigate vers la page suivante
 * @returns {Promise<void>}
 */
async function goToNextPage() {
  const config = window.TotleadsConfig;
  
  const nextButton = document.querySelector(config.selectors.PAGINATION_NEXT);
  
  if (!nextButton || nextButton.disabled) {
    throw new Error('Bouton "Next" non disponible');
  }
  
  nextButton.click();
}

/**
 * Fonction utilitaire pour attendre un délai
 * @param {number} ms - Délai en millisecondes
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Exposer les fonctions globalement
if (typeof window !== 'undefined') {
  window.TotleadsListAutomation = {
    startAutomation,
    stopAutomation,
    getAutomationState,
    addCurrentPageToList,
  };
}

