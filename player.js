// player.js - Audiobook player functionality with audio file filtering

import { formatTime, shuffleArray, showPlayerError, showToast } from './utils.js';
import { storage } from './storage.js';
import { Visualizer } from './visualizer.js';

export class Player {
    constructor() {
        this.playlist = [];
        this.originalPlaylist = [];
        this.currentIndex = 0;
        this.isShuffled = false;
        this.loopMode = 'none';
        this.playerState = 'paused';
        this.lastVolume = 1;
        this.playbackRate = 1;
        this.isLoadingTrack = false;
        
        this.audio = null;
        this.trackTitle = null;
        this.playPauseButton = null;
        this.prevButton = null;
        this.nextButton = null;
        this.trackProgress = null;
        this.currentTimeEl = null;
        this.totalTimeEl = null;
        this.playlistContainer = null;
        this.playIcon = null;
        
        this.visualizer = new Visualizer();
        
        this.consecutiveErrors = 0;
        this.maxConsecutiveErrors = 3;
    }

    async initialize(identifier, startTrack = 0) {
        if (!identifier) {
            this.showError('No book selected. Please go back and choose an audiobook.');
            return false;
        }

        const showTitleEl = document.getElementById('show-title');
        if (showTitleEl) showTitleEl.textContent = 'Loading Audiobook...';

        try {
            const resp = await fetch(`https://archive.org/metadata/${identifier}`);
            
            if (!resp.ok) {
                throw new Error(`Server returned ${resp.status}: ${resp.statusText}`);
            }
            
            const data = await resp.json();

            if (!data || !data.metadata) {
                throw new Error('Invalid response from server');
            }

            let authorName = 'Unknown Author';
            if (typeof data.metadata.creator === 'string') {
                authorName = data.metadata.creator;
            }

            document.title = `${authorName}: ${data.metadata.title || 'Audiobook'}`;
            if (showTitleEl) showTitleEl.textContent = data.metadata.title || 'Unknown Book';
            
            const archiveLink = document.getElementById('archive-link');
            if (archiveLink) archiveLink.href = `https://archive.org/details/${identifier}`;

            this.updateBookInfo(data);
            
            try {
                storage.updateRecentlyViewed({
                    identifier,
                    title: data.metadata.title
                });
            } catch (e) {
                console.warn('Could not update recently viewed:', e);
            }

            if (!data.files || !Array.isArray(data.files)) {
                throw new Error('No files found in book data');
            }

            // IMPROVED: Filter out non-audio files
            const audioFiles = data.files.filter(f => {
                if (!f.name || !f.format) return false;
                
                const format = f.format.toLowerCase();
                const name = f.name.toLowerCase();
                
                // Only include actual audio formats
                const isAudioFormat = format.includes('mp3') || 
                                     format.includes('ogg') || 
                                     format.includes('vorbis') ||
                                     format.includes('mpeg');
                
                // Exclude non-audio file extensions
                const nonAudioExtensions = [
                    '.zip', '.txt', '.pdf', '.xml', '.jpg', '.jpeg', 
                    '.png', '.gif', '.m3u', '.md5', '.sqlite', '.torrent',
                    '.html', '.htm', '.json', '.sh', '.asc', '.meta'
                ];
                
                const hasNonAudioExtension = nonAudioExtensions.some(ext => name.endsWith(ext));
                
                // Check original format too
                const originalFormat = f.original ? f.original.toLowerCase() : '';
                const isOriginalAudio = !originalFormat || 
                                       originalFormat.includes('mp3') || 
                                       originalFormat.includes('audio');
                
                return isAudioFormat && !hasNonAudioExtension && isOriginalAudio;
            });
            
            if (!audioFiles.length) {
                throw new Error('No playable audio files found in this audiobook');
            }

            console.log(`Found ${audioFiles.length} audio files out of ${data.files.length} total files`);

            this.playlist = audioFiles.map(f => ({
                title: f.title || f.name.replace(/\.(mp3|ogg)$/i, ''),
                url: `https://archive.org/download/${identifier}/${encodeURIComponent(f.name)}`
            }));
            this.originalPlaylist = [...this.playlist];

            if (!isNaN(startTrack) && startTrack >= 0 && startTrack < this.playlist.length) {
                this.currentIndex = startTrack;
            }

            this.setupUI();
            
            try {
                await this.visualizer.initialize(this.audio);
            } catch (e) {
                console.warn('Visualizer initialization failed:', e);
            }
            
            this.loadTrack(this.currentIndex);
            
            return true;

        } catch (error) {
            console.error('Error initializing player:', error);
            
            let errorMessage = 'Unable to load audiobook';
            if (error.message) {
                errorMessage = error.message;
            }
            
            this.showError(errorMessage);
            return false;
        }
    }

