// Popup script - focused only on UI interactions and display logic
let extractedData = [];
let isMultiPageMode = false;
let isAutoMode = false;
let currentPageNumber = 1;
let isAutoExtracting = false;

// Get current active tab with error handling
async function getCurrentActiveTab() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        if (!tab || !tab.url || !tab.url.includes('google.com/search')) {
            const googleTabs = await chrome.tabs.query({ url: '*://www.google.com/search*' });
            if (googleTabs.length > 0) {
                return googleTabs[0];
            }
            throw new Error('❌ Please open a Google search results page first!');
        }
        
        return tab;
    } catch (error) {
        throw new Error('❌ Cannot access tabs. Please check extension permissions.');
    }
}

// Initialize popup
document.addEventListener('DOMContentLoaded', function() {
    loadStoredData();
    
    document.getElementById('extractBtn').addEventListener('click', extractData);
    document.getElementById('exportBtn').addEventListener('click', exportToCSV);
    document.getElementById('clearBtn').addEventListener('click', clearData);
    
    addEnhancedControls();
    
    window.addEventListener('resize', optimizeTableForFullScreen);
    optimizeTableForFullScreen();
    
    // Auto-extract after 1 second delay
    setTimeout(autoExtractOnOpen, 1000);
});

// Auto extraction on extension open
async function autoExtractOnOpen() {
    if (isAutoExtracting) return;
    
    try {
        const tab = await getCurrentActiveTab();
        
        if (!tab || !tab.url) {
            console.log('No active tab found, skipping auto-extraction');
            return;
        }
        
        // Always allow extraction even if not on Google search page
        isAutoExtracting = true;
        
        // Set auto mode
        const autoModeRadio = document.getElementById('autoMode');
        if (autoModeRadio) {
            autoModeRadio.checked = true;
            handleModeChange();
        }
        
        // Set target to 30 results
        const targetResultsSelect = document.getElementById('targetResults');
        if (targetResultsSelect) {
            targetResultsSelect.value = '30';
        }
        
        // Get query from URL or input field
        let query = '';
        if (tab.url.includes('google.com/search')) {
            query = getQueryFromURL(tab.url);
        } else {
            query = document.getElementById('searchQuery')?.value || '';
            // If no query in input field, try to get from storage
            if (!query) {
                const result = await chrome.storage.local.get(['lastQuery']);
                query = result.lastQuery || '';
            }
        }
        
        if (!query) {
            showStatus('⚠️ No search query found. Please enter a search term.', 'warning');
            isAutoExtracting = false;
            return;
        }
        
        // Save query for future use
        chrome.storage.local.set({ lastQuery: query });
        
        showStatus('🚀 Auto-extracting 30 results...', 'info');
        await extractAutoMode(query);
        showStatus('✅ Auto-extraction completed! 30 results fetched successfully.', 'success');
        
    } catch (error) {
        console.error('Auto-extraction error:', error);
        showStatus('ℹ️ Ready for manual extraction', 'info');
    } finally {
        isAutoExtracting = false;
    }
}

