/**
 * Injecteur du bouton "Add to list" pour les pages de recherche d'entreprises
 * Gère l'ajout du bouton dans l'interface LinkedIn Sales Navigator (company search)
 */

/**
 * Vérifie si le bouton "Add to list" existe déjà
 * @returns {boolean} - true si le bouton existe
 */
function listButtonExists() {
  const config = window.TotleadsConfig;
  return !!document.getElementById(config.selectors.ADD_TO_LIST_BUTTON_ID);
}

/**
 * Gestionnaire de clic sur le bouton "Add to list"
 */
function handleAddToListButtonClick() {
  const config = window.TotleadsConfig;
  const messaging = window.TotleadsMessaging;

  // Envoyer un message pour ouvrir la fenêtre de liste
  messaging.postToWindow(
    config.messages.LINKEDIN_LIST_AUTOMATION,
    config.actions.OPEN_LIST_WINDOW
  );
}

/**
 * Vérifie si on est sur une page de recherche d'entreprises
 * @returns {boolean} - true si on est sur /sales/search/company
 */
function isOnCompanySearchPage() {
  const config = window.TotleadsConfig;
  const url = window.location.href;
  const onCompanySearch = url.includes(config.patterns.SALES_NAVIGATOR_URL) &&
    url.includes(config.patterns.SALES_SEARCH_COMPANY_URL);

  return onCompanySearch;
}

/**
 * Trouve le conteneur pour injecter le bouton
 * @returns {Promise<Element|null>} - Conteneur trouvé ou null
 */
