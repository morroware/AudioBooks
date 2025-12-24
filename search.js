/**
 * search-improved.js - Book-focused search with covers and grid layout
 */

import { showLoading, hideLoading, showToast } from './utils.js';
import { getBandConfig } from './bandConfig.js';
import { storage } from './storage.js';

// Search state
let currentPage = 1;
const resultsPerPage = 24; // More results for grid
let totalResults = 0;
let currentView = 'grid'; // Default to grid view
let currentResults = [];
let activeFilters = new Set();
let lastSearchParams = null;
let isLoadingMore = false;

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, retries = MAX_RETRIES) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            console.warn(`Fetch attempt ${i + 1} failed:`, error.message);
            if (i === retries - 1) {
                throw error;
            }
            await sleep(RETRY_DELAY * (i + 1));
        }
    }
}

export async function searchShows(page = 1, append = false) {
    const searchQueryInput = document.getElementById('searchQuery');
    const yearFromInput = document.getElementById('yearFrom');
    const yearToInput = document.getElementById('yearTo');
    const bandSelector = document.getElementById('bandSelector');

    const query = searchQueryInput ? searchQueryInput.value.trim() : '';
    const yearFrom = yearFromInput ? yearFromInput.value : '';
    const yearTo = yearToInput ? yearToInput.value : '';
    const band = bandSelector ? bandSelector.value : 'AllLibriVox';
    
    lastSearchParams = { query, yearFrom, yearTo, band, page };
    
    if (!append) {
        showLoading();
    }
    currentPage = page;
    
    try {
        const config = getBandConfig(band);
        let baseQuery = config.query || 'collection:(librivoxaudio)';
        const bandTitle = config.title;
        
        // Handle different search types
        if (band === 'Author_Search' && query) {
            baseQuery = `collection:(librivoxaudio) AND creator:(${query})`;
        } else if (band === 'Title_Search' && query) {
            baseQuery = `collection:(librivoxaudio) AND title:(${query})`;
        } else if (band === 'Custom' && query) {
            baseQuery = `collection:(librivoxaudio) AND (${query})`;
        } else if (baseQuery && query) {
            baseQuery += ` AND (${query})`;
        }
        
        // Year filtering
        if (yearFrom || yearTo) {
            const fromYear = yearFrom || '1700';
            const toYear = yearTo || '2024';
            baseQuery += ` AND year:[${fromYear} TO ${toYear}]`;
        } else if (config.yearRange) {
            baseQuery += ` AND year:[${config.yearRange[0]} TO ${config.yearRange[1]}]`;
        }
        
        // Apply special filters
        activeFilters.forEach(filter => {
            if (filter === 'solo') {
                baseQuery += ' AND subject:(solo)';
            } else if (filter === 'complete') {
                baseQuery += ' AND subject:(complete)';
            } else if (filter === 'english') {
                baseQuery += ' AND language:(English)';
            }
        });
        
        document.title = `${bandTitle} - LibriVox Audiobook Explorer`;

        const url = `https://archive.org/advancedsearch.php?` +
            `q=${encodeURIComponent(baseQuery)}` +
            `&fl[]=identifier,title,year,creator,date,language,runtime,description,subject` +
            `&sort[]=downloads+desc&output=json` +
            `&rows=${resultsPerPage}&page=${page}`;
        
        const data = await fetchWithRetry(url);
        
        hideLoading();
        const resultsDiv = document.getElementById('results');
        
        if (!data.response || !data.response.docs || data.response.docs.length === 0) {
            if (resultsDiv && !append) {
                resultsDiv.innerHTML = `
                    <div class="col-span-full text-center py-16 animate-fade-in">
                        <div class="inline-flex items-center justify-center w-20 h-20 bg-gray-800 rounded-full mb-6">
                            <svg class="w-10 h-10 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                            </svg>
                        </div>
                        <h3 class="text-xl font-bold text-gray-300 mb-2">No audiobooks found</h3>
                        <p class="text-gray-500">Try adjusting your search criteria or filters</p>
                    </div>`;
            }
            updatePagination(0);
            isLoadingMore = false;
            return;
        }
        
        totalResults = data.response.numFound;
        
        if (append) {
            currentResults = [...currentResults, ...data.response.docs];
        } else {
            currentResults = data.response.docs;
        }
        
        if (resultsDiv) {
            updateResultsDisplay(append);
        }
        
        updatePagination();
        isLoadingMore = false;
        
    } catch (error) {
        console.error('Search error:', error);
        hideLoading();
        isLoadingMore = false;
        handleSearchError(error);
    }
}

