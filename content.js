// Content script - focused only on DOM scraping and raw data extraction
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'extractRawData') {
        console.log(`Extracting raw data from page ${request.pageNum}`);
        
        extractRawDataFromPage(request.pageNum, request.query)
            .then(rawData => {
                console.log(`Page ${request.pageNum}: Extracted ${rawData.length} raw results`);
                sendResponse({ rawData: rawData });
            })
            .catch(error => {
                console.error(`Page ${request.pageNum} extraction error:`, error);
                sendResponse({ rawData: [], error: error.message });
            });
        
        return true; // Keep message channel open
    }
});

// Extract raw data from current page only
async function extractRawDataFromPage(pageNumber, query) {
    console.log(`Starting raw extraction for page ${pageNumber}...`);
    
    // Wait for page to be fully loaded
    await waitForPageLoad();
    
    // Handle keywords extraction and storage
    let extractedKeywords = '';
    
    if (pageNumber === 1) {
        // Extract keywords from page 1 and store globally
        extractedKeywords = extractPeopleAlsoSearchFor();
        console.log(`🔑 Extracted keywords for all results: "${extractedKeywords}"`);
        
        // Store keywords globally for use in subsequent pages
        try {
            await chrome.storage.local.set({ 
                globalKeywords: extractedKeywords,
                keywordsQuery: query // Store with query to ensure relevance
            });
            console.log('✅ Keywords stored globally for subsequent pages');
        } catch (error) {
            console.error('❌ Error storing keywords:', error);
        }
    } else {
        // For pages 2+, retrieve stored keywords
        try {
            const result = await chrome.storage.local.get(['globalKeywords', 'keywordsQuery']);
            
            // Use stored keywords if they match current query
            if (result.globalKeywords && result.keywordsQuery === query) {
                extractedKeywords = result.globalKeywords;
                console.log(`🔑 Retrieved stored keywords for page ${pageNumber}: "${extractedKeywords}"`);
            } else {
                console.log(`⚠️ No matching stored keywords found for page ${pageNumber}`);
            }
        } catch (error) {
            console.error('❌ Error retrieving stored keywords:', error);
        }
    }
    
    // Find search results with multiple selectors
    const searchSelectors = [
        'div.g:not(.g-blk):not(.mnr-c)',
        '.MjjYud:not(.mnr-c)',
        '.tF2Cxc:not(.mnr-c)',
        '.yuRUbf',
        'div[data-ved]:has(h3):not(.mnr-c)'
    ];
     
    let searchResults = [];
    
    // Try each selector to find results
    for (const selector of searchSelectors) {
        try {
            const elements = document.querySelectorAll(selector);
            console.log(`Selector "${selector}" found ${elements.length} elements`);
            
            if (elements.length > 0) {
                const filtered = Array.from(elements).filter(el => {
                    return !isUnwantedElement(el) && hasValidContent(el);
                });
                
                if (filtered.length > 0) {
                    searchResults = filtered;
                    console.log(`Using selector: ${selector}, found ${filtered.length} valid results`);
                    break;
                }
            }
        } catch (error) {
            console.log(`Error with selector ${selector}:`, error);
        }
    }
    
    console.log(`Page ${pageNumber}: Found ${searchResults.length} valid elements`);
    
    // Extract raw data from each result
    const rawResults = [];
    const startRank = getStartRankForPage(pageNumber);
    
    for (let i = 0; i < Math.min(searchResults.length, 10); i++) {
        try {
            const element = searchResults[i];
            const rank = startRank + i;
            const rawResult = extractRawDataFromElement(element, rank, query, extractedKeywords);
            
            if (rawResult && isValidRawResult(rawResult)) {
                rawResults.push(rawResult);
                console.log(`Extracted raw result ${rank}: ${rawResult.url}`);
            }
        } catch (error) {
            console.error(`Error extracting result ${i + 1}:`, error);
        }
    }
    
    console.log(`Page ${pageNumber}: Successfully extracted ${rawResults.length} raw results`);
    return rawResults;
}