async function findListButtonContainer() {
  try {
    // Stratégie 1: Chercher par la classe CSS spécifique _lower-search-nav-reflow
    const navReflowContainer = document.querySelector('.flex.align-items-center.full-width[class*="_lower-search-nav-reflow"]');
    if (navReflowContainer) {
      return navReflowContainer;
    }

    // Stratégie 2: Chercher par l'icône SVG "bulleted-list-icon" (unique au bouton Save to list)
    const bulletedListIcon = document.querySelector('li-icon[type="bulleted-list-icon"]');
    if (bulletedListIcon) {
      // Remonter jusqu'au conteneur flex align-items-center full-width
      const container = bulletedListIcon.closest('.flex.align-items-center.full-width');
      if (container) return container;
    }

    // Stratégie 3: Chercher par l'attribut data-x--save-menu-trigger
    const saveMenuButton = document.querySelector('button[data-x--save-menu-trigger]');
    if (saveMenuButton) {
      const container = saveMenuButton.closest('.flex.align-items-center.full-width');
      if (container) return container;
    }

    // Stratégie 4: Chercher par la classe _bulk-action-control (utilisée par tous les boutons d'action en masse)
    const bulkActionButton = document.querySelector('button[class*="_bulk-action-control"]');
    if (bulkActionButton) {
      const container = bulkActionButton.closest('.flex.align-items-center.full-width');
      if (container) return container;
    }

    // Stratégie 5: Chercher par le checkbox multi-selector
    // Le pattern ID commence toujours par "multi-selector-checkbox-"
    const multiSelectorCheckbox = document.querySelector('input[id^="multi-selector-checkbox-"]');
    if (multiSelectorCheckbox) {
      // Remonter jusqu'au conteneur flex align-items-center full-width
      const container = multiSelectorCheckbox.closest('.flex.align-items-center.full-width');
      if (container) return container;
    }

    // Stratégie 6 (Fallback): Chercher un conteneur avec checkbox + plusieurs boutons disabled
    // C'est la structure caractéristique de la barre d'actions
    const flexContainers = document.querySelectorAll('.flex.align-items-center.full-width');
    for (const container of flexContainers) {
      const hasCheckbox = container.querySelector('input[type="checkbox"]');
      const disabledButtons = container.querySelectorAll('button[disabled]');

      // Si le conteneur a un checkbox ET au moins 2 boutons disabled, c'est probablement le bon
      if (hasCheckbox && disabledButtons.length >= 2) {
        return container;
      }
    }

    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Crée le bouton "Add to list" stylisé (même style que "Export for free")
 * @returns {HTMLButtonElement} - Bouton créé
 */
function createAddToListButton() {
  const config = window.TotleadsConfig;
  const i18n = window.TotleadsI18n;
  const domHelpers = window.TotleadsDOMHelpers;

  if (domHelpers && typeof domHelpers.createStyledButton === 'function') {
    const button = domHelpers.createStyledButton({
      id: config.selectors.ADD_TO_LIST_BUTTON_ID,
      text: i18n.t('extraction.addToListButton'),
      onClick: handleAddToListButtonClick,
      labelRole: 'add-to-list-button-label'
    });
    button.style.setProperty('margin-left', '12px', 'important');
    // button.style.setProperty('min-width', '150px', 'important');
    return button;
  }

  // Fallback si dom-helpers non chargé
  const button = document.createElement('button');
  button.id = config.selectors.ADD_TO_LIST_BUTTON_ID;
  button.type = 'button';
  const textSpan = document.createElement('span');
  textSpan.dataset.totleadsRole = 'add-to-list-button-label';
  textSpan.textContent = i18n.t('extraction.addToListButton');
  button.appendChild(textSpan);
  button.addEventListener('click', handleAddToListButtonClick);
  return button;
}

/**
 * Rend le bouton "Add to list" responsive selon la largeur de la fenêtre
 * Adapte le texte et la taille du bouton pour l'intervalle 780px => 1000px
 */
function makeListButtonResponsive() {
  const config = window.TotleadsConfig;
  const i18n = window.TotleadsI18n;

  const button = document.getElementById(config.selectors.ADD_TO_LIST_BUTTON_ID);
  if (!button) return;

  const label = button.querySelector('[data-totleads-role="add-to-list-button-label"]');
  if (!label) return;

  const windowWidth = window.innerWidth;

  // Petite fenêtre (780px - 1000px) : Réduire padding et taille
  if (windowWidth >= 780 && windowWidth <= 1000) {
    label.textContent = i18n.t('extraction.addToListButtonShort') || i18n.t('extraction.addToListButton');
    // button.style.setProperty('min-width', '120px', 'important');
    button.style.setProperty('padding', '8px 12px', 'important');
    button.style.setProperty('margin-left', '8px', 'important');
    button.style.setProperty('font-size', '13px', 'important');
  }
  // Fenêtre normale (> 1000px) : Taille complète
  else {
    label.textContent = i18n.t('extraction.addToListButton');
    // button.style.setProperty('min-width', '150px', 'important');
    // button.style.setProperty('padding', '10px 20px', 'important');
    button.style.setProperty('margin-left', '12px', 'important');
    button.style.setProperty('font-size', '14px', 'important');
  }
}

/**
 * Initialise l'observateur de redimensionnement pour le bouton "Add to list" responsive
 */
function initListButtonResponsiveObserver() {
  // Éviter de créer plusieurs observateurs
  if (window.__totleads_listButtonResponsiveObserverInitialized) {
    makeListButtonResponsive(); // Appliquer quand même la responsivité
    return;
  }

  // Debounce pour éviter trop d'appels pendant le redimensionnement
  let resizeTimeout;
  const debouncedResize = () => {
    if (resizeTimeout) clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      makeListButtonResponsive();
    }, 100);
  };

  // Créer un ResizeObserver pour détecter les changements de taille
  if (typeof ResizeObserver !== 'undefined') {
    const resizeObserver = new ResizeObserver(debouncedResize);
    resizeObserver.observe(document.body);
  } else {
    // Fallback: utiliser window.resize
    window.addEventListener('resize', debouncedResize);
  }

  // Marquer comme initialisé
  window.__totleads_listButtonResponsiveObserverInitialized = true;

  // Appliquer immédiatement la responsivité
  makeListButtonResponsive();
}

/**
 * Ajoute le bouton "Add to list" à l'interface LinkedIn
 * @returns {Promise<boolean>} - true si le bouton a été ajouté avec succès
 */