// Auto mode extraction with proper results logic
async function extractAutoMode(providedQuery = null) {
    // Cancel any ongoing extraction
    if (currentExtractionProcess) {
        currentExtractionProcess.abort = true;
        currentExtractionProcess = null;
    }
    
    // Create new extraction process tracker
    currentExtractionProcess = { abort: false };
    const thisProcess = currentExtractionProcess;
    
    const targetResults = parseInt(document.getElementById('targetResults')?.value || '30');
    
    try {
        // Reset current page number to always start from page 1
        currentPageNumber = 1;
        updatePageInfo();
        
        // Clear previous data before starting new extraction
        extractedData = [];
        displayResults([]);
        updateResultCount();
        
        showStatus('🤖 Auto-extracting results in background...', 'info');
        
        // Get query from provided parameter, current tab, or input field
        let query = providedQuery;
        if (!query) {
            const tab = await getCurrentActiveTab();
            if (tab.url.includes('google.com/search')) {
                query = getQueryFromURL(tab.url);
            } else {
                query = document.getElementById('searchQuery')?.value || '';
                // If still no query, try to get from storage
                if (!query) {
                    const result = await chrome.storage.local.get(['lastQuery']);
                    query = result.lastQuery || '';
                }
            }
        }
        
        if (!query) {
            throw new Error('No search query found. Please enter a search term.');
        }
        
        // Save query for future use
        chrome.storage.local.set({ lastQuery: query });
        
        // Check if this process was aborted
        if (thisProcess.abort) {
            console.log('Extraction process was aborted');
            return;
        }
        
        // Use the new background auto extraction
        const response = await chrome.runtime.sendMessage({
            action: 'autoExtractResults',
            query: query,
            targetResults: targetResults
        });
        
        // Check if this process was aborted
        if (thisProcess.abort) {
            console.log('Extraction process was aborted after API call');
            return;
        }
        
        if (response && response.results && response.results.length > 0) {
            extractedData = response.results;
            displayResults(extractedData);
            updateResultCount();
            showStatus(`✅ Auto-extraction completed! ${extractedData.length} results extracted.`, 'success');
        } else {
            throw new Error('No results found or extraction failed');
        }
        
    } catch (error) {
        // Only show error if this process wasn't aborted
        if (!thisProcess.abort) {
            console.error('Auto extraction error:', error);
            showStatus(error.message || '❌ Auto-extraction failed', 'error');
        }
    } finally {
        // Clear reference if this is still the current process
        if (currentExtractionProcess === thisProcess) {
            currentExtractionProcess = null;
        }
    }
}

// Target results change handler
function handleTargetResultsChange() {
    const targetResults = document.getElementById('targetResults');
    if (targetResults) {
        targetResults.addEventListener('change', function() {
            // Clear data when target results option changes
            clearData();
            
            // Update UI to reflect the change
            const resultsValue = targetResults.value;
            const autoModeLabel = document.querySelector('label.mode-option.auto span');
            if (autoModeLabel) {
                autoModeLabel.textContent = `🤖 Auto Next (${resultsValue} Results)`;
            }
            
            // If auto mode is selected, start extraction with new target
            if (isAutoMode) {
                extractAutoMode();
            }
        });
    }
}

// Event listener for page load to clear data and auto-start if needed
document.addEventListener('DOMContentLoaded', function() {
    console.log('Extension page loaded - clearing all data');
    
    // Clear ALL chrome storage data completely
    chrome.storage.local.clear(function() {
        console.log('All chrome storage cleared on page load');
        
        // Clear UI data
        extractedData = [];
        displayResults([]);
        updateResultCount();
        currentPageNumber = 1;
        updatePageInfo();
        
        // Also notify background script to clear its data
        chrome.runtime.sendMessage({
            action: 'clearSERPData'
        });
        
        console.log('UI data cleared and reset');
    });
    
    // Setup event listeners
    setupEventListeners();
    
    // Auto-start extraction if auto mode is selected (with delay to ensure clearing completes)
    setTimeout(() => {
        const autoModeRadio = document.getElementById('autoMode');
        if (autoModeRadio && autoModeRadio.checked) {
            console.log('Auto mode detected - starting extraction');
            extractAutoMode();
        }
    }, 800);
});

// Clear data function
async function clearData() {
    try {
        // Cancel any ongoing extraction
        if (currentExtractionProcess) {
            currentExtractionProcess.abort = true;
            currentExtractionProcess = null;
        }
        
        // Clear local data
        extractedData = [];
        displayResults([]);
        updateResultCount();
        
        // Reset page number
        currentPageNumber = 1;
        updatePageInfo();
        
        // Clear backend data
        await chrome.runtime.sendMessage({ action: 'clearSERPData' });
        
        showStatus('🧹 Data cleared successfully!', 'success');
    } catch (error) {
        console.error('Clear data error:', error);
        showStatus(error.message || '❌ Failed to clear data', 'error');
    }
}

