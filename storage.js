// storage.js - Centralized storage management for LibriVox Audiobooks

class StorageManager {
    constructor() {
        this.prefix = 'librivox_';
        this.initStorage();
    }

    initStorage() {
        // Validate and initialize recently viewed audiobooks
        try {
            const raw = localStorage.getItem(this.prefix + 'recentlyViewed') || '[]';
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) throw new Error('Invalid format');
        } catch {
            console.error('Invalid recentlyViewed; resetting');
            localStorage.removeItem(this.prefix + 'recentlyViewed');
        }
    }

    // Get recently viewed audiobooks
    getRecentlyViewed() {
        try {
            const raw = localStorage.getItem(this.prefix + 'recentlyViewed') || '[]';
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    // Update recently viewed audiobooks
    updateRecentlyViewed(audiobook) {
        if (!audiobook || !audiobook.identifier) {
            console.error('Invalid audiobook data for recently viewed');
            return;
        }

        let stored = this.getRecentlyViewed();

        // Remove if already exists, then add to front
        stored = stored.filter(s => s.identifier !== audiobook.identifier);
        stored.unshift({
            identifier: audiobook.identifier,
            title: audiobook.title || 'Unknown Audiobook'
        });

        // Keep only last 5
        if (stored.length > 5) stored.pop();

        try {
            localStorage.setItem(this.prefix + 'recentlyViewed', JSON.stringify(stored));
        } catch (e) {
            console.error('Error saving recentlyViewed:', e);
        }

        return stored;
    }

    // Get selected category
    getSelectedCategory() {
        return localStorage.getItem(this.prefix + 'selectedCategory') || 'AllLibriVox';
    }

    // Save selected category
    setSelectedCategory(category) {
        try {
            localStorage.setItem(this.prefix + 'selectedCategory', category);
        } catch (e) {
            console.error('Error saving selected category:', e);
        }
    }

    // Clear all storage
    clearAll() {
        const keys = Object.keys(localStorage);
        keys.forEach(key => {
            if (key.startsWith(this.prefix)) {
                localStorage.removeItem(key);
            }
        });
    }
}

// Export singleton instance
export const storage = new StorageManager();