    setupUI() {
        const loadingPlaceholder = document.getElementById('loading-placeholder');
        const customPlayer = document.getElementById('custom-player');
        
        if (loadingPlaceholder) loadingPlaceholder.remove();
        if (customPlayer) customPlayer.classList.remove('hidden');

        this.audio = document.getElementById('audioElement');
        this.trackTitle = document.getElementById('trackTitle');
        this.playPauseButton = document.getElementById('playPause');
        this.prevButton = document.getElementById('prevTrack');
        this.nextButton = document.getElementById('nextTrack');
        this.trackProgress = document.getElementById('trackProgress');
        this.currentTimeEl = document.getElementById('currentTime');
        this.totalTimeEl = document.getElementById('totalTime');
        this.playlistContainer = document.getElementById('playlistContainer');
        this.playIcon = document.getElementById('playIcon');

        const muteButton = document.getElementById('muteButton');
        const volumeControl = document.getElementById('volumeControl');
        const shuffleButton = document.getElementById('shuffleButton');
        const loopButton = document.getElementById('loopButton');

        if (this.playPauseButton) {
            this.playPauseButton.addEventListener('click', () => this.playPause());
        }
        if (this.nextButton) {
            this.nextButton.addEventListener('click', () => this.nextTrack());
        }
        if (this.prevButton) {
            this.prevButton.addEventListener('click', () => this.prevTrack());
        }
        if (this.trackProgress) {
            this.trackProgress.addEventListener('input', (e) => this.seekTrack(e));
        }
        if (muteButton) {
            muteButton.addEventListener('click', () => this.toggleMute());
        }
        if (volumeControl) {
            volumeControl.addEventListener('input', (e) => this.handleVolumeChange(e));
        }
        if (shuffleButton) {
            shuffleButton.addEventListener('click', () => this.toggleShuffle());
        }
        if (loopButton) {
            loopButton.addEventListener('click', () => this.toggleLoop());
        }

        if (this.audio) {
            this.audio.addEventListener('timeupdate', () => this.updateProgress());
            this.audio.addEventListener('loadedmetadata', () => this.updateTotalTime());
            this.audio.addEventListener('ended', () => this.handleTrackEnd());
            this.audio.addEventListener('progress', () => this.updateBufferProgress());
            this.audio.addEventListener('playing', () => {
                this.updateState('playing');
                this.consecutiveErrors = 0;
                this.isLoadingTrack = false;
            });
            this.audio.addEventListener('pause', () => this.updateState('paused'));
            this.audio.addEventListener('waiting', () => this.updateState('loading'));
            this.audio.addEventListener('canplay', () => {
                this.isLoadingTrack = false;
            });
            this.audio.addEventListener('error', (e) => this.handleAudioError(e));
        }

        this.renderPlaylist();
        this.updatePlaylistInfo();
        this.updateControls();
        this.setupKeyboardControls();
    }

    handleAudioError(e) {
        console.error('Audio error:', e);
        this.consecutiveErrors++;
        this.isLoadingTrack = false;
        
        const audio = this.audio;
        if (!audio || !audio.error) return;
        
        let errorMessage = 'Audio playback error';
        
        switch (audio.error.code) {
            case audio.error.MEDIA_ERR_ABORTED:
                errorMessage = 'Playback aborted';
                break;
            case audio.error.MEDIA_ERR_NETWORK:
                errorMessage = 'Network error loading audio';
                break;
            case audio.error.MEDIA_ERR_DECODE:
                errorMessage = 'Audio file corrupted or unsupported';
                break;
            case audio.error.MEDIA_ERR_SRC_NOT_SUPPORTED:
                errorMessage = 'Audio format not supported';
                break;
        }
        
        if (this.consecutiveErrors >= this.maxConsecutiveErrors) {
            showPlayerError(`${errorMessage}. Multiple chapters failed to load. This audiobook may have issues.`);
        } else {
            showToast(errorMessage, 'error');
        }
    }