// Export CSV function with data clearing
async function exportCSV() {
    try {
        if (!extractedData || extractedData.length === 0) {
            throw new Error('No data to export');
        }
        
        showStatus('📤 Preparing CSV export...', 'info');
        
        // Generate CSV content
        const csvContent = generateCSV(extractedData);
        
        // Create download link
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `search_results_${new Date().toISOString().slice(0, 10)}.csv`);
        link.style.display = 'none';
        
        // Trigger download
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        showStatus('✅ CSV exported successfully!', 'success');
        
        // Clear data after export
        setTimeout(() => {
            clearData();
        }, 1000);
        
    } catch (error) {
        console.error('Export error:', error);
        showStatus(error.message || '❌ Export failed', 'error');
    }
}

// Event listener for page load to clear data
document.addEventListener('DOMContentLoaded', function() {
    // Clear data on page load/refresh
    extractedData = [];
    displayResults([]);
    updateResultCount();
    
    // Setup event listeners
    setupEventListeners();
});

// Target results change handler
function handleTargetResultsChange() {
    const targetResults = document.getElementById('targetResults');
    if (targetResults) {
        targetResults.addEventListener('change', function() {
            // Clear data when target results option changes
            clearData();
            
            // Update UI to reflect the change
            const resultsValue = targetResults.value;
            const autoModeLabel = document.querySelector('label.mode-option.auto span');
            if (autoModeLabel) {
                autoModeLabel.textContent = `🤖 Auto Next (${resultsValue} Results)`;
            }
        });
    }
}

// Add refresh button functionality
function setupRefreshButton() {
    const refreshButton = document.getElementById('refreshButton');
    if (!refreshButton) {
        // Create refresh button if it doesn't exist
        const controlsDiv = document.querySelector('.controls');
        if (controlsDiv) {
            const refreshBtn = document.createElement('button');
            refreshBtn.id = 'refreshButton';
            refreshBtn.innerHTML = '🔄 Refresh';
            refreshBtn.className = 'refresh-btn';
            refreshBtn.style.marginLeft = '10px';
            controlsDiv.appendChild(refreshBtn);
            
            // Add event listener
            refreshBtn.addEventListener('click', function() {
                console.log('Manual refresh clicked');
                location.reload();
            });
        }
    }
}

// Add this to setupEventListeners function
function setupEventListeners() {
    // Existing event listeners...
    
    // Add refresh button
    setupRefreshButton();
    
    // Add target results change handler
    handleTargetResultsChange();
    
    // Other event listeners...
    
    // Add beforeunload event to clear data when navigating away
    window.addEventListener('beforeunload', function() {
        console.log('Page unloading - clearing data');
        chrome.storage.local.clear();
    });
}

// Clear data function update
async function clearData() {
    try {
        if (confirm('Are you sure you want to clear all extracted data?')) {
            await chrome.runtime.sendMessage({ action: 'clearSERPData' });
            extractedData = [];
            displayResults([]);
            updateResultCount();
            showStatus('✅ All data cleared successfully', 'success');
            
            // Reset page number
            currentPageNumber = 1;
            updatePageInfo();
            updateQuickInfo();
            
            // Auto-extract after clearing if auto mode is selected
            const autoModeRadio = document.getElementById('autoMode');
            if (autoModeRadio && autoModeRadio.checked) {
                setTimeout(autoExtractOnOpen, 1000);
            }
        }
    } catch (error) {
        console.error('Clear data error:', error);
        showStatus('❌ Failed to clear data', 'error');
    }
}

