// visualizer.js - Audio waveform visualizer

export class Visualizer {
    constructor() {
        this.canvas = null;
        this.canvasContext = null;
        this.audioContext = null;
        this.analyser = null;
        this.dataArray = null;
        this.bufferLength = null;
        this.animationId = null;
        this.isInitialized = false;
    }

    async initialize(audioElement) {
        if (this.isInitialized) return;

        try {
            this.canvas = document.getElementById('visualizerCanvas');
            if (!this.canvas) {
                console.warn('Visualizer canvas not found');
                return;
            }

            this.canvasContext = this.canvas.getContext('2d');
            
            // Set canvas size
            const resizeCanvas = () => {
                const container = this.canvas.parentElement;
                if (container) {
                    this.canvas.width = container.clientWidth;
                    this.canvas.height = container.clientHeight;
                }
            };
            resizeCanvas();
            window.addEventListener('resize', resizeCanvas);

            // Create audio context
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.audioContext = new AudioContext();

            // Create analyser
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;
            this.bufferLength = this.analyser.frequencyBinCount;
            this.dataArray = new Uint8Array(this.bufferLength);

            // Connect audio element to analyser
            if (audioElement) {
                const source = this.audioContext.createMediaElementSource(audioElement);
                source.connect(this.analyser);
                this.analyser.connect(this.audioContext.destination);
            }

            this.isInitialized = true;
            this.draw();
            
        } catch (error) {
            console.error('Error initializing visualizer:', error);
        }
    }

    async resume() {
        if (this.audioContext && this.audioContext.state === 'suspended') {
            try {
                await this.audioContext.resume();
            } catch (error) {
                console.warn('Could not resume audio context:', error);
            }
        }
    }

    draw() {
        if (!this.isInitialized || !this.canvas || !this.canvasContext) return;

        this.animationId = requestAnimationFrame(() => this.draw());

        this.analyser.getByteFrequencyData(this.dataArray);

        const ctx = this.canvasContext;
        const width = this.canvas.width;
        const height = this.canvas.height;

        // Clear canvas with fade effect
        ctx.fillStyle = 'rgba(17, 24, 39, 0.2)';
        ctx.fillRect(0, 0, width, height);

        const barWidth = (width / this.bufferLength) * 2.5;
        let barHeight;
        let x = 0;

        for (let i = 0; i < this.bufferLength; i++) {
            barHeight = (this.dataArray[i] / 255) * height * 0.8;

            // Create gradient for bars
            const gradient = ctx.createLinearGradient(0, height - barHeight, 0, height);
            gradient.addColorStop(0, '#0ea5e9');
            gradient.addColorStop(0.5, '#06b6d4');
            gradient.addColorStop(1, '#3b82f6');

            ctx.fillStyle = gradient;
            ctx.fillRect(x, height - barHeight, barWidth, barHeight);

            x += barWidth + 1;
        }
    }

    destroy() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }

        if (this.audioContext) {
            this.audioContext.close().catch(err => {
                console.warn('Error closing audio context:', err);
            });
            this.audioContext = null;
        }

        this.isInitialized = false;
    }
}