    loadTrack(index) {
        if (this.isLoadingTrack) {
            console.log('Already loading a chapter, please wait');
            return;
        }

        const track = this.playlist[index];
        if (!track || !track.url) {
            showPlayerError('Invalid chapter or missing URL');
            return;
        }

        console.log('Loading chapter:', index, track.title);
        this.isLoadingTrack = true;
        this.currentIndex = index;
        this.playerState = 'loading';
        
        this.updateControls();
        this.highlightCurrentTrack();

        try {
            this.audio.pause();
            this.audio.src = '';
            this.audio.load();
            
            this.audio.src = track.url;
            this.trackTitle.textContent = track.title;
            
            const infoEl = document.getElementById('trackInfo');
            if (infoEl) {
                infoEl.textContent = `Chapter ${index + 1} of ${this.playlist.length}`;
            }

            this.audio.playbackRate = this.playbackRate;
            this.audio.volume = this.lastVolume;
            this.audio.load();
            
            this.highlightCurrentTrack();
            
        } catch (error) {
            console.error('Error loading chapter:', error);
            this.isLoadingTrack = false;
            showPlayerError('Failed to load chapter');
        }
    }

    async playPause() {
        try {
            await this.visualizer.resume();
        } catch (e) {
            console.warn('Visualizer resume failed:', e);
        }
        
        if (this.playerState === 'playing') {
            this.audio.pause();
            this.playerState = 'paused';
        } else {
            try {
                const promise = this.audio.play();
                if (promise !== undefined) {
                    await promise;
                }
                this.playerState = 'playing';
            } catch (error) {
                console.error('Playback failed:', error);
                this.playerState = 'paused';
                
                if (error.name === 'NotAllowedError') {
                    showToast('Click play button to start playback', 'info');
                } else {
                    showToast('Playback failed. Try another chapter.', 'error');
                }
            }
        }
        this.updateControls();
        this.highlightCurrentTrack();
    }

    nextTrack() {
        if (this.isLoadingTrack) return;
        
        this.audio.pause();
        this.audio.src = '';
        this.audio.load();

        if (this.isShuffled) {
            this.currentIndex = Math.floor(Math.random() * this.playlist.length);
        } else if (this.currentIndex < this.playlist.length - 1) {
            this.currentIndex++;
        } else if (this.loopMode === 'all') {
            this.currentIndex = 0;
        } else {
            return;
        }

        this.loadTrack(this.currentIndex);
        
        const playWhenReady = () => {
            if (!this.isLoadingTrack) {
                this.audio.play()
                    .then(() => {
                        console.log('Next chapter auto-play started');
                        this.playerState = 'playing';
                        this.updateControls();
                        this.highlightCurrentTrack();
                    })
                    .catch(err => {
                        if (!err.message.includes('interrupted')) {
                            console.error('Next chapter auto-play failed:', err);
                        }
                    });
            } else {
                setTimeout(playWhenReady, 100);
            }
        };
        
        setTimeout(playWhenReady, 200);
    }

    prevTrack() {
        if (this.isLoadingTrack) return;
        
        this.audio.pause();
        this.audio.src = '';
        this.audio.load();

        if (this.audio.currentTime > 3) {
            this.audio.currentTime = 0;
            return;
        }

        if (this.isShuffled) {
            this.currentIndex = Math.floor(Math.random() * this.playlist.length);
        } else if (this.currentIndex > 0) {
            this.currentIndex--;
        } else if (this.loopMode === 'all') {
            this.currentIndex = this.playlist.length - 1;
        } else {
            return;
        }

        this.loadTrack(this.currentIndex);
        
        const playWhenReady = () => {
            if (!this.isLoadingTrack) {
                this.audio.play()
                    .then(() => {
                        console.log('Previous chapter auto-play started');
                        this.playerState = 'playing';
                        this.updateControls();
                        this.highlightCurrentTrack();
                    })
                    .catch(err => {
                        if (!err.message.includes('interrupted')) {
                            console.error('Prev chapter auto-play failed:', err);
                        }
                    });
            } else {
                setTimeout(playWhenReady, 100);
            }
        };
        
        setTimeout(playWhenReady, 200);
    }