// Full screen table optimization
function optimizeTableForFullScreen() {
    const tableContainer = document.querySelector('.table-container');
    if (tableContainer) {
        const windowHeight = window.innerHeight;
        const headerHeight = document.querySelector('.header')?.offsetHeight || 0;
        const controlsHeight = document.querySelector('.controls')?.offsetHeight || 0;
        const enhancedControlsHeight = 200;
        
        const availableHeight = windowHeight - headerHeight - controlsHeight - enhancedControlsHeight - 100;
        tableContainer.style.height = `${Math.max(300, availableHeight)}px`;
    }
}

// Add enhanced UI controls - now uses existing HTML structure
function addEnhancedControls() {
    // Add event listeners for mode selection
    document.querySelectorAll('input[name="extractMode"]').forEach(radio => {
        radio.addEventListener('change', handleModeChange);
    });
    
    // Add hover effects for mode labels
    document.querySelectorAll('.mode-option').forEach(label => {
        label.addEventListener('mouseenter', function() {
            this.style.transform = 'translateY(-2px)';
            this.style.boxShadow = '0 4px 8px rgba(0,0,0,0.1)';
        });
        label.addEventListener('mouseleave', function() {
            this.style.transform = 'translateY(0)';
            this.style.boxShadow = 'none';
        });
    });
    
    // Add event listeners for navigation buttons
    const nextExtractBtn = document.getElementById('nextExtractBtn');
    const prevExtractBtn = document.getElementById('prevExtractBtn');
    const nextPageBtn = document.getElementById('nextPageBtn');
    const prevPageBtn = document.getElementById('prevPageBtn');
    
    if (nextExtractBtn) nextExtractBtn.addEventListener('click', quickNextPageExtract);
    if (prevExtractBtn) prevExtractBtn.addEventListener('click', quickPrevPageExtract);
    if (nextPageBtn) nextPageBtn.addEventListener('click', goToNextPageAndExtract);
    if (prevPageBtn) prevPageBtn.addEventListener('click', goToPreviousPage);
    
    handleModeChange();
}

// Handle mode changes
function handleModeChange() {
    const selectedMode = document.querySelector('input[name="extractMode"]:checked')?.value || 'auto';
    const pageNav = document.getElementById('pageNavigation');
    const autoSettings = document.getElementById('autoModeSettings');
    const quickNav = document.getElementById('quickNavigation');
    const extractBtn = document.getElementById('extractBtn');
    
    // Hide all panels first
    if (pageNav) pageNav.style.display = 'none';
    if (autoSettings) autoSettings.style.display = 'none';
    if (quickNav) quickNav.style.display = 'none';
    
    switch(selectedMode) {
        case 'single':
            isMultiPageMode = false;
            isAutoMode = false;
            if (quickNav) quickNav.style.display = 'block';
            if (extractBtn) extractBtn.textContent = '📄 Extract Current Page';
            break;
            
        case 'manual':
            isMultiPageMode = true;
            isAutoMode = false;
            if (pageNav) pageNav.style.display = 'block';
            if (quickNav) quickNav.style.display = 'block';
            if (extractBtn) extractBtn.textContent = '📊 Extract & Add to Collection';
            updatePageInfo();
            updateQuickInfo();
            break;
            
        case 'auto':
            isMultiPageMode = false;
            isAutoMode = true;
            if (autoSettings) autoSettings.style.display = 'block';
            if (quickNav) quickNav.style.display = 'block';
            if (extractBtn) extractBtn.textContent = '🤖 Auto Extract (Multi-Page)';
            updateQuickInfo();
            break;
    }
}

// Main extraction function - delegates to background
async function extractData() {
    try {
        showStatus('🔄 Starting extraction...', 'info');
        
        if (isAutoMode) {
            await extractAutoMode();
        } else {
            await extractSinglePage();
        }
        
    } catch (error) {
        console.error('Extraction error:', error);
        showStatus(error.message || '❌ Extraction failed', 'error');
    }
}

