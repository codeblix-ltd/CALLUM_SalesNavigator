// Script d'interception des API LinkedIn
(function() {
    'use strict';

    // ─── Diagnostic temporaire ───────────────────────────────────────────────
    // Mettre à false pour désactiver tous les logs de diagnostic d'un coup.
    // Objectif : vérifier si la page company déclenche plusieurs réponses
    // `salesApiAccountSearch` concurrentes (totaux différents) et laquelle "gagne".
    const TOTLEADS_DIAG = true;
    function totleadsDiagAccount(source, data, urlString) {
      if (!TOTLEADS_DIAG) return;
      try {
        console.log('[Totleads][diag] account-search captée', {
          source,                                              // 'fetch' | 'xhr-blob' | 'xhr-text'
          total: data && data.paging ? data.paging.total : undefined,
          elementsCount: data && Array.isArray(data.elements) ? data.elements.length : null,
          hasFilters: !!(data && data.metadata && data.metadata.filters),
          ts: Date.now(),
          url: (urlString || '').slice(0, 200)
        });
      } catch (e) { /* ne jamais casser l'interception pour un log */ }
    }
    // ─────────────────────────────────────────────────────────────────────────

    const SEARCH_ENDPOINTS = [
      {
        endpoint: 'salesApiLeadSearch',
        messageType: 'LINKEDIN_API_CAPTURED',
        dataType: 'lead'
      },
      {
        endpoint: 'salesApiAccountSearch',
        messageType: 'LINKEDIN_ACCOUNTS_API_CAPTURED',
        dataType: 'account'
      }
    ];

    function getSearchDescriptor(urlString) {
      if (!urlString) return null;
      return SEARCH_ENDPOINTS.find(item => String(urlString).includes(item.endpoint)) || null;
    }

    function getAbsoluteLinkedInUrl(urlString) {
      if (!urlString) return '';
      return String(urlString).startsWith('http')
        ? String(urlString)
        : `https://www.linkedin.com${urlString}`;
    }

    function getApiErrorMessage(data, fallback) {
      if (!data || typeof data !== 'object') return fallback;
      const candidate = data.message || data.errorMessage || data.error || data.code;
      if (typeof candidate === 'string' || typeof candidate === 'number') {
        return String(candidate);
      }
      return fallback;
    }

    function postSearchResult(descriptor, details) {
      if (!descriptor) return;

      const elements = Array.isArray(details.data?.elements)
        ? details.data.elements
        : [];

      if (descriptor.dataType === 'account' && !details.error) {
        totleadsDiagAccount(details.source, details.data, details.url);
      }

      window.postMessage({
        type: descriptor.messageType,
        data: {
          url: details.url,
          method: details.method || 'GET',
          elements,
          elementsCount: elements.length,
          statusCode: Number.isFinite(details.status) ? details.status : 0,
          fullResponse: details.data || null,
          metadata: details.data?.metadata,
          error: details.error || null,
          timestamp: Date.now()
        }
      }, '*');
    }

    function postSearchError(descriptor, details) {
      postSearchResult(descriptor, {
        ...details,
        data: details.data || null,
        error: {
          kind: details.kind || 'api_error',
          status: Number.isFinite(details.status) ? details.status : 0,
          message: details.message || 'LinkedIn search API returned an invalid response'
        }
      });
    }

    function processSearchPayload(descriptor, details) {
      const { data } = details;

      if (!Array.isArray(data?.elements)) {
        postSearchError(descriptor, {
          ...details,
          kind: 'invalid_payload',
          message: getApiErrorMessage(
            data,
            'LinkedIn search API response did not contain a results array'
          )
        });
        return;
      }

      postSearchResult(descriptor, details);
    }

    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
      const request = args[0];
      const urlString = typeof request === 'string'
        ? request
        : (request?.url || request?.href || '');
      const descriptor = getSearchDescriptor(urlString);
      const method = args[1]?.method || request?.method || 'GET';
      let response;

      try {
        response = await originalFetch.apply(this, args);
      } catch (error) {
        if (descriptor) {
          postSearchError(descriptor, {
            url: getAbsoluteLinkedInUrl(urlString),
            method,
            status: 0,
            source: 'fetch',
            kind: 'network_error',
            message: error?.message || 'LinkedIn search API request failed'
          });
        }
        throw error;
      }

      if (!descriptor) {
        return response;
      }

      const details = {
        url: getAbsoluteLinkedInUrl(urlString),
        method,
        status: response.status,
        source: 'fetch'
      };

      if (!response.ok) {
        postSearchError(descriptor, {
          ...details,
          kind: 'http_error',
          message: `LinkedIn search API returned HTTP ${response.status}`
        });
        return response;
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.toLowerCase().includes('json')) {
        postSearchError(descriptor, {
          ...details,
          kind: 'invalid_content_type',
          message: `LinkedIn search API returned ${contentType || 'a non-JSON response'}`
        });
        return response;
      }

      try {
        const data = await response.clone().json();
        processSearchPayload(descriptor, { ...details, data });
      } catch (error) {
        postSearchError(descriptor, {
          ...details,
          kind: 'invalid_json',
          message: error?.message || 'LinkedIn search API returned invalid JSON'
        });
      }

      return response;
    };
    
    // Intercepter aussi XMLHttpRequest
    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;
    
    XMLHttpRequest.prototype.open = function(method, url, ...args) {
      this._method = method;
      this._url = url;
      return originalXHROpen.apply(this, [method, url, ...args]);
    };

    async function inspectSearchXhr(xhr, descriptor) {
      if (!descriptor || xhr.__totleadsSearchHandled) return;
      xhr.__totleadsSearchHandled = true;

      const details = {
        url: getAbsoluteLinkedInUrl(xhr._url),
        method: xhr._method || 'GET',
        status: xhr.status,
        source: xhr.responseType === 'blob' ? 'xhr-blob' : 'xhr-text'
      };

      if (xhr.status < 200 || xhr.status >= 300) {
        postSearchError(descriptor, {
          ...details,
          kind: 'http_error',
          message: `LinkedIn search API returned HTTP ${xhr.status || 0}`
        });
        return;
      }

      try {
        let data;
        if (xhr.responseType === 'json') {
          data = xhr.response;
        } else if (xhr.responseType === 'blob') {
          const responseText = await xhr.response.text();
          data = JSON.parse(responseText);
        } else {
          data = JSON.parse(xhr.responseText);
        }

        processSearchPayload(descriptor, { ...details, data });
      } catch (error) {
        postSearchError(descriptor, {
          ...details,
          kind: 'invalid_json',
          message: error?.message || 'LinkedIn search API returned invalid JSON'
        });
      }
    }
    
    XMLHttpRequest.prototype.send = function(data) {
      const xhr = this;
      const searchDescriptor = getSearchDescriptor(xhr._url);

      if (searchDescriptor) {
        xhr.addEventListener('load', function() {
          inspectSearchXhr(xhr, searchDescriptor);
        });
        xhr.addEventListener('error', function() {
          if (xhr.__totleadsSearchHandled) return;
          xhr.__totleadsSearchHandled = true;
          postSearchError(searchDescriptor, {
            url: getAbsoluteLinkedInUrl(xhr._url),
            method: xhr._method || 'GET',
            status: xhr.status || 0,
            source: 'xhr',
            kind: 'network_error',
            message: 'LinkedIn search API request failed'
          });
        });
        xhr.addEventListener('timeout', function() {
          if (xhr.__totleadsSearchHandled) return;
          xhr.__totleadsSearchHandled = true;
          postSearchError(searchDescriptor, {
            url: getAbsoluteLinkedInUrl(xhr._url),
            method: xhr._method || 'GET',
            status: xhr.status || 0,
            source: 'xhr',
            kind: 'network_timeout',
            message: 'LinkedIn search API request timed out'
          });
        });
      }
      
      xhr.addEventListener('load', function() {
        // Capturer salesApiNavChrome pour extraire le member URN
        if (xhr._url && xhr._url.includes('salesApiNavChrome')) {
          try {
            if (xhr.responseType === 'blob') {
              // Lire le blob de manière asynchrone
              xhr.response.text().then(responseText => {
                if (!responseText || responseText.length === 0) {
                  return;
                }
                
                try {
                  const data = JSON.parse(responseText);
                  
                  if (data.member) {
                    window.postMessage({
                      type: 'LINKEDIN_MEMBER_CAPTURED',
                      data: {
                        member: data.member,
                        timestamp: Date.now()
                      }
                    }, '*');
                  }
                } catch (parseError) {
                  // Erreur silencieuse
                }
              }).catch(() => {
                // Erreur silencieuse
              });
              
              return;
            } else {
              const responseData = xhr.responseText;
              
              if (!responseData || responseData.length === 0) {
                return;
              }
              
              const data = JSON.parse(responseData);
              
              if (data.member) {
                window.postMessage({
                  type: 'LINKEDIN_MEMBER_CAPTURED',
                  data: {
                    member: data.member,
                    timestamp: Date.now()
                  }
                }, '*');
              }
            }
          } catch (error) {
            // Erreur silencieuse
          }
        }
        
        // Capturer POST salesApiLists (création de liste à la volée)
        if (xhr._url && xhr._url.includes('salesApiLists') && (xhr._method || '').toUpperCase() === 'POST' && !xhr._url.includes('listSources')) {
          try {
            const parseListCreatedResponse = (data) => {
              if (!data || typeof data !== 'object' || !data.id || !data.name) {
                return null;
              }
              if (data.listType && data.listType.toUpperCase() !== 'ACCOUNT') {
                return null;
              }
              return {
                id: data.id,
                name: data.name,
                entityCount: 0,
                listSource: data.role || 'OWNER'
              };
            };
            const emitListCreated = (list) => {
              if (list) {
                window.postMessage({
                  type: 'LINKEDIN_LIST_CREATED',
                  data: { list: list, timestamp: Date.now() }
                }, '*');
              }
            };
            if (xhr.responseType === 'blob') {
              xhr.response.text().then(responseText => {
                if (!responseText || responseText.length === 0) return;
                try {
                  const data = JSON.parse(responseText);
                  emitListCreated(parseListCreatedResponse(data));
                } catch (e) { /* ignore */ }
              }).catch(() => {});
              return;
            }
            const responseData = xhr.responseText;
            if (responseData && responseData.length > 0) {
              try {
                const data = JSON.parse(responseData);
                emitListCreated(parseListCreatedResponse(data));
              } catch (e) { /* ignore */ }
            }
          } catch (error) {
            // Erreur silencieuse
          }
        }

        // Capturer salesApiLists pour récupérer les listes disponibles
        if (xhr._url && xhr._url.includes('salesApiLists') && xhr._url.includes('listSources')) {
          try {
            // Parser l'URL pour extraire le paramètre listType
            const urlObj = new URL(xhr._url.startsWith('http') ? xhr._url : `https://www.linkedin.com${xhr._url}`);
            const listType = urlObj.searchParams.get('listType');
            
            // Ne capturer que si listType est égal à "account" (en minuscules)
            if (!listType || listType.toLowerCase() !== 'account') {
              return;
            }
          } catch (urlError) {
            // Si l'URL ne peut pas être parsée, ne pas capturer
            return;
          }
          
          try {
            if (xhr.responseType === 'blob') {
              // Lire le blob de manière asynchrone
              xhr.response.text().then(responseText => {
                if (!responseText || responseText.length === 0) {
                  return;
                }
                
                try {
                  const data = JSON.parse(responseText);
                  
                  if (data.elements && Array.isArray(data.elements)) {
                    // Extraire uniquement les noms des listes
                    const lists = data.elements.map(item => ({
                      id: item.id,
                      name: item.name,
                      entityCount: item.entityCount || 0,
                      listSource: item.listSource
                    }));
                    
                    // Construire l'URL complète
                    const fullUrl = xhr._url.startsWith('http') ? xhr._url : `https://www.linkedin.com${xhr._url}`;
                    
                    window.postMessage({
                      type: 'LINKEDIN_LISTS_CAPTURED',
                      data: {
                        url: fullUrl,
                        method: xhr._method || 'GET',
                        lists: lists,
                        listsCount: lists.length,
                        statusCode: xhr.status,
                        fullResponse: data,
                        timestamp: Date.now()
                      }
                    }, '*');
                  }
                } catch (parseError) {
                  // Erreur silencieuse
                }
              }).catch(() => {
                // Erreur silencieuse
              });
              
              return;
            } else {
              const responseData = xhr.responseText;
              
              if (!responseData || responseData.length === 0) {
                return;
              }
              
              const data = JSON.parse(responseData);
              
              if (data.elements && Array.isArray(data.elements)) {
                // Extraire uniquement les noms des listes
                const lists = data.elements.map(item => ({
                  id: item.id,
                  name: item.name,
                  entityCount: item.entityCount || 0,
                  listSource: item.listSource
                }));
                
                const fullUrl = xhr._url.startsWith('http') ? xhr._url : `https://www.linkedin.com${xhr._url}`;
                
                window.postMessage({
                  type: 'LINKEDIN_LISTS_CAPTURED',
                  data: {
                    url: fullUrl,
                    method: xhr._method || 'GET',
                    lists: lists,
                    listsCount: lists.length,
                    statusCode: xhr.status,
                    fullResponse: data,
                    timestamp: Date.now()
                  }
                }, '*');
              }
            }
          } catch (error) {
            // Erreur silencieuse
          }
        }
      });
      
      return originalXHRSend.apply(this, [data]);
    };
    
    // Intercepter les changements d'URL (pushState, replaceState)
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    
    history.pushState = function(...args) {
      const result = originalPushState.apply(this, args);
      
      // Envoyer un message pour notifier le changement d'URL
      window.postMessage({
        type: 'LINKEDIN_URL_CHANGED',
        data: {
          url: location.href,
          timestamp: Date.now()
        }
      }, '*');
      
      return result;
    };
    
    history.replaceState = function(...args) {
      const result = originalReplaceState.apply(this, args);
      
      // Envoyer un message pour notifier le changement d'URL
      window.postMessage({
        type: 'LINKEDIN_URL_CHANGED',
        data: {
          url: location.href,
          timestamp: Date.now()
        }
      }, '*');
      
      return result;
    };
    
    // Écouter popstate
    window.addEventListener('popstate', () => {
      window.postMessage({
        type: 'LINKEDIN_URL_CHANGED',
        data: {
          url: location.href,
          timestamp: Date.now()
        }
      }, '*');
    });
  })();