    selectTrack(index) {
        if (this.isLoadingTrack) {
            console.log('Please wait for current chapter to load');
            showToast('Please wait...', 'info', 1000);
            return;
        }

        console.log('Chapter selected:', index);

        if (index === this.currentIndex && !this.isLoadingTrack) {
            this.playPause();
            return;
        }

        this.audio.pause();
        this.audio.src = '';
        this.audio.load();

        this.loadTrack(index);
        
        const playWhenReady = () => {
            if (!this.isLoadingTrack) {
                this.audio.play()
                    .then(() => {
                        console.log('Auto-play started successfully');
                        this.playerState = 'playing';
                        this.updateControls();
                        this.highlightCurrentTrack();
                    })
                    .catch(err => {
                        if (!err.message.includes('interrupted')) {
                            console.error('Auto-play failed:', err);
                            showToast('Click play to start', 'info');
                        }
                    });
            } else {
                setTimeout(playWhenReady, 100);
            }
        };
        
        setTimeout(playWhenReady, 200);
    }

    handleTrackEnd() {
        if (this.loopMode === 'one') {
            this.audio.currentTime = 0;
            this.audio.play().catch(err => console.error('Loop play error:', err));
        } else if (this.loopMode === 'all' || this.isShuffled || this.currentIndex < this.playlist.length - 1) {
            this.nextTrack();
        } else {
            this.playerState = 'paused';
            this.updateControls();
            this.highlightCurrentTrack();
        }
    }

    updateProgress() {
        if (!this.audio.duration || isNaN(this.audio.duration)) return;
        const pct = (this.audio.currentTime / this.audio.duration) * 100;
        if (this.trackProgress) this.trackProgress.value = pct;
        const pb = document.getElementById('progressBar');
        if (pb) pb.style.width = `${pct}%`;
        if (this.currentTimeEl) this.currentTimeEl.textContent = formatTime(this.audio.currentTime);
    }

    updateTotalTime() {
        if (this.totalTimeEl && this.audio.duration) {
            this.totalTimeEl.textContent = formatTime(this.audio.duration);
        }
    }

    seekTrack(e) {
        const t = (e.target.value / 100) * this.audio.duration;
        if (!isNaN(t)) {
            this.audio.currentTime = t;
            this.updateProgress();
        }
    }

    updateBufferProgress() {
        if (!this.audio.buffered.length) return;
        const bb = document.getElementById('bufferBar');
        if (!bb || !this.audio.duration) return;
        try {
            const buffered = this.audio.buffered.end(this.audio.buffered.length - 1);
            const pct = (buffered / this.audio.duration) * 100;
            bb.style.width = `${pct}%`;
        } catch (e) {
            // Ignore buffering errors
        }
    }

    toggleMute() {
        if (this.audio.volume > 0) {
            this.lastVolume = this.audio.volume;
            this.audio.volume = 0;
        } else {
            this.audio.volume = this.lastVolume;
        }
        this.updateVolumeUI();
    }

    handleVolumeChange(e) {
        const vol = e.target.value / 100;
        this.audio.volume = vol;
        this.lastVolume = vol;
        this.updateVolumeUI();
    }

    updateVolumeUI() {
        const bar = document.getElementById('volumeBar');
        const ctrl = document.getElementById('volumeControl');
        if (bar) bar.style.width = `${this.audio.volume * 100}%`;
        if (ctrl) ctrl.value = this.audio.volume * 100;
    }

    toggleShuffle() {
        const btn = document.getElementById('shuffleButton');
        if (!btn) return;
        
        this.isShuffled = !this.isShuffled;
        btn.classList.toggle('text-blue-400');
        btn.title = `Shuffle ${this.isShuffled ? 'On' : 'Off'}`;
        
        const current = this.playlist[this.currentIndex];
        this.playlist = this.isShuffled ? shuffleArray([...this.playlist]) : [...this.originalPlaylist];
        this.currentIndex = this.playlist.findIndex(t => t.url === current.url);
        
        this.renderPlaylist();
        this.highlightCurrentTrack();
    }

    toggleLoop() {
        const btn = document.getElementById('loopButton');
        if (!btn) return;
        
        const modes = ['none', 'one', 'all'];
        this.loopMode = modes[(modes.indexOf(this.loopMode) + 1) % 3];
        btn.classList.toggle('text-blue-400', this.loopMode !== 'none');
        btn.title = `Loop: ${this.loopMode}`;
    }

