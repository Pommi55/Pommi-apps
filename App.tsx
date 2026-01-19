
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai';
import { SessionStatus, ChatMessage } from './types.ts';
import { encode, decode, decodeAudioData, createBlob } from './utils/audio-utils.ts';

const SYSTEM_INSTRUCTION = `You are "Zephyr", a world-class American English speaking coach from San Francisco. 
Your mission is to help Chinese learners (from beginners to professionals) overcome their fear of speaking English.

PERSONALITY & RULES:
1. EXTREMELY ENCOURAGING: Use phrases like "You're doing amazing!", "I love that expression!", "Don't worry about the grammar, just keep going!"
2. AMERICAN STYLE: Speak in clear, standard American English with a warm, energetic tone.
3. BILINGUAL SUPPORT: Always provide the English response followed by a Chinese translation in brackets. 
   Example: "That's a fantastic way to put it! [这是一个非常出色的表达方式！]"
4. PROMPT SPEAKING: If the user is quiet, gently nudge them: "I'm here for you, what's on your mind? [我在这儿呢，你在想什么？]"
5. FEEDBACK: Only provide ONE small correction at the end of your turn if necessary, but prioritize the flow of conversation over perfect grammar.
6. TOPICS: Focus on daily life, career goals, or technology to make it practical.
`;

