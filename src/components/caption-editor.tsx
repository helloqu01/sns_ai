"use client";

import React, { useState } from 'react';
import { Sparkles, Copy, Wand2, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

const tones = [
    { id: 'professional', label: '전문적', icon: '🌐', description: '신뢰감 있는 정보형 톤' },
    { id: 'friendly', label: '친근한', icon: '😊', description: '부드럽고 쉽게 읽히는 톤' },
    { id: 'trendy', label: '트렌디', icon: '✨', description: '감각적이고 힙한 톤' },
];

const captionStyles = [
    { id: 'balanced', label: '밸런스', description: '소개와 안내를 균형 있게' },
    { id: 'magazine', label: '매거진', description: '에디토리얼 느낌으로 정리' },
    { id: 'promotional', label: '프로모션', description: '참여와 반응을 유도' },
    { id: 'minimal', label: '미니멀', description: '짧고 명확하게 요약' },
];

interface CaptionEditorProps {
    text: string;
    onTextChange: (text: string) => void;
    tone: string;
    onToneChange: (tone: string) => void;
    styleMode: string;
    onStyleModeChange: (style: string) => void;
    onGenerateCaption: () => void | Promise<void>;
    isGeneratingCaption?: boolean;
    className?: string;
    compact?: boolean;
    embedded?: boolean;
    showToneAndStyleControls?: boolean;
    quickGenerateLabel?: string;
    generateButtonLabel?: string;
    generateButtonLoadingLabel?: string;
    showQuickGenerateButton?: boolean;
    customStylePanel?: React.ReactNode;
    customStylePanelLabel?: string;
}

export function CaptionEditor({
    text,
    onTextChange,
    tone,
    onToneChange,
    styleMode,
    onStyleModeChange,
    onGenerateCaption,
    isGeneratingCaption = false,
    className,
    compact = false,
    embedded = false,
    showToneAndStyleControls = true,
    quickGenerateLabel = 'AI 생성',
    generateButtonLabel = 'AI 캡션 생성',
    generateButtonLoadingLabel = '캡션 생성 중...',
    showQuickGenerateButton = true,
    customStylePanel,
    customStylePanelLabel = '스타일 선택',
}: CaptionEditorProps) {
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className={cn(
            embedded
                ? "rounded-[1.75rem] border border-slate-100/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.94),rgba(252,249,251,0.98))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] flex flex-col break-keep"
                : "glassmorphism rounded-[2rem] border-none shadow-xl flex flex-col break-keep",
            embedded
                ? ""
                : compact ? "p-5" : "p-6 h-full",
            className,
        )}>
            <div className="mb-5 flex items-center justify-between gap-4">
                <div>
                    <h3 className="text-lg font-black tracking-tight text-slate-900">캡션 편집</h3>
                    <p className="text-[11px] font-bold leading-relaxed text-slate-400">
                        {showToneAndStyleControls
                            ? '생성된 초안을 다듬거나 설정을 바꿔 생성할 수 있습니다.'
                            : '생성된 초안을 다듬거나 AI 캡션을 생성할 수 있습니다.'}
                    </p>
                </div>
                {showQuickGenerateButton && (
                    <button
                        onClick={onGenerateCaption}
                        disabled={isGeneratingCaption}
                        className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-pink-100 bg-pink-50 px-3 py-1.5 text-[10px] font-black text-pink-600 disabled:opacity-50"
                    >
                        {isGeneratingCaption ? <div className="h-3 w-3 animate-spin rounded-full border-2 border-pink-600/30 border-t-pink-600" /> : <Wand2 className="h-3 w-3" />}
                        {quickGenerateLabel}
                    </button>
                )}
            </div>

            <div className="flex flex-1 flex-col gap-4">
                {showToneAndStyleControls && (
                    <div className="grid gap-3 xl:grid-cols-[1.15fr,1fr]">
                        <div className="rounded-[1.35rem] border border-slate-100 bg-white/90 p-3">
                            <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-400">톤 선택</label>
                            <div className="grid gap-2">
                            {tones.map((toneOption) => (
                                <button
                                    key={toneOption.id}
                                    onClick={() => onToneChange(toneOption.id)}
                                    className={cn(
                                        "flex items-center justify-between gap-3 rounded-[1rem] border px-3 py-2.5 text-left transition-all",
                                        tone === toneOption.id
                                            ? "border-pink-200 bg-pink-50 shadow-sm"
                                            : "border-slate-100 bg-white text-slate-500 hover:border-slate-200"
                                    )}
                                >
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm">{toneOption.icon}</span>
                                        <div>
                                            <div className={cn("text-xs font-black", tone === toneOption.id ? "text-pink-700" : "text-slate-700")}>{toneOption.label}</div>
                                            <div className="text-[10px] font-bold text-slate-400">{toneOption.description}</div>
                                        </div>
                                    </div>
                                    {tone === toneOption.id && <Check className="h-4 w-4 text-pink-600" />}
                                </button>
                            ))}
                            </div>
                        </div>

                        <div className="rounded-[1.35rem] border border-slate-100 bg-white/90 p-3">
                            <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-400">{customStylePanelLabel}</label>
                            {customStylePanel || (
                                <div className="grid grid-cols-2 gap-2">
                                    {captionStyles.map((style) => (
                                        <button
                                            key={style.id}
                                            onClick={() => onStyleModeChange(style.id)}
                                            className={cn(
                                                "rounded-[1rem] border px-3 py-3 text-left transition-all",
                                                styleMode === style.id
                                                    ? "border-slate-900 bg-slate-900 text-white shadow-lg shadow-slate-200"
                                                    : "border-slate-100 bg-white text-slate-600 hover:border-slate-200"
                                            )}
                                        >
                                            <div className="text-[11px] font-black">{style.label}</div>
                                            <div className={cn("mt-1 text-[10px] font-bold leading-relaxed", styleMode === style.id ? "text-white/70" : "text-slate-400")}>
                                                {style.description}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                <div className="flex-1 relative">
                    <textarea
                        value={text}
                        onChange={(e) => onTextChange(e.target.value)}
                        placeholder="이곳에 인스타그램 캡션이 생성됩니다."
                        className={cn(
                            "w-full h-full break-keep bg-slate-50/50 border-2 border-slate-100 rounded-[1.5rem] p-5 text-sm font-bold leading-relaxed outline-none focus:border-pink-200 transition-all resize-none",
                            compact ? "min-h-[190px]" : "min-h-[250px]",
                        )}
                    />
                    <span className="absolute bottom-4 right-6 whitespace-nowrap text-[10px] font-bold text-slate-300">
                        {text.length}/2,200
                    </span>
                </div>

                <div className="flex flex-wrap gap-3 pt-2">
                    <button
                        onClick={onGenerateCaption}
                        disabled={isGeneratingCaption}
                        className="min-w-0 flex-1 whitespace-nowrap rounded-2xl bg-pink-600 py-4 font-black text-white shadow-lg shadow-pink-200 transition-all hover:bg-pink-700 active:scale-95 flex items-center justify-center gap-2 disabled:bg-pink-300"
                    >
                        {isGeneratingCaption ? (
                            <div className="w-5 h-5 border-3 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : (
                            <Sparkles className="w-5 h-5" />
                        )}
                        {isGeneratingCaption ? generateButtonLoadingLabel : generateButtonLabel}
                    </button>
                    <button
                        onClick={handleCopy}
                        className="shrink-0 basis-[112px] whitespace-nowrap rounded-2xl border-2 border-slate-100 bg-white py-4 font-black transition-all hover:border-slate-200 active:scale-95 flex items-center justify-center gap-2"
                    >
                        {copied ? <Check className="w-5 h-5 text-emerald-500" /> : <Copy className="w-5 h-5 text-slate-400" />}
                        복사
                    </button>
                </div>

                <div className="pt-4 border-t border-slate-50">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 block"># 추천 해시태그</label>
                    <div className="flex flex-wrap gap-2">
                        {['페스티벌가이드', '주간페스티벌', '퀸즈스마일', '페스티벌소식', '놀러가자'].map(tag => (
                            <span key={tag} className="whitespace-nowrap text-[10px] font-black px-3 py-1.5 rounded-full bg-white border border-slate-100 text-slate-400">#{tag}</span>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