    updateControls() {
        if (!this.playIcon) return;
        
        if (this.playerState === 'playing') {
            this.playIcon.innerHTML = `
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                      d="M10 9v6m4-6v6" />`;
        } else {
            this.playIcon.innerHTML = `
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                      d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                      d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />`;
        }
        
        if (this.prevButton && this.nextButton) {
            this.prevButton.disabled = this.currentIndex === 0 && !this.isShuffled && this.loopMode === 'none';
            this.nextButton.disabled = this.currentIndex === this.playlist.length - 1 && !this.isShuffled && this.loopMode === 'none';
            
            [this.prevButton, this.nextButton].forEach(b => {
                if (b.disabled) {
                    b.classList.add('opacity-50', 'cursor-not-allowed');
                } else {
                    b.classList.remove('opacity-50', 'cursor-not-allowed');
                }
            });
        }
    }

    updateState(state) {
        this.playerState = state;
        this.updateControls();
        setTimeout(() => this.highlightCurrentTrack(), 0);
    }

    renderPlaylist() {
        if (!this.playlistContainer) return;
        
        this.playlistContainer.innerHTML = this.playlist.map((track, i) => `
            <div class="playlist-item py-2 px-3 flex justify-between items-center rounded-lg cursor-pointer"
                 onclick="window.player.selectTrack(${i})"
                 data-track-index="${i}">
                <div class="flex items-center space-x-2 min-w-0 flex-1">
                    <span class="text-sm text-gray-400 flex-shrink-0">
                        ${i + 1}.
                    </span>
                    <span class="text-sm text-gray-300 truncate">
                        ${track.title}
                    </span>
                </div>
            </div>
        `).join('');
        
        this.updatePlaylistInfo();
        
        setTimeout(() => this.highlightCurrentTrack(), 50);
    }

    highlightCurrentTrack() {
        if (!this.playlistContainer) return;
        
        console.log('Highlighting chapter:', this.currentIndex, 'State:', this.playerState);
        
        Array.from(this.playlistContainer.children).forEach((el) => {
            const trackIndex = parseInt(el.getAttribute('data-track-index'));
            const isCurrentTrack = trackIndex === this.currentIndex;
            
            el.classList.remove('active');
            
            const numberSpan = el.querySelector('span:first-child');
            const titleSpan = el.querySelector('span:last-child');
            const playingIcon = el.querySelector('.playing-icon');
            
            if (playingIcon) {
                playingIcon.remove();
            }
            
            if (isCurrentTrack) {
                el.classList.add('active');
                
                if (numberSpan) {
                    numberSpan.className = 'text-sm text-blue-400 flex-shrink-0 font-bold';
                }
                
                if (titleSpan) {
                    titleSpan.className = 'text-sm text-white font-medium truncate';
                }
                
                if (this.playerState === 'playing') {
                    const icon = document.createElement('span');
                    icon.className = 'text-blue-400 flex-shrink-0 playing-icon';
                    icon.textContent = '▶️';
                    el.appendChild(icon);
                }
                
                try {
                    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                } catch (e) {
                    // Ignore scroll errors
                }
            } else {
                if (numberSpan) {
                    numberSpan.className = 'text-sm text-gray-400 flex-shrink-0';
                }
                if (titleSpan) {
                    titleSpan.className = 'text-sm text-gray-300 truncate';
                }
            }
        });
    }

    updatePlaylistInfo() {
        const pi = document.getElementById('playlistInfo');
        if (pi) pi.textContent = `${this.playlist.length} chapters`;
    }