const App: React.FC = () => {
  const [status, setStatus] = useState<SessionStatus>(SessionStatus.IDLE);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<any>(null);
  const audioContextsRef = useRef<{ input: AudioContext; output: AudioContext } | null>(null);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const nextStartTimeRef = useRef(0);
  const transcriptionBufferRef = useRef({ user: '', model: '' });

  // 自动滚动到最新消息
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [messages]);

  const stopAudio = useCallback(() => {
    sourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;
  }, []);

  const handleStartSession = async () => {
    try {
      setStatus(SessionStatus.CONNECTING);
      
      const apiKey = process.env.API_KEY;
      if (!apiKey) throw new Error("API Key is missing.");

      const ai = new GoogleGenAI({ apiKey });
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      audioContextsRef.current = { input: inputCtx, output: outputCtx };

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            setStatus(SessionStatus.ACTIVE);
            const source = inputCtx.createMediaStreamSource(stream);
            const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createBlob(inputData);
              sessionPromise.then(s => s.sendRealtimeInput({ media: pcmBlob }));
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(inputCtx.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            // 处理转录文字
            if (message.serverContent?.inputTranscription) {
              transcriptionBufferRef.current.user += message.serverContent.inputTranscription.text;
            }
            if (message.serverContent?.outputTranscription) {
              transcriptionBufferRef.current.model += message.serverContent.outputTranscription.text;
            }
            if (message.serverContent?.turnComplete) {
              const uText = transcriptionBufferRef.current.user.trim();
              const mText = transcriptionBufferRef.current.model.trim();
              if (uText || mText) {
                setMessages(prev => [
                  ...prev,
                  ...(uText ? [{ id: `u-${Date.now()}`, role: 'user' as const, text: uText, timestamp: Date.now() }] : []),
                  ...(mText ? [{ id: `m-${Date.now()}`, role: 'model' as const, text: mText, timestamp: Date.now() }] : [])
                ]);
              }
              transcriptionBufferRef.current = { user: '', model: '' };
            }

            // 播放音频
            const audioData = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (audioData && audioContextsRef.current) {
              const ctx = audioContextsRef.current.output;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              const buffer = await decodeAudioData(decode(audioData), ctx, 24000, 1);
              const source = ctx.createBufferSource();
              source.buffer = buffer;
              source.connect(ctx.destination);
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += buffer.duration;
              sourcesRef.current.add(source);
            }
            if (message.serverContent?.interrupted) stopAudio();
          },
          onerror: (e) => { 
            console.error("Session Error:", e);
            setStatus(SessionStatus.ERROR);
          },
          onclose: () => setStatus(SessionStatus.IDLE)
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: SYSTEM_INSTRUCTION,
        },
      });
      sessionRef.current = await sessionPromise;
    } catch (err) {
      console.error("Init Error:", err);
      setStatus(SessionStatus.ERROR);
      alert("请确保已开启麦克风权限。");
    }
  };

  const handleStopSession = () => {
    if (sessionRef.current) sessionRef.current.close();
    stopAudio();
    if (audioContextsRef.current) {
      audioContextsRef.current.input.close();
      audioContextsRef.current.output.close();
    }
    setStatus(SessionStatus.IDLE);
  };

  return (
    <div className="flex flex-col h-screen w-full bg-[#0B0F1A] text-slate-100 font-sans overflow-hidden">
      {/* 顶部状态栏 */}
      <header className="px-6 py-5 bg-slate-900/80 backdrop-blur-xl border-b border-white/5 flex justify-between items-center z-20 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-500 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/30 ring-1 ring-white/20">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-white/90">Zephyr Coaching</h1>
            <p className="text-[9px] text-indigo-400 font-bold tracking-[0.2em] uppercase">Elite American Tutor</p>
          </div>
        </div>
        <div className="flex items-center gap-2 px-3 py-1 bg-white/5 rounded-full border border-white/10">
           <div className={`w-1.5 h-1.5 rounded-full ${status === SessionStatus.ACTIVE ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} />
           <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{status}</span>
        </div>
      </header>

      {/* 聊天内容区 */}
      <main className="flex-1 overflow-hidden relative">
        <div ref={chatScrollRef} className="h-full overflow-y-auto px-6 py-10 space-y-8 max-w-2xl mx-auto scrollbar-hide">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center animate-slide-in">
              <div className="w-24 h-24 bg-indigo-500/10 rounded-[2.5rem] border border-indigo-500/20 flex items-center justify-center mb-8 relative">
                <div className="absolute inset-0 bg-indigo-500/5 rounded-[2.5rem] animate-pulse" />
                <svg className="w-12 h-12 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold mb-4 text-white">Ready to boost your confidence?</h2>
              <p className="text-slate-400 text-sm leading-relaxed max-w-xs mx-auto font-medium">
                点击下方按钮，开始和 Zephyr 导师对话。我会实时通过中文辅助你，带你自信开口。
              </p>
            </div>
          ) : (
            messages.map(m => (
              <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} animate-slide-in`}>
                <div className={`max-w-[88%] px-5 py-4 rounded-2xl text-[14px] leading-relaxed shadow-2xl ${
                  m.role === 'user' 
                    ? 'bg-indigo-600 text-white rounded-tr-none' 
                    : 'bg-slate-800 text-slate-200 border border-white/5 rounded-tl-none'
                }`}>
                  <p className="font-medium whitespace-pre-wrap">{m.text}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </main>

      {/* 底部控制台 */}
      <footer className="px-6 py-12 bg-slate-900/50 backdrop-blur-3xl border-t border-white/5 flex flex-col items-center gap-6 z-20 shrink-0">
        <div className="relative">
          {status === SessionStatus.ACTIVE && (
            <>
              <div className="absolute inset-[-20px] bg-indigo-500/10 rounded-full animate-ping" />
              <div className="absolute inset-[-10px] bg-indigo-500/5 rounded-full animate-pulse border border-indigo-500/20" />
            </>
          )}
          <button
            onClick={status === SessionStatus.ACTIVE ? handleStopSession : handleStartSession}
            disabled={status === SessionStatus.CONNECTING}
            className={`w-20 h-20 rounded-full flex items-center justify-center text-white shadow-2xl transition-all active:scale-95 hover:scale-105 relative z-10 ${
              status === SessionStatus.ACTIVE ? 'bg-rose-500' : 'bg-indigo-600 shadow-indigo-500/20'
            } disabled:opacity-50`}
          >
            {status === SessionStatus.CONNECTING ? (
              <div className="w-8 h-8 border-3 border-white/20 border-t-white rounded-full animate-spin" />
            ) : status === SessionStatus.ACTIVE ? (
              <svg className="w-10 h-10" fill="currentColor" viewBox="0 0 24 24"><rect width="12" height="12" x="6" y="6" rx="2"/></svg>
            ) : (
              <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            )}
          </button>
        </div>
        
        <div className="text-center">
          <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.4em] mb-1">
            {status === SessionStatus.ACTIVE ? 'Coach Zephyr is listening...' : status === SessionStatus.CONNECTING ? 'Establishing connection...' : 'Tap the mic to start speaking'}
          </p>
          <p className="text-[9px] text-slate-600 font-bold uppercase tracking-wider">Your safe space to practice American English</p>
        </div>
      </footer>
    </div>
  );
};

export default App;
