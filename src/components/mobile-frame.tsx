"use client";

import React from 'react';
import { Heart, MessageCircle, Send, Bookmark, MoreHorizontal, ChevronLeft, ChevronRight } from 'lucide-react';

export function MobileFrame() {
    return (
        <div className="w-full max-w-[320px] aspect-[9/18.5] bg-white rounded-[3rem] shadow-2xl border-[8px] border-slate-900 overflow-hidden relative">
            {/* Top Bar */}
            <div className="h-14 flex items-center justify-between px-6 border-b border-slate-50">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-yellow-400 via-red-500 to-purple-600 p-[2px]">
                        <div className="w-full h-full rounded-full bg-slate-200 border-2 border-white"></div>
                    </div>
                    <div className="leading-tight">
                        <p className="text-[11px] font-black">your_brand</p>
                        <p className="text-[9px] text-slate-400">스폰서</p>
                    </div>
                </div>
                <MoreHorizontal className="w-4 h-4 text-slate-400" />
            </div>

            {/* Main Image View */}
            <div className="relative aspect-square bg-gradient-to-br from-purple-400 to-indigo-600 flex flex-col items-center justify-center p-8 text-white overflow-hidden">
                <div className="relative z-10 text-center animate-in fade-in zoom-in duration-700">
                    <p className="text-[10px] font-black tracking-widest opacity-60 mb-2 uppercase">2026 Collection</p>
                    <h2 className="text-4xl font-black mb-4 drop-shadow-lg leading-tight">SPRING<br />SALE</h2>
                    <p className="text-sm font-bold opacity-80 uppercase tracking-tighter">New Arrivals Only</p>
                </div>

                {/* Navigation Arrows */}
                <button className="absolute left-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-black/10 flex items-center justify-center backdrop-blur-md">
                    <ChevronLeft className="w-4 h-4" />
                </button>
                <button className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/20 flex items-center justify-center backdrop-blur-md shadow-lg border border-white/30">
                    <ChevronRight className="w-5 h-5" />
                </button>

                {/* Dots */}
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-white"></div>
                    <div className="w-1.5 h-1.5 rounded-full bg-white/30"></div>
                    <div className="w-1.5 h-1.5 rounded-full bg-white/30"></div>
                    <div className="w-1.5 h-1.5 rounded-full bg-white/30"></div>
                </div>

                {/* Decor */}
                <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-pink-400/30 rounded-full blur-3xl"></div>
                <div className="absolute top-0 left-0 w-full h-full opacity-30 mix-blend-overlay bg-[url('https://www.transparenttextures.com/patterns/clean-gray-paper.png')]"></div>
            </div>

            {/* Actions */}
            <div className="p-4 flex items-center justify-between">
                <div className="flex gap-4">
                    <Heart className="w-5 h-5 text-slate-900" />
                    <MessageCircle className="w-5 h-5 text-slate-900" />
                    <Send className="w-5 h-5 text-slate-900" />
                </div>
                <Bookmark className="w-5 h-5 text-slate-900" />
            </div>

            <div className="px-4 pb-4">
                <p className="text-xs font-black">1,402 likes</p>
                <p className="text-[11px] mt-1"><span className="font-black mr-1">your_brand</span>봄맞이 특별 프로모션이 시작되었습니다! 🌸</p>
            </div>
        </div>
    );
}