// Extract raw data from single element (no processing)
// Function to extract "People also search for" keywords using user's working logic
function extractPeopleAlsoSearchFor() {
    console.log('🔍 Extracting People Also Search For suggestions...');
    
    // Get current search query
    function getCurrentSearchQuery() {
        const input = document.querySelector('input[name="q"], textarea[name="q"]');
        if (input && input.value) {
            return input.value.toLowerCase().trim();
        }
        
        const urlParams = new URLSearchParams(window.location.search);
        const qParam = urlParams.get('q');
        return qParam ? qParam.toLowerCase().trim() : '';
    }
    
    // Extract key terms from search query
    function getKeyTerms(query) {
        if (!query) return [];
        
        const commonWords = ['the', 'and', 'or', 'for', 'in', 'on', 'at', 'to', 'of', 'with', 'by'];
        return query.split(/\s+/)
            .filter(term => term.length > 2 && !commonWords.includes(term))
            .map(term => term.replace(/[^\w\d]/g, ''));
    }
    
    // Check if text is related to search query
    function isRelatedToQuery(text, keyTerms) {
        if (!text || !keyTerms.length) return false;
        const textLower = text.toLowerCase();
        return keyTerms.some(term => textLower.includes(term));
    }
    
    // Check if text looks like a search suggestion
    function isSearchSuggestion(text) {
        if (!text) return false;
        
        const words = text.trim().split(/\s+/);
        
        return words.length >= 2 &&           // At least 2 words
               words.length <= 8 &&           // Max 8 words
               text.length >= 10 &&           // At least 10 characters
               text.length <= 60 &&           // Max 60 characters
               !text.includes('|') &&         // No pipes
               !text.includes('·') &&         // No bullets
               !text.includes('YouTube') &&   // No YouTube
               !text.includes('Quora') &&     // No Quora
               !text.includes('ago') &&       // No time references
               !text.includes('answers') &&   // No Q&A
               !text.includes('Part-') &&     // No part numbers
               !text.includes('EP') &&        // No episode numbers
               !text.includes('Master') &&    // No tutorial titles
               !text.includes('http') &&      // No URLs
               !text.includes('...') &&       // No ellipsis
               !text.match(/\d{2}-\w{3}-\d{4}/); // No dates
    }
    
    try {
        const searchQuery = getCurrentSearchQuery();
        console.log(`📝 Search query: "${searchQuery}"`);
        
        if (!searchQuery) {
            console.log('❌ No search query found');
            return '';
        }
        
        const keyTerms = getKeyTerms(searchQuery);
        console.log(`🔑 Key terms: ${keyTerms.join(', ')}`);
        
        let suggestions = [];
        
        // Target specific selectors for suggestions
        const selectors = [
            '.qR29te',
            '.b2Rnsc.vIifob',
            'div[data-hveid] .qR29te'
        ];
        
        selectors.forEach(selector => {
            const elements = document.querySelectorAll(selector);
            console.log(`📌 Found ${elements.length} elements with: ${selector}`);
            
            elements.forEach((element, index) => {
                const text = element.textContent.trim();
                
                if (isSearchSuggestion(text) && isRelatedToQuery(text, keyTerms)) {
                    console.log(`   ✅ Valid: "${text}"`);
                    suggestions.push(text);
                } else if (text.length > 5) {
                    console.log(`   ❌ Filtered: "${text.substring(0, 50)}..."`);
                }
            });
        });
        
        // Remove duplicates
        const uniqueSuggestions = [...new Set(suggestions)];
        
        console.log('\n🎯 FINAL SUGGESTIONS:');
        console.log('═'.repeat(50));
        uniqueSuggestions.forEach((text, index) => {
            console.log(`${index + 1}. "${text}"`);
        });
        
        console.log(`\n✅ Total: ${uniqueSuggestions.length} suggestions`);
        
        // Return comma-separated string (limit to 8 for CSV)
        const result = uniqueSuggestions.slice(0, 8).join(', ');
        console.log(`\n📋 Final result: "${result}"`);
        return result;
        
    } catch (error) {
        console.log('❌ Error in extraction:', error);
        return '';
    }
}