function handleSearchError(error) {
    const resultsDiv = document.getElementById('results');
    if (!resultsDiv) return;
    
    const errorMessage = error.message || 'Unknown error';
    const isNetworkError = errorMessage.includes('fetch') || errorMessage.includes('network');
    
    resultsDiv.innerHTML = `
        <div class="col-span-full text-center py-16 animate-fade-in">
            <div class="inline-flex items-center justify-center w-20 h-20 bg-red-900 bg-opacity-30 rounded-full mb-6">
                <svg class="w-10 h-10 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
            </div>
            <h3 class="text-xl font-bold text-red-400 mb-2">
                ${isNetworkError ? 'Connection Problem' : 'Search Error'}
            </h3>
            <p class="text-gray-400 mb-6 max-w-md mx-auto">
                ${isNetworkError 
                    ? 'Unable to reach Archive.org. Please check your connection.' 
                    : 'An error occurred while searching. This may be temporary.'}
            </p>
            <button 
                onclick="window.retryLastSearch()" 
                class="px-6 py-3 bg-gradient-to-r from-sky-600 to-cyan-600 hover:from-sky-700 hover:to-cyan-700 text-white font-semibold rounded-xl transition-all transform hover:scale-105 shadow-lg">
                Try Again
            </button>
        </div>`;
}

window.retryLastSearch = function() {
    if (lastSearchParams) {
        const { query, yearFrom, yearTo, band, page } = lastSearchParams;
        
        const searchQueryInput = document.getElementById('searchQuery');
        const yearFromInput = document.getElementById('yearFrom');
        const yearToInput = document.getElementById('yearTo');
        const bandSelector = document.getElementById('bandSelector');
        
        if (searchQueryInput) searchQueryInput.value = query;
        if (yearFromInput) yearFromInput.value = yearFrom;
        if (yearToInput) yearToInput.value = yearTo;
        if (bandSelector) bandSelector.value = band;
        
        showToast('Retrying search...', 'info');
        searchShows(page);
    }
};

function updateResultsDisplay(append = false) {
    const resultsDiv = document.getElementById('results');
    if (!resultsDiv) return;
    
    // Always use grid view for books
    resultsDiv.className = 'books-grid';
    
    const newHTML = currentResults.map((show, index) => {
        const card = createBookCard(show);
        const delay = append ? 0 : index * 0.03;
        return `<div class="animate-fade-in" style="animation-delay: ${delay}s">${card}</div>`;
    }).join('');
    
    if (append) {
        resultsDiv.insertAdjacentHTML('beforeend', newHTML);
    } else {
        resultsDiv.innerHTML = newHTML;
    }
}

function createBookCard(book) {
    const author = book.creator || 'Unknown Author';
    const title = book.title || 'Untitled Audiobook';
    const year = book.year || book.date || '';
    const language = book.language || 'English';
    
    // Get cover image from Archive.org
    const coverUrl = `https://archive.org/services/img/${book.identifier}`;
    
    // Extract runtime if available
    const runtime = book.runtime || '';
    
    // Get subjects for genre tags
    const subjects = Array.isArray(book.subject) ? book.subject : 
                    typeof book.subject === 'string' ? [book.subject] : [];
    const genreTags = subjects
        .slice(0, 2)
        .filter(s => s && s.length < 20)
        .map(s => s.charAt(0).toUpperCase() + s.slice(1));
    
    return `
        <div class="book-card" onclick="openPlayerPage('${book.identifier}')">
            <div class="book-cover-wrapper">
                <img src="${coverUrl}" 
                     alt="${title}" 
                     class="book-cover"
                     loading="lazy"
                     onerror="this.src='data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 200 300\'%3E%3Crect fill=\'%23374151\' width=\'200\' height=\'300\'/%3E%3Ctext x=\'50%25\' y=\'45%25\' dominant-baseline=\'middle\' text-anchor=\'middle\' fill=\'%239ca3af\' font-size=\'48\' font-family=\'system-ui\'%3E%F0%9F%93%96%3C/text%3E%3Ctext x=\'50%25\' y=\'60%25\' dominant-baseline=\'middle\' text-anchor=\'middle\' fill=\'%236b7280\' font-size=\'12\' font-family=\'system-ui\'%3ENo Cover%3C/text%3E%3C/svg%3E'">
                <div class="book-overlay">
                    <div class="play-button">
                        <svg class="w-8 h-8" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z"/>
                        </svg>
                    </div>
                    <div class="overlay-info">
                        <div class="overlay-author">${author}</div>
                        ${runtime ? `<div class="overlay-runtime">
                            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            ${runtime}
                        </div>` : ''}
                    </div>
                </div>
            </div>
            <div class="book-info">
                <h3 class="book-title" title="${title}">${title}</h3>
                <p class="book-author">${author}</p>
                <div class="book-meta">
                    ${year ? `<span class="meta-badge year-badge">${year}</span>` : ''}
                    ${language !== 'English' ? `<span class="meta-badge lang-badge">${language}</span>` : ''}
                    ${genreTags.length > 0 ? genreTags.map(tag => 
                        `<span class="meta-badge genre-badge">${tag}</span>`
                    ).join('') : ''}
                </div>
            </div>
        </div>
    `;
}