// Auto mode extraction with proper 30 results logic
async function extractAutoMode() {
    const targetResults = parseInt(document.getElementById('targetResults')?.value || '30');
    const pageDelay = parseInt(document.getElementById('pageDelay')?.value || '5') * 1000;
    
    try {
        showStatus('🤖 Auto-extracting results in background...', 'info');
        
        // Get query from current tab or input field
        const tab = await getCurrentActiveTab();
        const query = getQueryFromURL(tab.url);
        
        // Use the new background auto extraction
        const response = await chrome.runtime.sendMessage({
            action: 'autoExtractResults',
            query: query,
            targetResults: targetResults
        });
        
        if (response && response.results && response.results.length > 0) {
            extractedData = response.results;
            displayResults(extractedData);
            updateResultCount();
            showStatus(`✅ Auto-extraction completed! ${extractedData.length} results extracted.`, 'success');
        } else {
            throw new Error('No results found or extraction failed');
        }
        
    } catch (error) {
        console.error('Auto extraction error:', error);
        showStatus(error.message || '❌ Auto-extraction failed', 'error');
    }
}

// Single page extraction
async function extractSinglePage() {
    try {
        const tab = await getCurrentActiveTab();
        const query = getQueryFromURL(tab.url);
        
        showStatus('📄 Extracting current page...', 'info');
        
        // Use original extraction method for compatibility
        const response = await chrome.runtime.sendMessage({
            action: 'extractFromPage',
            tabId: tab.id,
            pageNum: 1,
            query: query
        });
        
        if (response && response.results) {
            extractedData = response.results;
            displayResults(extractedData);
            updateResultCount();
            showStatus(`✅ Extracted ${extractedData.length} results from current page`, 'success');
        } else {
            throw new Error('No results found on current page');
        }
        
    } catch (error) {
        console.error('Single page extraction error:', error);
        showStatus(error.message || '❌ Single page extraction failed', 'error');
    }
}

// Quick navigation functions
async function quickNextPageExtract() {
    const nextBtn = document.getElementById('nextExtractBtn');
    const prevBtn = document.getElementById('prevExtractBtn');
    const statusInfo = document.getElementById('quickStatusInfo');
    
    if (!nextBtn || !prevBtn || !statusInfo) return;
    
    nextBtn.disabled = true;
    prevBtn.disabled = true;
    nextBtn.innerHTML = '<span style="margin-right: 6px;">⏳</span><span>Processing...</span>';
    statusInfo.textContent = 'Navigating...';
    
    try {
        const tab = await getCurrentActiveTab();
        const query = getQueryFromURL(tab.url);
        
        const url = new URL(tab.url);
        const currentStart = parseInt(url.searchParams.get('start') || '0');
        const nextStart = currentStart + 10;
        const nextPage = Math.floor(nextStart / 10) + 1;
        
        statusInfo.textContent = `Extracting page ${nextPage}...`;
        
        // Use hidden tab extraction
        const response = await chrome.runtime.sendMessage({
            action: 'extractFromHiddenTab',
            pageNum: nextPage,
            query: query
        });
        
        if (response && response.results) {
            if (!isMultiPageMode) {
                extractedData = response.results;
            } else {
                extractedData = extractedData.concat(response.results);
            }
            displayResults(extractedData);
            updateResultCount();
            
            // Update UI to show next page number but don't actually navigate
            currentPageNumber = nextPage;
            updatePageInfo();
            updateQuickInfo();
        }
        
        statusInfo.textContent = 'Completed!';
        showStatus(`✅ Page ${nextPage} extracted successfully!`, 'success');
        
    } catch (error) {
        console.error('Quick next page extract error:', error);
        statusInfo.textContent = 'Error!';
        showStatus(error.message || '❌ Extraction failed', 'error');
    } finally {
        nextBtn.disabled = false;
        prevBtn.disabled = false;
        nextBtn.innerHTML = '<span style="margin-right: 6px;">➡️</span><span>Next + Extract</span>';
        setTimeout(() => {
            statusInfo.textContent = 'Ready';
        }, 2000);
    }
}

