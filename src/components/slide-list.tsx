"use client";

import React from 'react';
import { cn } from '@/lib/utils';

const slides = [
    { id: 1, title: 'Spring Sale 2026', status: '완료', color: 'bg-purple-500' },
    { id: 2, title: 'Product Launch', status: '완료', color: 'bg-indigo-400' },
    { id: 3, title: 'Marketing Strategy', status: '생성중', color: 'bg-slate-200' },
    { id: 4, title: 'Brand Awareness', status: '초안', color: 'bg-slate-100' },
];

export function SlideList() {
    return (
        <div className="space-y-4">
            <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-black tracking-tight">슬라이드 목록</h3>
            </div>
            <div className="grid grid-cols-2 gap-4">
                {slides.map((slide) => (
                    <div key={slide.id} className="group relative">
                        <div className={cn(
                            "aspect-square rounded-2xl overflow-hidden border-2 transition-all p-4 flex flex-col justify-end text-white relative",
                            slide.status === '완료' ? "border-pink-500 ring-2 ring-pink-500/20" : "border-slate-100"
                        )}>
                            <div className={cn("absolute inset-0 opacity-40", slide.color)}></div>
                            <div className="absolute top-2 left-2 w-5 h-5 rounded-full bg-black/20 backdrop-blur-md flex items-center justify-center text-[10px] font-bold">
                                {slide.id}
                            </div>
                            <div className="relative z-10">
                                <p className="text-[11px] font-black leading-tight mb-2">{slide.title}</p>
                                <span className={cn(
                                    "text-[9px] px-2 py-0.5 rounded-full font-black uppercase tracking-wider",
                                    slide.status === '완료' ? "bg-pink-500 text-white" : "bg-white text-slate-500"
                                )}>
                                    {slide.status}
                                </span>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
