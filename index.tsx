/* tslint:disable */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {GoogleGenAI, LiveServerMessage, Modality, Session} from '@google/genai';
import {LitElement, css, html} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {createBlob, decode, decodeAudioData} from './utils';
import './visual-3d';

interface ChatTurn {
  id: string;
  sender: 'user' | 'model';
  text: string;
}

@customElement('gdm-live-audio')
export class GdmLiveAudio extends LitElement {
  @state() isRecording = false;
  @state() isMuted = false;
  @state() status = '';
  @state() error = '';
  @state() thinkingEnabled = false;
  @state() thoughts: string[] = [];
  @state() userTranscript = '';
  @state() modelTranscript = '';
  @state() mood = 'neutral';
  @state() chatTurns: ChatTurn[] = [];

  private client: GoogleGenAI;
  private session: Session;
  private inputAudioContext = new (window.AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 16000});
  private outputAudioContext = new (window.AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 24000});
  @state() inputNode = this.inputAudioContext.createGain();
  @state() outputNode = this.outputAudioContext.createGain();
  private nextStartTime = 0;
  private mediaStream: MediaStream;
  private sourceNode: AudioBufferSourceNode;
  private scriptProcessorNode: ScriptProcessorNode;
  private sources = new Set<AudioBufferSourceNode>();

  static styles = css`
    :host {
      --primary: #6366f1;
      --primary-glow: rgba(99, 102, 241, 0.4);
      --amber: #f59e0b;
      --amber-glow: rgba(245, 158, 11, 0.4);
      --bg-glass: rgba(16, 12, 20, 0.65);
      --border-glass: rgba(255, 255, 255, 0.08);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #f3f4f6;
    }

    .app-container {
      position: absolute;
      inset: 0;
      display: grid;
      grid-template-columns: 350px 1fr;
      padding: 30px;
      gap: 30px;
      pointer-events: none;
      z-index: 10;
      box-sizing: border-box;
      overflow: hidden;
    }

    .interactive-element {
      pointer-events: auto;
    }

    .glass-panel {
      background: var(--bg-glass);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid var(--border-glass);
      border-radius: 20px;
      padding: 24px;
      display: flex;
      flex-direction: column;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
      transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
    }

    .glass-panel:hover {
      border-color: rgba(255, 255, 255, 0.15);
    }

    .left-sidebar {
      display: flex;
      flex-direction: column;
      gap: 24px;
    }

    header h1 {
      font-size: 20px;
      font-weight: 800;
      letter-spacing: 0.1em;
      margin: 0 0 4px 0;
      background: linear-gradient(135deg, #fff, #9ca3af);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      text-transform: uppercase;
    }

    header .subtitle {
      font-size: 11px;
      color: #9ca3af;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      font-weight: 600;
    }

    .divider {
      height: 1px;
      background: rgba(255, 255, 255, 0.1);
      margin: 4px 0;
    }

    .status-area {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 13px;
      color: #d1d5db;
    }

    .aura-area {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 13px;
      color: #9ca3af;
      margin-top: -12px;
      margin-bottom: 4px;
    }

    .aura-label {
      font-weight: 600;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .aura-badge {
      font-size: 11px;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 8px;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      transition: all 0.5s ease;
    }

    .aura-badge.mood-neutral {
      background: rgba(99, 102, 241, 0.15);
      color: #818cf8;
      border: 1px solid rgba(99, 102, 241, 0.3);
      box-shadow: 0 0 10px rgba(99, 102, 241, 0.1);
    }

    .aura-badge.mood-excited {
      background: rgba(236, 72, 153, 0.15);
      color: #f472b6;
      border: 1px solid rgba(236, 72, 153, 0.3);
      box-shadow: 0 0 10px rgba(236, 72, 153, 0.1);
    }

    .aura-badge.mood-analytical {
      background: rgba(245, 158, 11, 0.15);
      color: #fbbf24;
      border: 1px solid rgba(245, 158, 11, 0.3);
      box-shadow: 0 0 10px rgba(245, 158, 11, 0.1);
    }

    .aura-badge.mood-warm {
      background: rgba(249, 115, 22, 0.15);
      color: #ffaa7a;
      border: 1px solid rgba(249, 115, 22, 0.3);
      box-shadow: 0 0 10px rgba(249, 115, 22, 0.1);
    }

    .aura-badge.mood-mysterious {
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.3);
      box-shadow: 0 0 10px rgba(16, 185, 129, 0.1);
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #10b981;
      box-shadow: 0 0 8px #10b981;
      position: relative;
    }

    .status-dot.recording {
      background: #ef4444;
      box-shadow: 0 0 10px #ef4444;
      animation: pulse 1.5s infinite;
    }

    .status-dot.idle {
      background: #6b7280;
      box-shadow: none;
    }

    @keyframes pulse {
      0% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.2); opacity: 0.5; }
      100% { transform: scale(1); opacity: 1; }
    }

    /* Controls styling */
    .controls-group {
      display: flex;
      flex-direction: column;
      gap: 16px;
      align-items: center;
      margin-top: auto;
      margin-bottom: auto;
    }

    .mic-button {
      outline: none;
      border: 1px solid rgba(255, 255, 255, 0.15);
      background: radial-gradient(circle, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.02) 100%);
      color: white;
      border-radius: 50%;
      width: 100px;
      height: 100px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.3);
      position: relative;
    }

    .mic-button::before {
      content: '';
      position: absolute;
      inset: -6px;
      border-radius: 50%;
      border: 1px dashed rgba(255, 255, 255, 0.1);
      transition: all 0.5s ease;
    }

    .mic-button:hover {
      background: rgba(255, 255, 255, 0.15);
      transform: translateY(-2px);
      border-color: rgba(255, 255, 255, 0.3);
    }

    .mic-button:hover::before {
      transform: rotate(30deg);
      border-color: rgba(255, 255, 255, 0.2);
    }

    .mic-button.recording {
      border-color: rgba(239, 68, 68, 0.4);
      background: radial-gradient(circle, rgba(239,68,68,0.2) 0%, rgba(239,68,68,0.05) 100%);
      box-shadow: 0 0 30px rgba(239, 68, 68, 0.3);
    }

    .mic-button.recording::before {
      inset: -10px;
      border: 1px solid rgba(239, 68, 68, 0.3);
      animation: rotate-slow 8s linear infinite;
    }

    @keyframes rotate-slow {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    .secondary-buttons {
      display: flex;
      gap: 12px;
      width: 100%;
    }

    .btn-secondary {
      flex: 1;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.08);
      color: #e5e7eb;
      border-radius: 12px;
      padding: 10px 16px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transition: all 0.2s ease;
    }

    .btn-secondary:hover:not([disabled]) {
      background: rgba(255, 255, 255, 0.1);
      border-color: rgba(255, 255, 255, 0.2);
      color: white;
    }

    .btn-secondary[disabled] {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .btn-secondary.muted {
      background: rgba(239, 68, 68, 0.15);
      border-color: rgba(239, 68, 68, 0.3);
      color: #f87171;
    }

    .btn-secondary.muted:hover:not([disabled]) {
      background: rgba(239, 68, 68, 0.25);
      border-color: rgba(239, 68, 68, 0.5);
      color: #fca5a5;
    }

    /* Toggle Switch styling */
    .toggle-container {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 16px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .toggle-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .toggle-label {
      font-weight: 700;
      font-size: 14px;
      color: #fff;
    }

    .toggle-desc {
      font-size: 11px;
      color: #9ca3af;
      line-height: 1.4;
    }

    .switch {
      position: relative;
      display: inline-block;
      width: 48px;
      height: 24px;
    }

    .switch input {
      opacity: 0;
      width: 0;
      height: 0;
    }

    .slider {
      position: absolute;
      cursor: pointer;
      inset: 0;
      background-color: rgba(255, 255, 255, 0.1);
      transition: .4s;
      border-radius: 24px;
      border: 1px solid rgba(255, 255, 255, 0.1);
    }

    .slider:before {
      position: absolute;
      content: "";
      height: 16px;
      width: 16px;
      left: 3px;
      bottom: 3px;
      background-color: #d1d5db;
      transition: .4s;
      border-radius: 50%;
    }

    input:checked + .slider {
      background-color: var(--amber-glow);
      border-color: var(--amber);
    }

    input:checked + .slider:before {
      transform: translateX(24px);
      background-color: var(--amber);
      box-shadow: 0 0 8px var(--amber);
    }

    /* Right side panels: Thought stream and subtitles */
    .content-area {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      height: 100%;
    }

    .right-panels {
      display: flex;
      flex-direction: column;
      gap: 20px;
      align-items: flex-end;
      height: 100%;
    }

    .thought-panel {
      width: 380px;
      max-height: 55%;
      height: auto;
      border-color: rgba(245, 158, 11, 0.15);
    }

    .thought-panel.active {
      border-color: rgba(245, 158, 11, 0.4);
      box-shadow: 0 0 30px rgba(245, 158, 11, 0.15);
    }

    .panel-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 12px;
    }

    .panel-header h2 {
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      margin: 0;
    }

    .pulse-dot-amber {
      width: 6px;
      height: 6px;
      background: var(--amber);
      border-radius: 50%;
      box-shadow: 0 0 6px var(--amber);
      animation: pulse-amber 2s infinite;
    }

    @keyframes pulse-amber {
      0% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.3); opacity: 0.4; }
      100% { transform: scale(1); opacity: 1; }
    }

    .thought-stream {
      flex: 1;
      overflow-y: auto;
      font-family: 'JetBrains Mono', 'Courier New', Courier, monospace;
      font-size: 12px;
      line-height: 1.6;
      color: #fbbf24;
      background: rgba(0, 0, 0, 0.25);
      border-radius: 12px;
      padding: 16px;
      border: 1px solid rgba(255, 255, 255, 0.04);
      box-sizing: border-box;
      max-height: 280px;
      scrollbar-width: thin;
      scrollbar-color: rgba(255, 255, 255, 0.1) transparent;
    }

    .thought-stream::-webkit-scrollbar {
      width: 4px;
    }

    .thought-stream::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.1);
      border-radius: 2px;
    }

    .thought-placeholder {
      color: #6b7280;
      font-style: italic;
      text-align: center;
      margin-top: 40px;
    }

    /* Subtitles / Dialog Panel */
    .dialog-panel {
      width: 100%;
      margin-top: auto;
      pointer-events: auto;
    }

    .dialog-box {
      width: 100%;
      max-width: 700px;
      margin: 0 auto;
      background: var(--bg-glass);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid var(--border-glass);
      border-radius: 24px;
      padding: 20px 28px;
      box-shadow: 0 15px 35px rgba(0, 0, 0, 0.4);
      display: flex;
      flex-direction: column;
      gap: 14px;
      box-sizing: border-box;
      max-height: 280px;
      overflow-y: auto;
      scrollbar-width: thin;
      scrollbar-color: rgba(255, 255, 255, 0.1) transparent;
    }

    .dialog-box::-webkit-scrollbar {
      width: 4px;
    }

    .dialog-box::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.1);
      border-radius: 2px;
    }

    .dialog-line {
      display: flex;
      gap: 12px;
      font-size: 14px;
      line-height: 1.5;
      transition: opacity 0.4s ease, transform 0.4s ease;
    }

    .dialog-speaker {
      font-weight: 700;
      min-width: 50px;
      text-transform: uppercase;
      font-size: 11px;
      letter-spacing: 0.05em;
      padding-top: 2px;
    }

    .dialog-speaker.user {
      color: var(--primary);
    }

    .dialog-speaker.orb {
      color: #10b981;
    }

    .dialog-text {
      color: #e5e7eb;
      flex: 1;
    }

    .dialog-text.empty {
      color: #6b7280;
      font-style: italic;
    }

    .error-banner {
      background: rgba(239, 68, 68, 0.15);
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: #fca5a5;
      border-radius: 12px;
      padding: 12px 16px;
      font-size: 12px;
      margin-top: auto;
    }
  `;

  constructor() {
    super();
    this.initClient();
  }

  private initAudio() {
    this.nextStartTime = this.outputAudioContext.currentTime;
  }

  private async initClient() {
    this.initAudio();

    this.client = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });

    this.outputNode.connect(this.outputAudioContext.destination);

    this.initSession();
  }

  private toggleThinking() {
    this.thinkingEnabled = !this.thinkingEnabled;
    this.reset();
  }

  private scrollThoughtsToBottom() {
    setTimeout(() => {
      const container = this.shadowRoot?.querySelector('#thoughtStream');
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    }, 20);
  }

  private scrollDialogToBottom() {
    setTimeout(() => {
      const container = this.shadowRoot?.querySelector('#dialogBox');
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    }, 20);
  }

  private determineMood(text: string): string {
    if (!text) return 'neutral';
    
    const lowerText = text.toLowerCase();
    
    // Keywords representing different moods
    const excitedWords = [
      'wow', 'awesome', 'amazing', 'great', 'fantastic', 'excellent', 'excited', 'incredible',
      'cool', 'love', 'happy', 'joy', 'wonderful', 'beautiful', 'absolutely', 'thrilled',
      'super', 'perfect', 'brilliant', 'delighted', 'glad', 'eager', 'fun', 'hurrah', 'cheers',
      'delight', 'marvelous', 'fabulous', 'splendid', 'tremendous', 'outstanding', 'epic'
    ];
    
    const analyticalWords = [
      'think', 'reason', 'analyze', 'logic', 'cognitive', 'concept', 'system', 'structure',
      'calculate', 'compute', 'formula', 'data', 'information', 'theory', 'research',
      'science', 'fact', 'evidence', 'hypothesis', 'proof', 'code', 'algorithm', 'complex',
      'problem', 'solution', 'definition', 'identify', 'conclude', 'examine', 'process',
      'variables', 'parameters', 'quantum', 'equation', 'logic', 'technical'
    ];
    
    const warmWords = [
      'sorry', 'comfort', 'feel', 'sad', 'heart', 'warm', 'kind', 'empathy', 'sympathy',
      'friend', 'help', 'support', 'listen', 'care', 'soft', 'gentle', 'hope', 'peace',
      'trust', 'love', 'dear', 'safe', 'protect', 'understand', 'patient', 'calm',
      'heal', 'compassion', 'gentle', 'harmony', 'relax', 'breath', 'quiet', 'rest'
    ];
    
    const mysteriousWords = [
      'secret', 'mystery', 'unknown', 'cosmic', 'space', 'galaxy', 'quantum', 'dimension',
      'unseen', 'hidden', 'magic', 'future', 'dream', 'portal', 'alien', 'gravity',
      'infinite', 'star', 'void', 'shadow', 'nebula', 'darkness', 'eternity', 'vibe',
      'weird', 'mystical', 'supernatural', 'unusual', 'rare', 'esoteric', 'stellar'
    ];

    // Count occurrences
    let excitedCount = 0;
    let analyticalCount = 0;
    let warmCount = 0;
    let mysteriousCount = 0;

    const words = lowerText.split(/\s+/);
    for (const word of words) {
      // Strip punctuation
      const cleanWord = word.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"']/g, "");
      if (excitedWords.includes(cleanWord)) excitedCount++;
      if (analyticalWords.includes(cleanWord)) analyticalCount++;
      if (warmWords.includes(cleanWord)) warmCount++;
      if (mysteriousWords.includes(cleanWord)) mysteriousCount++;
    }

    // Determine the maximum
    const max = Math.max(excitedCount, analyticalCount, warmCount, mysteriousCount);
    if (max === 0) return 'neutral';
    if (max === excitedCount) return 'excited';
    if (max === analyticalCount) return 'analytical';
    if (max === warmCount) return 'warm';
    if (max === mysteriousCount) return 'mysterious';
    
    return 'neutral';
  }

  private async initSession() {
    this.thoughts = [];
    this.userTranscript = '';
    this.modelTranscript = '';
    this.mood = 'neutral';
    const model = 'gemini-3.1-flash-live-preview';

    try {
      this.updateStatus('Initializing connection...');
      const config: any = {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {prebuiltVoiceConfig: {voiceName: 'Orus'}},
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      };

      if (this.thinkingEnabled) {
        config.thinkingConfig = {
          includeThoughts: true,
          thinkingBudget: 2048,
          thinkingLevel: 'HIGH',
        };
      } else {
        config.thinkingConfig = {
          includeThoughts: false,
          thinkingBudget: 0,
          thinkingLevel: 'MINIMAL',
        };
      }

      this.session = await this.client.live.connect({
        model: model,
        callbacks: {
          onopen: () => {
            this.updateStatus('Connected & ready');
          },
          onmessage: async (message: LiveServerMessage) => {
            // Check for thoughts in parts
            const parts = message.serverContent?.modelTurn?.parts || [];
            for (const part of parts) {
              if (part.thought && part.text) {
                this.thoughts = [...this.thoughts, part.text];
                this.scrollThoughtsToBottom();
              }
            }

            // Decode audio
            const audio = parts.find(p => p.inlineData)?.inlineData || 
                          message.serverContent?.modelTurn?.parts?.[0]?.inlineData;

            if (audio) {
              this.nextStartTime = Math.max(
                this.nextStartTime,
                this.outputAudioContext.currentTime,
              );

              const audioBuffer = await decodeAudioData(
                decode(audio.data),
                this.outputAudioContext,
                24000,
                1,
              );
              const source = this.outputAudioContext.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(this.outputNode);
              source.addEventListener('ended', () => {
                this.sources.delete(source);
              });

              source.start(this.nextStartTime);
              this.nextStartTime = this.nextStartTime + audioBuffer.duration;
              this.sources.add(source);
            }

            const interrupted = message.serverContent?.interrupted;
            if (interrupted) {
              for (const source of this.sources.values()) {
                try {
                  source.stop();
                } catch (e) {}
                this.sources.delete(source);
              }
              this.nextStartTime = 0;
            }

            // Real-time transcriptions
            if ((message as any).inputTranscription?.text) {
              const text = (message as any).inputTranscription.text.trim();
              if (text) {
                this.userTranscript = text;
                const lastTurn = this.chatTurns[this.chatTurns.length - 1];
                if (!lastTurn || lastTurn.sender !== 'user') {
                  this.chatTurns = [...this.chatTurns, {
                    id: Math.random().toString(36).substring(2),
                    sender: 'user' as const,
                    text: text
                  }].slice(-6);
                } else {
                  lastTurn.text = text;
                  this.chatTurns = [...this.chatTurns];
                }
                this.scrollDialogToBottom();
              }
            }
            if ((message as any).outputTranscription?.text) {
              const text = (message as any).outputTranscription.text.trim();
              if (text) {
                this.modelTranscript = text;
                this.mood = this.determineMood(this.modelTranscript);
                const lastTurn = this.chatTurns[this.chatTurns.length - 1];
                if (!lastTurn || lastTurn.sender !== 'model') {
                  this.chatTurns = [...this.chatTurns, {
                    id: Math.random().toString(36).substring(2),
                    sender: 'model' as const,
                    text: text
                  }].slice(-6);
                } else {
                  lastTurn.text = text;
                  this.chatTurns = [...this.chatTurns];
                }
                this.scrollDialogToBottom();
              }
            }
          },
          onerror: (e: ErrorEvent) => {
            this.updateError(e.message);
          },
          onclose: (e: CloseEvent) => {
            this.updateStatus('Connection inactive: ' + e.reason);
          },
        },
        config: config,
      });
    } catch (e: any) {
      console.error(e);
      this.updateError('Establish session failed: ' + e.message);
    }
  }

  private updateStatus(msg: string) {
    this.status = msg;
  }

  private updateError(msg: string) {
    this.error = msg;
  }

  private async startRecording() {
    if (this.isRecording) {
      return;
    }

    this.inputAudioContext.resume();
    this.updateStatus('Requesting microphone access...');

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });

      this.updateStatus('Microphone capture started...');

      this.sourceNode = this.inputAudioContext.createMediaStreamSource(
        this.mediaStream,
      );
      this.sourceNode.connect(this.inputNode);
      this.inputNode.gain.value = this.isMuted ? 0 : 1;

      const bufferSize = 256;
      this.scriptProcessorNode = this.inputAudioContext.createScriptProcessor(
        bufferSize,
        1,
        1,
      );

      this.scriptProcessorNode.onaudioprocess = (audioProcessingEvent) => {
        if (!this.isRecording) return;
        if (this.isMuted) return;

        const inputBuffer = audioProcessingEvent.inputBuffer;
        const pcmData = inputBuffer.getChannelData(0);

        try {
          this.session.sendRealtimeInput({media: createBlob(pcmData)});
        } catch (e) {}
      };

      this.sourceNode.connect(this.scriptProcessorNode);
      this.scriptProcessorNode.connect(this.inputAudioContext.destination);

      this.isRecording = true;
      this.updateStatus('Active');
    } catch (err: any) {
      console.error('Error starting recording:', err);
      this.updateStatus(`Error: ${err.message}`);
      this.stopRecording();
    }
  }

  private toggleMute() {
    this.isMuted = !this.isMuted;
    if (this.inputNode) {
      this.inputNode.gain.value = this.isMuted ? 0 : 1;
    }
  }

  private stopRecording() {
    if (!this.isRecording && !this.mediaStream && !this.inputAudioContext)
      return;

    this.isRecording = false;

    if (this.scriptProcessorNode && this.sourceNode && this.inputAudioContext) {
      try {
        this.scriptProcessorNode.disconnect();
        this.sourceNode.disconnect();
      } catch (e) {}
    }

    this.scriptProcessorNode = null;
    this.sourceNode = null;

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (e) {}
      });
      this.mediaStream = null;
    }

    this.updateStatus('Recording stopped');
  }

  private reset() {
    this.stopRecording();
    this.session?.close();
    this.initSession();
    this.updateStatus('Session cleared');
  }

  render() {
    return html`
      <div class="app-container">
        <!-- Sidebar Panel -->
        <div class="glass-panel left-sidebar interactive-element">
          <header>
            <h1>Prime Audio Orb</h1>
            <div class="subtitle">Live Cognitive Bridge</div>
          </header>
          <div class="divider"></div>

          <!-- Status Indicator -->
          <div class="status-area">
            <div class="status-dot ${this.isRecording ? 'recording' : this.status.includes('Active') || this.status.includes('ready') ? '' : 'idle'}"></div>
            <span>${this.status || 'Connecting...'}</span>
          </div>

          <!-- Sentiment Aura Badge -->
          <div class="aura-area">
            <span class="aura-label">Aura:</span>
            <span class="aura-badge mood-${this.mood}">
              ${this.mood === 'neutral' ? 'Calm / Wise' : 
                this.mood === 'excited' ? 'Vibrant / Energetic' :
                this.mood === 'analytical' ? 'Thoughtful / Analytical' :
                this.mood === 'warm' ? 'Empathetic / Warm' :
                this.mood === 'mysterious' ? 'Cosmic / Mystical' : 'Calm'}
            </span>
          </div>

          <!-- High Thinking Switch -->
          <div class="toggle-container">
            <div class="toggle-row">
              <span class="toggle-label">High Thinking Mode</span>
              <label class="switch">
                <input 
                  type="checkbox" 
                  .checked=${this.thinkingEnabled} 
                  @change=${this.toggleThinking}>
                <span class="slider"></span>
              </label>
            </div>
            <div class="toggle-desc">
              Grants the orb an active reasoning budget. The orb will compute deep step-by-step thoughts before speaking, visible in real-time.
            </div>
          </div>

          <!-- Controls Section -->
          <div class="controls-group">
            <button
              class="mic-button ${this.isRecording ? 'recording' : ''}"
              @click=${this.isRecording ? this.stopRecording : this.startRecording}
              title=${this.isRecording ? 'Stop Recording' : 'Start Recording'}>
              ${this.isRecording ? html`
                <!-- Stop Icon -->
                <svg viewBox="0 0 24 24" width="36" height="36" fill="currentColor">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              ` : html`
                <!-- Mic Icon -->
                <svg viewBox="0 0 24 24" width="36" height="36" fill="currentColor">
                  <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                  <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
                </svg>
              `}
            </button>

            <div class="secondary-buttons">
              <button
                class="btn-secondary ${this.isMuted ? 'muted' : ''}"
                @click=${this.toggleMute}
                title=${this.isMuted ? 'Unmute Microphone' : 'Mute Microphone'}>
                ${this.isMuted ? html`
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                    <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17l1.02 1.02c.63-.61.99-1.47.99-2.39V5c0-1.66-1.35-3-3-3s-3 1.34-3 3v.17l4 4v1zM4.41 2.86L3 4.27l6.01 6.01V11c0 1.66 1.35 3 3 3 .55 0 1.05-.15 1.49-.4l3.12 3.12c-.81.65-1.78 1.1-2.85 1.23V21h-2v-3.05c-3.35-.43-6-3.3-6-6.81l-2-.01c0 4.14 3.03 7.57 7 8.16V22h4v-1.84c1.55-.23 2.97-.84 4.15-1.71l2.58 2.58 1.41-1.41L4.41 2.86zM12 12c-.55 0-1-.45-1-1v-.17l1.17 1.17c-.06.01-.11.01-.17.01z"/>
                  </svg>
                  Unmute Mic
                ` : html`
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                    <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.4 2.72 6.2 6 6.7V21h2v-3.3c3.28-.5 6-3.3 6-6.7h-1.7z"/>
                  </svg>
                  Mute Mic
                `}
              </button>

              <button
                class="btn-secondary"
                @click=${this.reset}
                ?disabled=${this.isRecording}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                  <path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
                </svg>
                Sync Session
              </button>
            </div>
          </div>

          ${this.error ? html`
            <div class="error-banner">
              <strong>Error:</strong> ${this.error}
            </div>
          ` : ''}
        </div>

        <!-- Center / Right / Bottom Area -->
        <div class="content-area">
          <div class="right-panels">
            <!-- Thought Panel -->
            <div class="glass-panel thought-panel ${this.thinkingEnabled ? 'active' : ''} interactive-element">
              <div class="panel-header">
                ${this.thinkingEnabled ? html`<div class="pulse-dot-amber"></div>` : ''}
                <h2>Orb Thought Stream</h2>
              </div>
              <div class="thought-stream" id="thoughtStream">
                ${this.thoughts.length > 0 ? html`
                  ${this.thoughts.map(t => html`<span>${t}</span>`)}
                ` : html`
                  <div class="thought-placeholder">
                    ${this.thinkingEnabled ? 'Awaiting spoken query... Speak to orb to begin reasoning.' : 'High Thinking Mode is currently inactive. Toggle it to view internal thoughts.'}
                  </div>
                `}
              </div>
            </div>
          </div>

          <!-- Dialog / Subtitle Pill -->
          <div class="dialog-panel interactive-element">
            <div class="dialog-box" id="dialogBox">
              ${this.chatTurns.length > 0 ? html`
                ${this.chatTurns.map((turn, index) => {
                  const distanceFromNewest = this.chatTurns.length - 1 - index;
                  let opacity = 1.0;
                  if (distanceFromNewest === 1) opacity = 0.7;
                  else if (distanceFromNewest === 2) opacity = 0.45;
                  else if (distanceFromNewest === 3) opacity = 0.25;
                  else if (distanceFromNewest >= 4) opacity = 0.12;

                  return html`
                    <div class="dialog-line" style="opacity: ${opacity};">
                      <span class="dialog-speaker ${turn.sender}">${turn.sender === 'user' ? 'You' : 'Orb'}</span>
                      <span class="dialog-text">${turn.text}</span>
                    </div>
                  `;
                })}
              ` : html`
                <div class="dialog-line" style="justify-content: center; opacity: 0.7;">
                  <span class="dialog-text empty">Awaiting conversation... Speak to the orb to begin.</span>
                </div>
              `}
            </div>
          </div>
        </div>

        <!-- Background 3D Canvas -->
        <gdm-live-audio-visuals-3d
          .inputNode=${this.inputNode}
          .outputNode=${this.outputNode}
          .thinking=${this.thinkingEnabled}
          .mood=${this.mood}></gdm-live-audio-visuals-3d>
      </div>
    `;
  }
}