async function quickPrevPageExtract() {
    const nextBtn = document.getElementById('nextExtractBtn');
    const prevBtn = document.getElementById('prevExtractBtn');
    const statusInfo = document.getElementById('quickStatusInfo');
    
    if (!nextBtn || !prevBtn || !statusInfo) return;
    
    nextBtn.disabled = true;
    prevBtn.disabled = true;
    prevBtn.innerHTML = '<span style="margin-right: 6px;">⏳</span><span>Processing...</span>';
    statusInfo.textContent = 'Navigating...';
    
    try {
        const tab = await getCurrentActiveTab();
        const query = getQueryFromURL(tab.url);
        
        const url = new URL(tab.url);
        const currentStart = parseInt(url.searchParams.get('start') || '0');
        const prevStart = Math.max(0, currentStart - 10);
        const prevPage = Math.floor(prevStart / 10) + 1;
        
        if (prevStart < 0) {
            throw new Error('Already on first page');
        }
        
        statusInfo.textContent = `Going to page ${prevPage}...`;
        
        await goToPreviousPage();
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        currentPageNumber = prevPage;
        updatePageInfo();
        updateQuickInfo();
        
        statusInfo.textContent = 'Extracting data...';
        
        const response = await chrome.runtime.sendMessage({
            action: 'extractFromPage',
            tabId: tab.id,
            pageNum: prevPage,
            query: query
        });
        
        if (response && response.results) {
            if (!isMultiPageMode) {
                extractedData = response.results;
            } else {
                extractedData = extractedData.concat(response.results);
            }
            displayResults(extractedData);
            updateResultCount();
        }
        
        statusInfo.textContent = 'Completed!';
        showStatus(`✅ Page ${prevPage} extracted successfully!`, 'success');
        
    } catch (error) {
        console.error('Quick prev page extract error:', error);
        statusInfo.textContent = 'Error!';
        showStatus(error.message || '❌ Navigation + extraction failed', 'error');
    } finally {
        nextBtn.disabled = false;
        prevBtn.disabled = false;
        prevBtn.innerHTML = '<span style="margin-right: 6px;">⬅️</span><span>Prev + Extract</span>';
        setTimeout(() => {
            statusInfo.textContent = 'Ready';
        }, 2000);
    }
}

// Navigation functions
async function goToNextPageAndExtract() {
    try {
        const tab = await getCurrentActiveTab();
        const query = getQueryFromURL(tab.url);
        
        showStatus('🔄 Navigating to next page...', 'info');
        
        await navigateToNextPage(tab.id, currentPageNumber + 1);
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        currentPageNumber++;
        updatePageInfo();
        
        showStatus('📊 Extracting from new page...', 'info');
        
        const response = await chrome.runtime.sendMessage({
            action: 'extractFromPage',
            tabId: tab.id,
            pageNum: currentPageNumber,
            query: query
        });
        
        if (response && response.results) {
            extractedData = extractedData.concat(response.results);
            displayResults(extractedData);
            updateResultCount();
            showStatus(`✅ Page ${currentPageNumber} extracted successfully!`, 'success');
        }
        
    } catch (error) {
        console.error('Next page extract error:', error);
        showStatus(error.message || '❌ Next page extraction failed', 'error');
    }
}

async function goToPreviousPage() {
    try {
        const tab = await getCurrentActiveTab();
        
        if (currentPageNumber <= 1) {
            showStatus('⚠️ Already on first page', 'warning');
            return;
        }
        
        showStatus('🔄 Navigating to previous page...', 'info');
        
        const url = new URL(tab.url);
        const currentStart = parseInt(url.searchParams.get('start') || '0');
        const prevStart = Math.max(0, currentStart - 10);
        
        url.searchParams.set('start', prevStart.toString());
        
        await chrome.tabs.update(tab.id, { url: url.toString() });
        
        currentPageNumber = Math.max(1, currentPageNumber - 1);
        updatePageInfo();
        
        showStatus(`✅ Navigated to page ${currentPageNumber}`, 'success');
        
    } catch (error) {
        console.error('Previous page navigation error:', error);
        showStatus(error.message || '❌ Previous page navigation failed', 'error');
    }
}