function updatePagination(customTotal = null) {
    const total = customTotal !== null ? customTotal : totalResults;
    const totalPages = Math.ceil(total / resultsPerPage);
    const pageInfo = document.getElementById('pageInfo');
    const prevPage = document.getElementById('prevPage');
    const nextPage = document.getElementById('nextPage');

    if (pageInfo) {
        if (total === 0) {
            pageInfo.textContent = '';
        } else {
            const showing = Math.min(currentPage * resultsPerPage, total);
            pageInfo.textContent = `Showing ${showing} of ${total.toLocaleString()} audiobooks`;
        }
    }
    if (prevPage) prevPage.disabled = currentPage === 1;
    if (nextPage) nextPage.disabled = currentPage === totalPages || totalPages === 0;
}

export function changePage(delta) {
    searchShows(currentPage + delta);
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

export function openPlayerPage(identifier) {
    if (!identifier) {
        showToast('Invalid audiobook identifier', 'error');
        return;
    }
    window.location.href = `player.html?id=${identifier}`;
}

// Infinite scroll setup
function setupInfiniteScroll() {
    let observer;
    
    const sentinel = document.createElement('div');
    sentinel.id = 'scroll-sentinel';
    sentinel.className = 'h-10';
    
    const resultsDiv = document.getElementById('results');
    if (resultsDiv && resultsDiv.parentElement) {
        resultsDiv.parentElement.appendChild(sentinel);
    }
    
    observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting && !isLoadingMore && currentResults.length < totalResults) {
                isLoadingMore = true;
                const nextPage = currentPage + 1;
                const totalPages = Math.ceil(totalResults / resultsPerPage);
                
                if (nextPage <= totalPages) {
                    showToast('Loading more...', 'info', 1000);
                    searchShows(nextPage, true);
                }
            }
        });
    }, {
        rootMargin: '200px'
    });
    
    observer.observe(sentinel);
    
    return () => {
        if (observer) observer.disconnect();
    };
}

export function initSearchPage() {
    console.log('Initializing audiobook search page...');
    
    const searchButton = document.getElementById('searchButton');
    const searchQuery = document.getElementById('searchQuery');
    const yearFrom = document.getElementById('yearFrom');
    const yearTo = document.getElementById('yearTo');
    const bandSelector = document.getElementById('bandSelector');
    const prevPage = document.getElementById('prevPage');
    const nextPage = document.getElementById('nextPage');

    // Set default year range
    if (yearFrom && yearTo) {
        const savedBand = storage.getSelectedBand();
        const config = getBandConfig(savedBand);
        if (config && config.yearRange) {
            yearFrom.value = config.yearRange[0];
            yearTo.value = config.yearRange[1];
        }
    }

    if (searchButton) {
        searchButton.addEventListener('click', (e) => {
            e.preventDefault();
            searchShows(1);
        });
    }

    if (searchQuery) {
        searchQuery.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                searchShows(1);
            }
        });
    }

    if (yearFrom) yearFrom.addEventListener('change', () => searchShows(1));
    if (yearTo) yearTo.addEventListener('change', () => searchShows(1));
    
    if (bandSelector) {
        const savedBand = storage.getSelectedBand();
        if (savedBand && bandSelector.querySelector(`option[value="${savedBand}"]`)) {
            bandSelector.value = savedBand;
        }
        
        bandSelector.addEventListener('change', function() {
            storage.setSelectedBand(this.value);
            currentPage = 1;
            
            const config = getBandConfig(this.value);
            if (yearFrom && yearTo && config && config.yearRange) {
                yearFrom.value = config.yearRange[0];
                yearTo.value = config.yearRange[1];
            }
            
            // Clear search for special search types
            if (this.value === 'Author_Search' || this.value === 'Title_Search' || this.value === 'Custom') {
                if (searchQuery) {
                    searchQuery.value = '';
                    searchQuery.placeholder = config.placeholder || 'Enter search...';
                }
            }
            
            searchShows(1);
        });
    }

    const filterButtons = document.querySelectorAll('[data-filter]');
    filterButtons.forEach(button => {
        button.addEventListener('click', function() {
            const filter = this.dataset.filter;
            
            if (activeFilters.has(filter)) {
                activeFilters.delete(filter);
                this.classList.remove('active');
            } else {
                activeFilters.add(filter);
                this.classList.add('active');
            }
            
            searchShows(1);
        });
    });
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.target.matches('input, select, textarea')) return;
        
        switch(e.key.toLowerCase()) {
            case '/':
                e.preventDefault();
                if (searchQuery) searchQuery.focus();
                break;
            case 'r':
                e.preventDefault();
                const randomBtn = document.getElementById('randomShow');
                if (randomBtn) randomBtn.click();
                break;
        }
    });

    if (prevPage) prevPage.addEventListener('click', () => changePage(-1));
    if (nextPage) nextPage.addEventListener('click', () => changePage(1));

    // Setup infinite scroll
    setupInfiniteScroll();

    console.log('Running initial search...');
    searchShows(1);
}

window.openPlayerPage = openPlayerPage;
window.searchShows = searchShows;
window.changePage = changePage;