    updateBookInfo(data) {
        const si = document.getElementById('show-info');
        if (si && data.metadata) {
            const m = data.metadata;
            const content = `
                <p class="text-sm md:text-base text-gray-300"><strong>Author:</strong> ${m.creator || 'Unknown'}</p>
                <p class="text-sm md:text-base text-gray-300"><strong>Narrator:</strong> ${m.narrator || m.reader || 'Unknown'}</p>
                <p class="text-sm md:text-base text-gray-300"><strong>Language:</strong> ${m.language || 'English'}</p>
                <p class="text-sm md:text-base text-gray-300"><strong>Published:</strong> ${m.year || m.date || 'N/A'}</p>
                ${m.runtime ? `<p class="text-sm md:text-base text-gray-300"><strong>Runtime:</strong> ${m.runtime}</p>` : ''}
                ${m.genre ? `<p class="text-sm md:text-base text-gray-300"><strong>Genre:</strong> ${m.genre}</p>` : ''}
            `;
            
            if (si.tagName === 'DETAILS') {
                let contentDiv = si.querySelector('.show-info-content');
                if (!contentDiv) {
                    contentDiv = document.createElement('div');
                    contentDiv.className = 'show-info-content space-y-2';
                    si.appendChild(contentDiv);
                }
                contentDiv.innerHTML = content;
            } else {
                si.innerHTML = `
                    <h2 class="text-xl font-semibold mb-4 text-gray-100">Book Details</h2>
                    ${content}
                `;
            }
        }
        
        const ai = document.getElementById('additional-info');
        if (ai && data.metadata) {
            const m = data.metadata;
            const hasInfo = m.description || m.notes;
            const content = `
                ${m.description ? `<p class="text-sm md:text-base text-gray-300 mb-2">${m.description}</p>` : ''}
                ${m.notes ? `<p class="text-sm md:text-base text-gray-300 mb-2">${m.notes}</p>` : ''}
                ${!hasInfo ? '<p class="text-sm md:text-base text-gray-500">No additional information available</p>' : ''}
            `;
            
            if (ai.tagName === 'DETAILS') {
                let contentDiv = ai.querySelector('.additional-info-content');
                if (!contentDiv) {
                    contentDiv = document.createElement('div');
                    contentDiv.className = 'additional-info-content space-y-2';
                    ai.appendChild(contentDiv);
                }
                contentDiv.innerHTML = content;
            } else {
                ai.innerHTML = `
                    <h2 class="text-xl font-semibold mb-4 text-gray-100">Additional Information</h2>
                    ${content}
                `;
            }
        }
    }

    setupKeyboardControls() {
        document.addEventListener('keydown', (e) => {
            const cp = document.getElementById('custom-player');
            if (!cp || cp.classList.contains('hidden')) return;
            if (e.target.matches('input, textarea, select')) return;
            
            switch (e.key.toLowerCase()) {
                case ' ':
                case 'k':
                    e.preventDefault();
                    this.playPause();
                    break;
                case 'arrowright':
                    e.preventDefault();
                    if (this.audio.duration) {
                        this.audio.currentTime = Math.min(this.audio.currentTime + 5, this.audio.duration);
                    }
                    break;
                case 'arrowleft':
                    e.preventDefault();
                    this.audio.currentTime = Math.max(this.audio.currentTime - 5, 0);
                    break;
                case 'j':
                    e.preventDefault();
                    this.audio.currentTime = Math.max(this.audio.currentTime - 10, 0);
                    break;
                case 'l':
                    e.preventDefault();
                    if (this.audio.duration) {
                        this.audio.currentTime = Math.min(this.audio.currentTime + 10, this.audio.duration);
                    }
                    break;
                case 'm':
                    e.preventDefault();
                    this.toggleMute();
                    break;
                case 'n':
                    e.preventDefault();
                    this.nextTrack();
                    break;
                case 'p':
                    e.preventDefault();
                    this.prevTrack();
                    break;
            }
        });
    }

    showError(msg) {
        const pw = document.getElementById('player-wrapper');
        if (pw) {
            pw.innerHTML = `
                <div class="bg-gray-800 border-2 border-red-900 rounded-lg p-6 text-center">
                    <svg class="w-16 h-16 mx-auto mb-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <h3 class="text-xl font-bold text-red-400 mb-2">Error Loading Player</h3>
                    <p class="text-gray-300 mb-4">${msg}</p>
                    <div class="flex gap-4 justify-center">
                        <button onclick="location.reload()" 
                                class="px-6 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors">
                            Try Again
                        </button>
                        <a href="index.html" 
                           class="px-6 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors inline-block">
                            Return to Search
                        </a>
                    </div>
                </div>`;
        }
    }

    destroy() {
        try {
            this.visualizer.destroy();
        } catch (e) {
            console.error('Error destroying visualizer:', e);
        }
        
        if (this.audio) {
            this.audio.pause();
            this.audio.removeAttribute('src');
        }
    }
}