// Modified extractRawDataFromElement function
function extractRawDataFromElement(element, rank, query, keywords = '') {
    let url = '';
    let title = '';
    let snippet = '';
    
    // Find main link
    const linkSelectors = [
        'h3 a[href*="http"]',
        'a[href*="http"]:has(h3)',
        'a[href^="/url?"]:has(h3)',
        'a[href*="http"]'
    ];
    
    let linkElement = null;
    for (const selector of linkSelectors) {
        try {
            linkElement = element.querySelector(selector);
            if (linkElement && linkElement.href) break;
        } catch (e) {
            continue;
        }
    }
    
    if (linkElement) {
        url = linkElement.href;
        
        // Clean Google redirects
        if (url.includes('/url?')) {
            try {
                const urlParams = new URLSearchParams(url.split('?')[1]);
                url = urlParams.get('url') || urlParams.get('q') || url;
            } catch (e) {
                // Keep original URL if parsing fails
            }
        }
    }
    
    // Find title
    const titleSelectors = ['h3', '.LC20lb', '[role="heading"]', 'h3 span'];
    for (const selector of titleSelectors) {
        try {
            const titleEl = element.querySelector(selector);
            if (titleEl && titleEl.textContent.trim()) {
                title = titleEl.textContent.trim();
                break;
            }
        } catch (e) {
            continue;
        }
    }
    
    // Find snippet
    const snippetSelectors = ['.VwiC3b', '.s', '.st', '[data-content-feature="1"]'];
    for (const selector of snippetSelectors) {
        try {
            const snippetEl = element.querySelector(selector);
            if (snippetEl && snippetEl.textContent.trim()) {
                snippet = snippetEl.textContent.trim();
                break;
            }
        } catch (e) {
            continue;
        }
    }
    
    // Return raw data with keywords included for ALL results
    return {
        rank: rank,
        url: url,
        title: title,
        snippet: snippet,
        keywords: keywords, // Use the passed keywords for ALL results
        query: query,
        location: getLocationFromPage(),
        extractedAt: new Date().toISOString()
    };
}

// Helper functions for DOM operations only
function waitForPageLoad() {
    return new Promise((resolve) => {
        if (document.readyState === 'complete') {
            setTimeout(resolve, 2000);
        } else {
            window.addEventListener('load', () => {
                setTimeout(resolve, 2000);
            });
        }
    });
}

function getStartRankForPage(pageNumber) {
    const urlParams = new URLSearchParams(window.location.search);
    const startParam = urlParams.get('start');
    
    if (startParam) {
        return parseInt(startParam) + 1;
    }
    
    return (pageNumber - 1) * 10 + 1;
}

function isUnwantedElement(element) {
    const unwantedChecks = [
        element.querySelector('.related-question-pair'),
        element.querySelector('[data-text-ad]'),
        element.querySelector('.commercial-unit-desktop-top'),
        element.closest('.ULSxyf'),
        element.closest('.g-blk'),
        element.closest('.mnr-c'),
        element.closest('.cu-container'),
        element.textContent.includes('People also ask'),
        element.textContent.includes('Related searches'),
        element.textContent.includes('Videos'),
        element.textContent.includes('Images'),
        element.textContent.includes('Shopping'),
        element.textContent.includes('Maps'),
        element.textContent.includes('News'),
        element.classList.contains('g-blk'),
        element.classList.contains('mnr-c'),
        element.classList.contains('ULSxyf')
    ];
    
    return unwantedChecks.some(check => check);
}

function hasValidContent(element) {
    const hasLink = element.querySelector('a[href*="http"], a[href^="/url?"]');
    const hasTitle = element.querySelector('h3, .LC20lb, [role="heading"]');
    return hasLink && hasTitle;
}

function isValidRawResult(result) {
    return result && 
           result.url && 
           result.title &&
           result.url.includes('http') &&
           result.title.length > 0;
}

function getLocationFromPage() {
    // Try to find location from page elements
    try {
        const styledSpans = document.querySelectorAll('span[style*="background"]');
        for (const span of styledSpans) {
            const text = span.textContent.trim();
            if (text.length > 2 && 
                !text.match(/\b(help|privacy|terms|google|search|update|based|activity|feedback|send|try|without)\b/i)) {
                return text.replace(/,/g, '').replace(/\s+/g, ' ').trim();
            }
        }
    } catch (e) {
        // Continue to next method
    }

    try {
        const footerSpans = document.querySelectorAll('.fbar span, .f span');
        for (const span of footerSpans) {
            const text = span.textContent.trim();
            if (text.length > 2 && 
                !text.match(/\b(help|privacy|terms|google|search|update|based|activity|feedback|send|try|without|results|personalised)\b/i)) {
                return text.replace(/,/g, '').replace(/\s+/g, ' ').trim();
            }
        }
    } catch (e) {
        // Continue
    }

    try {
        const urlParams = new URLSearchParams(window.location.search);
        const near = urlParams.get('near');
        if (near) {
            const decoded = decodeURIComponent(near).replace(/,/g, '').replace(/\s+/g, ' ').trim();
            if (decoded.length > 2) {
                return decoded;
            }
        }
    } catch (e) {
        // Continue
    }

    return 'Desktop';
}

// Helper function to get query from current URL
function getQueryFromURL() {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const query = urlParams.get('q');
        return query ? decodeURIComponent(query) : '';
    } catch (error) {
        console.error('Error getting query from URL:', error);
        return '';
    }
}

// Initialize content script
if (window.location.href.includes('google.com/search')) {
    console.log('SERP Scraper content script loaded for page:', window.location.href);
}


