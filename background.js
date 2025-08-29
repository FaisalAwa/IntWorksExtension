// Centralized data processing and storage service
class SERPBackground {
  constructor() {
    this.hiddenTabId = null;
    this.init();
  }

  // Shared constants - single source of truth
  static OUR_SITES = [
    'dumpsacademy.com', 'dumpsschool.com', 'certificationgenie.com', 
    'killerdumps.com', 'study4exam.com', 'pass4future.com', 
    'certboosters.com', 'justcerts.com', 'testschamp.com', 
    'premiumdumps.com', 'getcertifyhere.com', 'certs2pass.com', 
    'certstime.com', 'pass4success.com', 'certsfire.com', 
    'p2pexams.com', 'prepbolt.com', 'testinsights.com', 
    'certsmarket.com', 'examshome.com', 'trendycerts.com'
  ];

  init() {
    chrome.action.onClicked.addListener((tab) => {
      chrome.tabs.create({
        url: chrome.runtime.getURL('popup.html'),
        active: true
      });
    });

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      this.handleMessage(request, sender, sendResponse);
      return true;
    });
  }

  // Handle message from popup or content script
  async handleMessage(request, sender, sendResponse) {
      try {
        console.log('Background received message:', request.action);
        
        switch (request.action) {
          case 'openPopup':
            this.openPopup();
            return true;
            
          case 'extractFromPage':
            const results = await this.extractFromPage(request.tabId, request.pageNum, request.query);
            return { results };
            
          case 'extractFromHiddenTab':
            const hiddenResults = await this.extractFromHiddenTab(request.pageNum, request.query);
            return { results: hiddenResults };
            
          case 'autoExtractResults':
            const autoResults = await this.autoExtractResults(request.query, request.targetResults);
            return { results: autoResults };
            
          case 'clearSERPData':
            this.clearSERPData();
            return { success: true };
            
          default:
            console.log('Unknown action:', request.action);
            return false;
        }
      } catch (error) {
        console.error('Error handling message:', error);
        return { error: error.message };
      }
  }
  
  // Clear SERP data
  clearSERPData() {
      console.log('Clearing all SERP data in background');
      this.serpData = [];
      
      // Close any existing hidden tab
      if (this.hiddenTabId) {
          try {
              chrome.tabs.get(this.hiddenTabId, (tab) => {
                  if (tab) {
                      chrome.tabs.remove(this.hiddenTabId);
                  }
              });
          } catch (e) {
              console.log('Tab not found or already closed');
          }
          this.hiddenTabId = null;
      }
      
      // Clear ALL chrome storage
      chrome.storage.local.clear(function() {
          console.log('All chrome storage cleared from background');
      });
  }

  async handleMessage(request, sender, sendResponse) {
    try {
      switch (request.action) {
        case 'processAndStoreData':
          const processedData = await this.processAndStoreData(request.rawData, request.query);
          sendResponse({ success: true, data: processedData });
          break;
          
        case 'getSERPData':
          const data = await this.getSERPData();
          sendResponse(data);
          break;
          
        case 'clearSERPData':
          await this.clearSERPData();
          // Reset hidden tab when data is cleared
          if (this.hiddenTabId) {
            try {
              await chrome.tabs.remove(this.hiddenTabId);
            } catch (e) {
              console.log('Tab already closed');
            }
            this.hiddenTabId = null;
          }
          sendResponse({ success: true });
          break;
          
        case 'exportToCSV':
          const csvData = await this.exportToCSV();
          sendResponse({ csvData });
          break;
          
        case 'navigateToPage':
          await chrome.tabs.update(sender.tab.id, { url: request.url });
          sendResponse({ success: true });
          break;
          
        case 'extractFromPage':
          // Keep original functionality for compatibility
          const results = await this.extractFromPage(sender.tab.id, request.pageNum, request.query);
          sendResponse({ results });
          break;
          
        case 'extractFromHiddenTab':
          // New method for hidden tab extraction
          const hiddenResults = await this.extractFromHiddenTab(request.pageNum, request.query);
          sendResponse({ results: hiddenResults });
          break;
          
        case 'autoExtractResults':
          const autoResults = await this.autoExtractResults(request.query, request.targetResults);
          sendResponse({ results: autoResults });
          break;
          
        default:
          sendResponse({ error: 'Unknown action' });
      }
    } catch (error) {
      console.error('Error in handleMessage:', error);
      sendResponse({ error: error.message });
    }
  }
  
  // New method for hidden tab extraction
  async extractFromHiddenTab(pageNum, query) {
    try {
      // Always close previous hidden tab if it exists
      if (this.hiddenTabId) {
        try {
          await chrome.tabs.get(this.hiddenTabId);
          await chrome.tabs.remove(this.hiddenTabId);
        } catch (e) {
          console.log('Previous tab not found or already closed');
        }
        this.hiddenTabId = null;
      }
      
      // Get all current windows
      const windows = await chrome.windows.getAll();
      let hiddenWindow = null;
      
      // Create a new window that's positioned off-screen
      hiddenWindow = await chrome.windows.create({
        url: this.buildGoogleSearchUrl(query, pageNum),
        type: 'popup',
        focused: false,
        width: 1,
        height: 1,
        left: -9999,  // Position off-screen
        top: -9999    // Position off-screen
      });
      
      // Get the tab from the hidden window
      const tabs = await chrome.tabs.query({ windowId: hiddenWindow.id });
      this.hiddenTabId = tabs[0].id;
      
      // Wait for page to load
      await new Promise((resolve) => {
        const listener = (tabId, changeInfo) => {
          if (tabId === this.hiddenTabId && changeInfo.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            setTimeout(resolve, 2000); // Extra delay for page to fully render
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
      });
      
      // Extract data from hidden tab
      const results = await this.extractFromPage(this.hiddenTabId, pageNum, query);
      
      // Close the hidden window after extraction
      try {
        await chrome.windows.remove(hiddenWindow.id);
        this.hiddenTabId = null;
      } catch (e) {
        console.log('Window already closed');
      }
      
      return results;
    } catch (error) {
      console.error('Hidden tab extraction error:', error);
      throw error;
    }
  }
  
  // New method for auto extraction in background
  async autoExtractResults(query, targetResults = 30) {
    // Always start from page 1 regardless of previous state
    let currentPage = 1;
    let totalExtracted = 0;
    let allResults = [];
    
    // Reset any existing hidden tab
    if (this.hiddenTabId) {
      try {
        await chrome.tabs.get(this.hiddenTabId);
        await chrome.tabs.remove(this.hiddenTabId);
      } catch (e) {
        console.log('Previous tab not found or already closed');
      }
      this.hiddenTabId = null;
    }
    
    try {
      while (totalExtracted < targetResults) {
        console.log(`Auto-extracting page ${currentPage}... (${totalExtracted}/${targetResults})`);
        
        // Extract from current page via hidden tab
        const results = await this.extractFromHiddenTab(currentPage, query);
        
        if (results && results.length > 0) {
          allResults = allResults.concat(results);
          totalExtracted = allResults.length;
          
          if (totalExtracted >= targetResults) {
            console.log(`Auto-extraction completed! ${totalExtracted} results extracted.`);
            break;
          }
          
          // Move to next page
          currentPage++;
        } else {
          console.log('No more results found. Auto-extraction stopped.');
          break;
        }
      }
      
      return allResults;
    } catch (error) {
      console.error('Auto extraction error:', error);
      throw error;
    }
  }
  
  // Helper method to build Google search URL
  buildGoogleSearchUrl(query, pageNum) {
    const url = new URL('https://www.google.com/search');
    url.searchParams.set('q', query);
    if (pageNum > 1) {
      url.searchParams.set('start', ((pageNum - 1) * 10).toString());
    }
    return url.toString();
  }

  // Extract data from page via content script
  async extractFromPage(tabId, pageNum, query) {
    try {
      // Inject content script
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js']
      });

      // Get raw data from content script
      const response = await new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, { 
          action: 'extractRawData', 
          pageNum, 
          query 
        }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        });
      });

      if (response && response.rawData) {
        return await this.processAndStoreData(response.rawData, query);
      }
      return [];
    } catch (error) {
      console.error('Extract from page error:', error);
      throw error;
    }
  }

  // Centralized data processing - FIXED VERSION
  async processAndStoreData(rawDataArray, query) {
    // Get existing data to find the highest rank
    const result = await chrome.storage.local.get(['serpData']);
    const existingData = result.serpData || [];
    
    // Find the highest existing rank for continuous numbering
    const highestRank = existingData.length > 0 
      ? Math.max(...existingData.map(item => parseInt(item.rankPositions) || 0))
      : 0;
    
    const processedData = rawDataArray.map((rawItem, index) => {
      // Use continuous ranking: start from highestRank + 1
      const newRank = highestRank + index + 1;
      
      return {
        rankPositions: newRank, // Always use calculated continuous rank
        resultLink: rawItem.url || '',
        targetURL: this.extractDomain(rawItem.url || ''),
        resultType: this.determineResultType(rawItem.url, rawItem.title),
        rankType: this.determineRankType(rawItem.url),
        date: this.getCurrentFormattedDate(),
        examCode: this.extractExamCode(query, rawItem.url, rawItem.title),
        variation: this.determineVariation(query, rawItem.url, rawItem.title),
        location: rawItem.location || 'Desktop',
        title: rawItem.title || '',
        snippet: rawItem.snippet || '',
        keywords: rawItem.keywords || '', // ADD THIS LINE - Missing keywords mapping!
        query: query || '',
        extractedAt: new Date().toISOString(),
        id: this.generateId(),
        uniqueKey: this.generateUniqueKey(rawItem.url, query)
      };
    });
  
    await this.storeSERPData(processedData);
    return processedData;
  }

  // Data processing utilities
  determineResultType(url, title) {
    if (!url) return 'Main Site';
    
    const urlLower = url.toLowerCase();
    const titleLower = (title || '').toLowerCase();
    
    if (urlLower.includes('facebook.com') || urlLower.includes('twitter.com') || 
        urlLower.includes('linkedin.com') || urlLower.includes('instagram.com') ||
        urlLower.includes('youtube.com') || urlLower.includes('tiktok.com')) {
      return 'Social';
    }
    
    if (urlLower.includes('microsoft.com') || urlLower.includes('amazon.com') ||
        urlLower.includes('google.com') || urlLower.includes('apple.com') ||
        urlLower.includes('oracle.com') || urlLower.includes('cisco.com')) {
      return 'Vendor Site';
    }
    
    if (urlLower.includes('quora.com') || urlLower.includes('reddit.com') || urlLower.includes('github.com') ||
        urlLower.includes('stackoverflow.com') || urlLower.includes('answers.com') ||
        titleLower.includes('forum') || titleLower.includes('discussion')) {
      return 'Referral';
    }
    
    return 'Main Site';
  }

  determineRankType(url) {
    if (!url) return 'Competitor';
    
    const urlLower = url.toLowerCase();
    return SERPBackground.OUR_SITES.some(site => urlLower.includes(site)) ? 'Our Site' : 'Competitor';
  }

  extractExamCode(query, url, title = '') {
    const text = `${query} ${url} ${title}`.toLowerCase();
    
    const examPatterns = [
      /\b([a-z]{2,4}\s*[-\s]*\d{2,4})\b/gi,
      /\b([a-z]{2,4}\s*[a-z]{2,4}\s*c\d{2})\b/gi,
      /\b([a-z]{2,4}\s*\d{3})\b/gi,
      /\b(\d{3,4})\b/gi
    ];

    for (const pattern of examPatterns) {
      const matches = text.match(pattern);
      if (matches && matches.length > 0) {
        return matches[0].trim().replace(/[-\s]+/g, ' ').trim();
      }
    }
    
    return '';
  }

  determineVariation(query, url, title = '') {
    const originalQuery = query.toLowerCase().trim();
    
    if (originalQuery === 'legacy') return 'exam';
    
    const examPatterns = [
      /\b([a-z]{2,4}\s*[-\s]*\d{2,4})\b/gi,
      /\b([a-z]{2,4}\s*[a-z]{2,4}\s*c\d{2})\b/gi,
      /\b([a-z]{2,4}\s*\d{3})\b/gi,
      /\b(\d{3,4})\b/gi
    ];

    let foundExamCode = '';
    let examCodePosition = -1;

    for (const pattern of examPatterns) {
      pattern.lastIndex = 0;
      const match = pattern.exec(originalQuery);
      if (match) {
        foundExamCode = match[0];
        examCodePosition = match.index;
        break;
      }
    }

    if (!foundExamCode) return originalQuery || 'exam';

    const afterExamCode = originalQuery.substring(examCodePosition + foundExamCode.length).trim();
    if (afterExamCode) return afterExamCode;
    
    const beforeExamCode = originalQuery.substring(0, examCodePosition).trim();
    if (beforeExamCode) return beforeExamCode;
    
    return 'exam';
  }

  extractDomain(url) {
    try {
      return new URL(url).hostname.replace('www.', '');
    } catch {
      return '';
    }
  }

  getCurrentFormattedDate() {
    return new Date().toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  }

  generateUniqueKey(url, query) {
    const cleanUrl = (url || '').toLowerCase().replace(/[?#].*$/, '');
    const cleanQuery = (query || '').toLowerCase().trim();
    return `${cleanUrl}|${cleanQuery}`;
  }

  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  // Storage operations with continuous ranking - FIXED VERSION
  async storeSERPData(newData) {
    try {
      const result = await chrome.storage.local.get(['serpData']);
      let existingData = result.serpData || [];
      
      const existingKeys = new Set(existingData.map(item => item.uniqueKey));
      const newUniqueData = newData.filter(item => !existingKeys.has(item.uniqueKey));
      
      if (newUniqueData.length === 0) {
        console.log('No new unique results to store');
        return;
      }
      
      // Simply append new data to existing data (ranks are already calculated correctly)
      let combinedData = [...existingData, ...newUniqueData]
        .sort((a, b) => (parseInt(a.rankPositions) || 0) - (parseInt(b.rankPositions) || 0)) // Sort by rank position
        .slice(0, 1000);
      
      await chrome.storage.local.set({ serpData: combinedData });
      console.log(`Stored ${newUniqueData.length} new SERP results with continuous ranking`);
    } catch (error) {
      console.error('Error storing SERP data:', error);
      throw error;
    }
  }

  async getSERPData() {
    try {
      const result = await chrome.storage.local.get(['serpData']);
      return result.serpData || [];
    } catch (error) {
      console.error('Error getting SERP data:', error);
      return [];
    }
  }

  async clearSERPData() {
    try {
      await chrome.storage.local.remove(['serpData']);
    } catch (error) {
      console.error('Error clearing SERP data:', error);
      throw error;
    }
  }

  async exportToCSV() {
    try {
      const data = await this.getSERPData();
      
      if (data.length === 0) {
        throw new Error('No data to export');
      }
      
      // Sort data by Rank Position in ascending order
      const sortedData = data.sort((a, b) => {
        const rankA = parseInt(a.rankPositions) || 0;
        const rankB = parseInt(b.rankPositions) || 0;
        return rankA - rankB;
      });
      
      const headers = [
          'Rank Positions', 'Result Link', 'Target URL', 'Result Type', 
          'Rank Type', 'Date', 'Exam Code', 'Variation', 'Location', 'Keywords'
      ];
      
      const csvRows = [headers.join(',')];
      
      sortedData.forEach((item) => {
          const row = [
              item.rankPositions || '',
              `"${(item.resultLink || '').replace(/"/g, '""')}"`,
              `"${item.targetURL || ''}"`,
              item.resultType || '',
              item.rankType || '',
              item.date || '',
              item.examCode || '',
              item.variation || '',
              item.location || '',
              `"${(item.keywords || '').replace(/"/g, '""')}"`, // Add keywords column
          ];
          csvRows.push(row.join(','));
      });
      
      return csvRows.join('\n');
    } catch (error) {
      console.error('Error exporting to CSV:', error);
      throw error;
    }
  }
}

// Initialize background service
new SERPBackground();