async function navigateToNextPage(tabId, pageNumber) {
    try {
        const tab = await chrome.tabs.get(tabId);
        const url = new URL(tab.url);
        
        const newStart = (pageNumber - 1) * 10;
        url.searchParams.set('start', newStart.toString());
        
        await chrome.tabs.update(tabId, { url: url.toString() });
        
        return new Promise((resolve) => {
            const listener = (tabId, changeInfo) => {
                if (changeInfo.status === 'complete') {
                    chrome.tabs.onUpdated.removeListener(listener);
                    resolve();
                }
            };
            chrome.tabs.onUpdated.addListener(listener);
        });
        
    } catch (error) {
        console.error('Navigation error:', error);
        throw error;
    }
}

// Update functions
function updatePageInfo() {
    const pageInfo = document.getElementById('currentPageInfo');
    const progressInfo = document.getElementById('progressInfo');
    
    if (pageInfo) pageInfo.textContent = `Current: Page ${currentPageNumber}`;
    if (progressInfo) progressInfo.textContent = `Progress: ${extractedData.length}/30`;
}

function updateQuickInfo() {
    const quickPageInfo = document.getElementById('quickCurrentPageInfo');
    const quickProgressInfo = document.getElementById('quickProgressInfo');
    
    if (quickPageInfo) quickPageInfo.textContent = `Page: ${currentPageNumber}`;
    if (quickProgressInfo) quickProgressInfo.textContent = `Results: ${extractedData.length}/30`;
}

function updateResultCount() {
    const resultCount = document.getElementById('resultCount');
    if (resultCount) {
        resultCount.textContent = `📊 ${extractedData.length} results`;
    }
}

// Helper function to get badge class based on content and type
function getBadgeClass(text, type) {
    if (!text) return 'badge';
    
    const lowerText = text.toLowerCase();
    
    if (type === 'resultType') {
        switch(lowerText) {
            case 'main site': return 'badge badge-result-main';
            case 'competitor': return 'badge badge-result-competitor';
            case 'referral': return 'badge badge-result-referral';
            default: return 'badge badge-result-other';
        }
    } else if (type === 'rankType') {
        switch(lowerText) {
            case 'our site': return 'badge badge-rank-our';
            case 'competitor': return 'badge badge-rank-competitor';
            case 'main site': return 'badge badge-rank-main';
            default: return 'badge badge-rank-other';
        }
    } else if (type === 'examCode') {
        return 'badge badge-exam';
    } else if (type === 'variation') {
        return 'badge badge-variation';
    }
    
    return 'badge';
}

