/**
 * Parser et injecteur d'URL pour LinkedIn Sales Navigator (Rest.li query format)
 */
function removeFacetTypeFromQuery(queryStr, facetType) {
  let searchTarget = `type:${facetType}`;
  let pos = queryStr.indexOf(searchTarget);
  while (pos !== -1) {
    let openParenPos = queryStr.lastIndexOf('(', pos);
    if (openParenPos !== -1) {
      let depth = 0;
      let closeParenPos = -1;
      for (let i = openParenPos; i < queryStr.length; i++) {
        if (queryStr[i] === '(') depth++;
        else if (queryStr[i] === ')') {
          depth--;
          if (depth === 0) {
            closeParenPos = i;
            break;
          }
        }
      }

      if (closeParenPos !== -1) {
        let start = openParenPos;
        let end = closeParenPos + 1;

        let prefix = queryStr.slice(0, start);
        let suffix = queryStr.slice(end);

        if (suffix.startsWith(',')) {
          suffix = suffix.slice(1);
        } else if (prefix.endsWith(',')) {
          prefix = prefix.slice(0, -1);
        }

        queryStr = prefix + suffix;
      }
    }
    pos = queryStr.indexOf(searchTarget);
  }
  return queryStr;
}

function injectFacetIntoUrl(originalUrl, facetType, facetId) {
  try {
    const urlObj = new URL(originalUrl);
    let queryStr = urlObj.searchParams.get('query');
    
    if (!queryStr) return originalUrl; // Not a standard Sales Nav search
    
    // First, strip out any pre-existing filter of this exact facetType to prevent duplicates!
    queryStr = removeFacetTypeFromQuery(queryStr, facetType);

    // The query is often wrapped in URL encoding, but URLSearchParams auto-decodes the first layer.
    // However, the internal string contains parentheses formatting: (filters:List(...),keywords:...)
    const newFilterStr = `(type:${facetType},values:List((id:${facetId},selectionType:INCLUDED)))`;
    
    const filtersStart = queryStr.indexOf('filters:List(');
    
    if (filtersStart !== -1) {
      // Find where filters:List( starts and inject right after it
      const insertPos = filtersStart + 'filters:List('.length;
      const nextChar = queryStr[insertPos];
      const comma = (nextChar === ')' || nextChar === undefined) ? '' : ',';
      
      queryStr = queryStr.slice(0, insertPos) + newFilterStr + comma + queryStr.slice(insertPos);
    } else {
      // No filters exist yet. Find the closing bracket of query=(...) safely
      let depth = 0;
      let queryBodyStart = queryStr.indexOf('(');
      let insertPos = -1;
      
      for (let i = queryBodyStart; i < queryStr.length; i++) {
        if (queryStr[i] === '(') depth++;
        else if (queryStr[i] === ')') {
          depth--;
          if (depth === 0) {
            insertPos = i;
            break;
          }
        }
      }
      
      if (insertPos !== -1) {
        const prefix = queryStr.slice(0, insertPos);
        const suffix = queryStr.slice(insertPos);
        const needsComma = prefix[prefix.length - 1] !== '(';
        const comma = needsComma ? ',' : '';
        queryStr = prefix + comma + `filters:List(${newFilterStr})` + suffix;
      }
    }
    
    // Always reset pagination to page 1 for the new child URL
    urlObj.searchParams.set('query', queryStr);
    urlObj.searchParams.delete('page');
    urlObj.searchParams.delete('start');
    urlObj.searchParams.delete('count');
    
    // Custom format the query string because URLSearchParams uses '+' for spaces
    // and URL-encodes parens, which breaks LinkedIn's RestLi parser.
    let finalQueryStr = "";
    for (const [key, val] of urlObj.searchParams.entries()) {
      let encodedVal = encodeURIComponent(val)
        .replace(/%28/g, '(')
        .replace(/%29/g, ')')
        .replace(/%2C/g, ',')
        .replace(/%3A/g, ':');
      finalQueryStr += (finalQueryStr ? '&' : '?') + key + '=' + encodedVal;
    }
    
    return urlObj.origin + urlObj.pathname + finalQueryStr;
  } catch (err) {
    window.TotleadsLogger?.error('[UrlCodec] Failed to inject facet', err);
    return originalUrl;
  }
}

if (typeof window !== 'undefined') {
  window.TotleadsUrlCodec = { injectFacetIntoUrl, removeFacetTypeFromQuery };
}