async function addListButton() {
  const config = window.TotleadsConfig;
  const eventDetectors = window.TotleadsEventDetectors;

  try {
    // Vérifier si on est sur la page de recherche d'entreprises
    if (!isOnCompanySearchPage()) {
      return false;
    }

    // Vérifier si le bouton existe déjà
    if (listButtonExists()) {
      return false;
    }

    // Attendre que le contenu soit chargé
    await eventDetectors.waitForContentLoad(2000);

    // Trouver le conteneur des boutons
    const buttonContainer = await findListButtonContainer();

    if (!buttonContainer) {
      setTimeout(addListButton, config.delays.BUTTON_RETRY);
      return false;
    }

    // Vérifier à nouveau si le bouton existe déjà
    if (listButtonExists()) {
      return false;
    }

    // Créer le bouton
    const button = createAddToListButton();

    // Améliorer l'accessibilité du bouton
    const a11y = window.TotleadsA11y;
    const i18n = window.TotleadsI18n;

    if (a11y && i18n) {
      a11y.makeButtonAccessible(button, {
        label: i18n.t('extraction.addToListButton')
      });
    }

    // Insérer le bouton dans le conteneur (à la fin)
    buttonContainer.appendChild(button);

    // Initialiser la gestion responsive du bouton
    initListButtonResponsiveObserver();

    return true;
  } catch (error) {
    // Réessayer en cas d'erreur
    setTimeout(addListButton, config.delays.BUTTON_RETRY);
    return false;
  }
}

/**
 * Retire le bouton "Add to list" de l'interface
 * @returns {boolean} - true si le bouton a été retiré
 */
function removeListButton() {
  const config = window.TotleadsConfig;

  try {
    const button = document.getElementById(config.selectors.ADD_TO_LIST_BUTTON_ID);

    if (button) {
      button.remove();
      return true;
    }

    return false;
  } catch (error) {
    return false;
  }
}

/**
 * Initialise l'injection du bouton au chargement de la page
 */
async function initializeListButtonInjection() {
  const eventDetectors = window.TotleadsEventDetectors;

  // Vérifier immédiatement si on est sur la bonne page
  if (!isOnCompanySearchPage()) {
    return;
  }

  // Attendre que le DOM soit complètement prêt
  await eventDetectors.waitForDOMReady();

  // Attendre un peu que le contenu LinkedIn se charge
  await eventDetectors.waitForContentLoad(3000);

  // Ajouter le bouton
  addListButton();
}

/**
 * Gère les changements d'URL et réinjecte le bouton si nécessaire
 * @param {string} newUrl - Nouvelle URL
 */
async function handleListUrlChange(newUrl) {
  const eventDetectors = window.TotleadsEventDetectors;

  // Attendre que le contenu se charge
  await eventDetectors.waitForContentLoad(1000);

  // Vérifier si on est sur la page de recherche d'entreprises
  const isOnCompanySearch = isOnCompanySearchPage();

  if (isOnCompanySearch) {
    // Réinjecter si nécessaire sur la page de recherche d'entreprises
    if (!listButtonExists()) {
      addListButton();
    }
  } else {
    // Retirer le bouton si on n'est plus sur la page de recherche d'entreprises
    if (listButtonExists()) {
      removeListButton();
    }
  }
}

/**
 * Observe les changements du DOM pour détecter si le bouton est supprimé
 * et le réinjecter automatiquement (fallback de sécurité)
 */
function observeListButtonChanges() {
  // Attendre que le DOM soit prêt avant d'observer
  setTimeout(() => {
    const targetNode = document.querySelector('main') || document.body;

    if (!targetNode) {
      return;
    }

    let mutationTimeout = null;

    new MutationObserver(() => {
      if (mutationTimeout) clearTimeout(mutationTimeout);

      mutationTimeout = setTimeout(() => {
        const isOnCompanySearch = isOnCompanySearchPage();
        if (isOnCompanySearch && !listButtonExists()) {
          addListButton();
        }
      }, 500);
    }).observe(targetNode, {
      subtree: true,
      childList: true
    });
  }, 100);
}

// Exposer les fonctions globalement
if (typeof window !== 'undefined') {
  window.TotleadsListInjector = {
    addListButton,
    removeListButton,
    listButtonExists,
    initializeListButtonInjection,
    handleListUrlChange,
    observeListButtonChanges,
    isOnCompanySearchPage,
  };
}