// Display results with proper CSS classes instead of inline styles
function displayResults(data) {
    const resultsBody = document.getElementById('resultsBody');
    
    if (!resultsBody) return;
    
    if (!data || data.length === 0) {
        resultsBody.innerHTML = `
            <tr>
                <td colspan="10" style="text-align: center; padding: 40px; color: #666;">
                    <div style="font-size: 18px; margin-bottom: 10px;">🚀</div>
                    <div style="font-size: 16px; margin-bottom: 8px;">Ready to Extract!</div>
                    <div style="font-size: 13px; opacity: 0.8;">
                        1. Navigate to Google search results<br>
                        2. Select extraction mode<br>
                        3. Click extract to get started
                    </div>
                </td>
            </tr>
        `;
        return;
    }
    
    // Clear existing rows
    resultsBody.innerHTML = '';
    
    // Create data rows with CSS classes
    data.forEach((item, index) => {
        const row = resultsBody.insertRow();
        
        const values = [
            item.rankPositions || '',
            item.resultLink || '',
            item.targetURL || '',
            item.resultType || '',
            item.rankType || '',
            item.date || '',
            item.examCode || '',
            item.variation || '',
            item.location || '',
            item.keywords || '',
        ];
        
        values.forEach((value, cellIndex) => {
            const td = row.insertCell();
            
            // Apply CSS classes for badges
            if (cellIndex === 3) { // Result Type column
                const span = document.createElement('span');
                span.className = getBadgeClass(value, 'resultType');
                span.textContent = value;
                td.appendChild(span);
            } else if (cellIndex === 4) { // Rank Type column
                const span = document.createElement('span');
                span.className = getBadgeClass(value, 'rankType');
                span.textContent = value;
                td.appendChild(span);
            } else if (cellIndex === 6) { // Date column
                td.textContent = value;
            } else if (cellIndex === 7) { // Exam Code column
                const span = document.createElement('span');
                span.className = getBadgeClass(value, 'examCode');
                span.textContent = value;
                td.appendChild(span);
            } else if (cellIndex === 8) { // Variation column
                const span = document.createElement('span');
                span.className = getBadgeClass(value, 'variation');
                span.textContent = value;
                td.appendChild(span);
            } else {
                td.textContent = value;
            }
            
            td.title = value; // Tooltip for full text
            
            // Apply CSS classes for specific columns
            if (cellIndex === 0) { // Rank column
                td.className = 'rank-cell';
            } else if (cellIndex === 1 || cellIndex === 2) { // Link columns
                td.className = 'link-cell';
            }
        });
    });
    
    updateResultCount();
}

// Export to CSV - delegates to background
async function exportToCSV() {
    try {
        showStatus('📊 Exporting to CSV...', 'info');
        
        const response = await chrome.runtime.sendMessage({ action: 'exportToCSV' });
        
        if (response && response.csvData) {
            const blob = new Blob([response.csvData], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = url;
            a.download = `serp-data-${new Date().toISOString().split('T')[0]}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            showStatus('✅ CSV exported successfully!', 'success');
        } else {
            throw new Error('No data to export');
        }
        
    } catch (error) {
        console.error('Export error:', error);
        showStatus(error.message || '❌ Export failed', 'error');
    }
}

// Clear data - delegates to background
async function clearData() {
    try {
        const response = await chrome.runtime.sendMessage({ action: 'clearSERPData' });
        
        if (response && response.success) {
            extractedData = [];
            displayResults([]);
            updateResultCount();
            showStatus('✅ All data cleared successfully!', 'success');
        } else {
            throw new Error('Failed to clear data');
        }
        
    } catch (error) {
        console.error('Clear data error:', error);
        showStatus(error.message || '❌ Clear data failed', 'error');
    }
}

// Load stored data - delegates to background
async function loadStoredData() {
    try {
        const data = await chrome.runtime.sendMessage({ action: 'getSERPData' });
        
        if (data && Array.isArray(data)) {
            extractedData = data;
            displayResults(extractedData);
            updateResultCount();
            
            if (data.length > 0) {
                showStatus(`📊 Loaded ${data.length} stored results`, 'info');
            }
        }
        
    } catch (error) {
        console.error('Load data error:', error);
        showStatus('⚠️ Could not load stored data', 'warning');
    }
}

// Utility functions
function showStatus(message, type = 'info') {
    const statusElement = document.getElementById('status');
    if (!statusElement) return;
    
    statusElement.textContent = message;
    statusElement.className = `status ${type}`;
    statusElement.style.display = 'block';
    
    if (type === 'success' || type === 'error') {
        setTimeout(() => {
            statusElement.textContent = 'Ready';
            statusElement.className = 'status info';
        }, 5000);
    }
}

function getQueryFromURL(url) {
    try {
        const urlObj = new URL(url);
        const query = urlObj.searchParams.get('q');
        return query ? decodeURIComponent(query) : '';
    } catch (error) {
        console.error('Error getting query from URL:', error);
        return '';
    }
}


