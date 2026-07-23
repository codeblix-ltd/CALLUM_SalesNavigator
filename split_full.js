const fs = require('fs');

// 1. YOUR ORIGINAL BASE URL
const BASE_URL = "https://www.linkedin.com/sales/search/people?query=(recentSearchParam%3A(id%3A5752546450%2CdoLogHistory%3Atrue)%2Cfilters%3AList((type%3AGEOGRAPHY%2Cvalues%3AList((id%3A103537801%2CselectionType%3AINCLUDED)))%2C(type%3AFOLLOWS_YOUR_COMPANY%2Cvalues%3AList((id%3ACF%2Ctext%3AFollowing%2520your%2520company%2CselectionType%3AINCLUDED)))))&sessionId=l983kbKUSf6ju6gNrFklJQ%3D%3D&viewAllFilters=true";

// 2. FACETS DIVIDED INTO CHUNKS
// Grouped into chunks to keep the URLs a reasonable length.
const HEADCOUNT = [
    [{id: 'A', text: 'Self-employed'}],
    [{id: 'B', text: '1-10'}],
    [{id: 'C', text: '11-50'}],
    [{id: 'D', text: '51-200'}],
    [{id: 'E', text: '201-500'}],
    [{id: 'F', text: '501-1000'}], 
    [{id: 'G', text: '1001-5000'}],
    [{id: 'H', text: '5001-10000'}],
    [{id: 'I', text: '10001%2B'}]
];

const FUNCTION = [
    [{id: '4', text: 'Business%20Development'}],
    [{id: '25', text: 'Sales'}],
    [{id: '8', text: 'Engineering'}, {id: '13', text: 'Information%20Technology'}],
    [{id: '1', text: 'Accounting'}, {id: '10', text: 'Finance'}, {id: '6', text: 'Consulting'}],
    [{id: '18', text: 'Operations'}, {id: '2', text: 'Administrative'}, {id: '12', text: 'Human%20Resources'}],
    [{id: '15', text: 'Marketing'}, {id: '16', text: 'Media%20and%20Communication'}, {id: '3', text: 'Arts%20and%20Design'}],
    [{id: '5', text: 'Community%20and%20Social%20Services'}, {id: '7', text: 'Education'}, {id: '11', text: 'Healthcare%20Services'}],
    [{id: '9', text: 'Entrepreneurship'}, {id: '14', text: 'Legal'}, {id: '17', text: 'Military'}, {id: '19', text: 'Product'}, {id: '20', text: 'Program'}, {id: '21', text: 'Purchasing'}, {id: '22', text: 'QA'}, {id: '23', text: 'Real%20Estate'}, {id: '24', text: 'Research'}, {id: '26', text: 'Support'}]
];

const SENIORITY = [
    [{id: '110', text: 'Entry%20Level'}, {id: '210', text: 'Experienced%20Manager'}],
    [{id: '220', text: 'Director'}, {id: '300', text: 'Vice%20President'}],
    [{id: '310', text: 'CXO'}, {id: '320', text: 'Owner%20%2F%20Partner'}],
    [{id: '100', text: 'In%20Training'}, {id: '120', text: 'Senior'}, {id: '130', text: 'Strategic'}, {id: '200', text: 'Entry%20Level%20Manager'}]
];

// 3. THE WATERFALL ALGORITHM 
// This creates the exact "Exclude previous -> Include current" logic you asked for.
function buildFacetStr(type, chunks, stepIndex) {
    let values = [];
    for (let i = 0; i <= stepIndex; i++) {
        if (i === chunks.length) break; // Catch the final "All Excluded" step

        let isIncluded = (i === stepIndex && stepIndex !== chunks.length);
        let selType = isIncluded ? 'INCLUDED' : 'EXCLUDED';
        
        chunks[i].forEach(item => {
            values.push(`(id:${item.id},text:${item.text},selectionType:${selType})`);
        });
    }
    if (values.length === 0) return null;
    return `(type:${type},values:List(${values.join(',')}))`;
}

// Generate all combinations
let allFilterCombos = [];
for(let h = 0; h <= HEADCOUNT.length; h++) {
    let hStr = buildFacetStr('COMPANY_HEADCOUNT', HEADCOUNT, h);
    for(let f = 0; f <= FUNCTION.length; f++) {
        let fStr = buildFacetStr('FUNCTION', FUNCTION, f);
        for(let s = 0; s <= SENIORITY.length; s++) {
            let sStr = buildFacetStr('SENIORITY_LEVEL', SENIORITY, s);
            
            let combo = [hStr, fStr, sStr].filter(Boolean);
            allFilterCombos.push(combo);
        }
    }
}

// 4. INJECT INTO BASE URL SAFELY
// Split the URL around the "query=" param to avoid destroying the formatting
const urlParts = BASE_URL.split('query=');
const prefix = urlParts[0] + 'query=';
const queryPart = urlParts[1].split('&sessionId=')[0];
const suffix = '&sessionId=' + urlParts[1].split('&sessionId=')[1];

let decodedQuery = decodeURIComponent(queryPart);
let finalUrls = [];

allFilterCombos.forEach(combo => {
    if(combo.length === 0) return;
    let comboStr = combo.join(',');
    
    // Inject our new filters right inside filters:List(
    let newQuery = decodedQuery.replace('filters:List(', `filters:List(${comboStr},`);

    // Encode safely exactly the way LinkedIn expects it
    // Commas and colons are encoded, but parenthesis ( ) MUST remain raw!
    let encodedQuery = encodeURIComponent(newQuery)
        .replace(/%28/g, '(')
        .replace(/%29/g, ')');

    let finalUrl = prefix + encodedQuery + suffix;
    finalUrls.push(finalUrl);
});

// 5. SAVE TO TEXT FILE
fs.writeFileSync('split_urls.txt', finalUrls.join('\n'));
console.log(`✅ Success! Generated ${finalUrls.length} mutually exclusive URLs and saved to 'split_urls.txt'.`);